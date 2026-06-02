import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { resolveSceneImagePrompt } from '../utils/scene-image-prompt.js'
import { syncSceneAsset } from '../services/asset-library.js'
import { tryChargeUser, tryRefundCharge, tryPreflightBatchCharge, chargeBatchItem, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { getUserBalance } from '../services/credits.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { imageReferenceSupportHint, supportsImageReference } from '../utils/image-reference-support.js'
import { buildSceneAnglePromptById, buildSceneAngleSheetPrompt } from '../utils/scene-angle-prompts.js'
import { getSceneAnglePreset, listSceneAnglePresets, SCENE_MULTI_VIEW_SHEET_ID } from '../constants/scene-angles.js'
import { listMissingSceneAngleIds } from '../utils/scene-image-variants.js'

function resolveSceneAngleContext(sceneId: number, episodeId: number) {
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
  if (!scene) return { error: 'Scene not found' as const }

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!ep) return { error: 'Episode not found' as const }

  const heroImage = String(scene.imageUrl || scene.localPath || '').trim()
  if (!heroImage) return { error: '请先生成场景主视角图，再生成多角度' as const }

  const config = (ep.imageConfigId != null ? getConfigById(ep.imageConfigId) : null)
    || getActiveConfig('image')
  if (!config) return { error: 'No active image AI config' as const }
  if (!supportsImageReference(config.provider, config.model)) {
    return {
      error: `当前图片模型（${config.provider} · ${config.model || 'unknown'}）不支持参考图生图。${imageReferenceSupportHint()}`,
    }
  }

  return { scene, ep, config, heroImage }
}

const app = new Hono()

// POST /scenes
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()
  const res = db.insert(schema.scenes).values({
    dramaId: body.drama_id,
    episodeId: body.episode_id,
    location: body.location,
    time: body.time || '',
    prompt: body.prompt || body.location,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const [result] = db.select().from(schema.scenes)
    .where(eq(schema.scenes.id, Number(res.lastInsertRowid))).all()
  if (result) syncSceneAsset(result.id)
  return created(c, result)
})

// PUT /scenes/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.location !== undefined) updates.location = body.location
  if (body.time !== undefined) updates.time = body.time
  if (body.prompt !== undefined) updates.prompt = body.prompt
  db.update(schema.scenes).set(updates).where(eq(schema.scenes.id, id)).run()
  syncSceneAsset(id)
  return success(c)
})

// GET /scenes/angle-presets
app.get('/angle-presets/list', (c) => {
  return success(c, { items: listSceneAnglePresets() })
})

// POST /scenes/:id/generate-angle — 基于主场景图生成多角度
app.post('/:id/generate-angle', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const angleId = String(body.angle_id || '').trim()
  if (!angleId) return badRequest(c, 'angle_id is required')
  const preset = getSceneAnglePreset(angleId)
  if (!preset) return badRequest(c, `未知场景角度：${angleId}`)
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const ctx = resolveSceneAngleContext(id, Number(body.episode_id))
  if ('error' in ctx) return badRequest(c, ctx.error)

  const prompt = buildSceneAnglePromptById(ctx.scene, angleId, body.prompt)
  const billed = tryChargeUser(c, CREDIT_ACTIONS.SCENE_IMAGE, {
    summary: `场景多角度：${ctx.scene.location} · ${preset.label}`,
    dramaId: ctx.scene.dramaId,
    episodeId: ctx.ep.id,
    resourceType: 'scene',
    resourceId: id,
  })
  if (billed.error) return billed.error

  try {
    logTaskStart('SceneImage', 'generate-angle', { sceneId: id, angleId, episodeId: ctx.ep.id })
    const genId = await generateImage({
      sceneId: id,
      dramaId: ctx.scene.dramaId,
      prompt,
      referenceImages: [ctx.heroImage],
      frameType: angleId,
      imageType: 'scene_angle',
      variantId: angleId,
      configId: ctx.ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })
    logActivity(getAuthUser(c), {
      action: 'scene.image.angle',
      summary: `场景多角度：${ctx.scene.location} · ${preset.label}`,
      resourceType: 'scene',
      resourceId: id,
      dramaId: ctx.scene.dramaId,
      episodeId: ctx.ep.id,
      creditCost: billed.charge.cost,
      metadata: { generation_id: genId, angle_id: angleId, credit_tx_id: billed.charge.transactionId },
    })
    return success(c, {
      image_generation_id: genId,
      angle_id: angleId,
      label: preset.label,
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '场景多角度生成失败退款',
      dramaId: ctx.scene.dramaId,
      episodeId: ctx.ep.id,
      resourceType: 'scene',
      resourceId: id,
      metadata: { reason: err.message, angle_id: angleId },
    })
    logTaskError('SceneImage', 'generate-angle', { sceneId: id, angleId, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /scenes/:id/generate-all-angles — 一键生成全部角度（多张）
app.post('/:id/generate-all-angles', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const ctx = resolveSceneAngleContext(id, Number(body.episode_id))
  if ('error' in ctx) return badRequest(c, ctx.error)

  const skipExisting = body.skip_existing !== false
  const requestedIds = Array.isArray(body.angle_ids)
    ? body.angle_ids.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : []
  const candidateIds: string[] = requestedIds.length ? requestedIds : listSceneAnglePresets().map(item => item.id)
  const angleIds = skipExisting
    ? listMissingSceneAngleIds(ctx.scene, candidateIds)
    : candidateIds.filter((angleId: string) => !!getSceneAnglePreset(angleId))

  if (!angleIds.length) {
    return success(c, {
      items: [],
      skipped: candidateIds,
      message: skipExisting ? '全部角度已存在，无需重复生成' : '没有可生成的角度',
      credits_balance: getUserBalance(getAuthUser(c).id),
    })
  }

  const preflight = tryPreflightBatchCharge(c, CREDIT_ACTIONS.SCENE_IMAGE, angleIds.length)
  if (preflight.error) return preflight.error

  logTaskStart('SceneImage', 'generate-all-angles', { sceneId: id, angleIds, episodeId: ctx.ep.id })
  const items: Array<{ angle_id: string; label: string; image_generation_id: number }> = []
  const failed: Array<{ angle_id: string; error: string }> = []
  const creditTxIds: number[] = []
  let totalCharged = 0
  let lastBalance = preflight.balance

  for (const angleId of angleIds) {
    const preset = getSceneAnglePreset(angleId)!
    const prompt = buildSceneAnglePromptById(ctx.scene, angleId, body.prompt)
    const charge = chargeBatchItem(preflight.user.id, CREDIT_ACTIONS.SCENE_IMAGE, {
      summary: `场景多角度：${ctx.scene.location} · ${preset.label}`,
      dramaId: ctx.scene.dramaId,
      episodeId: ctx.ep.id,
      resourceType: 'scene',
      resourceId: id,
      metadata: { batch: 'scene_all_angles', angle_id: angleId },
    })
    if (!charge.ok) {
      failed.push({ angle_id: angleId, error: charge.message || '积分不足' })
      break
    }
    totalCharged += charge.cost
    lastBalance = charge.balance
    if (charge.transactionId) creditTxIds.push(charge.transactionId)

    try {
      const genId = await generateImage({
        sceneId: id,
        dramaId: ctx.scene.dramaId,
        prompt,
        referenceImages: [ctx.heroImage],
        frameType: angleId,
        imageType: 'scene_angle',
        variantId: angleId,
        configId: ctx.ep.imageConfigId ?? undefined,
        creditTransactionId: charge.transactionId,
      })
      items.push({ angle_id: angleId, label: preset.label, image_generation_id: genId })
    } catch (err: any) {
      tryRefundCharge(charge.transactionId, {
        summary: `场景多角度失败退款：${preset.label}`,
        dramaId: ctx.scene.dramaId,
        episodeId: ctx.ep.id,
        resourceType: 'scene',
        resourceId: id,
        metadata: { reason: err.message, angle_id: angleId, batch: 'scene_all_angles' },
      })
      failed.push({ angle_id: angleId, error: err.message })
    }
  }

  logTaskSuccess('SceneImage', 'generate-all-angles', { sceneId: id, count: items.length, failed: failed.length })
  logActivity(getAuthUser(c), {
    action: 'scene.image.angle.batch',
    summary: `场景全部角度：${ctx.scene.location}（${items.length}/${angleIds.length} 张）`,
    resourceType: 'scene',
    resourceId: id,
    dramaId: ctx.scene.dramaId,
    episodeId: ctx.ep.id,
    creditCost: totalCharged,
    metadata: {
      angle_ids: angleIds,
      generation_ids: items.map(item => item.image_generation_id),
      credit_tx_ids: creditTxIds,
      failed,
    },
  })
  return success(c, {
    items,
    failed,
    skipped: candidateIds.filter((angleId: string) => !angleIds.includes(angleId)),
    credits_balance: lastBalance,
  })
})

// POST /scenes/:id/generate-angle-sheet — 一张图内多视角拼板
app.post('/:id/generate-angle-sheet', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const ctx = resolveSceneAngleContext(id, Number(body.episode_id))
  if ('error' in ctx) return badRequest(c, ctx.error)

  const prompt = buildSceneAngleSheetPrompt(ctx.scene, body.prompt)
  const billed = tryChargeUser(c, CREDIT_ACTIONS.SCENE_IMAGE, {
    summary: `场景多视角拼板：${ctx.scene.location}`,
    dramaId: ctx.scene.dramaId,
    episodeId: ctx.ep.id,
    resourceType: 'scene',
    resourceId: id,
  })
  if (billed.error) return billed.error

  try {
    logTaskStart('SceneImage', 'generate-angle-sheet', { sceneId: id, episodeId: ctx.ep.id })
    const genId = await generateImage({
      sceneId: id,
      dramaId: ctx.scene.dramaId,
      prompt,
      referenceImages: [ctx.heroImage],
      size: '2048x1024',
      frameType: SCENE_MULTI_VIEW_SHEET_ID,
      imageType: 'scene_angle_sheet',
      variantId: SCENE_MULTI_VIEW_SHEET_ID,
      configId: ctx.ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })
    logTaskSuccess('SceneImage', 'generate-angle-sheet', { sceneId: id, generationId: genId })
    logActivity(getAuthUser(c), {
      action: 'scene.image.angle.sheet',
      summary: `场景多视角拼板：${ctx.scene.location}`,
      resourceType: 'scene',
      resourceId: id,
      dramaId: ctx.scene.dramaId,
      episodeId: ctx.ep.id,
      creditCost: billed.charge.cost,
      metadata: { generation_id: genId, credit_tx_id: billed.charge.transactionId },
    })
    return success(c, {
      image_generation_id: genId,
      angle_id: SCENE_MULTI_VIEW_SHEET_ID,
      label: '多视角拼板',
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '场景多视角拼板生成失败退款',
      dramaId: ctx.scene.dramaId,
      episodeId: ctx.ep.id,
      resourceType: 'scene',
      resourceId: id,
      metadata: { reason: err.message },
    })
    logTaskError('SceneImage', 'generate-angle-sheet', { sceneId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /scenes/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, id)).all()
  if (!scene) return badRequest(c, 'Scene not found')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id))).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const prompt = resolveSceneImagePrompt(scene, body.prompt)
  if (body.prompt?.trim()) {
    db.update(schema.scenes).set({ prompt, updatedAt: now() }).where(eq(schema.scenes.id, id)).run()
  }

  const billed = tryChargeUser(c, CREDIT_ACTIONS.SCENE_IMAGE, {
    summary: `生成场景图：${scene.location}`,
    dramaId: scene.dramaId,
    episodeId: ep.id,
    resourceType: 'scene',
    resourceId: id,
  })
  if (billed.error) return billed.error

  try {
    logTaskStart('SceneImage', 'generate', { sceneId: id, episodeId: ep.id, dramaId: scene.dramaId, location: scene.location, prompt })
    db.update(schema.scenes).set({ status: 'processing', updatedAt: now() }).where(eq(schema.scenes.id, id)).run()
    const genId = await generateImage({
      sceneId: id,
      dramaId: scene.dramaId,
      prompt,
      configId: ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })
    logTaskSuccess('SceneImage', 'generate', { sceneId: id, generationId: genId })
    logActivity(getAuthUser(c), {
      action: 'scene.image',
      summary: `生成场景图：${scene.location}`,
      resourceType: 'scene',
      resourceId: id,
      dramaId: scene.dramaId,
      episodeId: ep.id,
      creditCost: billed.charge.cost,
      metadata: { generation_id: genId, credit_tx_id: billed.charge.transactionId },
    })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '场景图生成失败退款',
      dramaId: scene.dramaId,
      episodeId: ep.id,
      resourceType: 'scene',
      resourceId: id,
      metadata: { reason: err.message },
    })
    logTaskError('SceneImage', 'generate', { sceneId: id, error: err.message })
    db.update(schema.scenes).set({ status: 'failed', updatedAt: now() }).where(eq(schema.scenes.id, id)).run()
    return badRequest(c, err.message)
  }
})

// DELETE /scenes/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  db.delete(schema.scenes).where(eq(schema.scenes.id, id)).run()
  return success(c)
})

export default app
