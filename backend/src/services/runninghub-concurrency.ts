/**
 * RunningHub 账号并发控制
 * 账号总并发 3：视频超分最多 2，TTS 最多 1
 */
import { logTaskProgress } from '../utils/task-logger.js'

export type RunningHubSlotKind = 'tts' | 'upscale'

export const RUNNINGHUB_CONCURRENCY = {
  tts: 1,
  upscale: 2,
  total: 3,
} as const

type Waiter = {
  kind: RunningHubSlotKind
  resolve: () => void
}

const active: Record<RunningHubSlotKind, number> = {
  tts: 0,
  upscale: 0,
}

const waiters: Waiter[] = []

function totalActive() {
  return active.tts + active.upscale
}

function canAcquire(kind: RunningHubSlotKind) {
  if (active[kind] >= RUNNINGHUB_CONCURRENCY[kind]) return false
  if (totalActive() >= RUNNINGHUB_CONCURRENCY.total) return false
  return true
}

function tryWake() {
  let progressed = true
  while (progressed) {
    progressed = false
    for (let i = 0; i < waiters.length; i++) {
      const w = waiters[i]
      if (!canAcquire(w.kind)) continue
      waiters.splice(i, 1)
      active[w.kind] += 1
      w.resolve()
      progressed = true
      break
    }
  }
}

export function getRunningHubConcurrencySnapshot() {
  return {
    active: { ...active },
    waiting: waiters.length,
    limits: { ...RUNNINGHUB_CONCURRENCY },
  }
}

/**
 * 占用一个 RunningHub 并发槽位执行任务；槽位在上传/提交/轮询期间一直占用，
 * 直到任务结束（成功或失败）才释放，避免超出账号并发上限。
 */
export async function withRunningHubSlot<T>(
  kind: RunningHubSlotKind,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const waited = !canAcquire(kind)
  if (waited) {
    logTaskProgress('RunningHub', 'slot-wait', {
      kind,
      ...getRunningHubConcurrencySnapshot(),
      ...meta,
    })
  }

  await new Promise<void>((resolve) => {
    if (canAcquire(kind)) {
      active[kind] += 1
      resolve()
      return
    }
    waiters.push({
      kind,
      resolve: () => resolve(),
    })
  })

  logTaskProgress('RunningHub', 'slot-acquired', {
    kind,
    ...getRunningHubConcurrencySnapshot(),
    ...meta,
  })

  try {
    return await fn()
  } finally {
    active[kind] = Math.max(0, active[kind] - 1)
    logTaskProgress('RunningHub', 'slot-released', {
      kind,
      ...getRunningHubConcurrencySnapshot(),
      ...meta,
    })
    tryWake()
  }
}
