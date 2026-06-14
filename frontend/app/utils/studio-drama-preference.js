import { getStoredUser } from './auth-token.js'

function storageKey(scope) {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_studio_drama:${userId}:${scope || 'video'}`
}

export function getLastStudioDramaId(scope = 'video') {
  const key = storageKey(scope)
  if (!key || typeof localStorage === 'undefined') return ''
  return String(localStorage.getItem(key) || '').trim()
}

export function setLastStudioDramaId(scope, dramaId) {
  const key = storageKey(scope)
  if (!key || typeof localStorage === 'undefined') return
  const id = String(dramaId || '').trim()
  if (id) localStorage.setItem(key, id)
  else localStorage.removeItem(key)
}

export function resolveStudioDramaId({ scope = 'video', defaultDramaId = '', dramas = [], remember = true } = {}) {
  const fromDefault = String(defaultDramaId || '').trim()
  if (fromDefault) return fromDefault
  if (!remember) return ''

  const saved = getLastStudioDramaId(scope)
  if (!saved) return ''

  const list = Array.isArray(dramas) ? dramas : []
  if (list.length && !list.some(item => String(item.id) === saved)) return ''
  return saved
}
