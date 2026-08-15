import { getStoredUser } from './auth-token.js'

function storageKey() {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_xingyuemeng_model:${userId}`
}

export function getSavedXingyuemengModel() {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const model = String(localStorage.getItem(key) || '').trim()
    return model || null
  } catch {
    return null
  }
}

export function setSavedXingyuemengModel(model) {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return
  const next = String(model || '').trim()
  if (!next) {
    localStorage.removeItem(key)
    return
  }
  localStorage.setItem(key, next)
}

export function resolveXingyuemengModelPreference({
  models = [],
  defaultModel = '',
} = {}) {
  const list = Array.isArray(models) ? models : []
  const saved = getSavedXingyuemengModel()
  if (saved && (!list.length || list.some(item => String(item.id) === saved))) {
    return saved
  }
  const fallback = String(defaultModel || '').trim()
  if (fallback && (!list.length || list.some(item => String(item.id) === fallback))) {
    return fallback
  }
  return list[0]?.id || fallback || null
}
