/** 通道8(梦工厂) 已全员开放 */
export const FUNSHION_ALLOWED_USERNAMES = []

/** 任意已登录用户可见；加载中也返回 true，避免导航/页面误藏或误跳转 */
export function canAccessFunshionChannel(user, isAdmin = false) {
  if (isAdmin || user?.role === 'admin') return true
  if (user?.can_use_funshion === true) return true
  if (user?.id != null && Number(user.id) > 0) return true
  if (user?.username || user?.display_name || user?.displayName) return true
  // auth 尚未就绪时也不要隐藏通道（页面内再等 ready）
  return true
}
