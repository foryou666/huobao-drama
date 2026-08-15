/**
 * Seedance 官方 Ark / ChatFire 网关用的 ratio 字段。
 * 仅 volcengine-video / seedance-content 使用；橙盟 chengmeng 走 values.orientation，勿复用本模块。
 */
const FIXED_SEEDANCE_RATIOS = new Set(['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'])

/** 火山官方 Ark 根地址（仅 ratio 字段，无 aspectRatio） */
export function isOfficialArkVolcengine(baseUrl?: string | null): boolean {
  return String(baseUrl || '').toLowerCase().includes('volces.com')
}

/** ChatFire / GeekNow / 火山代理等第三方网关会额外校验 aspectRatio */
export function shouldSendSeedanceAspectRatioField(baseUrl?: string | null): boolean {
  // 官方火山方舟仅使用 ratio 字段；其余代理网关均需 aspectRatio
  return !isOfficialArkVolcengine(baseUrl)
}

/**
 * 规范化上游 ratio。
 * 用户选了 9:16 / 16:9 等固定比例时必须原样下发（通道2 竖屏被强制 adaptive 会跟参考图变成横屏）。
 * 仅在未指定或显式 adaptive 时用 adaptive（有参考素材时跟主素材画幅）。
 */
export function normalizeSeedanceRatio(
  aspectRatio?: string | null,
  _model?: string | null,
  _options?: { hasReferenceMedia?: boolean },
): string {
  const ratio = String(aspectRatio || '').trim()
  if (ratio === 'portrait') return '9:16'
  if (ratio === 'landscape') return '16:9'
  if (FIXED_SEEDANCE_RATIOS.has(ratio)) return ratio
  if (!ratio || ratio === 'adaptive') return 'adaptive'
  return 'adaptive'
}

/**
 * 本站入库/卡片占位用的画幅：保留用户选择的横竖屏。
 */
export function normalizeSeedanceDisplayAspectRatio(
  aspectRatio?: string | null,
  fallback: string = '16:9',
): string {
  const ratio = String(aspectRatio || '').trim()
  if (ratio === '16:9' || ratio === '21:9' || ratio === '4:3' || ratio === '3:2' || ratio === 'landscape') {
    return '16:9'
  }
  if (ratio === '9:16' || ratio === '3:4' || ratio === '2:3' || ratio === 'portrait') {
    return '9:16'
  }
  if (ratio === '1:1') return '1:1'
  const fb = String(fallback || '').trim()
  if (fb === '9:16' || fb === '3:4' || fb === '2:3') return '9:16'
  return '16:9'
}

export function seedanceRatioRequestFields(
  aspectRatio: string | null | undefined,
  model: string | null | undefined,
  hasReferenceMedia: boolean,
  baseUrl?: string | null,
): Record<string, string> {
  const ratio = normalizeSeedanceRatio(aspectRatio, model, { hasReferenceMedia })
  const fields: Record<string, string> = { ratio }
  // 第三方网关需单独传 aspectRatio
  if (shouldSendSeedanceAspectRatioField(baseUrl)) {
    fields.aspectRatio = ratio
  }
  return fields
}
