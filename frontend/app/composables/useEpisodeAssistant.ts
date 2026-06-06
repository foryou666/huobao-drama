import { toast } from 'vue-sonner'
import { assistantAPI, type AssistantDbMessage } from '~/composables/useApi'

export type AssistantRole = 'user' | 'assistant'

export interface AssistantAttachment {
  kind: 'character' | 'scene' | 'shot_frame' | 'shot_blocking' | 'shot_video' | 'shot_compose' | 'merge'
  id: number
  label?: string
  frame_type?: 'first_frame' | 'last_frame'
  status: 'processing' | 'ready' | 'failed'
  url?: string | null
}

export interface AssistantMessage {
  id: string
  role: AssistantRole
  content: string
  toolSummary?: string
  attachments?: AssistantAttachment[]
  at: number
}

export interface AssistantContext {
  dramaId: number
  stepKey: string
  stepLabel: string
  directorStyle?: string
  selectedStoryboard?: {
    id: number
    index: number
    title?: string
  } | null
}

const STEP_AGENT: Record<string, string | null> = {
  'script:raw': 'script_rewriter',
  'script:rewrite': 'script_rewriter',
  'script:extract': 'extractor',
  'script:voice': 'voice_assigner',
  'script:storyboard': 'shot_plan_generator',
  'prod:chars': 'grid_prompt_generator',
  'prod:scenes': 'grid_prompt_generator',
  'prod:dubbing': 'voice_assigner',
  'prod:shots': 'grid_prompt_generator',
  'prod:videos': 'storyboard_breaker',
  'prod:compose': 'storyboard_breaker',
  'export:merge': 'storyboard_breaker',
}

const STEP_LABELS: Record<string, string> = {
  'script:raw': '原始内容',
  'script:rewrite': 'AI 改写',
  'script:extract': '提取角色场景',
  'script:voice': '音色分配',
  'script:storyboard': '分镜拆解',
  'prod:chars': '角色形象',
  'prod:scenes': '场景图片',
  'prod:dubbing': '配音生成',
  'prod:shots': '镜头图片',
  'prod:videos': '视频生成',
  'prod:compose': '视频合成',
  'export:merge': '拼接导出',
}

export const ASSISTANT_QUICK_CHIPS: Record<string, string[]> = {
  'script:raw': ['按红果风格改写剧本并保存', '压缩废话，保留爽点'],
  'script:rewrite': ['对白再短一点，更红果', '加强集末悬念钩子'],
  'script:extract': ['补全遗漏角色并去重保存', '合并重复场景'],
  'script:voice': ['按性格重新分配音色', '女主换更甜的声音'],
  'script:storyboard': [
    '读取剧本并生成完整工业镜头列表并导入',
    '重新生成全部镜头列表',
    '加强集末悬念钩子镜头',
  ],
  'prod:chars': ['生成所有角色图片', '重新生成没有图片的角色', '优化所有角色 image_prompt'],
  'prod:scenes': ['生成所有场景图片', '重新生成缺失的场景图', '优化场景 image_prompt'],
  'prod:dubbing': ['为所有镜头生成配音', '检查未分配音色的角色并分配', '重新生成第1镜配音'],
  'prod:shots': ['为选中镜头生成首帧', '批量生成缺失的首帧', '首帧构图再电影感一点'],
  'prod:videos': ['生成所有镜头视频', '重新生成选中镜头视频', '优化选中镜头 video_prompt 口型细则'],
  'prod:compose': ['合成所有已有视频的镜头', '检查未合成镜头并说明原因'],
  'export:merge': ['拼接本集成片', '查看当前制作进度'],
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseAttachmentsJson(raw?: string | null): AssistantAttachment[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as AssistantAttachment[] : []
  } catch {
    return []
  }
}

function mapDbMessage(row: AssistantDbMessage): AssistantMessage {
  return {
    id: `db-${row.id}`,
    role: row.role,
    content: row.content,
    toolSummary: row.tool_summary || undefined,
    attachments: parseAttachmentsJson(row.attachments),
    at: new Date(row.created_at).getTime() || Date.now(),
  }
}

export const EPISODE_ASSISTANT_THREAD_KEY = 'episode:assistant'

export function getAssistantAgentType(stepKey: string): string | null {
  return STEP_AGENT[stepKey] ?? null
}

export function getAssistantStepLabel(stepKey: string): string {
  return STEP_LABELS[stepKey] || stepKey
}

export function useEpisodeAssistant(
  episodeId: Ref<number>,
  currentStepKey: Ref<string>,
  context: Ref<AssistantContext>,
  options?: { threadKey?: string },
) {
  const threadKey = options?.threadKey ?? EPISODE_ASSISTANT_THREAD_KEY
  const messages = ref<AssistantMessage[]>([])
  const running = ref(false)
  const loadingHistory = ref(false)
  const streamingText = ref('')
  const input = ref('')
  let abortController: AbortController | null = null

  const agentType = computed(() => getAssistantAgentType(currentStepKey.value))
  const stepLabel = computed(() => getAssistantStepLabel(currentStepKey.value))
  const quickChips = computed(() => ASSISTANT_QUICK_CHIPS[currentStepKey.value] || [])
  const disabled = computed(() => !agentType.value || running.value || loadingHistory.value)

  async function loadFromDb() {
    if (!episodeId.value) {
      messages.value = []
      return
    }
    loadingHistory.value = true
    try {
      const res = await assistantAPI.listMessages(episodeId.value, threadKey)
      messages.value = (res.items || []).map(mapDbMessage)
    } catch (err: any) {
      toast.error(err?.message || '加载对话历史失败')
      messages.value = []
    } finally {
      loadingHistory.value = false
    }
  }

  watch(episodeId, () => {
    streamingText.value = ''
    loadFromDb()
  }, { immediate: true })

  function buildContextBlock(): string {
    const c = context.value
    const lines = [
      `[制作上下文]`,
      `当前步骤：${c.stepLabel || stepLabel.value}（${c.stepKey || currentStepKey.value}）`,
    ]
    if (c.directorStyle) lines.push(`导演风格：${c.directorStyle}`)
    if (c.selectedStoryboard) {
      lines.push(
        `用户选中镜头：#${c.selectedStoryboard.index} ${c.selectedStoryboard.title || ''}（storyboard_id=${c.selectedStoryboard.id}）`,
        `若用户要求改「当前/选中镜头」，优先只 update_storyboard 该 id，不要全量 save_storyboards 覆盖整集。`,
      )
    }
    return lines.join('\n')
  }

  async function clearHistory() {
    if (!episodeId.value) return
    try {
      await assistantAPI.clearMessages(episodeId.value, threadKey)
      messages.value = []
      streamingText.value = ''
      toast.success('已清空对话')
    } catch (err: any) {
      toast.error(err?.message || '清空失败')
    }
  }

  function stop() {
    abortController?.abort()
    abortController = null
    running.value = false
    streamingText.value = ''
    void loadFromDb()
  }

  async function send(text: string, onDataChanged?: () => void) {
    const msg = text.trim()
    if (!msg || running.value) return

    const type = agentType.value
    if (!type) {
      toast.info('当前步骤暂不支持 AI 对话')
      return
    }

    running.value = true
    streamingText.value = ''
    input.value = ''
    abortController = new AbortController()

    const draftAssistantId = uid()
    messages.value = [
      ...messages.value,
      { id: uid(), role: 'user', content: msg, at: Date.now() },
      { id: draftAssistantId, role: 'assistant', content: '', at: Date.now() },
    ]

    let mutated = false

    try {
      await assistantAPI.chatStream(
        {
          agent_type: type,
          message: msg,
          drama_id: context.value.dramaId,
          episode_id: episodeId.value,
          step_key: threadKey,
          context: buildContextBlock(),
        },
        {
          onUser: (data) => {
            const idx = messages.value.findIndex(m => m.role === 'user' && m.content === msg)
            if (idx >= 0) {
              messages.value[idx] = {
                ...messages.value[idx],
                id: `db-${data.id}`,
                at: new Date(data.created_at).getTime() || messages.value[idx].at,
              }
            }
          },
          onDelta: (delta) => {
            streamingText.value += delta
            const aiIdx = messages.value.findIndex(m => m.id === draftAssistantId)
            if (aiIdx >= 0) {
              messages.value[aiIdx] = {
                ...messages.value[aiIdx],
                content: streamingText.value,
              }
            }
          },
          onTool: (name) => {
            const aiIdx = messages.value.findIndex(m => m.id === draftAssistantId)
            if (aiIdx >= 0 && name) {
              messages.value[aiIdx] = {
                ...messages.value[aiIdx],
                toolSummary: `正在调用：${name}…`,
              }
            }
          },
          onDone: (data) => {
            mutated = !!data.mutated
            const aiIdx = messages.value.findIndex(m => m.id === draftAssistantId)
            if (aiIdx >= 0) {
              messages.value[aiIdx] = {
                id: `db-${data.assistant_message_id}`,
                role: 'assistant',
                content: data.text || streamingText.value || '（无文本回复）',
                toolSummary: data.tool_summary || undefined,
                attachments: data.attachments || [],
                at: Date.now(),
              }
            }
          },
          onError: (message) => {
            throw new Error(message)
          },
        },
        abortController.signal,
      )

      if (mutated) {
        toast.success('已更新数据')
        onDataChanged?.()
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        toast.info('已停止生成')
        await loadFromDb()
        return
      }
      const message = err?.message || '助手请求失败'
      toast.error(message)
      const aiIdx = messages.value.findIndex(m => m.id === draftAssistantId)
      if (aiIdx >= 0) {
        messages.value[aiIdx] = {
          ...messages.value[aiIdx],
          content: streamingText.value
            ? `${streamingText.value}\n\n（未完成：${message}）`
            : `请求失败：${message}`,
        }
      }
      if (type === 'storyboard_breaker' && /超时|空响应|连接中断/i.test(message)) {
        onDataChanged?.()
      }
      if (type === 'shot_plan_generator' && /超时|空响应|连接中断/i.test(message)) {
        onDataChanged?.()
      }
    } finally {
      running.value = false
      streamingText.value = ''
      abortController = null
    }
  }

  async function recordActivity(
    userText: string,
    assistantText: string,
    attachments?: AssistantAttachment[],
  ): Promise<{ assistantMessageId: string } | null> {
    const userMessage = userText.trim()
    const assistantMessage = assistantText.trim()
    if (!userMessage || !assistantMessage || !episodeId.value) return null

    const type = agentType.value
    if (!type) return null

    const appendLocal = (assistantId: string, userId: string) => {
      messages.value = [
        ...messages.value,
        { id: userId, role: 'user', content: userMessage, at: Date.now() },
        {
          id: assistantId,
          role: 'assistant',
          content: assistantMessage,
          attachments: attachments || [],
          at: Date.now(),
        },
      ]
    }

    try {
      const res = await assistantAPI.recordActivity({
        episode_id: episodeId.value,
        step_key: threadKey,
        agent_type: type,
        user_message: userMessage,
        assistant_message: assistantMessage,
        attachments,
      })
      appendLocal(`db-${res.assistant_message_id}`, `db-${res.user_message_id}`)
      return { assistantMessageId: `db-${res.assistant_message_id}` }
    } catch {
      const assistantId = uid()
      appendLocal(assistantId, uid())
      return { assistantMessageId: assistantId }
    }
  }

  async function patchActivity(
    assistantMessageId: string,
    patch: { content?: string; attachments?: AssistantAttachment[] },
  ) {
    const aiIdx = messages.value.findIndex(m => m.id === assistantMessageId)
    if (aiIdx >= 0) {
      messages.value[aiIdx] = {
        ...messages.value[aiIdx],
        content: patch.content ?? messages.value[aiIdx].content,
        attachments: patch.attachments ?? messages.value[aiIdx].attachments,
      }
    }

    const dbId = assistantMessageId.startsWith('db-')
      ? Number(assistantMessageId.slice(3))
      : NaN
    if (!Number.isFinite(dbId)) return

    try {
      await assistantAPI.patchMessage(dbId, patch)
    } catch {
      // 本地已更新，持久化失败不影响当前会话
    }
  }

  return {
    messages,
    running,
    loadingHistory,
    streamingText,
    input,
    agentType,
    stepLabel,
    quickChips,
    disabled,
    send,
    recordActivity,
    patchActivity,
    clearHistory,
    stop,
    reloadHistory: loadFromDb,
  }
}
