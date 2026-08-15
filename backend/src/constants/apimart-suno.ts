/** APIMart Suno 配乐生成 */

export const APIMART_SUNO_PROVIDER = 'apimart'
export const APIMART_SUNO_MODEL = 'suno'

export const APIMART_SUNO_VERSIONS = [
  'v3.5',
  'v4',
  'v4.5',
  'v4.5+',
  'v4.5-all',
  'v5',
  'v5.5',
] as const

export type ApimartSunoVersion = typeof APIMART_SUNO_VERSIONS[number]

export const APIMART_SUNO_DEFAULT_VERSION: ApimartSunoVersion = 'v5'

export function normalizeApimartSunoVersion(raw?: string | null): ApimartSunoVersion {
  const value = String(raw || '').trim()
  if ((APIMART_SUNO_VERSIONS as readonly string[]).includes(value)) {
    return value as ApimartSunoVersion
  }
  return APIMART_SUNO_DEFAULT_VERSION
}
