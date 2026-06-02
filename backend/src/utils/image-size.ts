import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { readLocalImageDimensions } from './storage.js'

export type ImageAspectRatio = '9:16' | '16:9'

export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = '9:16'
export const DEFAULT_IMAGE_SIZE = '1080x1920'

const ASPECT_TO_PIXELS: Record<ImageAspectRatio, string> = {
  '9:16': '1080x1920',
  '16:9': '1920x1080',
}

/** 剧集标准比例尺寸：按设计分辨率原样发送，不做 16 对齐取整 */
const PRESET_IMAGE_SIZES = new Set(Object.values(ASPECT_TO_PIXELS))

const GRID_CELL_BY_ASPECT: Record<ImageAspectRatio, { cellW: number; cellH: number }> = {
  '9:16': { cellW: 540, cellH: 960 },
  '16:9': { cellW: 960, cellH: 540 },
}

export function resolveImageAspectRatio(raw?: string | null): ImageAspectRatio {
  if (raw === '16:9' || raw === '9:16') return raw
  return DEFAULT_IMAGE_ASPECT_RATIO
}

export function getImageSizeForAspectRatio(ratio?: string | null): string {
  return ASPECT_TO_PIXELS[resolveImageAspectRatio(ratio)]
}

export function getGridCellSizeForAspectRatio(ratio?: string | null) {
  return GRID_CELL_BY_ASPECT[resolveImageAspectRatio(ratio)]
}

/**
 * 非标准尺寸时对齐到 16 的倍数（部分 OpenAI 兼容接口要求）。
 * 剧集预设的 1080x1920 / 1920x1080 保持原值。
 */
export function normalizeImageSize(size?: string | null, fallback = DEFAULT_IMAGE_SIZE): string {
  const raw = String(size || fallback).trim()
  if (PRESET_IMAGE_SIZES.has(raw)) return raw

  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(raw)
  if (!match) return fallback

  const snap = (value: number) => Math.max(16, Math.round(value / 16) * 16)
  return `${snap(Number(match[1]))}x${snap(Number(match[2]))}`
}

export function getDramaImageAspectRatio(dramaId: number): ImageAspectRatio {
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  return resolveImageAspectRatio(drama?.imageAspectRatio)
}

export function getDramaImageSize(dramaId: number): string {
  return getImageSizeForAspectRatio(getDramaImageAspectRatio(dramaId))
}

export function getDramaGridCellSize(dramaId: number) {
  return getGridCellSizeForAspectRatio(getDramaImageAspectRatio(dramaId))
}

/** Explicit size wins; otherwise use drama-level aspect when dramaId is known. */
export function resolveImageSize(explicitSize?: string | null, dramaId?: number): string {
  if (explicitSize) return normalizeImageSize(explicitSize)
  if (dramaId) return getDramaImageSize(dramaId)
  return normalizeImageSize()
}

/** 参考图生图时读取原图尺寸，保持横竖比不变 */
export async function resolveReferenceImageSize(referencePath: string): Promise<string | null> {
  const dims = await readLocalImageDimensions(referencePath)
  if (!dims) return null
  return normalizeImageSize(`${dims.width}x${dims.height}`)
}

export interface ResolveGenerationImageSizeParams {
  explicitSize?: string | null
  dramaId?: number
  referenceImages?: string[]
  imageType?: string | null
}

/**
 * 尺寸策略：
 * - 文生图（无参考图）：使用剧集「画面比例」设置
 * - 参考图生图（如 Seedance 风格转换）：跟随首张参考图原始尺寸
 */
export async function resolveGenerationImageSize(params: ResolveGenerationImageSizeParams): Promise<string> {
  if (params.explicitSize) return normalizeImageSize(params.explicitSize)

  const shouldMatchReference = params.imageType === 'character_variant'
    || params.imageType === 'character_outfit'
    || params.imageType === 'character_outfit_variant'
    || (params.referenceImages?.length && params.imageType !== 'grid')

  if (shouldMatchReference && params.referenceImages?.length) {
    for (const ref of params.referenceImages) {
      const refSize = await resolveReferenceImageSize(ref)
      if (refSize) return refSize
    }
  }

  return resolveImageSize(null, params.dramaId)
}
