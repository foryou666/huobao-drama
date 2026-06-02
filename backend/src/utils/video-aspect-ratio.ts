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

/** ChatFire / GeekNow / 火山代理等第三方网关会额外校验 aspectRatio，且多模态参考时只接受 adaptive */
export function shouldSendSeedanceAspectRatioField(baseUrl?: string | null): boolean {
  // 官方火山方舟仅使用 ratio 字段；其余代理网关均需 aspectRatio
  return !isOfficialArkVolcengine(baseUrl)
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
  // 第三方网关（ChatFire / GeekNow / volcengine_proxy 等）需单独传 aspectRatio；多模态参考时固定 adaptive
  if (shouldSendSeedanceAspectRatioField(baseUrl)) {
    fields.aspectRatio = ratio === 'adaptive' ? 'adaptive' : ratio
  }
  return fields
}
