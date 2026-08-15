import { getStoredUser } from './auth-token.js'
import { isDream50ProStudioModel } from './studio-image-model-preference.js'

/** Image 2 默认比例 */
export const STUDIO_IMAGE_ASPECT_OPTIONS = ['16:9', '9:16']
export const STUDIO_IMAGE_ASPECT_DEFAULT = '16:9'

/** dream5.0 pro：对齐即梦 5.0 Pro */
export const DREAM50_PRO_ASPECT_OPTIONS = [
  '智能',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '1:1',
  '3:4',
  '2:3',
  '9:16',
]
export const DREAM50_PRO_ASPECT_DEFAULT = '1:1'

function storageKey() {
  const userId = getStoredUser()?.id
  if (!userId) return null
  return `hg_studio_image_aspect:${userId}`
}

export function aspectOptionsForModel(model) {
  if (isDream50ProStudioModel(model)) return [...DREAM50_PRO_ASPECT_OPTIONS]
  return [...STUDIO_IMAGE_ASPECT_OPTIONS]
}

export function defaultAspectForModel(model) {
  return isDream50ProStudioModel(model) ? DREAM50_PRO_ASPECT_DEFAULT : STUDIO_IMAGE_ASPECT_DEFAULT
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
  if (value) localStorage.setItem(key, value)
  else localStorage.removeItem(key)
}

export function resolveStudioImageAspectRatio(model, allowed) {
  const options = Array.isArray(allowed) && allowed.length
    ? allowed.map(String)
    : aspectOptionsForModel(model)
  const fallback = options.includes(defaultAspectForModel(model))
    ? defaultAspectForModel(model)
    : (options[0] || STUDIO_IMAGE_ASPECT_DEFAULT)
  const saved = getLastStudioImageAspectRatio()
  if (saved && options.includes(saved)) return saved
  return fallback
}

export function aspectRatioFromImageItem(item, model) {
  const ratio = String(item?.aspect_ratio || item?.aspectRatio || '').trim()
  const options = aspectOptionsForModel(model || item?.model)
  if (options.includes(ratio)) return ratio
  const size = String(item?.size || '').trim().toLowerCase()
  if (size === '1920x1080') return '16:9'
  if (size === '1080x1920') return '9:16'
  const match = /^(\d+)\s*x\s*(\d+)$/.exec(size)
  if (match) {
    const w = Number(match[1])
    const h = Number(match[2])
    if (w > 0 && h > 0) {
      const r = w / h
      if (Math.abs(r - 1) < 0.05) return '1:1'
      if (Math.abs(r - 16 / 9) < 0.08) return '16:9'
      if (Math.abs(r - 9 / 16) < 0.08) return '9:16'
      if (Math.abs(r - 4 / 3) < 0.08) return '4:3'
      if (Math.abs(r - 3 / 4) < 0.08) return '3:4'
      if (Math.abs(r - 3 / 2) < 0.08) return '3:2'
      if (Math.abs(r - 2 / 3) < 0.08) return '2:3'
      if (Math.abs(r - 21 / 9) < 0.08) return '21:9'
      if (w > h) return '16:9'
      if (h > w) return '9:16'
    }
  }
  return resolveStudioImageAspectRatio(model || item?.model, options)
}
