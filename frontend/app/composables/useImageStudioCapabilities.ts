import { imageAPI } from '~/composables/useApi'

export type ImageStudioResolutionOption = {
  id: string
  label?: string
  credit_cost?: number
}

export type ImageStudioModelOption = {
  id: string
  label?: string
  default?: boolean
  available?: boolean
  resolutions?: ImageStudioResolutionOption[]
  default_resolution?: string
  aspect_ratios?: string[]
  default_aspect_ratio?: string
  quantities?: number[]
  default_quantity?: number
  max_reference_images?: number
  supports_reference?: boolean
}

export type ImageStudioCapabilities = {
  max_reference_images?: number
  supports_reference?: boolean
  provider?: string | null
  model?: string | null
  models?: string[]
  model_options?: ImageStudioModelOption[]
  resolutions?: ImageStudioResolutionOption[]
  default_resolution?: string
  aspect_ratios?: string[]
  default_aspect_ratio?: string
  quantities?: number[]
  default_quantity?: number
  can_view_all_studio?: boolean
  user_filter_options?: { id: number; username: string; display_name: string }[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
const SESSION_KEY = 'studio-image-capabilities-v4'
let cached: { at: number; data: ImageStudioCapabilities } | null = null
let inflight: Promise<ImageStudioCapabilities> | null = null

function readSessionCache(): ImageStudioCapabilities | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: ImageStudioCapabilities }
    if (!parsed?.data || !parsed.savedAt || Date.now() - parsed.savedAt >= CACHE_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed.data
  } catch {
    return null
  }
}

function writeSessionCache(data: ImageStudioCapabilities) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ savedAt: Date.now(), data }))
  } catch {
    // ignore quota
  }
}

function rememberCapabilities(data: ImageStudioCapabilities) {
  cached = { at: Date.now(), data }
  writeSessionCache(data)
}

/** 图片工作台 capabilities：同会话内去重 + 内存/ sessionStorage 缓存 */
export async function loadImageStudioCapabilities(force = false): Promise<ImageStudioCapabilities> {
  const now = Date.now()
  if (!force && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.data
  }
  if (!force && inflight) {
    return inflight
  }

  if (!force && !cached) {
    const fromSession = readSessionCache()
    if (fromSession) {
      cached = { at: Date.now(), data: fromSession }
      return fromSession
    }
  }

  inflight = imageAPI.capabilities()
    .then((data) => {
      const normalized = (data || {}) as ImageStudioCapabilities
      rememberCapabilities(normalized)
      inflight = null
      return normalized
    })
    .catch((err) => {
      inflight = null
      throw err
    })

  return inflight
}

export function getCachedImageStudioCapabilities(): ImageStudioCapabilities | null {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data
  }
  const fromSession = readSessionCache()
  if (fromSession) {
    cached = { at: Date.now(), data: fromSession }
    return fromSession
  }
  return null
}

export function applyImageStudioCapabilitiesToComposer(
  caps: ImageStudioCapabilities,
  refs: {
    maxImages: { value: number }
    supportsReference: { value: boolean }
    modelOptions: { value: string[] }
    selectedModel: { value: string }
    resolutionOptions?: { value: ImageStudioResolutionOption[] }
    selectedResolution?: { value: string }
  },
  defaults: {
    modelOptions: string[]
    resolveModel: (models: string[]) => string
    resolveResolution?: (ids: string[]) => string
    resolutionOptions?: ImageStudioResolutionOption[]
  },
) {
  if (caps.max_reference_images) refs.maxImages.value = Number(caps.max_reference_images)
  refs.supportsReference.value = caps.supports_reference !== false
  const models = Array.isArray(caps.models) && caps.models.length
    ? caps.models.map(String)
    : [...defaults.modelOptions]
  refs.modelOptions.value = models
  refs.selectedModel.value = defaults.resolveModel(models)

  if (refs.resolutionOptions && refs.selectedResolution) {
    const fromCaps = Array.isArray(caps.resolutions) ? caps.resolutions : []
    const resolutions = fromCaps.length
      ? fromCaps.map(item => ({
          id: String(item.id || '').trim().toLowerCase(),
          label: item.label || String(item.id || '').toUpperCase(),
          credit_cost: Number(item.credit_cost) || undefined,
        })).filter(item => item.id)
      : [...(defaults.resolutionOptions || [])]
    refs.resolutionOptions.value = resolutions
    const ids = resolutions.map(item => item.id)
    refs.selectedResolution.value = defaults.resolveResolution
      ? defaults.resolveResolution(ids)
      : (caps.default_resolution || ids[0] || '1k')
  }
}
