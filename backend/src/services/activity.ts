import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import type { AuthUser } from '../middleware/auth.js'

export interface ActivityInput {
  action: string
  summary?: string
  resourceType?: string
  resourceId?: number
  dramaId?: number
  episodeId?: number
  metadata?: Record<string, unknown>
  creditCost?: number
  transactionId?: number
}

function resolveOperatorMeta(user: AuthUser | Pick<AuthUser, 'id'>) {
  if ('username' in user && user.username) {
    return {
      operator_id: user.id,
      operator_username: user.username,
      operator_name: user.displayName || user.username,
    }
  }
  const [row] = db.select().from(schema.users).where(eq(schema.users.id, user.id)).all()
  return {
    operator_id: user.id,
    operator_username: row?.username || '',
    operator_name: row?.displayName || row?.username || '',
  }
}

export function logActivity(user: AuthUser | Pick<AuthUser, 'id'>, input: ActivityInput) {
  try {
    const operator = resolveOperatorMeta(user)
    const metadata = {
      ...operator,
      ...(input.transactionId ? { transaction_id: input.transactionId } : {}),
      ...(input.metadata || {}),
    }
    db.insert(schema.activityLogs).values({
      userId: user.id,
      action: input.action,
      summary: input.summary || null,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId ?? null,
      dramaId: input.dramaId ?? null,
      episodeId: input.episodeId ?? null,
      metadata: JSON.stringify(metadata),
      creditCost: input.creditCost ?? null,
      createdAt: now(),
    }).run()
  } catch (err) {
    console.error('[activity] log failed', input.action, err)
  }
}

export function logCreditActivity(
  user: AuthUser,
  action: string,
  charge: { cost: number; transactionId?: number },
  input: Omit<ActivityInput, 'action' | 'creditCost' | 'transactionId'> = {},
) {
  logActivity(user, {
    action,
    creditCost: charge.cost > 0 ? charge.cost : undefined,
    transactionId: charge.transactionId,
    ...input,
  })
}

export function formatActivityLogRow(
  row: typeof schema.activityLogs.$inferSelect,
  userMap: Map<number, typeof schema.users.$inferSelect>,
) {
  const meta = row.metadata ? JSON.parse(row.metadata) : null
  const u = userMap.get(row.userId)
  return {
    id: row.id,
    user_id: row.userId,
    username: u?.username || meta?.operator_username,
    display_name: u?.displayName || u?.username || meta?.operator_name,
    operator_id: meta?.operator_id ?? row.userId,
    operator_name: meta?.operator_name || u?.displayName || u?.username,
    action: row.action,
    summary: row.summary,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    drama_id: row.dramaId,
    episode_id: row.episodeId,
    metadata: meta,
    credit_cost: row.creditCost ?? 0,
    created_at: row.createdAt,
  }
}

function buildUserMap(userIds: number[]) {
  const users = userIds.length
    ? db.select().from(schema.users).all().filter(u => userIds.includes(u.id))
    : []
  return new Map(users.map(u => [u.id, u]))
}

export function listEpisodeActivityLogs(episodeId: number, opts?: { limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
  const offset = Math.max(opts?.offset ?? 0, 0)
  const rows = db.select().from(schema.activityLogs)
    .orderBy(desc(schema.activityLogs.createdAt))
    .all()
    .filter(row =>
      row.episodeId === episodeId
      || (row.resourceType === 'episode' && row.resourceId === episodeId),
    )
  const slice = rows.slice(offset, offset + limit)
  const userIds = [...new Set(slice.map(r => r.userId))]
  const userMap = buildUserMap(userIds)
  return {
    items: slice.map(row => formatActivityLogRow(row, userMap)),
    total: rows.length,
    limit,
    offset,
  }
}

export function listActivityLogs(opts: {
  userId?: number
  userIds?: number[]
  limit?: number
  offset?: number
}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  let query = db.select().from(schema.activityLogs).orderBy(desc(schema.activityLogs.createdAt))
  if (opts.userIds?.length) {
    query = query.where(inArray(schema.activityLogs.userId, opts.userIds)) as typeof query
  } else if (opts.userId) {
    query = query.where(eq(schema.activityLogs.userId, opts.userId)) as typeof query
  }
  const rows = query.all()
  const slice = rows.slice(offset, offset + limit)
  const userIds = [...new Set(slice.map(r => r.userId))]
  const userMap = buildUserMap(userIds)
  return {
    items: slice.map(row => formatActivityLogRow(row, userMap)),
    total: rows.length,
    limit,
    offset,
  }
}
