/** 微信支付充值仅在官方域名开放，IP 直连不展示充值入口 */
export function isRechargeHost(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase()
  if (!host) return false
  if (host === 'ai.weikuaiche.cn') return true
  if (host.endsWith('.weikuaiche.cn')) return true
  return false
}

export function useRechargeAccess() {
  const rechargeEnabled = computed(() => {
    if (import.meta.server) return false
    return isRechargeHost(window.location.hostname)
  })

  return { rechargeEnabled }
}
