import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { requireAuth, requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import {
  getUserBalance,
  grantCredits,
  listCreditPricing,
  listCreditTransactions,
  updateCreditPricing,
} from '../services/credits.js'
import {
  getAistarslabChannelEnabledMap,
  setAistarslabChannelEnabled,
} from '../utils/aistarslab-channel-settings.js'
import {
  getChengmengModelEnabledMap,
  setChengmengModelEnabled,
} from '../utils/chengmeng-model-settings.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { logActivity } from '../services/activity.js'
import { resolveAuditScope } from '../services/team-audit.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAuth)

app.get('/balance', (c) => {
  const user = getAuthUser(c)
  return success(c, { balance: getUserBalance(user.id) })
})

app.get('/transactions', (c) => {
  const user = getAuthUser(c)
  const all = c.req.query('all') === '1'
  const team = c.req.query('team') === '1'
  const teamId = c.req.query('team_id') ? Number(c.req.query('team_id')) : undefined
  const userIdParam = c.req.query('user_id') ? Number(c.req.query('user_id')) : undefined
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)

  const resolved = resolveAuditScope(c, user, { all, team, teamId, userId: userIdParam })
  if (!resolved.ok) return resolved.response
  const { scope } = resolved
  const result = listCreditTransactions({ userIds: scope.userIds, limit, offset })
  return success(c, { ...result, scope: scope.mode, team_id: scope.teamId ?? null })
})

app.get('/pricing', (c) => success(c, {
  items: listCreditPricing(),
  aistarslab_channel_enabled: getAistarslabChannelEnabledMap(),
  chengmeng_model_enabled: getChengmengModelEnabledMap(),
}))

app.put('/chengmeng-models/:modelId/enabled', requireAdmin, async (c) => {
  const modelId = String(c.req.param('modelId') || '').trim()
  if (!modelId) return badRequest(c, 'modelId is required')
  const body = await c.req.json()
  const enabled = body.enabled !== false && body.enabled !== 0 && body.enabled !== '0'
  setChengmengModelEnabled(modelId, enabled)
  logActivity(getAuthUser(c), {
    action: 'credits.chengmeng_model.update',
    summary: `橙盟通道1 模型 ${modelId} ${enabled ? '启用' : '禁用'}`,
    metadata: { model_id: modelId, enabled },
  })
  return success(c, { model_id: modelId, enabled })
})

app.put('/aistarslab-channels/:channel/enabled', requireAdmin, async (c) => {
  const channel = String(c.req.param('channel') || '').trim()
  if (!channel) return badRequest(c, 'channel is required')
  const body = await c.req.json()
  const enabled = body.enabled !== false && body.enabled !== 0 && body.enabled !== '0'
  setAistarslabChannelEnabled(channel, enabled)
  logActivity(getAuthUser(c), {
    action: 'credits.aistarslab_channel.update',
    summary: `Seedance VIP 线路 ${channel} ${enabled ? '启用' : '禁用'}`,
    metadata: { channel, enabled },
  })
  return success(c, { channel, enabled })
})

app.put('/pricing/:action', requireAdmin, async (c) => {
  const action = c.req.param('action')
  const body = await c.req.json()
  const cost = Number(body.cost)
  if (!Number.isFinite(cost) || cost < 0) return badRequest(c, 'cost 必须是非负整数')
  updateCreditPricing(action, cost, body.label, body.description)
  logActivity(getAuthUser(c), {
    action: 'credits.pricing.update',
    summary: `更新积分定价：${action} → ${cost}`,
    metadata: { action, cost },
  })
  return success(c)
})

app.post('/grant', requireAdmin, async (c) => {
  const body = await c.req.json()
  const userId = Number(body.user_id)
  const amount = Number(body.amount)
  if (!userId) return badRequest(c, 'user_id is required')
  const admin = getAuthUser(c)
  const result = grantCredits(userId, amount, admin.id, body.summary)
  if (!result.ok) return badRequest(c, result.message || '充值失败')
  const [targetUser] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
  const targetName = targetUser?.displayName || targetUser?.username
  const grantSummary = body.summary
    || (targetName
      ? `为用户 #${userId}（${targetName}）充值 ${amount} 积分`
      : `为用户 #${userId} 充值 ${amount} 积分`)
  logActivity(admin, {
    action: 'credits.grant',
    summary: grantSummary,
    resourceType: 'user',
    resourceId: userId,
    metadata: { amount, balance: result.balance },
  })
  return success(c, { balance: result.balance, transaction_id: result.transactionId })
})

export default app
