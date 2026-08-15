import { getStoredUser } from './auth-token.js'

export const STUDIO_IMAGE_MODEL_OPTIONS = ['gpt-image-2', 'dream5.0-pro']
export const STUDIO_IMAGE_MODEL_DEFAULT = 'gpt-image-2'

export const STUDIO_IMAGE_MODEL_LABELS = {
  'gpt-image-2': 'Image 2',
  'gpt-image-1': 'Image 1',
  'dream5.0-pro': 'dream5.0 pro',
  'dream5.0 pro': 'dream5.0 pro',
  'dreamina-seedream-5.0-pro': 'dream5.0 pro',
}

export function studioImageModelLabel(id, provider) {
  const raw = String(id || '').trim()
  if (!raw) {
    const p = String(provider || '').trim().toLowerCase()
    if (p === 'jimeng_web') return 'dream5.0 pro'
    return ''
  }
  const key = raw.toLowerCase()
  if (STUDIO_IMAGE_MODEL_LABELS[raw]) return STUDIO_IMAGE_MODEL_LABELS[raw]
  if (STUDIO_IMAGE_MODEL_LABELS[key]) return STUDIO_IMAGE_MODEL_LABELS[key]
  if (key.includes('dream5') || key.includes('seedream-5.0-pro')) return 'dream5.0 pro'
  if (key.includes('gpt-image-2') || key === 'image-2') return 'Image 2'
  if (String(provider || '').trim().toLowerCase() === 'jimeng_web') return 'dream5.0 pro'
  return raw
}

export function isDream50ProStudioModel(model) {
  const id = String(model || '').trim().toLowerCase()
  return id === 'dream5.0-pro' || id === 'dream5.0 pro' || id === 'dreamina-seedream-5.0-pro'
}

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
