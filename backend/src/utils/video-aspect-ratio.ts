/**
 * Seedance 官方 Ark / ChatFire 网关用的 ratio 字段。
 * 仅 volcengine-video / seedance-content 使用；橙盟 chengmeng 走 values.orientation，勿复用本模块。
 */
import { isSeedance2Model } from '../constants/seedance.js'

const FIXED_SEEDANCE_RATIOS = new Set(['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'])

/** 火山官方 Ark 根地址（仅 ratio 字段，无 aspectRatio） */
export function isOfficialArkVolcengine(baseUrl?: string | null): boolean {
  return String(baseUrl || '').toLowerCase().includes('volces.com')
}

/** ChatFire 等第三方火山代理会额外校验 aspectRatio，且只接受 adaptive */
export function shouldSendSeedanceAspectRatioField(baseUrl?: string | null): boolean {
  if (isOfficialArkVolcengine(baseUrl)) return false
  const url = String(baseUrl || '').toLowerCase()
  return url.includes('chatfire') || url.includes('/volcengine')
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
  // 第三方网关（ChatFire 等）的 aspectRatio 字段仅接受 adaptive，不能与 ratio 共用 9:16
  if (shouldSendSeedanceAspectRatioField(baseUrl)) {
    fields.aspectRatio = 'adaptive'
  }
  return fields
}
