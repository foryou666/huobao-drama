import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { normalizeIp } from './client-ip.js'

/** 解析多行 / 逗号分隔的 IP/CIDR 文本为去重列表 */
export function parseAllowedIpsInput(input: unknown): string[] {
  if (Array.isArray(input)) {
    return normalizeAllowedIpList(input.map(v => String(v || '')))
  }
  const text = String(input ?? '')
  const parts = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
  return normalizeAllowedIpList(parts)
}

export function normalizeAllowedIpList(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const entry = String(raw || '').trim().toLowerCase()
    if (!entry) continue
    if (!isValidAllowEntry(entry)) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  return out
}

export function serializeAllowedIps(list: string[] | null | undefined): string | null {
  const normalized = normalizeAllowedIpList(list || [])
  return normalized.length ? JSON.stringify(normalized) : null
}

export function deserializeAllowedIps(raw: string | null | undefined): string[] {
  if (!raw) return []
  const text = String(raw).trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return normalizeAllowedIpList(parsed.map(v => String(v || '')))
  } catch {
    /* legacy newline / comma text */
  }
  return parseAllowedIpsInput(text)
}

function isValidAllowEntry(entry: string): boolean {
  if (entry.includes('/')) {
    const [ip, prefixRaw] = entry.split('/')
    const prefix = Number(prefixRaw)
    if (!Number.isInteger(prefix)) return false
    if (isIpv4(ip)) return prefix >= 0 && prefix <= 32
    if (isIpv6(ip)) return prefix >= 0 && prefix <= 128
    return false
  }
  return isIpv4(entry) || isIpv6(entry)
}

function isIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every(p => {
    if (!/^\d{1,3}$/.test(p)) return false
    const n = Number(p)
    return n >= 0 && n <= 255
  })
}

function isIpv6(ip: string): boolean {
  // 宽松校验：含冒号且仅合法字符
  if (!ip.includes(':')) return false
  return /^[0-9a-f:]+$/i.test(ip) && ip.split(':').length >= 3
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function matchIpv4Cidr(ip: string, cidr: string): boolean {
  const [net, prefixRaw] = cidr.split('/')
  const prefix = Number(prefixRaw)
  if (!isIpv4(ip) || !isIpv4(net) || !Number.isInteger(prefix)) return false
  if (prefix === 0) return true
  const mask = prefix === 32 ? 0xffffffff : ((0xffffffff << (32 - prefix)) >>> 0)
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(net) & mask)
}

/** 客户端 IP 是否命中任一白名单项（精确 IP 或 IPv4 CIDR） */
export function ipMatchesAllowlist(clientIp: string, allowlist: string[]): boolean {
  const ip = normalizeIp(clientIp)
  if (!ip || !allowlist.length) return false
  for (const entry of allowlist) {
    if (entry.includes('/')) {
      if (matchIpv4Cidr(ip, entry)) return true
      continue
    }
    if (normalizeIp(entry) === ip) return true
  }
  return false
}

export interface LoginIpDecision {
  allowed: boolean
  restricted: boolean
  allowlist: string[]
  clientIp: string
  reason?: string
}

/**
 * 合并用户个人白名单 + 所属团队白名单。
 * 全部为空 → 不限制；任一非空 → 客户端 IP 须命中并集中任一项。
 * 平台管理员豁免，避免误锁死后台。
 */
export function evaluateLoginIpAccess(opts: {
  userId: number
  role: string
  userAllowedIpsRaw: string | null | undefined
  clientIp: string
}): LoginIpDecision {
  const clientIp = normalizeIp(opts.clientIp)
  if (opts.role === 'admin') {
    return { allowed: true, restricted: false, allowlist: [], clientIp }
  }

  const userList = deserializeAllowedIps(opts.userAllowedIpsRaw)
  const memberships = db.select({ teamId: schema.teamMembers.teamId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, opts.userId))
    .all()
  const teamIds = memberships.map(m => m.teamId)
  let teamLists: string[] = []
  if (teamIds.length) {
    const teams = db.select({ allowedIps: schema.teams.allowedIps })
      .from(schema.teams)
      .where(inArray(schema.teams.id, teamIds))
      .all()
    for (const t of teams) {
      teamLists = teamLists.concat(deserializeAllowedIps(t.allowedIps))
    }
  }

  const allowlist = normalizeAllowedIpList([...userList, ...teamLists])
  if (!allowlist.length) {
    return { allowed: true, restricted: false, allowlist: [], clientIp }
  }
  if (!clientIp) {
    return {
      allowed: false,
      restricted: true,
      allowlist,
      clientIp,
      reason: '无法识别登录 IP',
    }
  }
  if (ipMatchesAllowlist(clientIp, allowlist)) {
    return { allowed: true, restricted: true, allowlist, clientIp }
  }
  return {
    allowed: false,
    restricted: true,
    allowlist,
    clientIp,
    reason: '当前网络环境不允许登录',
  }
}

export function listTeamMemberUserIds(teamId: number): number[] {
  return db.select({ userId: schema.teamMembers.userId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, teamId))
    .all()
    .map(r => r.userId)
}
