import { getStoredUser } from './auth-token.js'

export const STUDIO_IMAGE_RESOLUTION_OPTIONS = ['1k', '2k']
export const STUDIO_IMAGE_RESOLUTION_DEFAULT = '1k'

export const STUDIO_IMAGE_RESOLUTION_CREDIT_FALLBACK = {
  '1k': 9,
  '2k': 24,
}

function storageKey() {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_studio_image_resolution:${userId}`
}

export function getLastStudioImageResolution() {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return ''
  return String(localStorage.getItem(key) || '').trim().toLowerCase()
}

export function setLastStudioImageResolution(resolution) {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return
  const value = String(resolution || '').trim().toLowerCase()
  if (value && STUDIO_IMAGE_RESOLUTION_OPTIONS.includes(value)) {
    localStorage.setItem(key, value)
  } else {
    localStorage.removeItem(key)
  }
}

export function resolveStudioImageResolution(allowed = STUDIO_IMAGE_RESOLUTION_OPTIONS) {
  const list = (Array.isArray(allowed) ? allowed : STUDIO_IMAGE_RESOLUTION_OPTIONS)
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => STUDIO_IMAGE_RESOLUTION_OPTIONS.includes(item))
  const options = list.length ? list : [...STUDIO_IMAGE_RESOLUTION_OPTIONS]
  const saved = getLastStudioImageResolution()
  if (saved && options.includes(saved)) return saved
  if (options.includes(STUDIO_IMAGE_RESOLUTION_DEFAULT)) return STUDIO_IMAGE_RESOLUTION_DEFAULT
  return options[0]
}

export function resolutionFromImageItem(item) {
  const fromQuality = String(item?.quality || item?.resolution || '').trim().toLowerCase()
  if (STUDIO_IMAGE_RESOLUTION_OPTIONS.includes(fromQuality)) return fromQuality
  return resolveStudioImageResolution()
}
