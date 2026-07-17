import { computed, ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  ASSISTANT_QUICK_CHIPS,
  getAssistantAgentType,
  getAssistantStepLabel,
} from '~/composables/useEpisodeAssistant'
import {
  assistantAPI,
  canvasAPI,
  characterAPI,
  sceneAPI,
  videoAPI,
} from '~/composables/useApi'

export type CanvasStudioStep = {
  key: string
  label: string
  agent: string
  status: string
  count?: number
  completed?: number
  total?: number
}

export type CanvasStudioContext = {
  focus_episode_id: number | null
  episode: {
    id: number
    episode_number: number
    title: string
    has_content: boolean
    has_script: boolean
  } | null
  counts: Record<string, number>
  steps: CanvasStudioStep[]
}

const PIPELINE_ORDER = [
  'script:rewrite',
  'script:extract',
  'script:voice',
  'prod:chars',
  'prod:scenes',
  'script:storyboard',
  'prod:videos',
  'export:merge',
]

export function useCanvasStudio(boardId: Ref<number>, dramaId: Ref<number | null>, episodeId: Ref<number | null>) {
  const studio = ref<CanvasStudioContext | null>(null)
  const loadingStudio = ref(false)
  const running = ref(false)
  const busyAction = ref('')
  const streamText = ref('')
  const lastLog = ref('')
  const activeStepKey = ref('script:extract')
  let abort: AbortController | null = null

  const steps = computed(() => {
    const map = new Map((studio.value?.steps || []).map(s => [s.key, s]))
    return PIPELINE_ORDER.map((key) => {
      const hit = map.get(key)
      return hit || {
        key,
        label: getAssistantStepLabel(key),
        agent: getAssistantAgentType(key) || '',
        status: 'pending',
      }
    })
  })

  const activeStep = computed(() => steps.value.find(s => s.key === activeStepKey.value) || steps.value[0])
  const quickChips = computed(() => ASSISTANT_QUICK_CHIPS[activeStepKey.value] || [])

  async function refreshStudio() {
    if (!boardId.value) return
    loadingStudio.value = true
    try {
      studio.value = await canvasAPI.studio(boardId.value) as CanvasStudioContext
    } catch (err: any) {
      toast.error(err?.message || '加载生产线失败')
    } finally {
      loadingStudio.value = false
    }
  }

  function stopAgent() {
    abort?.abort()
    abort = null
    running.value = false
  }

  async function runAgentPrompt(message: string, stepKey = activeStepKey.value) {
    const drama = dramaId.value
    const episode = episodeId.value
    const agentType = getAssistantAgentType(stepKey)
    if (!drama || !episode) {
      toast.error('请先选择项目集')
      return false
    }
    if (!agentType) {
      toast.error('当前步骤暂无 Agent')
      return false
    }
    if (running.value) {
      toast.error('已有任务在运行')
      return false
    }

    activeStepKey.value = stepKey
    running.value = true
    streamText.value = ''
    lastLog.value = ''
    abort = new AbortController()
    try {
      await assistantAPI.chatStream(
        {
          agent_type: agentType,
          message,
          drama_id: drama,
          episode_id: episode,
          step_key: stepKey,
          context: `[画布生产线] 步骤：${getAssistantStepLabel(stepKey)}`,
        },
        {
          onDelta: (text) => {
            streamText.value += text
          },
          onTool: (name) => {
            lastLog.value = `工具：${name}`
          },
          onDone: (data) => {
            streamText.value = data.text || streamText.value
            lastLog.value = data.tool_summary || lastLog.value || '完成'
            if (data.mutated) toast.success('已写入项目，正在同步画布…')
            else toast.success('完成')
          },
          onError: (message) => {
            toast.error(message || 'Agent 失败')
          },
        },
        abort.signal,
      )
      return true
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error(err?.message || 'Agent 失败')
      return false
    } finally {
      running.value = false
      abort = null
      await refreshStudio()
    }
  }

  async function runPipelineStep(stepKey: string) {
    const chips = ASSISTANT_QUICK_CHIPS[stepKey] || []
    const prompt = chips[0] || `请执行：${getAssistantStepLabel(stepKey)}`
    return runAgentPrompt(prompt, stepKey)
  }

  async function generateNodeImage(kind: string, refId: number) {
    const episode = episodeId.value
    if (!episode) {
      toast.error('请先选择集')
      return false
    }
    busyAction.value = `img-${kind}-${refId}`
    try {
      if (kind === 'character') {
        await characterAPI.generateImage(refId, episode)
        toast.success('已提交角色图生成')
      } else if (kind === 'scene') {
        await sceneAPI.generateImage(refId, episode)
        toast.success('已提交场景图生成')
      } else {
        toast.error('该节点类型暂不支持一键生图')
        return false
      }
      await refreshStudio()
      return true
    } catch (err: any) {
      toast.error(err?.message || '生图失败')
      return false
    } finally {
      busyAction.value = ''
    }
  }

  async function batchGenerateMissing(kind: 'character' | 'scene', ids: number[]) {
    const episode = episodeId.value
    if (!episode || !ids.length) return false
    busyAction.value = `batch-${kind}`
    try {
      if (kind === 'character') await characterAPI.batchImages(ids, episode)
      else {
        for (const id of ids) await sceneAPI.generateImage(id, episode)
      }
      toast.success(`已提交 ${ids.length} 个${kind === 'character' ? '角色' : '场景'}生图`)
      await refreshStudio()
      return true
    } catch (err: any) {
      toast.error(err?.message || '批量生图失败')
      return false
    } finally {
      busyAction.value = ''
    }
  }

  async function generateStoryboardVideo(storyboardId: number, prompt?: string) {
    busyAction.value = `video-${storyboardId}`
    try {
      await videoAPI.generate({
        storyboard_id: storyboardId,
        prompt: prompt || undefined,
      })
      toast.success('已提交视频生成')
      await refreshStudio()
      return true
    } catch (err: any) {
      toast.error(err?.message || '视频生成失败')
      return false
    } finally {
      busyAction.value = ''
    }
  }

  return {
    studio,
    loadingStudio,
    running,
    busyAction,
    streamText,
    lastLog,
    activeStepKey,
    steps,
    activeStep,
    quickChips,
    refreshStudio,
    stopAgent,
    runAgentPrompt,
    runPipelineStep,
    generateNodeImage,
    batchGenerateMissing,
    generateStoryboardVideo,
  }
}
