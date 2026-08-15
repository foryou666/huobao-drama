/**
 * 通道8(梦工厂) 访问控制：全员开放。
 * Session / Token 仍仅管理员可在设置页配置。
 */
export function canAccessFunshionChannel(_user?: {
  role?: string | null
  username?: string | null
  displayName?: string | null
  display_name?: string | null
  id?: number | null
} | null): boolean {
  return true
}

/** @deprecated 已全员开放，保留空列表避免旧引用报错 */
export const FUNSHION_ALLOWED_USERNAMES: readonly string[] = []

export function isFunshionAllowedUsername(_username?: string | null, _displayName?: string | null): boolean {
  return true
}
