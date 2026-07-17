import { getStoredUser } from './auth-token.js'

export const STUDIO_IMAGE_MODEL_OPTIONS = ['gpt-image-2']
export const STUDIO_IMAGE_MODEL_DEFAULT = 'gpt-image-2'

function storageKey() {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_studio_image_model:${userId}`
}

export function getLastStudioImageModel() {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return ''
  return String(localStorage.getItem(key) || '').trim()
}

export function setLastStudioImageModel(model) {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return
  const value = String(model || '').trim()
  if (value) localStorage.setItem(key, value)
  else localStorage.removeItem(key)
}

export function resolveStudioImageModel(allowedModels = STUDIO_IMAGE_MODEL_OPTIONS) {
  const allowed = (Array.isArray(allowedModels) ? allowedModels : STUDIO_IMAGE_MODEL_OPTIONS)
    .map(String)
    .filter(Boolean)
  const fallback = allowed.includes(STUDIO_IMAGE_MODEL_DEFAULT)
    ? STUDIO_IMAGE_MODEL_DEFAULT
    : (allowed[0] || STUDIO_IMAGE_MODEL_DEFAULT)

  const saved = getLastStudioImageModel()
  if (saved && allowed.includes(saved)) return saved
  return fallback
}
