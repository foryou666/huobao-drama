import { eq } from 'drizzle-orm'
import { db, schema, getAppMeta, setAppMeta } from '../db/index.js'
import { getUserTeams } from '../services/teams.js'
import { listAllTeamsDirectory } from '../services/drama-shares.js'

export const JIMENG_ACCESS_META_KEY = 'jimeng_channel4_access_v1'

/** 用户可见的伪失败文案（不暴露概率门控） */
export const JIMENG_ACCESS_BUSY_MESSAGE = '上游通道繁忙，提交失败'

export interface JimengTeamAccessRule {
  team_id: number
  success_rate: number
}

export interface JimengAccessSettings {
  /** 总开关：关闭后不做概率门控（全员可提交） */
  enabled: boolean
  /** 未单独配置的团队/无团队用户的默认成功率 0–100 */
  default_success_rate: number
  /** 按团队覆盖的成功率 */
  teams: JimengTeamAccessRule[]
}

const DEFAULT_SETTINGS: JimengAccessSettings = {
  enabled: true,
  default_success_rate: 20,
  teams: [],
}

function clampRate(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function normalizeSettings(raw: unknown): JimengAccessSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS, teams: [] }
  }
  const obj = raw as Record<string, unknown>
  const teamsRaw = Array.isArray(obj.teams) ? obj.teams : []
  const teams: JimengTeamAccessRule[] = []
  const seen = new Set<number>()
  for (const item of teamsRaw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const teamId = Number(row.team_id ?? row.teamId)
    if (!Number.isFinite(teamId) || teamId <= 0 || seen.has(teamId)) continue
    seen.add(teamId)
    teams.push({
      team_id: teamId,
      success_rate: clampRate(row.success_rate ?? row.successRate, DEFAULT_SETTINGS.default_success_rate),
    })
  }
  return {
    enabled: obj.enabled !== false && obj.enabled !== 0 && obj.enabled !== '0',
    default_success_rate: clampRate(obj.default_success_rate ?? obj.defaultSuccessRate, DEFAULT_SETTINGS.default_success_rate),
    teams,
  }
}

/** 首次读取时：若库中已有名称含 lingjing 的团队，自动写入 100% 规则 */
function bootstrapPreferredTeam(settings: JimengAccessSettings): JimengAccessSettings {
  if (settings.teams.length) return settings
  const preferred = listAllTeamsDirectory().find(t => /lingjing|灵境/i.test(String(t.name || '')))
  if (!preferred) return settings
  return {
    ...settings,
    teams: [{ team_id: preferred.id, success_rate: 100 }],
  }
}

export function getJimengAccessSettings(): JimengAccessSettings {
  const raw = getAppMeta(JIMENG_ACCESS_META_KEY)
  if (!raw?.trim()) {
    const bootstrapped = bootstrapPreferredTeam({ ...DEFAULT_SETTINGS, teams: [] })
    // 首次落库，确保默认「lingjing=100%、其他=20%」无需再手动保存一次
    setAppMeta(JIMENG_ACCESS_META_KEY, JSON.stringify(bootstrapped))
    return bootstrapped
  }
  try {
    return normalizeSettings(JSON.parse(raw))
  } catch {
    const bootstrapped = bootstrapPreferredTeam({ ...DEFAULT_SETTINGS, teams: [] })
    setAppMeta(JIMENG_ACCESS_META_KEY, JSON.stringify(bootstrapped))
    return bootstrapped
  }
}

export function setJimengAccessSettings(input: Partial<JimengAccessSettings> | null | undefined): JimengAccessSettings {
  const current = getJimengAccessSettings()
  const next = normalizeSettings({
    enabled: input?.enabled ?? current.enabled,
    default_success_rate: input?.default_success_rate ?? current.default_success_rate,
    teams: input?.teams ?? current.teams,
  })
  setAppMeta(JIMENG_ACCESS_META_KEY, JSON.stringify(next))
  return next
}

export function listJimengAccessSettingsForAdmin() {
  const settings = getJimengAccessSettings()
  const directory = listAllTeamsDirectory()
  const byId = new Map(directory.map(t => [t.id, t.name]))
  return {
    ...settings,
    teams: settings.teams.map(rule => ({
      ...rule,
      team_name: byId.get(rule.team_id) || `团队 #${rule.team_id}`,
    })),
    available_teams: directory,
  }
}

/** 解析用户在通道4的提交成功率（取所属团队中最高覆盖率，否则默认） */
export function resolveJimengSuccessRateForUser(userId: number): {
  successRate: number
  matchedTeamId: number | null
  matchedTeamName: string | null
  defaultRate: number
} {
  const settings = getJimengAccessSettings()
  if (!settings.enabled) {
    return { successRate: 100, matchedTeamId: null, matchedTeamName: null, defaultRate: settings.default_success_rate }
  }
  const memberships = getUserTeams(userId)
  const rateByTeam = new Map(settings.teams.map(t => [t.team_id, t.success_rate]))
  let bestRate = settings.default_success_rate
  let matchedTeamId: number | null = null
  let matchedTeamName: string | null = null
  for (const team of memberships) {
    if (!rateByTeam.has(team.id)) continue
    const rate = rateByTeam.get(team.id)!
    if (matchedTeamId == null || rate > bestRate) {
      bestRate = rate
      matchedTeamId = team.id
      matchedTeamName = team.name
    }
  }
  return {
    successRate: bestRate,
    matchedTeamId,
    matchedTeamName,
    defaultRate: settings.default_success_rate,
  }
}

/**
 * 通道4 概率门控。通过返回 null；拒绝返回用户可见错误文案。
 * 管理员默认放行，避免影响运维调试。
 */
export function evaluateJimengSubmitAccess(user: { id: number; role?: string | null }): string | null {
  if (String(user.role || '') === 'admin') return null
  const settings = getJimengAccessSettings()
  if (!settings.enabled) return null
  const { successRate } = resolveJimengSuccessRateForUser(user.id)
  if (successRate >= 100) return null
  if (successRate <= 0) return JIMENG_ACCESS_BUSY_MESSAGE
  const roll = Math.random() * 100
  if (roll < successRate) return null
  return JIMENG_ACCESS_BUSY_MESSAGE
}

export function findTeamIdByName(name: string): number | null {
  const key = String(name || '').trim()
  if (!key) return null
  const [row] = db.select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.name, key))
    .all()
  return row?.id ?? null
}
