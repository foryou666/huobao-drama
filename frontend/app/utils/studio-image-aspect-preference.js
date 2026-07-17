import { getStoredUser } from './auth-token.js'

export const STUDIO_IMAGE_ASPECT_OPTIONS = ['16:9', '9:16']
export const STUDIO_IMAGE_ASPECT_DEFAULT = '16:9'

function storageKey() {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_studio_image_aspect:${userId}`
}

export function getLastStudioImageAspectRatio() {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return ''
  return String(localStorage.getItem(key) || '').trim()
}

export function setLastStudioImageAspectRatio(ratio) {
  const key = storageKey()
  if (!key || typeof localStorage === 'undefined') return
  const value = String(ratio || '').trim()
  if (value && STUDIO_IMAGE_ASPECT_OPTIONS.includes(value)) {
    localStorage.setItem(key, value)
  } else {
    localStorage.removeItem(key)
  }
}

export function resolveStudioImageAspectRatio() {
  const saved = getLastStudioImageAspectRatio()
  if (saved && STUDIO_IMAGE_ASPECT_OPTIONS.includes(saved)) return saved
  return STUDIO_IMAGE_ASPECT_DEFAULT
}

export function aspectRatioFromImageItem(item) {
  const ratio = String(item?.aspect_ratio || item?.aspectRatio || '').trim()
  if (STUDIO_IMAGE_ASPECT_OPTIONS.includes(ratio)) return ratio
  const size = String(item?.size || '').trim().toLowerCase()
  if (size === '1920x1080') return '16:9'
  if (size === '1080x1920') return '9:16'
  const match = /^(\d+)\s*x\s*(\d+)$/.exec(size)
  if (match) {
    const w = Number(match[1])
    const h = Number(match[2])
    if (w > h) return '16:9'
    if (h > w) return '9:16'
  }
  return resolveStudioImageAspectRatio()
}
