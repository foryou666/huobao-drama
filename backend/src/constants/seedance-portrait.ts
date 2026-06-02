/** 火山方舟 Seedance 真人人像 / 素材库相关文档与链接 */

export const SEEDANCE_PORTRAIT_DOC_URL = 'https://www.volcengine.com/docs/82379/2315856?lang=zh'

/** 虚拟人像库 / AIGC 素材说明 */
export const SEEDANCE_VIRTUAL_PORTRAIT_DOC_URL = 'https://www.volcengine.com/docs/82379/2223965?lang=zh'

/** 方舟体验中心（真人人像录入、邀约二维码） */
export const SEEDANCE_EXPERIENCE_URL = 'https://console.volcengine.com/ark/region:ark+cn-beijing/experience'

export const ASSET_URI_PREFIX = 'asset://'

export function isAssetUri(value?: string | null): boolean {
  return String(value || '').trim().startsWith(ASSET_URI_PREFIX)
}

/** 校验素材 ID（不含 asset:// 前缀） */
export function normalizeAssetId(raw?: string | null): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  const id = value.startsWith(ASSET_URI_PREFIX) ? value.slice(ASSET_URI_PREFIX.length) : value
  if (!/^asset-[\w-]+$/i.test(id) && !/^group-[\w-]+$/i.test(id)) {
    return null
  }
  return id
}

export function toAssetUri(assetId?: string | null): string | null {
  const id = normalizeAssetId(assetId)
  return id ? `${ASSET_URI_PREFIX}${id}` : null
}
