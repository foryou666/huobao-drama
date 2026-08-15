import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

/** 取客户端 IP：优先反代头，再回落到 TCP 连接地址 */
export function getClientIp(c: Context): string {
  const forwarded = String(c.req.header('x-forwarded-for') || '').trim()
  if (forwarded) {
    // 取最左侧（原始客户端）；若部署在不可信链路上需改为取最右侧
    const first = forwarded.split(',')[0]?.trim()
    if (first) return normalizeIp(first)
  }
  const realIp = String(c.req.header('x-real-ip') || '').trim()
  if (realIp) return normalizeIp(realIp)
  try {
    const info = getConnInfo(c)
    const addr = info?.remote?.address
    if (addr) return normalizeIp(addr)
  } catch {
    /* not node adapter */
  }
  return ''
}

export function normalizeIp(raw: string): string {
  let ip = String(raw || '').trim().toLowerCase()
  if (!ip) return ''
  // [::1] / :ffff:127.0.0.1
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  // strip zone id
  const zone = ip.indexOf('%')
  if (zone >= 0) ip = ip.slice(0, zone)
  return ip
}
