import { computed, ref } from 'vue'

export type GenerationTaskKind = 'image' | 'video' | 'compose'

export interface GenerationTask {
  key: string
  label: string
  kind: GenerationTaskKind
  startedAt: number
}

const tasks = ref<Record<string, GenerationTask>>({})
const tick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

function ensureTick() {
  if (tickTimer) return
  tickTimer = setInterval(() => {
    tick.value = Date.now()
  }, 1000)
}

function stopTickIfEmpty() {
  if (Object.keys(tasks.value).length || !tickTimer) return
  clearInterval(tickTimer)
  tickTimer = null
}

function formatElapsed(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem ? `${min} 分 ${rem} 秒` : `${min} 分`
}

function formatStartTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function slowThresholdMs(kind: GenerationTaskKind) {
  if (kind === 'video') return 5 * 60 * 1000
  if (kind === 'compose') return 3 * 60 * 1000
  return 2 * 60 * 1000
}

export function useGenerationTimer() {
  const activeList = computed(() =>
    Object.values(tasks.value).sort((a, b) => a.startedAt - b.startedAt),
  )

  const hasSlowTask = computed(() => {
    void tick.value
    return activeList.value.some((task) => Date.now() - task.startedAt >= slowThresholdMs(task.kind))
  })

  const primaryTask = computed(() => activeList.value[0] ?? null)

  function hasTask(key: string) {
    return Boolean(tasks.value[key])
  }

  function getTask(key: string) {
    return tasks.value[key] ?? null
  }

  function startTask(key: string, label: string, kind: GenerationTaskKind = 'image') {
    if (!key) return
    tasks.value = {
      ...tasks.value,
      [key]: { key, label, kind, startedAt: Date.now() },
    }
    ensureTick()
  }

  function endTask(key: string) {
    if (!key || !tasks.value[key]) return
    const next = { ...tasks.value }
    delete next[key]
    tasks.value = next
    stopTickIfEmpty()
  }

  function elapsedMs(key: string) {
    void tick.value
    const task = tasks.value[key]
    if (!task) return 0
    return Date.now() - task.startedAt
  }

  function isSlow(key: string) {
    const task = tasks.value[key]
    if (!task) return false
    return elapsedMs(key) >= slowThresholdMs(task.kind)
  }

  function metaText(key: string) {
    const task = tasks.value[key]
    if (!task) return ''
    return `开始 ${formatStartTime(task.startedAt)} · 已用 ${formatElapsed(elapsedMs(key))}`
  }

  function statusText(key: string) {
    const task = tasks.value[key]
    if (!task) return ''
    let text = metaText(key)
    if (isSlow(key)) text += ' · 耗时较长，可重新生成'
    return text
  }

  return {
    activeList,
    hasSlowTask,
    primaryTask,
    hasTask,
    getTask,
    startTask,
    endTask,
    elapsedMs,
    isSlow,
    metaText,
    statusText,
    formatElapsed,
    formatStartTime,
  }
}
