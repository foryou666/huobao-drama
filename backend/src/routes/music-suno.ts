import { Hono } from 'hono'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, notFound, forbidden, now } from '../utils/response.js'
import { denyUnlessAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { logActivity } from '../services/activity.js'
import { toSnakeCase } from '../utils/transform.js'
import { tryChargeUser, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { getActionCost } from '../services/credits.js'
import {
  MINIMAX_MUSIC_DEFAULT_MODEL,
  MINIMAX_MUSIC_MODEL_LABELS,
  MINIMAX_MUSIC_MODELS,
  MINIMAX_MUSIC_PROVIDER,
  normalizeMinimaxMusicModel,
} from '../constants/minimax-music.js'
import {
  MUSIC_LICENSE_CHANNEL,
  MUSIC_LICENSE_ISSUER,
  MUSIC_LICENSE_ISSUER_LEGAL,
  MUSIC_LICENSE_REGION,
  MUSIC_LICENSE_RIGHTS,
  MUSIC_LICENSE_USAGE,
  MUSIC_MEMBER_LEVEL_END,
  MUSIC_MEMBER_LEVEL_START,
  buildMusicOrderNo,
  formatCnDate,
  musicMemberLevelPeriodLabel,
  resolveMusicMemberLevel,
} from '../constants/music-license.js'
import {
  fetchMinimaxAccountBalance,
  isMinimaxMusicConfigured,
  processMusicGeneration,
} from '../services/minimax-music.js'

const app = new Hono<{ Variables: AuthVariables }>()

/** private=本人可见 team=团队可见 public=全站可见 */
const VISIBILITY_VALUES = ['private', 'team', 'public'] as const
type MusicVisibility = (typeof VISIBILITY_VALUES)[number]
const DEFAULT_VISIBILITY: MusicVisibility = 'public'

function normalizeVisibility(raw: unknown): MusicVisibility | null {
  const v = String(raw || '').trim().toLowerCase()
  if ((VISIBILITY_VALUES as readonly string[]).includes(v)) return v as MusicVisibility
  return null
}

function rowVisibility(row: typeof schema.musicGenerations.$inferSelect): MusicVisibility {
  return normalizeVisibility(row.visibility) || DEFAULT_VISIBILITY
}

function findUser(userId: number) {
  const [u] = db.select().from(schema.users)
    .where(eq(schema.users.id, userId))
    .all()
  return u || null
}

function formatClip(clip: any) {
  if (!clip || typeof clip !== 'object') return clip
  return {
    ...clip,
    audio_url: clip.audio_path ? `/${clip.audio_path}` : (clip.audio_url || null),
    cover_url: clip.cover_path ? `/${clip.cover_path}` : (clip.image_url || null),
  }
}

function ensureOrderNo(row: typeof schema.musicGenerations.$inferSelect): string {
  if (row.orderNo) return row.orderNo
  const orderNo = buildMusicOrderNo(row.id, row.createdAt)
  db.update(schema.musicGenerations)
    .set({ orderNo, updatedAt: now() })
    .where(eq(schema.musicGenerations.id, row.id))
    .run()
  return orderNo
}

function buildCertificate(
  row: typeof schema.musicGenerations.$inferSelect,
  owner: { username: string; displayName?: string | null; role?: string | null } | null,
) {
  const orderNo = ensureOrderNo(row)
  const licensee = owner?.displayName || owner?.username || `用户#${row.userId}`
  const workName = row.title?.trim() || `影光配乐 #${row.id}`
  const issuedAt = row.createdAt?.slice(0, 10) || MUSIC_MEMBER_LEVEL_START
  const issuedAtLabel = formatCnDate(issuedAt)
  return {
    order_no: orderNo,
    issuer: MUSIC_LICENSE_ISSUER,
    issuer_legal: MUSIC_LICENSE_ISSUER_LEGAL,
    licensee,
    /** 证书上统一展示为付费会员，不写等级有效期 */
    member_level: '付费会员',
    member_level_start: MUSIC_MEMBER_LEVEL_START,
    member_level_end: MUSIC_MEMBER_LEVEL_END,
    member_level_period: musicMemberLevelPeriodLabel(),
    project_name: `《${workName}》短剧配乐授权`,
    client_name: licensee,
    work_name: workName,
    usage_scene: MUSIC_LICENSE_USAGE,
    region: MUSIC_LICENSE_REGION,
    channel: MUSIC_LICENSE_CHANNEL,
    rights: MUSIC_LICENSE_RIGHTS,
    /** 授权日期：仅生成日，不写截止日 */
    period_start: issuedAt,
    period_end: null,
    period_end_label: null,
    period_label: issuedAtLabel,
    issued_at: issuedAt,
    issued_at_label: issuedAtLabel,
    album_name: '影光工场 · AI 配乐',
    authors: '影光工场（AI 生成作品，权属由平台依协议管理）',
    instrumental: Boolean(row.instrumental),
    model: row.version || MINIMAX_MUSIC_DEFAULT_MODEL,
    prompt: row.prompt,
  }
}

function formatRow(
  row: typeof schema.musicGenerations.$inferSelect,
  owner?: { username: string; displayName?: string | null; role?: string | null } | null,
) {
  let clips: any[] = []
  if (row.clipsJson) {
    try {
      const parsed = JSON.parse(row.clipsJson)
      clips = Array.isArray(parsed) ? parsed.map(formatClip) : []
    } catch {
      clips = []
    }
  }
  const orderNo = row.orderNo || buildMusicOrderNo(row.id, row.createdAt)
  const certOwner = owner === undefined ? findUser(row.userId) : owner
  return toSnakeCase({
    ...row,
    orderNo,
    visibility: rowVisibility(row),
    audio_url: row.audioPath ? `/${row.audioPath}` : null,
    cover_url: row.coverPath ? `/${row.coverPath}` : null,
    clips,
    certificate: buildCertificate({ ...row, orderNo }, certOwner),
  })
}

function canAccess(row: typeof schema.musicGenerations.$inferSelect, user: { id: number; role: string }, teamId: number | null) {
  if (user.role === 'admin' || row.userId === user.id) return true
  const visibility = rowVisibility(row)
  if (visibility === 'public') return true
  if (visibility === 'team') return teamId != null && row.teamId === teamId
  return false
}

// GET /music/suno/meta
app.get('/meta', (c) => {
  const user = getAuthUser(c)
  return success(c, {
    provider: MINIMAX_MUSIC_PROVIDER,
    versions: [...MINIMAX_MUSIC_MODELS],
    version_labels: MINIMAX_MUSIC_MODEL_LABELS,
    default_version: MINIMAX_MUSIC_DEFAULT_MODEL,
    visibility_options: [
      { value: 'private', label: '本人可见' },
      { value: 'team', label: '团队可见' },
      { value: 'public', label: '全站可见' },
    ],
    default_visibility: DEFAULT_VISIBILITY,
    license: {
      issuer: MUSIC_LICENSE_ISSUER,
      issuer_legal: MUSIC_LICENSE_ISSUER_LEGAL,
      region: MUSIC_LICENSE_REGION,
      channel: MUSIC_LICENSE_CHANNEL,
      usage: MUSIC_LICENSE_USAGE,
      rights: MUSIC_LICENSE_RIGHTS,
      member_level: resolveMusicMemberLevel(user.role),
      member_level_start: MUSIC_MEMBER_LEVEL_START,
      member_level_end: MUSIC_MEMBER_LEVEL_END,
      member_level_period: musicMemberLevelPeriodLabel(),
      auth_period_label: '自出具之日起永久',
      username: user.displayName || user.username,
    },
    agreements: [
      { id: 'user-agreement', title: '用户协议', path: '/music/user-agreement' },
      { id: 'ownership', title: '权属声明', path: '/music/ownership' },
      { id: 'recharge', title: '充值协议', path: '/recharge-agreement' },
    ],
    note: '每次生成将产生订单编号与授权证书。灵感模式用短风格描述；自定义模式填写歌词。建议勾选「纯音乐」做 BGM。',
  })
})

// GET /music/suno/status
app.get('/status', (c) => {
  if (isMinimaxMusicConfigured()) {
    return success(c, {
      state: 'ready',
      configured: true,
      ready: true,
      label: 'MiniMax 配乐已就绪',
      detail: '使用 MiniMax 官方 music_generation 接口',
    })
  }
  return success(c, {
    state: 'unconfigured',
    configured: false,
    ready: false,
    label: 'MiniMax 未配置',
    detail: '请联系管理员在服务器配置 MINIMAX_API_KEY',
  })
})

// GET /music/suno/admin/summary — 管理员：余额 + 统计
app.get('/admin/summary', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const rows = db.select({
    status: schema.musicGenerations.status,
    creditTxId: schema.musicGenerations.creditTxId,
  }).from(schema.musicGenerations).all()

  const counts = {
    total: rows.length,
    completed: 0,
    failed: 0,
    pending: 0,
    processing: 0,
  }
  for (const r of rows) {
    const s = String(r.status || '')
    if (s === 'completed') counts.completed += 1
    else if (s === 'failed') counts.failed += 1
    else if (s === 'processing') counts.processing += 1
    else counts.pending += 1
  }

  const txIds = [...new Set(rows.map(r => r.creditTxId).filter((id): id is number => Number.isFinite(id!) && id! > 0))]
  let creditsSpent = 0
  if (txIds.length) {
    const txs = db.select({
      id: schema.creditTransactions.id,
      amount: schema.creditTransactions.amount,
      type: schema.creditTransactions.type,
    }).from(schema.creditTransactions)
      .where(inArray(schema.creditTransactions.id, txIds))
      .all()
    for (const tx of txs) {
      if (tx.type === 'charge') creditsSpent += Math.abs(Number(tx.amount) || 0)
    }
  }

  const unitCost = getActionCost(CREDIT_ACTIONS.MUSIC_GENERATE_SUNO, 1)
  const upstream = await fetchMinimaxAccountBalance()

  return success(c, {
    provider: MINIMAX_MUSIC_PROVIDER,
    configured: upstream.configured,
    unit_credit_cost: unitCost,
    counts,
    credits_spent: creditsSpent,
    upstream,
  })
})

// GET /music/suno/admin/records — 管理员：配乐生成流水
app.get('/admin/records', (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const status = String(c.req.query('status') || '').trim()
  const keyword = String(c.req.query('q') || c.req.query('keyword') || '').trim().toLowerCase()
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)))
  const offset = Math.max(0, Number(c.req.query('offset') || 0))

  let rows = db.select().from(schema.musicGenerations)
    .orderBy(desc(schema.musicGenerations.id))
    .all()

  if (status) rows = rows.filter(r => String(r.status || '') === status)
  if (keyword) {
    rows = rows.filter(r => {
      const hay = [
        r.prompt,
        r.title,
        r.style,
        r.orderNo,
        r.errorMsg,
        r.version,
        String(r.id),
      ].map(x => String(x || '').toLowerCase()).join(' ')
      return hay.includes(keyword)
    })
  }

  const total = rows.length
  const page = rows.slice(offset, offset + limit)

  const userIds = [...new Set(page.map(r => r.userId))]
  const teamIds = [...new Set(page.map(r => r.teamId).filter((id): id is number => Number.isFinite(id!) && id! > 0))]
  const txIds = [...new Set(page.map(r => r.creditTxId).filter((id): id is number => Number.isFinite(id!) && id! > 0))]

  const owners = new Map<number, { username: string; displayName?: string | null; role?: string | null }>()
  for (const id of userIds) {
    const u = findUser(id)
    if (u) owners.set(id, u)
  }

  const teams = new Map<number, string>()
  if (teamIds.length) {
    const teamRows = db.select({
      id: schema.teams.id,
      name: schema.teams.name,
    }).from(schema.teams)
      .where(inArray(schema.teams.id, teamIds))
      .all()
    for (const t of teamRows) teams.set(t.id, t.name)
  }

  const creditMap = new Map<number, number>()
  if (txIds.length) {
    const txs = db.select({
      id: schema.creditTransactions.id,
      amount: schema.creditTransactions.amount,
      type: schema.creditTransactions.type,
    }).from(schema.creditTransactions)
      .where(inArray(schema.creditTransactions.id, txIds))
      .all()
    for (const tx of txs) {
      if (tx.type === 'charge') creditMap.set(tx.id, Math.abs(Number(tx.amount) || 0))
    }
  }

  const items = page.map(row => {
    const owner = owners.get(row.userId) || null
    const base = formatRow(row, owner)
    return {
      ...base,
      operator_name: owner?.displayName || owner?.username || null,
      team_name: row.teamId ? (teams.get(row.teamId) || null) : null,
      credit_cost: row.creditTxId ? (creditMap.get(row.creditTxId) ?? null) : null,
      model_label: MINIMAX_MUSIC_MODEL_LABELS[normalizeMinimaxMusicModel(row.version)] || row.version || MINIMAX_MUSIC_DEFAULT_MODEL,
    }
  })

  return success(c, {
    items,
    total,
    limit,
    offset,
    has_more: offset + items.length < total,
  })
})

// GET /music/suno
app.get('/', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)))
  const rows = db.select().from(schema.musicGenerations)
    .orderBy(desc(schema.musicGenerations.id))
    .limit(Math.min(500, limit * 5))
    .all()
    .filter(row => canAccess(row, user, teamId))
    .slice(0, limit)

  const userIds = [...new Set(rows.map(r => r.userId))]
  const owners = new Map<number, { username: string; displayName?: string | null; role?: string | null }>()
  for (const id of userIds) {
    const u = findUser(id)
    if (u) owners.set(id, u)
  }

  return success(c, {
    items: rows.map(row => formatRow(row, owners.get(row.userId) || null)),
    license_profile: {
      username: user.displayName || user.username,
      member_level: resolveMusicMemberLevel(user.role),
      member_level_start: MUSIC_MEMBER_LEVEL_START,
      member_level_end: MUSIC_MEMBER_LEVEL_END,
      member_level_period: musicMemberLevelPeriodLabel(),
      auth_period_label: '自出具之日起永久',
    },
  })
})

// GET /music/suno/:id/certificate — 授权证书数据
app.get('/:id/certificate', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效 ID')
  const [row] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  if (!row || !canAccess(row, user, teamId)) return notFound(c, '记录不存在')
  if (row.status !== 'completed') return badRequest(c, '仅已完成的配乐可出具授权证书')
  const owner = findUser(row.userId)
  return success(c, {
    ...buildCertificate(row, owner),
    music: formatRow(row, owner),
  })
})

// GET /music/suno/:id
app.get('/:id', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效 ID')
  const [row] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  if (!row || !canAccess(row, user, teamId)) return notFound(c, '记录不存在')
  return success(c, formatRow(row))
})

// PATCH /music/suno/:id/visibility — 管理员设置可见范围
app.patch('/:id/visibility', async (c) => {
  const user = getAuthUser(c)
  if (user.role !== 'admin') return forbidden(c, '仅管理员可设置可见范围')
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效 ID')
  const body = await c.req.json().catch(() => ({}))
  const visibility = normalizeVisibility(body.visibility)
  if (!visibility) return badRequest(c, '可见范围无效，可选：private / team / public')

  const [row] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  if (!row) return notFound(c, '记录不存在')

  const ts = now()
  db.update(schema.musicGenerations)
    .set({ visibility, updatedAt: ts })
    .where(eq(schema.musicGenerations.id, id))
    .run()

  logActivity(user, {
    action: 'music.suno.visibility',
    resourceType: 'music_generation',
    resourceId: id,
    summary: `配乐 #${id} 可见范围 → ${visibility}`,
    metadata: { visibility, prev: rowVisibility(row) },
  })

  const [next] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  return success(c, formatRow(next!))
})

// DELETE /music/suno/:id — 管理员删除失败记录
app.delete('/:id', (c) => {
  const user = getAuthUser(c)
  if (user.role !== 'admin') return forbidden(c, '仅管理员可删除')
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效 ID')
  const [row] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  if (!row) return notFound(c, '记录不存在')
  if (row.status !== 'failed') return badRequest(c, '仅可删除失败记录')

  db.delete(schema.musicGenerations).where(eq(schema.musicGenerations.id, id)).run()
  logActivity(user, {
    action: 'music.suno.delete',
    resourceType: 'music_generation',
    resourceId: id,
    summary: `删除失败配乐 #${id}`,
  })
  return success(c, { id })
})

// POST /music/suno — 提交生成（异步）
app.post('/', async (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const body = await c.req.json().catch(() => ({}))

  if (!isMinimaxMusicConfigured()) {
    return badRequest(c, 'MiniMax 未配置，无法生成配乐')
  }

  const prompt = String(body.prompt || '').trim()
  if (!prompt) return badRequest(c, '请输入配乐提示词或歌词')

  const custom = body.custom === true || body.custom_mode === true || body.customMode === true
  const instrumental = body.instrumental === true || body.instrumental === 1 || body.instrumental === '1'
  const version = normalizeMinimaxMusicModel(body.version || body.model)
  const title = body.title != null ? String(body.title).trim() || null : null
  const style = body.style != null ? String(body.style).trim() || null : null
  const dramaId = body.drama_id != null ? Number(body.drama_id) : null

  if (custom && !instrumental && !prompt) {
    return badRequest(c, '自定义模式请填写歌词，或勾选纯音乐')
  }
  if (instrumental && prompt.length > 2000) {
    return badRequest(c, '纯音乐描述最多 2000 字')
  }
  if (custom && !instrumental && prompt.length > 3500) {
    return badRequest(c, '歌词最多 3500 字')
  }

  // 生成前需确认已阅读协议（前端勾选；后端二次校验）
  const agreed = body.agree_terms === true || body.agreeTerms === true
  if (!agreed) {
    return badRequest(c, '请先阅读并同意《用户协议》与《权属声明》')
  }

  let visibility: MusicVisibility = DEFAULT_VISIBILITY
  if (user.role === 'admin') {
    visibility = normalizeVisibility(body.visibility) || DEFAULT_VISIBILITY
  }

  const billed = tryChargeUser(c, CREDIT_ACTIONS.MUSIC_GENERATE_SUNO, {
    summary: 'MiniMax 配乐生成',
    resourceType: 'music_generation',
    metadata: { version, instrumental, custom, visibility, provider: MINIMAX_MUSIC_PROVIDER },
  })
  if (billed.error) return billed.error

  const ts = now()
  const insert = db.insert(schema.musicGenerations).values({
    userId: user.id,
    teamId: teamId ?? null,
    dramaId: Number.isFinite(dramaId as number) ? dramaId : null,
    prompt,
    title,
    style,
    negativeTags: null,
    vocalGender: null,
    instrumental,
    customMode: custom,
    version,
    status: 'pending',
    provider: MINIMAX_MUSIC_PROVIDER,
    creditTxId: billed.charge?.transactionId ?? null,
    visibility,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const id = Number(insert.lastInsertRowid)
  const orderNo = buildMusicOrderNo(id, ts)
  db.update(schema.musicGenerations)
    .set({ orderNo, updatedAt: ts })
    .where(eq(schema.musicGenerations.id, id))
    .run()

  logActivity(user, {
    action: 'music.suno.generate',
    resourceType: 'music_generation',
    resourceId: id,
    summary: `MiniMax 配乐 #${id}（${orderNo}）`,
    metadata: { version, instrumental, custom, visibility, order_no: orderNo },
  })

  void processMusicGeneration(id)

  const [row] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  return created(c, formatRow(row!, {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  }))
})

export default app
