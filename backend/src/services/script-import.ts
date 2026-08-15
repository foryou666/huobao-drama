/**
 * 整部剧本导入：分集写入 → 按集提取资产 → 预览后确认生图
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { createAgent } from '../agents/index.js'
import { db, schema } from '../db/index.js'
import { getAuthUser, type AuthUser } from '../middleware/auth.js'
import { CREDIT_ACTIONS } from '../constants/credit-actions.js'
import { chargeCredits } from './credits.js'
import { generateImage } from './image-generation.js'
import { attachGeneratedImageToEntity } from './image-entity-attach.js'
import { ensureBoardForDrama } from './canvas-boards.js'
import { buildAgentChatMessages, runAgentGenerate } from './agent-chat.js'
import { resolveCharacterImagePrompt } from '../utils/character-image-prompt.js'
import { resolveSceneImagePrompt } from '../utils/scene-image-prompt.js'
import { resolveBillingImageModel, resolveBillingImageProvider } from '../utils/image-billing.js'
import {
  chargeBatchImageItem,
  tryChargeUser,
  tryPreflightBatchImageCharge,
  tryRefundCharge,
} from '../utils/credit-charge.js'
import { now } from '../utils/response.js'
import { normalizeDirectorStyle } from '../prompts/director-styles.js'
import { logActivity } from './activity.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  splitScriptByEpisodeMarkers,
  type ScriptEpisodeSlice,
  SCRIPT_IMPORT_WARN_CHARS,
  SCRIPT_IMPORT_RISK_CHARS,
} from './script-import-split.js'
import { resolveActiveTeamId } from './team-access.js'
import { ensureUserInDefaultTeam } from './teams.js'

export { splitScriptByEpisodeMarkers, SCRIPT_IMPORT_WARN_CHARS, SCRIPT_IMPORT_RISK_CHARS }

const EXTRACT_MESSAGE =
  '请从当前集剧本中提取本集需要的角色、场景、道具文字描述并去重保存。只保存文字描述，不要生成图片。'

const extractingDramas = new Set<number>()
const generatingDramas = new Set<number>()

export type ScriptImportStage =
  | 'preview'
  | 'committed'
  | 'extracting'
  | 'extracted'
  | 'generating'
  | 'done'
  | 'error'

export interface ScriptImportMeta {
  stage: ScriptImportStage
  total_episodes?: number
  extract?: {
    total: number
    done: number
    current_episode?: number | null
    errors: Array<{ episode_number: number; error: string }>
  }
  images?: {
    requested: number
    started: number
    failed: number
    errors: Array<{ type: string; id: number; error: string }>
  }
  error?: string | null
  updated_at?: string
}

function parseMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function getScriptImportMeta(drama: { metadata?: string | null }): ScriptImportMeta | null {
  const meta = parseMetadata(drama.metadata)
  const si = meta.script_import
  if (!si || typeof si !== 'object') return null
  return si as ScriptImportMeta
}

export function setScriptImportMeta(dramaId: number, patch: Partial<ScriptImportMeta>) {
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return
  const meta = parseMetadata(drama.metadata)
  const prev = (meta.script_import && typeof meta.script_import === 'object')
    ? meta.script_import as ScriptImportMeta
    : { stage: 'committed' as ScriptImportStage }
  meta.script_import = {
    ...prev,
    ...patch,
    updated_at: now(),
  }
  db.update(schema.dramas)
    .set({ metadata: JSON.stringify(meta), updatedAt: now() })
    .where(eq(schema.dramas.id, dramaId))
    .run()
}

export function previewScriptImport(text: string) {
  const split = splitScriptByEpisodeMarkers(text)
  return {
    ...split,
    warn_chars: SCRIPT_IMPORT_WARN_CHARS,
    risk_chars: SCRIPT_IMPORT_RISK_CHARS,
    model_note:
      '整部原文不会一次送入模型：先按「第N集」切开写入各集，再按集调用提取 Agent。'
      + `单集超过约 ${SCRIPT_IMPORT_WARN_CHARS} 字可能变慢或截断；超过约 ${SCRIPT_IMPORT_RISK_CHARS} 字建议再拆细。`,
  }
}

function pickServiceConfigId(serviceType: string, preferred?: number | null): number | null {
  if (preferred && Number.isFinite(preferred) && preferred > 0) {
    const [cfg] = db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.id, Number(preferred))).all()
    if (cfg && cfg.serviceType === serviceType) return cfg.id
  }
  const defaults = db.select().from(schema.aiServiceConfigs)
    .where(and(
      eq(schema.aiServiceConfigs.serviceType, serviceType),
      eq(schema.aiServiceConfigs.isDefault, true),
    )).all()
  if (defaults[0]) return defaults[0].id
  const any = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType)).all()
  return any[0]?.id ?? null
}

export interface CommitScriptImportInput {
  title: string
  script_text: string
  style?: string
  director_style?: string
  image_config_id?: number | null
  video_config_id?: number | null
  audio_config_id?: number | null
  /** 已确认的分集预览；若不传则服务端再切一次 */
  episodes?: ScriptEpisodeSlice[]
}

export function commitScriptImport(c: Context, input: CommitScriptImportInput) {
  const user = getAuthUser(c)
  const title = String(input.title || '').trim()
  if (!title) throw new Error('请填写项目名称')

  const split = input.episodes?.length
    ? {
        ok: true as const,
        episodes: input.episodes,
        preamble: '',
        total_chars: input.episodes.reduce((n, e) => n + (e.content?.length || 0), 0),
      }
    : splitScriptByEpisodeMarkers(input.script_text)

  if (!split.ok || !split.episodes.length) {
    throw new Error(
      ('reason' in split && split.reason)
        || '未检测到「第N集」标记，无法导入',
    )
  }

  const imageConfigId = pickServiceConfigId('image', input.image_config_id)
  const videoConfigId = pickServiceConfigId('video', input.video_config_id)
  const audioConfigId = pickServiceConfigId('audio', input.audio_config_id)

  let teamId = resolveActiveTeamId(c, user)
  if (teamId == null) teamId = ensureUserInDefaultTeam(user.id)

  const ts = now()
  const episodes = [...split.episodes].sort((a, b) => a.episode_number - b.episode_number)
  const meta: ScriptImportMeta = {
    stage: 'committed',
    total_episodes: episodes.length,
    extract: { total: episodes.length, done: 0, current_episode: null, errors: [] },
    error: null,
    updated_at: ts,
  }

  const res = db.insert(schema.dramas).values({
    title,
    description: ('preamble' in split ? split.preamble : '')?.slice(0, 500) || null,
    style: input.style || null,
    directorStyle: normalizeDirectorStyle(input.director_style),
    teamId,
    status: 'draft',
    totalEpisodes: episodes.length,
    metadata: JSON.stringify({ script_import: meta }),
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const dramaId = Number(res.lastInsertRowid)
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()

  for (const ep of episodes) {
    if (!ep.content?.trim()) continue
    db.insert(schema.episodes).values({
      dramaId,
      episodeNumber: ep.episode_number,
      title: ep.title || `第${ep.episode_number}集`,
      content: ep.content,
      scriptContent: ep.content,
      imageConfigId: imageConfigId ?? undefined,
      videoConfigId: videoConfigId ?? undefined,
      audioConfigId: audioConfigId ?? undefined,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    }).run()
  }

  ensureBoardForDrama(drama!, user.id, { syncNodes: true })

  logActivity(user, {
    action: 'drama.script_import',
    summary: `导入剧本创建项目「${title}」（${episodes.length} 集）`,
    resourceType: 'drama',
    resourceId: dramaId,
    dramaId,
    metadata: { total_episodes: episodes.length },
  })

  return {
    drama_id: dramaId,
    episode_count: episodes.length,
    image_config_id: imageConfigId,
    video_config_id: videoConfigId,
    audio_config_id: audioConfigId,
    script_import: getScriptImportMeta(drama!),
  }
}

async function extractOneEpisode(dramaId: number, episodeId: number, episodeNumber: number) {
  const agent = createAgent('extractor', episodeId, dramaId)
  if (!agent) throw new Error('提取 Agent 不可用，请检查 Agent 配置')
  const chatMessages = buildAgentChatMessages([], EXTRACT_MESSAGE)
  logTaskProgress('ScriptImport', 'extract-episode', { dramaId, episodeId, episodeNumber })
  await runAgentGenerate(agent, chatMessages, { maxSteps: 28 })
}

export function startScriptImportExtract(dramaId: number, user: AuthUser) {
  if (extractingDramas.has(dramaId)) {
    throw new Error('正在提取中，请稍候')
  }

  const episodes = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .orderBy(schema.episodes.episodeNumber)
    .all()
    .filter(ep => !ep.deletedAt && (ep.scriptContent || ep.content)?.trim())

  if (!episodes.length) throw new Error('没有可提取的分集剧本')

  setScriptImportMeta(dramaId, {
    stage: 'extracting',
    total_episodes: episodes.length,
    extract: { total: episodes.length, done: 0, current_episode: episodes[0].episodeNumber, errors: [] },
    error: null,
  })

  extractingDramas.add(dramaId)
  logTaskStart('ScriptImport', 'extract', { dramaId, total: episodes.length, userId: user.id })

  void (async () => {
    const errors: Array<{ episode_number: number; error: string }> = []
    let done = 0
    try {
      for (const ep of episodes) {
        setScriptImportMeta(dramaId, {
          stage: 'extracting',
          extract: {
            total: episodes.length,
            done,
            current_episode: ep.episodeNumber,
            errors: [...errors],
          },
        })
        try {
          // AGENT_RUN 积分为 0，仍走记账
          chargeCredits(user.id, CREDIT_ACTIONS.AGENT_RUN, {
            summary: `剧本导入提取第${ep.episodeNumber}集`,
            dramaId,
            episodeId: ep.id,
            resourceType: 'episode',
            resourceId: ep.id,
            metadata: { script_import: true },
          })
          await extractOneEpisode(dramaId, ep.id, ep.episodeNumber)
        } catch (err: any) {
          const message = err?.message || String(err)
          errors.push({ episode_number: ep.episodeNumber, error: message })
          logTaskError('ScriptImport', 'extract-episode', {
            dramaId,
            episodeId: ep.id,
            episodeNumber: ep.episodeNumber,
            error: message,
          })
        }
        done += 1
        setScriptImportMeta(dramaId, {
          stage: 'extracting',
          extract: {
            total: episodes.length,
            done,
            current_episode: ep.episodeNumber,
            errors: [...errors],
          },
        })
      }

      setScriptImportMeta(dramaId, {
        stage: 'extracted',
        extract: {
          total: episodes.length,
          done,
          current_episode: null,
          errors,
        },
        error: errors.length === episodes.length ? '全部集提取失败' : null,
      })
      logTaskSuccess('ScriptImport', 'extract', {
        dramaId,
        done,
        failed: errors.length,
      })
    } catch (err: any) {
      setScriptImportMeta(dramaId, {
        stage: 'error',
        error: err?.message || String(err),
      })
      logTaskError('ScriptImport', 'extract', { dramaId, error: err?.message })
    } finally {
      extractingDramas.delete(dramaId)
    }
  })()
}

async function waitAndAttachPropImage(
  generationId: number,
  opts: {
    propId: number
    dramaId: number
    user: AuthUser
    creditTransactionId?: number
  },
) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const [row] = db.select().from(schema.imageGenerations)
      .where(eq(schema.imageGenerations.id, generationId)).all()
    if (!row) throw new Error('生图记录不存在')
    if (row.status === 'failed') {
      tryRefundCharge(opts.creditTransactionId, {
        summary: `导入道具图失败退款`,
        dramaId: opts.dramaId,
        resourceType: 'prop',
        resourceId: opts.propId,
        metadata: { reason: row.errorMsg || 'failed' },
      })
      throw new Error(row.errorMsg || '道具生图失败')
    }
    if (row.status === 'completed' && (row.localPath || row.imageUrl)) {
      attachGeneratedImageToEntity({
        generationId,
        entityType: 'prop',
        entityId: opts.propId,
        dramaId: opts.dramaId,
        groupId: 'hero',
        groupLabel: '主图',
        setAsDefault: true,
        user: opts.user,
      })
      return
    }
    await new Promise(r => setTimeout(r, 1500))
  }
  throw new Error('道具生图超时')
}

export function listScriptImportAssets(dramaId: number) {
  const chars = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
  const scenes = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
  const propRows = db.select().from(schema.props)
    .where(and(eq(schema.props.dramaId, dramaId), isNull(schema.props.deletedAt)))
    .all()

  const items = [
    ...chars.map(c => ({
      type: 'character' as const,
      id: c.id,
      name: c.name,
      description: c.appearance || c.description || '',
      prompt: c.imagePrompt || '',
      has_image: !!c.imageUrl,
      image_url: c.imageUrl || null,
    })),
    ...scenes.map(s => ({
      type: 'scene' as const,
      id: s.id,
      name: [s.location, s.time].filter(Boolean).join(' · ') || `场景#${s.id}`,
      description: s.prompt || '',
      prompt: s.prompt || '',
      has_image: !!s.imageUrl,
      image_url: s.imageUrl || null,
    })),
    ...propRows.map(p => ({
      type: 'prop' as const,
      id: p.id,
      name: p.name,
      description: p.description || '',
      prompt: p.prompt || p.description || '',
      has_image: !!p.imageUrl,
      image_url: p.imageUrl || null,
    })),
  ]

  const missing = items.filter(i => !i.has_image)
  return {
    total: items.length,
    ready_count: items.filter(i => i.has_image).length,
    missing_count: missing.length,
    items,
    missing,
  }
}

function firstEpisodeWithImageConfig(dramaId: number) {
  const eps = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .orderBy(schema.episodes.episodeNumber)
    .all()
  return eps.find(e => e.imageConfigId) || eps[0] || null
}

export async function generateScriptImportImages(
  c: Context,
  dramaId: number,
  opts?: {
    character_ids?: number[]
    scene_ids?: number[]
    prop_ids?: number[]
    only_missing?: boolean
  },
) {
  if (generatingDramas.has(dramaId)) {
    throw new Error('正在生成图片，请稍候')
  }

  const assets = listScriptImportAssets(dramaId)
  const onlyMissing = opts?.only_missing !== false
  const pick = <T extends { id: number; type: string; has_image: boolean }>(
    type: string,
    ids: number[] | undefined,
  ) => {
    let list = assets.items.filter(i => i.type === type)
    if (ids?.length) {
      const set = new Set(ids)
      list = list.filter(i => set.has(i.id))
    } else if (onlyMissing) {
      list = list.filter(i => !i.has_image)
    }
    return list
  }

  const characters = pick('character', opts?.character_ids)
  const scenes = pick('scene', opts?.scene_ids)
  const props = pick('prop', opts?.prop_ids)
  const targets = [...characters, ...scenes, ...props]
  if (!targets.length) throw new Error('没有需要生成的资产图')

  const ep = firstEpisodeWithImageConfig(dramaId)
  if (!ep?.imageConfigId) {
    throw new Error('项目未配置图片服务，请先在某一集锁定图片配置后再生图')
  }

  const billingModel = resolveBillingImageModel({ imageConfigId: ep.imageConfigId })
  const billingProvider = resolveBillingImageProvider({ imageConfigId: ep.imageConfigId })
  const preflight = tryPreflightBatchImageCharge(
    c,
    CREDIT_ACTIONS.CHARACTER_IMAGE,
    targets.length,
    billingModel,
    billingProvider,
  )
  if (preflight.error) return { error: preflight.error }

  const user = getAuthUser(c)
  generatingDramas.add(dramaId)
  setScriptImportMeta(dramaId, {
    stage: 'generating',
    images: { requested: targets.length, started: 0, failed: 0, errors: [] },
    error: null,
  })

  const errors: Array<{ type: string; id: number; error: string }> = []
  let started = 0

  try {
    for (const item of characters) {
      const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, item.id)).all()
      if (!char) {
        errors.push({ type: 'character', id: item.id, error: '角色不存在' })
        continue
      }
      const prompt = resolveCharacterImagePrompt(char)
      const charge = chargeBatchImageItem(user.id, CREDIT_ACTIONS.CHARACTER_IMAGE, billingModel, {
        summary: `导入生图·角色：${char.name}`,
        dramaId,
        episodeId: ep.id,
        resourceType: 'character',
        resourceId: char.id,
        metadata: { script_import: true },
      }, billingProvider)
      if (!charge.ok) {
        errors.push({ type: 'character', id: item.id, error: charge.message || '积分不足' })
        break
      }
      try {
        await generateImage({
          characterId: char.id,
          dramaId,
          prompt,
          configId: ep.imageConfigId ?? undefined,
          creditTransactionId: charge.transactionId,
        })
        started += 1
      } catch (err: any) {
        tryRefundCharge(charge.transactionId, {
          summary: `导入生图失败退款：${char.name}`,
          dramaId,
          resourceType: 'character',
          resourceId: char.id,
          metadata: { reason: err.message },
        })
        errors.push({ type: 'character', id: item.id, error: err.message })
      }
    }

    for (const item of scenes) {
      const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, item.id)).all()
      if (!scene) {
        errors.push({ type: 'scene', id: item.id, error: '场景不存在' })
        continue
      }
      const prompt = resolveSceneImagePrompt(scene)
      const charge = chargeBatchImageItem(user.id, CREDIT_ACTIONS.SCENE_IMAGE, billingModel, {
        summary: `导入生图·场景：${scene.location || scene.id}`,
        dramaId,
        episodeId: ep.id,
        resourceType: 'scene',
        resourceId: scene.id,
        metadata: { script_import: true },
      }, billingProvider)
      if (!charge.ok) {
        errors.push({ type: 'scene', id: item.id, error: charge.message || '积分不足' })
        break
      }
      try {
        await generateImage({
          sceneId: scene.id,
          dramaId,
          prompt,
          configId: ep.imageConfigId ?? undefined,
          imageType: 'scene',
          creditTransactionId: charge.transactionId,
        })
        started += 1
      } catch (err: any) {
        tryRefundCharge(charge.transactionId, {
          summary: `导入生图失败退款：场景${scene.id}`,
          dramaId,
          resourceType: 'scene',
          resourceId: scene.id,
          metadata: { reason: err.message },
        })
        errors.push({ type: 'scene', id: item.id, error: err.message })
      }
    }

    const propTasks: Promise<void>[] = []
    for (const item of props) {
      const [prop] = db.select().from(schema.props).where(eq(schema.props.id, item.id)).all()
      if (!prop) {
        errors.push({ type: 'prop', id: item.id, error: '道具不存在' })
        continue
      }
      const prompt = (prop.prompt || prop.description || prop.name || '').trim()
      if (!prompt) {
        errors.push({ type: 'prop', id: item.id, error: '缺少生图提示词' })
        continue
      }
      const billed = tryChargeUser(c, CREDIT_ACTIONS.IMAGE_GENERATE, {
        summary: `导入生图·道具：${prop.name}`,
        dramaId,
        episodeId: ep.id,
        resourceType: 'prop',
        resourceId: prop.id,
        metadata: { script_import: true, image_model: billingModel },
      })
      if (billed.error) {
        errors.push({ type: 'prop', id: item.id, error: '积分不足' })
        break
      }
      try {
        const genId = await generateImage({
          dramaId,
          prompt,
          configId: ep.imageConfigId ?? undefined,
          imageType: 'prop',
          creditTransactionId: billed.charge.transactionId,
        })
        started += 1
        propTasks.push(
          waitAndAttachPropImage(genId, {
            propId: prop.id,
            dramaId,
            user,
            creditTransactionId: billed.charge.transactionId,
          }).catch((err: any) => {
            errors.push({ type: 'prop', id: item.id, error: err?.message || String(err) })
          }),
        )
      } catch (err: any) {
        tryRefundCharge(billed.charge.transactionId, {
          summary: `导入生图失败退款：${prop.name}`,
          dramaId,
          resourceType: 'prop',
          resourceId: prop.id,
          metadata: { reason: err.message },
        })
        errors.push({ type: 'prop', id: item.id, error: err.message })
      }
    }

    if (propTasks.length) await Promise.allSettled(propTasks)

    setScriptImportMeta(dramaId, {
      stage: 'done',
      images: {
        requested: targets.length,
        started,
        failed: errors.length,
        errors,
      },
      error: null,
    })

    logActivity(user, {
      action: 'drama.script_import.images',
      summary: `剧本导入生图 ${started}/${targets.length}`,
      dramaId,
      resourceType: 'drama',
      resourceId: dramaId,
    })

    return {
      error: null as null,
      requested: targets.length,
      started,
      failed: errors.length,
      errors,
      assets: listScriptImportAssets(dramaId),
    }
  } finally {
    generatingDramas.delete(dramaId)
  }
}

export function getScriptImportStatus(dramaId: number) {
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return null
  const episodes = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, dramaId))
    .orderBy(schema.episodes.episodeNumber)
    .all()
  return {
    drama_id: dramaId,
    title: drama.title,
    script_import: getScriptImportMeta(drama),
    episode_count: episodes.length,
    extracting: extractingDramas.has(dramaId),
    generating: generatingDramas.has(dramaId),
  }
}
