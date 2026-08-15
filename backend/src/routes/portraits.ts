import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest } from '../utils/response.js'
import { bindCharacterPortrait, getPortraitGuide } from '../services/seedance-portrait.js'
import {
  refreshCharacterSeedanceAssetStatus,
  syncCharacterSeedanceAsset,
  cancelCharacterSeedanceAsset,
} from '../services/seedance-asset.js'
import { denyUnlessAdmin, getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { findCharacterOutfit, listCharacterOutfits } from '../utils/character-image-variants.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import {
  beginPortraitCertRecord,
  finalizePortraitCertRecord,
  getPortraitCertQuotaSummary,
  getPortraitCertRecord,
  listPortraitCertRecords,
  softCancelPortraitCertById,
  softCancelPortraitCertRecord,
  updatePortraitAssetQuota,
} from '../services/portrait-cert-records.js'

const app = new Hono()

function readOutfitId(input: Record<string, unknown> | null | undefined, queryOutfitId?: string | null) {
  const fromBody = String(input?.outfit_id ?? input?.outfitId ?? '').trim()
  const fromQuery = String(queryOutfitId || '').trim()
  return fromBody || fromQuery || null
}

function readCandidateId(input: Record<string, unknown> | null | undefined, queryCandidateId?: string | null) {
  const fromBody = String(input?.candidate_id ?? input?.candidateId ?? '').trim()
  const fromQuery = String(queryCandidateId || '').trim()
  return fromBody || fromQuery || null
}

function outfitPortraitPayload(
  char: typeof schema.characters.$inferSelect,
  outfitId: string | null,
  candidateId?: string | null,
) {
  if (!outfitId) {
    return {
      outfit_id: null,
      candidate_id: null,
      seedance_asset_id: char.seedanceAssetId,
      seedance_asset_group_id: char.seedanceAssetGroupId,
      seedance_asset_status: char.seedanceAssetStatus,
    }
  }
  const outfit = findCharacterOutfit(char.referenceImages, outfitId)
  const candidate = candidateId
    ? (outfit?.candidates || []).find(c => c.id === candidateId)
    : null
  return {
    outfit_id: outfitId,
    candidate_id: candidateId || null,
    seedance_asset_id: candidate?.seedance_asset_id ?? outfit?.seedance_asset_id ?? null,
    seedance_asset_group_id: char.seedanceAssetGroupId,
    seedance_asset_status: candidate?.seedance_asset_status ?? outfit?.seedance_asset_status ?? null,
    outfit: outfit ? toSnakeCase(outfit as any) : null,
  }
}

// GET /portraits/guide — 真人人像录入指引
app.get('/guide', (c) => success(c, getPortraitGuide()))

// PUT /portraits/characters/:id — 绑定角色肖像类型与方舟 Asset ID
app.put('/characters/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()

  try {
    const result = bindCharacterPortrait(id, {
      portrait_type: body.portrait_type,
      seedance_asset_id: body.seedance_asset_id,
      seedance_asset_group_id: body.seedance_asset_group_id,
      seedance_asset_status: body.seedance_asset_status,
    })

    const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    logActivity(getAuthUser(c), {
      action: 'portrait.bind',
      summary: `绑定角色肖像：${char?.name || id}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char?.dramaId,
      metadata: {
        portrait_type: result.character?.portraitType,
        asset_id: result.character?.seedanceAssetId,
      },
    })

    return success(c, {
      id,
      portrait_type: result.character?.portraitType,
      seedance_asset_id: result.character?.seedanceAssetId,
      seedance_asset_group_id: result.character?.seedanceAssetGroupId,
      seedance_asset_status: result.character?.seedanceAssetStatus,
      asset_uri: result.asset_uri,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// POST /portraits/characters/:id/sync-asset — AIGC 立绘/造型提交方舟私域素材库
app.post('/characters/:id/sync-asset', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const outfitId = readOutfitId(body)
  const candidateId = readCandidateId(body)
  const force = !!body.force
  const user = getAuthUser(c)

  let recordId: number | null = null
  try {
    const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    if (!char) return badRequest(c, 'Character not found')

    const outfit = outfitId ? findCharacterOutfit(char.referenceImages, outfitId) : null
    const candidate = candidateId
      ? (outfit?.candidates || []).find(c => c.id === candidateId)
      : null
    const outfitLabel = outfit?.label || outfitId
    const summary = outfitLabel
      ? (candidate
        ? `提交方舟素材库：${char.name} · ${outfitLabel} · ${candidate.label || candidate.id}`
        : `提交方舟素材库：${char.name} · ${outfitLabel}`)
      : `提交方舟素材库：${char.name}`

    const billed = tryChargeUser(c, CREDIT_ACTIONS.PORTRAIT_SYNC, {
      summary,
      dramaId: char.dramaId,
      resourceType: 'character',
      resourceId: id,
    })
    if (billed.error) return billed.error

    const draft = beginPortraitCertRecord({
      characterId: id,
      outfitId,
      user,
      force,
      imageUrl: candidate?.url || undefined,
    })
    recordId = draft?.id ?? null

    const result = await syncCharacterSeedanceAsset(id, { force, outfitId, candidateId })

    finalizePortraitCertRecord(recordId, {
      status: result.status as any,
      assetId: result.asset_id,
      groupId: result.group_id,
      skipped: result.skipped,
    })

    logActivity(user, {
      action: 'portrait.sync',
      summary,
      resourceType: 'character',
      resourceId: id,
      dramaId: char?.dramaId,
      creditCost: billed.charge.cost,
      metadata: {
        asset_id: result.asset_id,
        outfit_id: result.outfit_id,
        candidate_id: result.candidate_id,
        skipped: result.skipped,
        cert_record_id: recordId,
        credit_tx_id: billed.charge.transactionId,
      },
    })

    const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    return success(c, {
      id,
      skipped: result.skipped,
      ...outfitPortraitPayload(updated!, outfitId, candidateId || result.candidate_id),
      asset_uri: result.asset_uri,
      portrait_type: result.character?.portraitType,
      credits_balance: billed.charge.balance,
      outfits: listCharacterOutfits(updated?.referenceImages).map(o => toSnakeCase(o as any)),
      cert_record_id: recordId,
    })
  } catch (err: any) {
    finalizePortraitCertRecord(recordId, {
      status: 'failed',
      failedReason: err?.message || String(err),
    })
    return badRequest(c, err.message)
  }
})

// GET /portraits/characters/:id/asset-status — 轮询素材入库状态
app.get('/characters/:id/asset-status', async (c) => {
  const id = Number(c.req.param('id'))
  const outfitId = readOutfitId(null, c.req.query('outfit_id') || c.req.query('outfitId'))
  const candidateId = readCandidateId(null, c.req.query('candidate_id') || c.req.query('candidateId'))

  try {
    const result = await refreshCharacterSeedanceAssetStatus(id, { outfitId, candidateId })
    const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    return success(c, {
      id,
      ...outfitPortraitPayload(updated!, outfitId, candidateId || result.candidate_id),
      asset_uri: result.asset_uri,
      failed_reason: result.failed_reason,
      outfits: listCharacterOutfits(updated?.referenceImages).map(o => toSnakeCase(o as any)),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// DELETE /portraits/characters/:id/asset — 取消认证并删除方舟素材（腾配额；流水软取消保留）
app.delete('/characters/:id/asset', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const outfitId = readOutfitId(body, c.req.query('outfit_id') || c.req.query('outfitId'))
  const candidateId = readCandidateId(body, c.req.query('candidate_id') || c.req.query('candidateId'))
  const user = getAuthUser(c)

  try {
    const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    if (!char) return badRequest(c, 'Character not found')

    const outfitLabel = outfitId
      ? (findCharacterOutfit(char.referenceImages, outfitId)?.label || outfitId)
      : null
    const result = await cancelCharacterSeedanceAsset(id, { outfitId, candidateId })
    softCancelPortraitCertRecord({
      characterId: id,
      outfitId,
      assetId: result.deleted_asset_id,
      user,
      reason: 'user',
    })
    logActivity(user, {
      action: 'portrait.cancel',
      summary: outfitLabel
        ? `取消造型认证：${char.name || id} · ${outfitLabel}`
        : `取消虚拟人像认证：${char.name || id}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char.dramaId,
      metadata: {
        deleted_asset_id: result.deleted_asset_id,
        outfit_id: outfitId,
        candidate_id: candidateId,
      },
    })
    const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    return success(c, {
      id,
      ...outfitPortraitPayload(updated!, outfitId, candidateId),
      asset_uri: null,
      deleted_asset_id: result.deleted_asset_id,
      outfits: listCharacterOutfits(updated?.referenceImages).map(o => toSnakeCase(o as any)),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// ===== 管理员：认证流水 / 配额 =====

app.get('/admin/summary', (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  return success(c, getPortraitCertQuotaSummary())
})

app.get('/admin/records', (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const status = c.req.query('status') || null
  const configIdRaw = c.req.query('config_id')
  const configId = configIdRaw != null && configIdRaw !== '' ? Number(configIdRaw) : null
  const q = c.req.query('q') || null
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const result = listPortraitCertRecords({ status, configId, q, limit, offset })
  return success(c, {
    ...result,
    items: toSnakeCaseArray(result.items as any),
  })
})

app.put('/admin/keys/:configId/quota', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const configId = Number(c.req.param('configId'))
  const body = await c.req.json().catch(() => ({}))
  try {
    const quota = Number(body.portrait_asset_quota ?? body.quota)
    const result = updatePortraitAssetQuota(configId, quota)
    return success(c, result)
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.delete('/admin/records/:id', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const recordId = Number(c.req.param('id'))
  const user = getAuthUser(c)
  try {
    const row = getPortraitCertRecord(recordId)
    if (!row) return badRequest(c, '认证记录不存在')
    if (row.status === 'active' || row.status === 'processing') {
      await cancelCharacterSeedanceAsset(row.characterId, {
        outfitId: row.outfitId,
      })
    }
    const updated = softCancelPortraitCertById(recordId, user, 'admin')
    logActivity(user, {
      action: 'portrait.cancel',
      summary: `后台取消认证：${row.characterName || row.characterId}`,
      resourceType: 'character',
      resourceId: row.characterId,
      dramaId: row.dramaId ?? undefined,
      metadata: {
        cert_record_id: recordId,
        deleted_asset_id: row.seedanceAssetId,
        outfit_id: row.outfitId,
      },
    })
    return success(c, toSnakeCase(updated as any))
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.post('/admin/records/:id/recertify', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const recordId = Number(c.req.param('id'))
  const user = getAuthUser(c)
  try {
    const row = getPortraitCertRecord(recordId)
    if (!row) return badRequest(c, '认证记录不存在')

    const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, row.characterId)).all()
    if (!char) return badRequest(c, '角色不存在')

    const billed = tryChargeUser(c, CREDIT_ACTIONS.PORTRAIT_SYNC, {
      summary: `重新认证：${row.characterName || row.characterId}`,
      dramaId: char.dramaId,
      resourceType: 'character',
      resourceId: row.characterId,
    })
    if (billed.error) return billed.error

    const draft = beginPortraitCertRecord({
      characterId: row.characterId,
      outfitId: row.outfitId,
      user,
      force: true,
    })

    const result = await syncCharacterSeedanceAsset(row.characterId, {
      force: true,
      outfitId: row.outfitId,
    })
    finalizePortraitCertRecord(draft?.id, {
      status: result.status as any,
      assetId: result.asset_id,
      groupId: result.group_id,
      skipped: result.skipped,
    })

    logActivity(user, {
      action: 'portrait.sync',
      summary: `后台重新认证：${row.characterName || row.characterId}`,
      resourceType: 'character',
      resourceId: row.characterId,
      dramaId: char.dramaId,
      creditCost: billed.charge.cost,
      metadata: {
        from_record_id: recordId,
        cert_record_id: draft?.id,
        asset_id: result.asset_id,
        outfit_id: row.outfitId,
      },
    })

    return success(c, {
      ...toSnakeCase(getPortraitCertRecord(draft?.id || 0) || {} as any),
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

export default app
