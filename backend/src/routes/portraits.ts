import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest } from '../utils/response.js'
import { bindCharacterPortrait, getPortraitGuide } from '../services/seedance-portrait.js'
import {
  refreshCharacterSeedanceAssetStatus,
  syncCharacterSeedanceAsset,
} from '../services/seedance-asset.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, CREDIT_ACTIONS } from '../utils/credit-charge.js'

const app = new Hono()

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

// POST /portraits/characters/:id/sync-asset — AIGC 立绘提交方舟私域素材库
app.post('/characters/:id/sync-asset', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))

  try {
    const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
    if (!char) return badRequest(c, 'Character not found')

    const billed = tryChargeUser(c, CREDIT_ACTIONS.PORTRAIT_SYNC, {
      summary: `提交方舟素材库：${char.name}`,
      dramaId: char.dramaId,
      resourceType: 'character',
      resourceId: id,
    })
    if (billed.error) return billed.error

    const result = await syncCharacterSeedanceAsset(id, { force: !!body.force })

    logActivity(getAuthUser(c), {
      action: 'portrait.sync',
      summary: `提交方舟素材库：${char?.name || id}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char?.dramaId,
      creditCost: billed.charge.cost,
      metadata: {
        asset_id: result.asset_id,
        skipped: result.skipped,
        credit_tx_id: billed.charge.transactionId,
      },
    })

    return success(c, {
      id,
      skipped: result.skipped,
      seedance_asset_id: result.asset_id,
      seedance_asset_group_id: result.group_id,
      seedance_asset_status: result.status,
      asset_uri: result.asset_uri,
      portrait_type: result.character?.portraitType,
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// GET /portraits/characters/:id/asset-status — 轮询素材入库状态
app.get('/characters/:id/asset-status', async (c) => {
  const id = Number(c.req.param('id'))

  try {
    const result = await refreshCharacterSeedanceAssetStatus(id)
    return success(c, {
      id,
      seedance_asset_status: result.status,
      seedance_asset_id: result.character?.seedanceAssetId,
      asset_uri: result.asset_uri,
      failed_reason: result.failed_reason,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

export default app
