/**
 * Seedance 官方 Ark / ChatFire 网关用的 ratio 字段。
 * 仅 volcengine-video / seedance-content 使用；橙盟 chengmeng 走 values.orientation，勿复用本模块。
 */
import { isSeedance2Model } from '../constants/seedance.js'

const FIXED_SEEDANCE_RATIOS = new Set(['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'])

/** ChatFire 等网关有时用 aspectRatio 字段校验，与官方 Ark 的 ratio 并存 */
export function isChatfireVolcengineGateway(baseUrl?: string | null): boolean {
  return String(baseUrl || '').toLowerCase().includes('chatfire')
}

/**
 * Seedance 图生视频 / 多模态参考时应用 adaptive，由参考图决定画幅。
 * 固定比例（9:16 等）在 Seedance 2.0 多参考模式下会被网关拒绝。
 */
export function normalizeSeedanceRatio(
  aspectRatio?: string | null,
  model?: string | null,
  options?: { hasReferenceMedia?: boolean },
): string {
  if (isSeedance2Model(model)) return 'adaptive'
  if (options?.hasReferenceMedia) return 'adaptive'
  const ratio = String(aspectRatio || '').trim()
  if (!ratio || ratio === 'adaptive') return 'adaptive'
  if (FIXED_SEEDANCE_RATIOS.has(ratio)) return ratio
  return 'adaptive'
}

export function seedanceRatioRequestFields(
  aspectRatio: string | null | undefined,
  model: string | null | undefined,
  hasReferenceMedia: boolean,
  baseUrl?: string | null,
): Record<string, string> {
  const ratio = normalizeSeedanceRatio(aspectRatio, model, { hasReferenceMedia })
  const fields: Record<string, string> = { ratio }
  if (isChatfireVolcengineGateway(baseUrl)) {
    fields.aspectRatio = ratio
  }
  return fields
}
