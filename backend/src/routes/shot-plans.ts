import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { assertEpisodeTeamAccess } from '../services/team-access.js'
import {
  autoGroupClips,
  confirmShotPlans,
  importIndustrialScript,
  listClipsWithPlans,
  listShotPlans,
  movePlanToClip,
  reorderShotPlans,
  updateShotPlan,
} from '../services/shot-plans.js'
import { generateAndImportShotPlans } from '../services/shot-plan-generate.js'
import { listShotPlanLogs, readShotPlanLog, writeShotPlanLog } from '../utils/shot-plan-logger.js'
import { buildShotPlanContext } from '../services/shot-plan-context.js'

const app = new Hono()

function mapPlan(row: ReturnType<typeof listShotPlans>[number]) {
  return {
    ...toSnakeCase(row),
    character_ids: row.character_ids,
  }
}

// GET /episodes/:episode_id/shot-plans
app.get('/:episode_id/shot-plans', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const plans = listShotPlans(episodeId)
  return success(c, plans.map(mapPlan))
})

// GET /episodes/:episode_id/shot-plans/logs
app.get('/:episode_id/shot-plans/logs', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const limit = Number(c.req.query('limit') || 20)
  const items = listShotPlanLogs({ episodeId, limit })
  return success(c, { items, log_dir: 'data/logs/shot-plans' })
})

// GET /episodes/:episode_id/shot-plans/logs/latest
app.get('/:episode_id/shot-plans/logs/latest', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const format = c.req.query('format') === 'json' ? 'json' : 'md'
  const [latest] = listShotPlanLogs({ episodeId, limit: 1 })
  if (!latest) return badRequest(c, '暂无分镜日志')
  const content = readShotPlanLog(latest.basename, format)
  if (!content) return badRequest(c, '日志文件不存在')
  return success(c, { ...latest, format, content })
})

// GET /episodes/:episode_id/shot-plans/logs/:basename
app.get('/:episode_id/shot-plans/logs/:basename', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const basename = c.req.param('basename')
  const format = c.req.query('format') === 'json' ? 'json' : 'md'
  const [meta] = listShotPlanLogs({ episodeId, limit: 100 }).filter(i => i.basename === basename)
  if (!meta) return badRequest(c, '未找到该日志或不属于当前集')
  const content = readShotPlanLog(basename, format)
  if (!content) return badRequest(c, '日志文件不存在')
  return success(c, { ...meta, format, content })
})

// POST /episodes/:episode_id/shot-plans/generate
app.post('/:episode_id/shot-plans/generate', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error

  try {
    const result = await generateAndImportShotPlans(episodeId, access.drama!.id)
    const plans = listShotPlans(episodeId)
    const clips = listClipsWithPlans(episodeId).filter(item => item.clip.clipSource !== 'legacy' && item.clip.clipSource)
    return success(c, {
      ...result,
      shot_plans: plans.map(mapPlan),
      clips: clips.map(({ clip, shotPlans, character_ids }) => ({
        ...toSnakeCase(clip),
        character_ids,
        shot_plans: shotPlans.map(p => mapPlan(p)).filter(Boolean),
      })),
    })
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
})

// POST /episodes/:episode_id/shot-plans/import
app.post('/:episode_id/shot-plans/import', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const body = await c.req.json()
  const text = String(body.text || '').trim()
  if (!text) return badRequest(c, 'text 不能为空')

  try {
    const result = importIndustrialScript(episodeId, access.drama!.id, text)
    const ctx = buildShotPlanContext(episodeId, access.drama!.id)
    const logFiles = writeShotPlanLog({
      source: 'import',
      episodeId,
      dramaId: access.drama!.id,
      episodeNumber: 'error' in ctx ? undefined : ctx.episode.episode_number,
      episodeTitle: 'error' in ctx ? undefined : ctx.episode.title,
      userPrompt: text,
      importResult: result as unknown as Record<string, unknown>,
    })
    const plans = listShotPlans(episodeId)
    const clips = listClipsWithPlans(episodeId).filter(item => item.clip.clipSource !== 'legacy' && item.clip.clipSource)
    return success(c, {
      ...result,
      log_basename: logFiles.basename,
      shot_plans: plans.map(mapPlan),
      clips: clips.map(({ clip, shotPlans, character_ids }) => ({
        ...toSnakeCase(clip),
        character_ids,
        shot_plans: shotPlans.map(p => mapPlan(p)).filter(Boolean),
      })),
    })
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
})

// POST /episodes/:episode_id/shot-plans/confirm
app.post('/:episode_id/shot-plans/confirm', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  return success(c, confirmShotPlans(episodeId))
})

// POST /episodes/:episode_id/shot-plans/reorder
app.post('/:episode_id/shot-plans/reorder', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const body = await c.req.json()
  const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids.map(Number).filter(Boolean) : []
  if (!orderedIds.length) return badRequest(c, 'ordered_ids 不能为空')
  return success(c, reorderShotPlans(episodeId, orderedIds))
})

// PUT /episodes/:episode_id/shot-plans/:plan_id
app.put('/:episode_id/shot-plans/:plan_id', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const planId = Number(c.req.param('plan_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const body = await c.req.json()
  try {
    const updated = updateShotPlan(planId, episodeId, access.drama!.id, body)
    return success(c, mapPlan({ ...updated, character_ids: updated.character_ids || [] }))
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
})

// GET /episodes/:episode_id/clips
app.get('/:episode_id/clips', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const clips = listClipsWithPlans(episodeId)
  return success(c, clips.map(({ clip, shotPlans, character_ids }) => ({
    ...toSnakeCase(clip),
    character_ids,
    shot_plans: shotPlans.map(p => mapPlan(p)).filter(Boolean),
  })))
})

// POST /episodes/:episode_id/clips/auto-group
app.post('/:episode_id/clips/auto-group', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  try {
    const result = autoGroupClips(episodeId, access.drama!.id)
    const clips = listClipsWithPlans(episodeId).filter(item => !item.clip.clipSource || item.clip.clipSource !== 'legacy')
    return success(c, {
      ...result,
      clips: clips.map(({ clip, shotPlans, character_ids }) => ({
        ...toSnakeCase(clip),
        character_ids,
        shot_plans: shotPlans.map(p => mapPlan(p)).filter(Boolean),
      })),
    })
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
})

// POST /episodes/:episode_id/clips/move-plan
app.post('/:episode_id/clips/move-plan', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const access = assertEpisodeTeamAccess(c, episodeId)
  if (access.error) return access.error
  const body = await c.req.json()
  const planId = Number(body.plan_id)
  const targetClipId = Number(body.target_clip_id)
  if (!planId || !targetClipId) return badRequest(c, 'plan_id 与 target_clip_id 必填')
  try {
    const result = movePlanToClip(episodeId, planId, targetClipId)
    const clips = listClipsWithPlans(episodeId).filter(item => !item.clip.clipSource || item.clip.clipSource !== 'legacy')
    return success(c, {
      ...result,
      clips: clips.map(({ clip, shotPlans, character_ids }) => ({
        ...toSnakeCase(clip),
        character_ids,
        shot_plans: shotPlans.map(p => mapPlan(p)).filter(Boolean),
      })),
    })
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
})

export default app
