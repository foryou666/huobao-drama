/**
 * 制作助手 — 会话持久化 + SSE 流式对话
 */
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createAgent, validAgentTypes } from '../agents/index.js'
import { db, schema } from '../db/index.js'
import { badRequest, success } from '../utils/response.js'
import { collectAgentStream } from '../services/agent-chat.js'
import {
  appendThreadMessage,
  applyContextToUserMessage,
  buildHistoryFromThread,
  clearAssistantThread,
  getOrCreateThread,
  getThreadForUser,
  listThreadMessages,
  updateThreadMessage,
} from '../services/assistant-store.js'
import { getAuthUser, type AuthVariables } from '../middleware/auth.js'
import {
  extractAttachmentsFromTools,
  parseAttachments,
  serializeAttachments,
} from '../services/assistant-attachments.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono<{ Variables: AuthVariables }>()

const MUTATING_TOOLS = new Set([
  'save_script',
  'save_storyboards',
  'update_storyboard',
  'save_dedup_characters',
  'save_dedup_scenes',
  'assign_voice',
  'update_character_image_prompt',
  'update_scene_image_prompt',
  'generate_character_image',
  'batch_generate_character_images',
  'generate_scene_image',
  'batch_generate_scene_images',
  'generate_shot_frame',
  'generate_voice_sample',
  'generate_shot_tts',
  'batch_generate_shot_tts',
  'generate_shot_video',
  'batch_generate_shot_videos',
  'compose_shot',
  'compose_all_shots',
  'merge_episode',
])

function sseChunk(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function parseIntParam(value: string | undefined, name: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ${name}`)
  return n
}

// GET /assistant/messages?episode_id=&step_key=
app.get('/messages', (c) => {
  const user = getAuthUser(c)
  let episodeId: number
  let stepKey: string
  try {
    episodeId = parseIntParam(c.req.query('episode_id'), 'episode_id')
    stepKey = String(c.req.query('step_key') || '').trim()
    if (!stepKey) throw new Error('missing step_key')
  } catch (err: any) {
    return badRequest(c, err.message)
  }

  const thread = getThreadForUser(user.id, episodeId, stepKey)
  if (!thread) {
    return success(c, { items: [], thread_id: null, agent_type: null })
  }

  return success(c, {
    thread_id: thread.id,
    agent_type: thread.agentType,
    items: listThreadMessages(thread.id),
  })
})

// DELETE /assistant/messages?episode_id=&step_key=
app.delete('/messages', (c) => {
  const user = getAuthUser(c)
  let episodeId: number
  let stepKey: string
  try {
    episodeId = parseIntParam(c.req.query('episode_id'), 'episode_id')
    stepKey = String(c.req.query('step_key') || '').trim()
    if (!stepKey) throw new Error('missing step_key')
  } catch (err: any) {
    return badRequest(c, err.message)
  }

  clearAssistantThread(user.id, episodeId, stepKey)
  return success(c, { cleared: true })
})

// POST /assistant/activity — 记录左侧一键操作（不调用 Agent）
app.post('/activity', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json() as {
    episode_id?: number
    step_key?: string
    agent_type?: string
    user_message?: string
    assistant_message?: string
    attachments?: unknown[]
  }

  let episodeId: number
  let stepKey: string
  try {
    episodeId = parseIntParam(String(body.episode_id), 'episode_id')
    stepKey = String(body.step_key || '').trim()
    if (!stepKey) throw new Error('missing step_key')
  } catch (err: any) {
    return badRequest(c, err.message)
  }

  const userMessage = String(body.user_message || '').trim()
  const assistantMessage = String(body.assistant_message || '').trim()
  if (!userMessage || !assistantMessage) {
    return badRequest(c, 'user_message and assistant_message are required')
  }

  const agentType = String(body.agent_type || 'grid_prompt_generator').trim()
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `Invalid agent type: ${agentType}`)
  }

  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  const attachmentsJson = serializeAttachments(attachments as any)

  const thread = getOrCreateThread(user.id, episodeId, stepKey, agentType)
  const userRow = appendThreadMessage(thread.id, 'user', userMessage)
  const assistantRow = appendThreadMessage(
    thread.id,
    'assistant',
    assistantMessage,
    null,
    attachmentsJson,
  )

  return success(c, {
    user_message_id: userRow.id,
    assistant_message_id: assistantRow.id,
    attachments,
  })
})

// PATCH /assistant/messages/:id — 更新附件状态（如异步生成完成）
app.patch('/messages/:id', async (c) => {
  const user = getAuthUser(c)
  const messageId = Number(c.req.param('id'))
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return badRequest(c, 'invalid message id')
  }

  const body = await c.req.json() as {
    content?: string
    attachments?: unknown[]
  }

  const [row] = db.select().from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.id, messageId))
    .all()
  if (!row) return badRequest(c, 'message not found')

  const [thread] = db.select().from(schema.assistantThreads)
    .where(eq(schema.assistantThreads.id, row.threadId))
    .all()
  if (!thread || thread.userId !== user.id) {
    return badRequest(c, 'message not found')
  }

  const attachmentsJson = body.attachments !== undefined
    ? serializeAttachments(body.attachments as any)
    : undefined

  const updated = updateThreadMessage(messageId, {
    content: body.content !== undefined ? String(body.content) : undefined,
    attachments: attachmentsJson,
  })

  if (!updated) return badRequest(c, 'nothing to update')

  return success(c, {
    id: updated.id,
    content: updated.content,
    attachments: parseAttachments(updated.attachments),
  })
})

// POST /assistant/chat/stream — SSE
app.post('/chat/stream', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()
  const {
    agent_type: agentType,
    message,
    drama_id: dramaId,
    episode_id: episodeId,
    step_key: stepKey,
    context,
  } = body

  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `Invalid agent type: ${agentType}`)
  }
  if (!episodeId || !dramaId || !stepKey || typeof stepKey !== 'string') {
    return badRequest(c, 'drama_id, episode_id and step_key are required')
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return badRequest(c, 'message is required')
  }

  const plainMessage = message.trim()
  const thread = getOrCreateThread(user.id, episodeId, stepKey, agentType)
  const userRow = appendThreadMessage(thread.id, 'user', plainMessage)

  const history = buildHistoryFromThread(thread.id, plainMessage)
  const chatMessages = [
    ...history,
    { role: 'user' as const, content: applyContextToUserMessage(plainMessage, context) },
  ]

  const agent = createAgent(agentType, episodeId, dramaId)
  if (!agent) return badRequest(c, 'Agent not found')

  const billed = tryChargeUser(c, CREDIT_ACTIONS.ASSISTANT_CHAT, {
    summary: `制作助手：${agentType}`,
    dramaId,
    episodeId,
    metadata: { agent_type: agentType, step_key: stepKey },
  })
  if (billed.error) return billed.error

  logTaskStart('Assistant', agentType, {
    userId: user.id,
    dramaId,
    episodeId,
    stepKey,
    message: plainMessage,
  })

  const startTime = performance.now()

  return new Response(new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseChunk(event, data)))
      }

      send('user', {
        id: userRow.id,
        role: 'user',
        content: userRow.content,
        created_at: userRow.createdAt,
      })

      try {
        let streamedText = ''
        const toolNames: string[] = []

        const result = await collectAgentStream(agent, chatMessages, {
          onDelta: (text) => {
            streamedText += text
            send('delta', { text })
          },
          onTool: (phase, name) => {
            if (phase === 'start' && name && !toolNames.includes(name)) {
              toolNames.push(name)
              send('tool', { phase, name })
            }
          },
        })

        const finalText = (result.text || streamedText || '').trim()
          || (result.toolCalls.length ? '已完成工具调用。' : '（无文本回复）')
        const toolSummary = result.toolCalls
          .map(tc => tc.toolName)
          .filter(Boolean)
          .length
          ? `已调用：${result.toolCalls.map(tc => tc.toolName).filter(Boolean).join('、')}`
          : null

        const attachments = extractAttachmentsFromTools(result.toolCalls, result.toolResults)
        const attachmentsJson = serializeAttachments(attachments)

        const assistantRow = appendThreadMessage(thread.id, 'assistant', finalText, toolSummary, attachmentsJson)

        const mutated = result.toolCalls.some(tc => tc.toolName && MUTATING_TOOLS.has(tc.toolName))
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
        logTaskSuccess('Assistant', agentType, { elapsedSeconds: elapsed, mutated })

        logActivity(user, {
          action: 'assistant.chat',
          summary: `制作助手：${agentType}`,
          dramaId,
          episodeId,
          creditCost: billed.charge.cost,
          metadata: { agent_type: agentType, step_key: stepKey, mutated, credit_tx_id: billed.charge.transactionId },
        })

        send('done', {
          assistant_message_id: assistantRow.id,
          text: finalText,
          tool_summary: toolSummary,
          attachments,
          toolCalls: result.toolCalls,
          mutated,
          credits_balance: billed.charge.balance,
        })
      } catch (err: any) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
        logTaskError('Assistant', agentType, { elapsedSeconds: elapsed, error: err.message })
        send('error', { message: err.message || 'Assistant stream failed' })
      } finally {
        controller.close()
      }
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})

export default app
