/** 即梦 Web 图片生成（Seedream / 图片 5.x）常量 */

export const JIMENG_IMAGE_REFERER = 'https://jimeng.jianying.com/ai-tool/image/generate'

/** 本站工作台模型 id */
export const JIMENG_STUDIO_IMAGE_MODEL_DREAM50_PRO = 'dream5.0-pro'
export const JIMENG_STUDIO_IMAGE_MODEL_LABEL = 'dream5.0 pro'

/** 上游 model_req_key（来自 /mweb/v1/get_common_config） */
export const JIMENG_IMAGE_UPSTREAM_SEEDREAM_50_PRO = 'high_aes_general_v50p_large'

export const JIMENG_IMAGE_DRAFT_VERSION = '3.3.9'
export const JIMENG_IMAGE_DRAFT_MIN_VERSION = '3.0.2'

export const JIMENG_IMAGE_RESOLUTIONS = ['1k', '2k', '4k'] as const
export type JimengImageResolution = typeof JIMENG_IMAGE_RESOLUTIONS[number]
export const JIMENG_IMAGE_DEFAULT_RESOLUTION: JimengImageResolution = '2k'

/** 对齐即梦「图片 5.0 Pro」比例选项（含智能） */
export const JIMENG_IMAGE_ASPECT_OPTIONS = [
  '智能',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '1:1',
  '3:4',
  '2:3',
  '9:16',
] as const
export type JimengImageAspectOption = typeof JIMENG_IMAGE_ASPECT_OPTIONS[number]
export const JIMENG_IMAGE_DEFAULT_ASPECT: JimengImageAspectOption = '1:1'

/** 对齐即梦生成数量 1–4 */
export const JIMENG_IMAGE_QUANTITIES = [1, 2, 3, 4] as const
export const JIMENG_IMAGE_DEFAULT_QUANTITY = 1
export const JIMENG_IMAGE_MAX_QUANTITY = 4

/** 比例 → 即梦 image_ratio 枚举 */
export const JIMENG_IMAGE_RATIO_MAP: Record<string, { ratio: number; sizes: Record<JimengImageResolution, { width: number; height: number }> }> = {
  '1:1': {
    ratio: 1,
    sizes: {
      '1k': { width: 1024, height: 1024 },
      '2k': { width: 2048, height: 2048 },
      '4k': { width: 4096, height: 4096 },
    },
  },
  '3:4': {
    ratio: 2,
    sizes: {
      '1k': { width: 768, height: 1024 },
      '2k': { width: 1728, height: 2304 },
      '4k': { width: 3520, height: 4693 },
    },
  },
  '16:9': {
    ratio: 3,
    sizes: {
      '1k': { width: 1024, height: 576 },
      '2k': { width: 2560, height: 1440 },
      '4k': { width: 5404, height: 3040 },
    },
  },
  '4:3': {
    ratio: 4,
    sizes: {
      '1k': { width: 1024, height: 768 },
      '2k': { width: 2304, height: 1728 },
      '4k': { width: 4693, height: 3520 },
    },
  },
  '9:16': {
    ratio: 5,
    sizes: {
      '1k': { width: 576, height: 1024 },
      '2k': { width: 1440, height: 2560 },
      '4k': { width: 3040, height: 5404 },
    },
  },
  '2:3': {
    ratio: 6,
    sizes: {
      '1k': { width: 682, height: 1024 },
      '2k': { width: 1664, height: 2496 },
      '4k': { width: 3328, height: 4992 },
    },
  },
  '3:2': {
    ratio: 7,
    sizes: {
      '1k': { width: 1024, height: 682 },
      '2k': { width: 2496, height: 1664 },
      '4k': { width: 4992, height: 3328 },
    },
  },
  '21:9': {
    ratio: 8,
    sizes: {
      '1k': { width: 1195, height: 512 },
      '2k': { width: 3024, height: 1296 },
      '4k': { width: 6197, height: 2656 },
    },
  },
}

export function isJimengDream50ProModel(model?: string | null): boolean {
  const id = String(model || '').trim().toLowerCase()
  return id === JIMENG_STUDIO_IMAGE_MODEL_DREAM50_PRO
    || id === 'dream5.0 pro'
    || id === 'dreamina-seedream-5.0-pro'
}

export function isJimengIntelligentAspect(raw?: string | null): boolean {
  const value = String(raw || '').trim().toLowerCase()
  return value === '智能' || value === 'auto' || value === 'intelligent' || value === 'smart'
}

export function parseJimengImageAspectRatio(raw?: string | null): JimengImageAspectOption {
  const value = String(raw || '').trim()
  if (isJimengIntelligentAspect(value)) return '智能'
  if ((JIMENG_IMAGE_ASPECT_OPTIONS as readonly string[]).includes(value)) {
    return value as JimengImageAspectOption
  }
  return JIMENG_IMAGE_DEFAULT_ASPECT
}

export function parseJimengImageQuantity(raw?: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return JIMENG_IMAGE_DEFAULT_QUANTITY
  return Math.min(JIMENG_IMAGE_MAX_QUANTITY, Math.max(1, n))
}

export function parseJimengImageResolution(raw?: string | null): JimengImageResolution {
  const value = String(raw || '').trim().toLowerCase().replace(/:intelligent$/i, '').replace(/\+auto$/i, '')
  if (value === '1k' || value === '2k' || value === '4k') return value
  return JIMENG_IMAGE_DEFAULT_RESOLUTION
}

/** quality 字段可带 `:intelligent` 后缀，表示即梦「智能」比例 */
export function qualityHasJimengIntelligent(raw?: string | null): boolean {
  const value = String(raw || '').trim().toLowerCase()
  return value.endsWith(':intelligent') || value.endsWith('+auto')
}

export function encodeJimengImageQuality(resolution: JimengImageResolution, intelligent: boolean): string {
  return intelligent ? `${resolution}:intelligent` : resolution
}

/** 由记录的 size(WxH) 反推比例；失败则默认 1:1 */
export function aspectRatioFromJimengSize(size?: string | null): string {
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(String(size || '').trim())
  if (!match) return JIMENG_IMAGE_DEFAULT_ASPECT
  const w = Number(match[1])
  const h = Number(match[2])
  if (!(w > 0 && h > 0)) return JIMENG_IMAGE_DEFAULT_ASPECT
  for (const [ratioKey, entry] of Object.entries(JIMENG_IMAGE_RATIO_MAP)) {
    for (const dim of Object.values(entry.sizes)) {
      if (dim.width === w && dim.height === h) return ratioKey
    }
  }
  const r = w / h
  let best: string = JIMENG_IMAGE_DEFAULT_ASPECT
  let bestDiff = Infinity
  for (const [ratioKey, entry] of Object.entries(JIMENG_IMAGE_RATIO_MAP)) {
    const sample = entry.sizes['2k']
    const diff = Math.abs(sample.width / sample.height - r)
    if (diff < bestDiff) {
      bestDiff = diff
      best = ratioKey
    }
  }
  return best
}

export function resolveJimengImageBenefitType(resolution: JimengImageResolution): string {
  if (resolution === '1k') return 'image_basic_v50_pro_1k'
  if (resolution === '4k') return 'image_basic_v50_pro_4k'
  return 'image_basic_v50_pro_2k'
}

export function resolveJimengImageSize(aspectRatio?: string | null, resolution?: string | null) {
  const parsed = parseJimengImageAspectRatio(aspectRatio)
  const intelligent = parsed === '智能'
  const ratioKey = intelligent ? '1:1' : parsed
  const entry = JIMENG_IMAGE_RATIO_MAP[ratioKey] || JIMENG_IMAGE_RATIO_MAP['1:1']
  const res = parseJimengImageResolution(resolution)
  return {
    ratioKey,
    intelligent,
    imageRatio: entry.ratio,
    resolution: res,
    ...entry.sizes[res],
  }
}

export function buildJimengImageVirtualConfig(model?: string | null) {
  return {
    id: 0,
    provider: 'jimeng_web',
    baseUrl: 'https://jimeng.jianying.com',
    apiKey: '',
    model: model || JIMENG_STUDIO_IMAGE_MODEL_DREAM50_PRO,
    models: [JIMENG_STUDIO_IMAGE_MODEL_DREAM50_PRO],
    settings: {},
  }
}
