/**
 * 分镜拆解 Agent 工具
 * 工厂函数模式 — 注入 episodeId + dramaId
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { logTaskProgress, logTaskSuccess } from '../../utils/task-logger.js'
import { repairEpisodeSceneLinks, resolveActiveSceneId } from '../../utils/scene-redirect.js'
import { ensureEpisodeCharacterLinks } from '../../utils/episode-entity-links.js'
import { isSeedance2Model } from '../../constants/seedance.js'
import { isChengmengProvider } from '../../constants/chengmeng.js'

function getEpisodeVideoConfig(episodeId: number) {
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!ep?.videoConfigId) return null
  const [cfg] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, ep.videoConfigId)).all()
  return cfg || null
}

function getEpisodeVideoModel(episodeId: number): string | null {
  return getEpisodeVideoConfig(episodeId)?.model || null
}

function isSeedance2EpisodeVideo(episodeId: number): boolean {
  const cfg = getEpisodeVideoConfig(episodeId)
  if (!cfg) return false
  if (isChengmengProvider(cfg.provider)) return true
  try {
    const models = cfg.model ? JSON.parse(cfg.model) : []
    const model = Array.isArray(models) ? models[0] : cfg.model
    return isSeedance2Model(model)
  } catch {
    return isSeedance2Model(cfg.model)
  }
}

function getVideoGenerationConstraints(videoModel: string | null, episodeId?: number) {
  const isSeedance2 = episodeId ? isSeedance2EpisodeVideo(episodeId) : isSeedance2Model(videoModel)
  if (isSeedance2) {
    return {
      provider_hint: 'seedance_2',
      max_clip_seconds: 15,
      target_shot_seconds: '12-15',
      min_shot_seconds: 10,
      rule: '每条 storyboard 对应一次视频生成；单条最长 15 秒。禁止把 2 秒快切拆成独立 storyboard。video_prompt 必须用红果工业格式：首行「图片1是…，图片2是…」（禁止 @图片）+ 多个【镜头 NNN】子块（每块约 2 秒，含景别/运镜/打光/表演/台词口型细则/AI 补充提示词）。默认 MS/MCU 面部完整入镜，CU 仅情绪高点，ECU 仅末块钩子；AI 补充提示词含 full face visible。duration 填 12-15 且等于所有「时长：N 秒」之和。禁止仅用 0-3秒/<n> 简写。',
    }
  }
  return {
    provider_hint: 'generic',
    max_clip_seconds: 12,
    target_shot_seconds: '10-15',
    min_shot_seconds: 8,
    rule: '每条 storyboard 尽量 10-15 秒；video_prompt 按 3 秒分段描述镜内变化。',
  }
}

/** 从 video_prompt 推断镜长：优先累加「时长：N 秒」；否则解析 9-12秒 时间轴 */
function inferDurationFromVideoPrompt(videoPrompt?: string | null): number | null {
  const text = String(videoPrompt || '')
  if (!text) return null

  const blockDurations: number[] = []
  for (const match of text.matchAll(/时长[：:]\s*(\d+)\s*秒/g)) {
    const sec = Number(match[1])
    if (Number.isFinite(sec) && sec > 0) blockDurations.push(sec)
  }
  if (blockDurations.length >= 2) {
    const sum = blockDurations.reduce((a, b) => a + b, 0)
    if (sum >= 4) return sum
  }

  let maxEnd = 0
  for (const match of text.matchAll(/(\d+)\s*[-–—]\s*(\d+)\s*秒/g)) {
    const end = Number(match[2])
    if (Number.isFinite(end)) maxEnd = Math.max(maxEnd, end)
  }
  if (maxEnd <= 0) return null
  return maxEnd
}

function normalizeStoryboardDuration(
  duration: number | undefined,
  videoModel: string | null,
  videoPrompt?: string | null,
  episodeId?: number,
): number {
  const { min_shot_seconds, max_clip_seconds } = getVideoGenerationConstraints(videoModel, episodeId)
  const parsed = Math.round(Number(duration || 0))
  const inferred = inferDurationFromVideoPrompt(videoPrompt)

  const pick = (value: number) => Math.min(max_clip_seconds, Math.max(min_shot_seconds, value))

  if (parsed >= min_shot_seconds && parsed <= max_clip_seconds) return parsed
  if (inferred != null && inferred >= min_shot_seconds && inferred <= max_clip_seconds) return inferred
  if (inferred != null && inferred > max_clip_seconds) return max_clip_seconds

  // Agent 仍填 1–3 秒（旧模版）：优先用 video_prompt 推断，否则默认 15，不再统一压成 12
  if (parsed > 0 && parsed <= 3) {
    if (inferred != null && inferred >= 4) return pick(inferred)
    return (episodeId ? isSeedance2EpisodeVideo(episodeId) : isSeedance2Model(videoModel)) ? 15 : 10
  }

  if (parsed > max_clip_seconds) return max_clip_seconds
  if (parsed > 0 && parsed < min_shot_seconds) {
    if (inferred != null && inferred >= min_shot_seconds) return pick(inferred)
    return min_shot_seconds
  }

  if (inferred != null && inferred >= min_shot_seconds) return pick(inferred)
  return (episodeId ? isSeedance2EpisodeVideo(episodeId) : isSeedance2Model(videoModel)) ? 15 : 10
}

function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
    .run()

  const uniqueIds = [...new Set(characterIds.filter(Boolean))]
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    }).run()
  }
}

function getEpisodeSceneIds(episodeId: number) {
  return new Set(
    db.select().from(schema.episodeScenes)
      .where(eq(schema.episodeScenes.episodeId, episodeId)).all()
      .map(link => link.sceneId),
  )
}

function getEpisodeCharacterIds(episodeId: number) {
  return new Set(
    db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
      .map(link => link.characterId),
  )
}

function validateStoryboardBindings(episodeId: number, sceneId: number | null | undefined, characterIds: number[] | undefined) {
  const [ep] = db.select().from(schema.episodes)
    .where(eq(schema.episodes.id, episodeId)).all()
  if (!ep) throw new Error('Episode not found')

  if (sceneId != null) {
    const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
    if (!scene || scene.deletedAt || scene.dramaId !== ep.dramaId) {
      throw new Error(`scene_id ${sceneId} 不属于当前项目`)
    }
  }

  const episodeCharacterIds = ensureEpisodeCharacterLinks(episodeId, ep.dramaId, characterIds)

  const invalidCharacterIds = (characterIds || []).filter(id => !episodeCharacterIds.has(id))
  if (invalidCharacterIds.length) {
    throw new Error(`character_ids 不属于当前集: ${invalidCharacterIds.join(', ')}`)
  }
}

export function createStoryboardTools(episodeId: number, dramaId: number) {
  const readStoryboardContext = createTool({
    id: 'read_storyboard_context',
    description: 'Read the screenplay, characters, and scenes for storyboard breakdown.',
    inputSchema: z.object({}),
    execute: async () => {
      const [ep] = db.select().from(schema.episodes)
        .where(eq(schema.episodes.id, episodeId)).all()
      if (!ep) return { error: 'Episode not found' }
      repairEpisodeSceneLinks(episodeId, dramaId)
      const script = ep.scriptContent || ep.content
      if (!script) return { error: 'Episode has no script' }

      const charLinks = db.select().from(schema.episodeCharacters)
        .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
      const sceneLinks = db.select().from(schema.episodeScenes)
        .where(eq(schema.episodeScenes.episodeId, episodeId)).all()

      const linkedCharacterIds = new Set(charLinks.map(link => link.characterId))
      const linkedSceneIds = new Set(sceneLinks.map(link => link.sceneId))

      const chars = db.select().from(schema.characters)
        .where(eq(schema.characters.dramaId, dramaId)).all()
      const scns = db.select().from(schema.scenes)
        .where(eq(schema.scenes.dramaId, dramaId)).all()
      const existingStoryboards = db.select().from(schema.storyboards)
        .where(eq(schema.storyboards.episodeId, episodeId)).all()

      const characters = chars
        .filter(c => !c.deletedAt)
        .filter(c => !linkedCharacterIds.size || linkedCharacterIds.has(c.id))
        .map(c => ({
          id: c.id,
          name: c.name,
          role: c.role || '',
          description: c.description || '',
          appearance: c.appearance || '',
          personality: c.personality || '',
          voice_style: c.voiceStyle || '',
          image_url: c.imageUrl || '',
          reference_images: c.referenceImages || '',
        }))

      const scenes = scns
        .filter(s => !s.deletedAt)
        .filter(s => !linkedSceneIds.size || linkedSceneIds.has(s.id))
        .map(s => ({
          id: s.id,
          location: s.location,
          time: s.time,
          prompt: s.prompt || '',
          image_url: s.imageUrl || '',
          storyboard_count: s.storyboardCount || 0,
        }))

      const videoModel = getEpisodeVideoModel(episodeId)
      const videoGeneration = getVideoGenerationConstraints(videoModel, episodeId)

      const payload = {
        episode: {
          id: ep.id,
          title: ep.title,
          episode_number: ep.episodeNumber,
          description: ep.description || '',
        },
        video_generation: {
          model: videoModel,
          ...videoGeneration,
        },
        script,
        characters,
        scenes,
        existing_storyboards: existingStoryboards
          .filter(sb => !sb.deletedAt)
          .map(sb => ({
            id: sb.id,
            shot_number: sb.storyboardNumber,
            title: sb.title || '',
            scene_id: sb.sceneId,
            character_ids: db.select().from(schema.storyboardCharacters)
              .where(eq(schema.storyboardCharacters.storyboardId, sb.id)).all()
              .map(link => link.characterId),
            shot_type: sb.shotType || '',
            duration: sb.duration || 0,
          })),
      }
      logTaskSuccess('StoryboardTool', 'read-context', {
        episodeId,
        dramaId,
        characters: characters.length,
        scenes: scenes.length,
        existingStoryboards: payload.existing_storyboards.length,
        scriptLength: script.length,
      })
      return payload
    },
  })

  const saveStoryboards = createTool({
    id: 'save_storyboards',
    description: 'Save generated storyboards. Replaces all existing storyboards for this episode.',
    inputSchema: z.object({
      storyboards: z.array(z.object({
        shot_number: z.number(),
        title: z.string().optional(),
        shot_type: z.string().optional(),
        angle: z.string().optional(),
        movement: z.string().optional(),
        location: z.string().optional(),
        time: z.string().optional(),
        action: z.string().optional(),
        dialogue: z.string().optional(),
        description: z.string().optional(),
        result: z.string().optional(),
        atmosphere: z.string().optional(),
        image_prompt: z.string().optional(),
        video_prompt: z.string().optional(),
        bgm_prompt: z.string().optional(),
        sound_effect: z.string().optional(),
        duration: z.number().optional(),
        scene_id: z.number().nullable().optional(),
        character_ids: z.array(z.number()).optional(),
      })),
    }),
    execute: async ({ storyboards }) => {
      if (!storyboards.length) {
        throw new Error('storyboards 不能为空，已拒绝清空本集分镜')
      }

      repairEpisodeSceneLinks(episodeId, dramaId)

      const ts = now()
      logTaskProgress('StoryboardTool', 'save-begin', {
        episodeId,
        dramaId,
        count: storyboards.length,
        shotNumbers: storyboards.map(sb => sb.shot_number).join(','),
      })

      const videoModel = getEpisodeVideoModel(episodeId)
      const prepared = storyboards.map(sb => {
        const resolvedSceneId = sb.scene_id != null
          ? resolveActiveSceneId(dramaId, sb.scene_id)
          : sb.scene_id
        validateStoryboardBindings(episodeId, resolvedSceneId, sb.character_ids)
        return {
          ...sb,
          scene_id: resolvedSceneId,
          duration: normalizeStoryboardDuration(sb.duration, videoModel, sb.video_prompt, episodeId),
        }
      })

      const totalDuration = prepared.reduce((sum, sb) => sum + sb.duration, 0)

      db.transaction(() => {
        const existingStoryboardIds = db.select().from(schema.storyboards)
          .where(eq(schema.storyboards.episodeId, episodeId)).all()
          .map(sb => sb.id)
        for (const storyboardId of existingStoryboardIds) {
          db.delete(schema.storyboardCharacters)
            .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
            .run()
        }
        db.delete(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)).run()

        for (const sb of prepared) {
          const res = db.insert(schema.storyboards).values({
            episodeId,
            storyboardNumber: sb.shot_number,
            title: sb.title, shotType: sb.shot_type,
            angle: sb.angle, movement: sb.movement,
            location: sb.location, time: sb.time,
            action: sb.action, dialogue: sb.dialogue,
            description: sb.description, result: sb.result,
            atmosphere: sb.atmosphere, imagePrompt: sb.image_prompt,
            videoPrompt: sb.video_prompt, bgmPrompt: sb.bgm_prompt,
            soundEffect: sb.sound_effect,
            sceneId: sb.scene_id, duration: sb.duration,
            createdAt: ts, updatedAt: ts,
          }).run()
          syncStoryboardCharacters(Number(res.lastInsertRowid), sb.character_ids || [])
        }

        db.update(schema.episodes)
          .set({ duration: Math.ceil(totalDuration / 60), updatedAt: ts })
          .where(eq(schema.episodes.id, episodeId)).run()
      })

      logTaskSuccess('StoryboardTool', 'save-complete', {
        episodeId,
        count: prepared.length,
        totalDuration,
      })
      return { message: `Saved ${prepared.length} storyboards`, count: prepared.length, total_duration: totalDuration }
    },
  })

  const updateStoryboard = createTool({
    id: 'update_storyboard',
    description: 'Update a specific storyboard shot.',
    inputSchema: z.object({
      storyboard_id: z.number(),
      title: z.string().optional(),
      shot_type: z.string().optional(),
      angle: z.string().optional(),
      movement: z.string().optional(),
      location: z.string().optional(),
      time: z.string().optional(),
      action: z.string().optional(),
      result: z.string().optional(),
      atmosphere: z.string().optional(),
      image_prompt: z.string().optional(),
      video_prompt: z.string().optional(),
      bgm_prompt: z.string().optional(),
      sound_effect: z.string().optional(),
      description: z.string().optional(),
      dialogue: z.string().optional(),
      scene_id: z.number().nullable().optional(),
      character_ids: z.array(z.number()).optional(),
      duration: z.number().optional(),
    }),
    execute: async ({ storyboard_id, ...fields }) => {
      const [storyboard] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard_id)).all()
      if (!storyboard) return { error: `Storyboard ${storyboard_id} not found` }
      logTaskProgress('StoryboardTool', 'update-begin', {
        episodeId,
        storyboardId: storyboard_id,
        fields: Object.keys(fields),
      })

      validateStoryboardBindings(
        episodeId,
        'scene_id' in fields
          ? resolveActiveSceneId(dramaId, fields.scene_id)
          : storyboard.sceneId,
        'character_ids' in fields
          ? fields.character_ids
          : db.select().from(schema.storyboardCharacters)
              .where(eq(schema.storyboardCharacters.storyboardId, storyboard_id)).all()
              .map(link => link.characterId),
      )

      const updates: Record<string, any> = { updatedAt: now() }
      if ('title' in fields) updates.title = fields.title
      if ('shot_type' in fields) updates.shotType = fields.shot_type
      if ('angle' in fields) updates.angle = fields.angle
      if ('movement' in fields) updates.movement = fields.movement
      if ('location' in fields) updates.location = fields.location
      if ('time' in fields) updates.time = fields.time
      if ('action' in fields) updates.action = fields.action
      if ('result' in fields) updates.result = fields.result
      if ('atmosphere' in fields) updates.atmosphere = fields.atmosphere
      if ('image_prompt' in fields) updates.imagePrompt = fields.image_prompt
      if ('video_prompt' in fields) updates.videoPrompt = fields.video_prompt
      if ('bgm_prompt' in fields) updates.bgmPrompt = fields.bgm_prompt
      if ('sound_effect' in fields) updates.soundEffect = fields.sound_effect
      if ('description' in fields) updates.description = fields.description
      if ('dialogue' in fields) updates.dialogue = fields.dialogue
      if ('scene_id' in fields) updates.sceneId = resolveActiveSceneId(dramaId, fields.scene_id)
      if ('duration' in fields) {
        updates.duration = normalizeStoryboardDuration(
          fields.duration,
          getEpisodeVideoModel(episodeId),
          fields.video_prompt,
          episodeId,
        )
      }
      db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, storyboard_id)).run()
      if ('character_ids' in fields) syncStoryboardCharacters(storyboard_id, fields.character_ids || [])
      logTaskSuccess('StoryboardTool', 'update-complete', {
        episodeId,
        storyboardId: storyboard_id,
        updatedFields: Object.keys(updates),
        characterIds: 'character_ids' in fields ? (fields.character_ids || []).join(',') : undefined,
      })
      return { message: `Storyboard ${storyboard_id} updated` }
    },
  })

  // 为宫格图生成整体提示词（分析选中镜头的描述，生成一个连贯的画格布局描述）
  const generateGridPrompt = createTool({
    id: 'generate_grid_prompt',
    description: '为宫格图生成整体画面描述。根据选中的镜头列表及其描述，生成一个连贯的宫格图提示词，用于一次性生成完整的宫格拼图。',
    inputSchema: z.object({
      shots: z.array(z.object({
        shot_number: z.number(),
        description: z.string(),
        shot_type: z.string().optional(),
        dialogue: z.string().optional(),
      })),
      rows: z.number(),
      cols: z.number(),
      mode: z.string(), // 'first_frame' | 'first_last' | 'multi_ref'
    }),
    execute: async ({ shots, rows, cols, mode }) => {
      if (!shots.length) return { error: 'No shots provided' }
      logTaskProgress('StoryboardTool', 'grid-prompt-begin', {
        episodeId,
        shots: shots.length,
        rows,
        cols,
        mode,
      })

      if (mode === 'multi_ref') {
        const sb = shots[0]
        const payload = {
          grid_prompt: `电影级高质量参考图，${sb.description}，专业摄影，电影质感，4K分辨率，${rows}x${cols} 宫格统一风格参考图`,
          cell_prompts: shots.map(s => ({
            shot_number: s.shot_number,
            frame_type: 'reference',
            prompt: `电影级高质量参考图，${s.description}，专业摄影，电影质感，4K分辨率，统一风格`,
          })),
        }
        logTaskSuccess('StoryboardTool', 'grid-prompt-complete', { episodeId, cells: payload.cell_prompts.length, mode })
        return payload
      }

      if (mode === 'first_last') {
        const cellPrompts = []
        for (const s of shots) {
          cellPrompts.push({
            shot_number: s.shot_number,
            frame_type: 'first_frame',
            prompt: `电影级高质量首帧，${s.description}，${s.shot_type || ''}，专业摄影，${rows}x${cols} 宫格风格统一`,
          })
          cellPrompts.push({
            shot_number: s.shot_number,
            frame_type: 'last_frame',
            prompt: `电影级高质量尾帧，${s.description}，${s.shot_type || ''}，专业摄影，${rows}x${cols} 宫格风格统一`,
          })
        }
        const payload = {
          grid_prompt: `${shots.length}个镜头首尾帧拼图，${shots.map(s => s.description).join(' | ')}，电影级画面，专业摄影，${rows}行${cols}列风格统一`,
          cell_prompts: cellPrompts,
        }
        logTaskSuccess('StoryboardTool', 'grid-prompt-complete', { episodeId, cells: payload.cell_prompts.length, mode })
        return payload
      }

      // first_frame mode
      const cellPrompts = shots.slice(0, rows * cols).map(s => ({
        shot_number: s.shot_number,
        frame_type: 'first_frame',
        prompt: `电影级高质量首帧，${s.description}，${s.shot_type || ''}，专业摄影，${rows}x${cols} 宫格风格统一`,
      }))
      const payload = {
        grid_prompt: `${shots.length}个镜头首帧拼图，${shots.map(s => s.description).join(' | ')}，电影级画面，专业摄影，${rows}行${cols}列风格统一`,
        cell_prompts: cellPrompts,
      }
      logTaskSuccess('StoryboardTool', 'grid-prompt-complete', { episodeId, cells: payload.cell_prompts.length, mode })
      return payload
    },
  })

  return { readStoryboardContext, saveStoryboards, updateStoryboard, generateGridPrompt }
}
