import { Hono } from 'hono'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, notFound, badRequest, now } from '../utils/response.js'
import { toSnakeCaseArray, toSnakeCase } from '../utils/transform.js'
import { logActivity, listEpisodeActivityLogs } from '../services/activity.js'
import { getAuthUser } from '../middleware/auth.js'
import { assessEpisodeDeletion } from '../services/deletion-guards.js'
import {
  assertDramaAdminAccess,
  assertDramaTeamAccess,
  assertEpisodeTeamAccess,
  loadDramaById,
} from '../services/team-access.js'
import { repairEpisodeSceneLinks } from '../utils/scene-redirect.js'
import {
  getStoryboardCharacterIdsForEpisode,
  repairEpisodeCharacterLinks,
  resolveCharacterIdsForEpisode,
} from '../utils/character-redirect.js'
import shotPlans from './shot-plans.js'

const app = new Hono()

const EPISODE_MEMBER_FIELDS = ['content', 'script_content'] as const
const EPISODE_ADMIN_FIELDS = ['title', 'description', 'status'] as const
const EPISODE_CONFIG_FIELDS = ['image_config_id', 'video_config_id', 'audio_config_id'] as const

function validateServiceConfigId(configId: unknown, serviceType: string): string | null {
  const id = Number(configId)
  if (!Number.isFinite(id) || id <= 0) return '无效的配置 ID'
  const [cfg] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id)).all()
  if (!cfg) return '配置不存在'
  if (cfg.serviceType !== serviceType) return `请选择${serviceType}类型的配置`
  return null
}

// POST /episodes — Create a new episode (team admin only)
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id required')
  if (!body.image_config_id || !body.video_config_id || !body.audio_config_id) {
    return badRequest(c, 'image_config_id, video_config_id and audio_config_id are required')
  }

  const drama = loadDramaById(body.drama_id)
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaAdminAccess(c, drama)
  if (denied) return denied

  const ts = now()
  const existing = db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, body.drama_id))
    .orderBy(schema.episodes.episodeNumber).all()
  const nextNum = existing.length ? Math.max(...existing.map(e => e.episodeNumber)) + 1 : 1

  const res = db.insert(schema.episodes).values({
    dramaId: body.drama_id,
    episodeNumber: nextNum,
    title: body.title || `第${nextNum}集`,
    imageConfigId: body.image_config_id,
    videoConfigId: body.video_config_id,
    audioConfigId: body.audio_config_id,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [ep] = db.select().from(schema.episodes)
    .where(eq(schema.episodes.id, Number(res.lastInsertRowid))).all()
  return success(c, {
    id: ep.id,
    episode_number: ep.episodeNumber,
    title: ep.title,
    image_config_id: ep.imageConfigId,
    video_config_id: ep.videoConfigId,
    audio_config_id: ep.audioConfigId,
  })
})

// PUT /episodes/:id - Update episode fields
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()

  const hasAdminFields = EPISODE_ADMIN_FIELDS.some(key => key in body)
  const hasMemberFields = EPISODE_MEMBER_FIELDS.some(key => key in body)
  const hasConfigFields = EPISODE_CONFIG_FIELDS.some(key => key in body)
  if (!hasAdminFields && !hasMemberFields && !hasConfigFields) return badRequest(c, 'no valid fields')

  const access = assertEpisodeTeamAccess(c, id)
  if (access.error) return access.error

  if (hasAdminFields) {
    const denied = assertDramaAdminAccess(c, access.drama!)
    if (denied) return denied
  }

  const drizzleUpdates: Record<string, any> = { updatedAt: now() }
  if ('content' in body) drizzleUpdates.content = body.content
  if ('script_content' in body) drizzleUpdates.scriptContent = body.script_content
  if ('title' in body) drizzleUpdates.title = body.title
  if ('description' in body) drizzleUpdates.description = body.description
  if ('status' in body) drizzleUpdates.status = body.status

  if ('image_config_id' in body) {
    const err = validateServiceConfigId(body.image_config_id, 'image')
    if (err) return badRequest(c, err)
    drizzleUpdates.imageConfigId = Number(body.image_config_id)
  }
  if ('video_config_id' in body) {
    const err = validateServiceConfigId(body.video_config_id, 'video')
    if (err) return badRequest(c, err)
    drizzleUpdates.videoConfigId = Number(body.video_config_id)
  }
  if ('audio_config_id' in body) {
    const err = validateServiceConfigId(body.audio_config_id, 'audio')
    if (err) return badRequest(c, err)
    drizzleUpdates.audioConfigId = Number(body.audio_config_id)
  }

  await db.update(schema.episodes).set(drizzleUpdates).where(eq(schema.episodes.id, id))

  if ('video_config_id' in body) {
    const [cfg] = db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.id, Number(body.video_config_id))).all()
    logActivity(getAuthUser(c), {
      action: 'episode.video_config',
      summary: `第 ${access.episode!.episodeNumber} 集切换视频服务为 ${cfg?.name || body.video_config_id}`,
      resourceType: 'episode',
      resourceId: id,
      dramaId: access.drama!.id,
      metadata: { video_config_id: Number(body.video_config_id), provider: cfg?.provider || null },
    })
  }

  return success(c)
})

// DELETE /episodes/:id — soft delete (empty episodes only, team admin)
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = assertEpisodeTeamAccess(c, id)
  if (access.error) return access.error
  const denied = assertDramaAdminAccess(c, access.drama!)
  if (denied) return denied
  const check = assessEpisodeDeletion(id)
  if (!check.allowed) return badRequest(c, check.reason || '该集含制作内容，无法删除')
  await db.update(schema.episodes).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.episodes.id, id))
  logActivity(getAuthUser(c), {
    action: 'episode.delete',
    summary: `删除第 ${access.episode!.episodeNumber} 集`,
    resourceType: 'episode',
    resourceId: id,
    dramaId: access.drama!.id,
  })
  return success(c)
})

// GET /episodes/:id/characters — 项目内全部角色（角色为项目级资产，各集共享）
app.get('/:id/characters', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const dramaId = access.drama!.id
  repairEpisodeCharacterLinks(episodeId, dramaId)
  const dramaChars = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'))
  const referencedIds = [...new Set(getStoryboardCharacterIdsForEpisode(episodeId))]
    .filter(id => !dramaChars.some(item => item.id === id))
  const referencedDeleted = referencedIds.length
    ? db.select().from(schema.characters)
      .where(and(inArray(schema.characters.id, referencedIds)))
      .all()
      .filter(ch => !!ch.deletedAt)
    : []
  return success(c, toSnakeCaseArray([...dramaChars, ...referencedDeleted]))
})

// GET /episodes/:id/scenes — 项目内全部场景（场景为项目级资产，各集共享）
app.get('/:id/scenes', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const rows = db.select().from(schema.scenes)
    .where(and(
      eq(schema.scenes.dramaId, access.episode!.dramaId),
      isNull(schema.scenes.deletedAt),
    ))
    .all()
  rows.sort((a, b) => {
    const byLocation = String(a.location).localeCompare(String(b.location), 'zh-CN')
    if (byLocation !== 0) return byLocation
    return String(a.time || '').localeCompare(String(b.time || ''), 'zh-CN')
  })
  return success(c, toSnakeCaseArray(rows))
})

// GET /episodes/:episode_id/storyboards
app.get('/:episode_id/storyboards', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const dramaId = access.drama!.id
  repairEpisodeSceneLinks(episodeId, dramaId)
  repairEpisodeCharacterLinks(episodeId, dramaId)
  const rows = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
    .all()
  const sbIds = rows.map(row => row.id)
  const links = sbIds.length
    ? db.select().from(schema.storyboardCharacters)
      .where(inArray(schema.storyboardCharacters.storyboardId, sbIds))
      .all()
    : []
  const charIdsByStoryboard = new Map<number, number[]>()
  for (const link of links) {
    const arr = charIdsByStoryboard.get(link.storyboardId) || []
    arr.push(link.characterId)
    charIdsByStoryboard.set(link.storyboardId, arr)
  }
  const propLinks = sbIds.length
    ? db.select().from(schema.storyboardProps)
      .where(inArray(schema.storyboardProps.storyboardId, sbIds))
      .all()
    : []
  const propIdsByStoryboard = new Map<number, number[]>()
  for (const link of propLinks) {
    const arr = propIdsByStoryboard.get(link.storyboardId) || []
    arr.push(link.propId)
    propIdsByStoryboard.set(link.storyboardId, arr)
  }

  const episodeCharIds = db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
    .map(link => link.characterId)
  const referencedCharIds = [...new Set([...episodeCharIds, ...getStoryboardCharacterIdsForEpisode(episodeId)])]
  const charsForEpisode = referencedCharIds.length
    ? db.select().from(schema.characters)
      .where(inArray(schema.characters.id, referencedCharIds))
      .all()
      .filter(ch => !ch.deletedAt || referencedCharIds.includes(ch.id))
    : []
  const charById = new Map(charsForEpisode.map(ch => [ch.id, ch]))

  return success(c, rows.map((row) => {
    const resolvedIds = resolveCharacterIdsForEpisode(dramaId, charIdsByStoryboard.get(row.id) || [])
    return {
      ...toSnakeCase(row),
      character_ids: resolvedIds,
      prop_ids: propIdsByStoryboard.get(row.id) || [],
      characters: resolvedIds
        .map(id => charById.get(id))
        .filter((ch): ch is NonNullable<typeof ch> => !!ch)
        .map(ch => toSnakeCase(ch)),
    }
  }))
})

// GET /episodes/:id/pipeline-status — 流水线进度
app.get('/:id/pipeline-status', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const ep = access.episode!

  const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId)).all()
  const scenes = db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, ep.dramaId)).all()
  const sbs = db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)).all()
  const merges = db.select().from(schema.videoMerges).where(eq(schema.videoMerges.episodeId, episodeId)).all()

  const charsWithVoice = chars.filter(ch => ch.voiceStyle)
  const charsWithSample = chars.filter(ch => ch.voiceSampleUrl)
  const sbsWithVideo = sbs.filter(s => s.videoUrl)
  const sbsComposed = sbs.filter(s => s.composedVideoUrl)
  const latestMerge = merges[merges.length - 1]

  function stepStatus(done: boolean, partial?: boolean) {
    if (done) return 'done'
    if (partial) return 'partial'
    return 'pending'
  }

  return success(c, {
    episode_id: episodeId,
    steps: {
      script_rewrite: { status: ep.scriptContent ? 'done' : (ep.content ? 'ready' : 'pending') },
      extract_characters: { status: stepStatus(chars.length > 0), count: chars.length },
      extract_scenes: { status: stepStatus(scenes.length > 0), count: scenes.length },
      assign_voices: { status: stepStatus(charsWithVoice.length === chars.length && chars.length > 0, charsWithVoice.length > 0), assigned: charsWithVoice.length, total: chars.length },
      generate_voice_samples: { status: stepStatus(charsWithSample.length === charsWithVoice.length && charsWithVoice.length > 0, charsWithSample.length > 0), completed: charsWithSample.length, total: charsWithVoice.length },
      extract_storyboards: { status: stepStatus(sbs.length > 0), count: sbs.length },
      // 镜头图不再作为必经环节；可选参考仍可在生视频时按需生成
      generate_videos: { status: stepStatus(sbsWithVideo.length === sbs.length && sbs.length > 0, sbsWithVideo.length > 0), completed: sbsWithVideo.length, total: sbs.length },
      compose_shots: { status: stepStatus(sbsComposed.length === sbs.length && sbs.length > 0, sbsComposed.length > 0), completed: sbsComposed.length, total: sbs.length },
      merge_episode: { status: latestMerge?.status === 'completed' ? 'done' : (latestMerge ? latestMerge.status : 'pending'), merged_url: latestMerge?.mergedUrl },
    },
  })
})

// GET /episodes/:id/activity-logs — 本集操作日志
app.get('/:id/activity-logs', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error

  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const result = listEpisodeActivityLogs(episodeId, { limit, offset })
  return success(c, result)
})

app.route('/', shotPlans)

export default app
