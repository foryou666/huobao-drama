/** 超分排队/ETA 文案 */

export function formatUpscaleEta(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 60) return '约 1 分钟'
  const mins = Math.max(1, Math.ceil(n / 60))
  if (mins < 60) return `约 ${mins} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `约 ${h} 小时 ${m} 分钟` : `约 ${h} 小时`
}

/** 排队中：前方 N 个 · 预计… */
export function formatUpscaleQueueHint(job) {
  if (!job) return ''
  if (job.status === 'queued') {
    const ahead = Math.max(0, Number(job.queue_ahead) || 0)
    const eta = formatUpscaleEta(job.eta_sec)
    if (ahead <= 0) {
      return eta ? `即将开始处理，${eta}` : '即将开始处理'
    }
    return eta
      ? `前方排队 ${ahead} 个，${eta}`
      : `前方排队 ${ahead} 个`
  }
  if (job.status === 'uploading') {
    const eta = formatUpscaleEta(job.eta_sec)
    return eta ? `上传中，${eta}` : '上传中'
  }
  if (job.status === 'processing') {
    const eta = formatUpscaleEta(job.eta_sec)
    return eta ? `处理中，${eta}` : '处理中'
  }
  return ''
}

export function formatUpscaleSubmitToast(job) {
  if (!job) return '已提交超分'
  if (job.status === 'queued') {
    const ahead = Math.max(0, Number(job.queue_ahead) || 0)
    const eta = formatUpscaleEta(job.eta_sec)
    if (ahead <= 0) {
      return eta ? `已提交，即将开始，${eta}` : '已提交，即将开始'
    }
    return eta
      ? `已提交，前方排队 ${ahead} 个，${eta}（无需操作，将自动开始）`
      : `已提交，前方排队 ${ahead} 个（无需操作，将自动开始）`
  }
  return '已提交超分'
}
