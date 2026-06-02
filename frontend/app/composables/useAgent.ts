import { toast } from 'vue-sonner'
import { api } from './useApi'

export function useAgent() {
  const running = ref(false)
  const runningType = ref<string | null>(null)

  async function run(type: string, msg: string, dramaId: number, episodeId: number, onDone?: () => void) {
    if (running.value) { toast.warning('操作执行中'); return }
    running.value = true
    runningType.value = type
    try {
      await api.post(`/agent/${type}/chat`, {
        message: msg,
        drama_id: dramaId,
        episode_id: episodeId,
      })
      toast.success('完成')
      onDone?.()
    } catch (err: any) {
      const message = err?.message || 'Agent 执行失败'
      toast.error(message)
      if (type === 'storyboard_breaker' && /超时|空响应|连接中断/i.test(message)) {
        onDone?.()
      }
    } finally {
      running.value = false
      runningType.value = null
    }
  }

  return { running, runningType, run }
}
