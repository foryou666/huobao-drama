import { getStoredUser } from './auth-token.js'

function storageKey() {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_aistarslab_selection:${userId}`
}

export function getSavedAistarslabSelection() {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    const channel = String(data?.channel || '').trim()
    const model = String(data?.model || '').trim()
    if (!channel || !model) return null
    return { channel, model }
  } catch {
    return null
  }
}

export function setSavedAistarslabSelection({ channel, model } = {}) {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return
  const ch = String(channel || '').trim()
  const m = String(model || '').trim()
  if (!ch || !m) {
    localStorage.removeItem(key)
    return
  }
  localStorage.setItem(key, JSON.stringify({ channel: ch, model: m }))
}

export function resolveAistarslabSelection({
  channels = [],
  models = [],
  defaultChannel = '',
  defaultModel = '',
} = {}) {
  const saved = getSavedAistarslabSelection()
  if (!saved) return null

  const channelList = Array.isArray(channels) ? channels : []
  const modelList = Array.isArray(models) ? models : []

  const channelOk = !channelList.length
    || channelList.some(item => String(item.channel) === saved.channel)
  const modelOk = modelList.some(item =>
    String(item.channel || defaultChannel) === saved.channel
    && String(item.model || item.id) === saved.model,
  )

  if (channelOk && modelOk) return saved
  return null
}
