import { getStoredUser } from './auth-token.js'

const DRAFT_VERSION = 1

function storageKey(scope) {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_studio_video_draft:${userId}:${scope || 'video'}`
}

export function loadStudioVideoDraft(scope = 'video') {
  const key = storageKey(scope)
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data?.v !== DRAFT_VERSION) return null
    return data
  } catch {
    return null
  }
}

export function saveStudioVideoDraft(scope, draft) {
  const key = storageKey(scope)
  if (!key || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify({
      v: DRAFT_VERSION,
      savedAt: Date.now(),
      ...draft,
    }))
  } catch {
    // localStorage 满或不可用时忽略
  }
}

export function clearStudioVideoDraft(scope = 'video') {
  const key = storageKey(scope)
  if (!key || typeof localStorage === 'undefined') return
  localStorage.removeItem(key)
}
