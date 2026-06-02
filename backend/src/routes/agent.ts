/**

 * Agent 聊天路由

 */

import { Hono } from 'hono'

import { createAgent, validAgentTypes } from '../agents/index.js'

import { success, badRequest, serverError } from '../utils/response.js'

import { buildAgentChatMessages, runAgentGenerate } from '../services/agent-chat.js'

import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

import { getAuthUser } from '../middleware/auth.js'

import { logActivity } from '../services/activity.js'
import { tryChargeUser, CREDIT_ACTIONS } from '../utils/credit-charge.js'



const app = new Hono()



// POST /agent/:type/chat — 非流式 Agent 对话（一键按钮仍用）

app.post('/:type/chat', async (c) => {

  const agentType = c.req.param('type')

  if (!validAgentTypes.includes(agentType)) {

    return badRequest(c, `Invalid agent type: ${agentType}`)

  }



  const body = await c.req.json()

  const { message, drama_id, episode_id, history, context } = body



  logTaskStart('Agent', agentType, {

    dramaId: drama_id,

    episodeId: episode_id,

    message,

    historyLength: Array.isArray(history) ? history.length : 0,

  })

  logTaskPayload('Agent', `${agentType} input`, body)



  if (!episode_id || !drama_id) {

    logTaskError('Agent', agentType, { reason: 'missing drama_id or episode_id' })

    return badRequest(c, 'drama_id and episode_id are required')

  }



  if (!message || typeof message !== 'string' || !message.trim()) {

    return badRequest(c, 'message is required')

  }

  const billed = tryChargeUser(c, CREDIT_ACTIONS.AGENT_RUN, {
    summary: `Agent：${agentType}`,
    dramaId: Number(drama_id),
    episodeId: Number(episode_id),
    metadata: { agent_type: agentType },
  })
  if (billed.error) return billed.error



  const agent = createAgent(agentType, episode_id, drama_id)

  if (!agent) {

    logTaskError('Agent', agentType, { reason: 'agent not found' })

    return badRequest(c, 'Agent not found')

  }



  const startTime = performance.now()



  try {

    const historyEntries = Array.isArray(history)

      ? history.map((entry: any) => ({

        role: entry?.role === 'assistant' ? 'assistant' as const : 'user' as const,

        content: String(entry?.content || ''),

      }))

      : []



    const chatMessages = buildAgentChatMessages(historyEntries, message, context)



    const result = await runAgentGenerate(agent, chatMessages, { maxSteps: 20 })



    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)

    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })



    logTaskProgress('Agent', 'tool-summary', {

      agentType,

      toolCalls: result.toolCalls.map(tc => tc.toolName),

      toolResults: result.toolResults.map(tr => tr.toolName),

    })

    logTaskPayload('Agent', `${agentType} tool-results`, result.toolResults)



    logActivity(getAuthUser(c), {

      action: 'agent.run',

      summary: `运行 Agent：${agentType}`,

      dramaId: drama_id,

      episodeId: episode_id,

      creditCost: billed.charge.cost,

      metadata: { agent_type: agentType, credit_tx_id: billed.charge.transactionId },

    })



    return success(c, {

      type: 'done',

      text: result.text || '',

      toolCalls: result.toolCalls,

      toolResults: result.toolResults,

      credits_balance: billed.charge.balance,

    })

  } catch (err: any) {

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)

    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: err.message })

    console.error(err.stack || err)

    return serverError(c, err.message || 'Agent execution failed')

  }

})



// GET /agent/:type/debug

app.get('/:type/debug', async (c) => {

  const agentType = c.req.param('type')

  if (!validAgentTypes.includes(agentType)) return badRequest(c, 'Invalid agent type')

  return success(c, { agent_type: agentType, valid: true })

})



export default app

