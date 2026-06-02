import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, notFound, badRequest, now } from '../utils/response.js'
import { toSnakeCaseArray, toSnakeCase } from '../utils/transform.js'
import { logActivity } from '../services/activity.js'
import { getAuthUser } from '../middleware/auth.js'
import { assessEpisodeDeletion } from '../services/deletion-guards.js'
import {
  assertDramaAdminAccess,
  assertDramaTeamAccess,
  assertEpisodeTeamAccess,
  loadDramaById,
} from '../services/team-access.js'

const app = new Hono()

const EPISODE_MEMBER_FIELDS = ['content', 'script_content'] as const
const EPISODE_ADMIN_FIELDS = ['title', 'description', 'status'] as const

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
  if (!hasAdminFields && !hasMemberFields) return badRequest(c, 'no valid fields')

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

  await db.update(schema.episodes).set(drizzleUpdates).where(eq(schema.episodes.id, id))
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

// GET /episodes/:id/characters — characters linked to this episode
app.get('/:id/characters', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const links = db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
  const charIds = links.map(l => l.characterId)
  if (!charIds.length) return success(c, [])
  const allChars = db.select().from(schema.characters).all()
  const result = allChars.filter(ch => charIds.includes(ch.id) && !ch.deletedAt)
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:id/scenes — scenes linked to this episode
app.get('/:id/scenes', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const links = db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId)).all()
  const sceneIds = links.map(l => l.sceneId)
  if (!sceneIds.length) return success(c, [])
  const allScenes = db.select().from(schema.scenes).all()
  const result = allScenes.filter(sc => sceneIds.includes(sc.id) && !sc.deletedAt)
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:episode_id/storyboards
app.get('/:episode_id/storyboards', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const rows = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
    .all()
  const links = db.select().from(schema.storyboardCharacters).all()
  const charIdsByStoryboard = new Map<number, number[]>()
  for (const link of links) {
    const arr = charIdsByStoryboard.get(link.storyboardId) || []
    arr.push(link.characterId)
    charIdsByStoryboard.set(link.storyboardId, arr)
  }

  const episodeCharIds = db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
    .map(link => link.characterId)
  const allChars = db.select().from(schema.characters).all()
    .filter(ch => episodeCharIds.includes(ch.id) && !ch.deletedAt)

  return success(c, rows.map((row) => ({
    ...toSnakeCase(row),
    character_ids: charIdsByStoryboard.get(row.id) || [],
    characters: allChars
      .filter(ch => (charIdsByStoryboard.get(row.id) || []).includes(ch.id))
      .map(ch => toSnakeCase(ch)),
  })))
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
  const sbsWithImage = sbs.filter(s => s.composedImage)
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
      generate_images: { status: stepStatus(sbsWithImage.length === sbs.length && sbs.length > 0, sbsWithImage.length > 0), completed: sbsWithImage.length, total: sbs.length },
      generate_videos: { status: stepStatus(sbsWithVideo.length === sbs.length && sbs.length > 0, sbsWithVideo.length > 0), completed: sbsWithVideo.length, total: sbs.length },
      compose_shots: { status: stepStatus(sbsComposed.length === sbs.length && sbs.length > 0, sbsComposed.length > 0), completed: sbsComposed.length, total: sbs.length },
      merge_episode: { status: latestMerge?.status === 'completed' ? 'done' : (latestMerge ? latestMerge.status : 'pending'), merged_url: latestMerge?.mergedUrl },
    },
  })
})

export default app
