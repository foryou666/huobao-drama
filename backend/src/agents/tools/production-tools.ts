/**
 * 制作执行工具 — 供制作助手对话触发图片/配音/视频/合成/拼接
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { now } from '../../utils/response.js'
import { generateImage } from '../../services/image-generation.js'
import { generateVideo } from '../../services/video-generation.js'
import { generateTTS, generateVoiceSample } from '../../services/tts-generation.js'
import { composeStoryboard } from '../../services/ffmpeg-compose.js'
import { mergeEpisodeVideos } from '../../services/ffmpeg-merge.js'
import { resolveCharacterImagePrompt } from '../../utils/character-image-prompt.js'
import { resolveSceneImagePrompt } from '../../utils/scene-image-prompt.js'
import { getDramaImageAspectRatio } from '../../utils/image-size.js'
import { buildOrderedStoryboardContentRefs } from '../../utils/video-content-refs.js'
import {
  parseStoryboardCharacterImageRefs,
  resolveCharacterImageForStoryboard,
} from '../../utils/character-image-variants.js'
import { resolveSceneImageForStoryboard } from '../../utils/scene-image-variants.js'

const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

function parseDialogueForTTS(dialogue?: string | null) {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim()
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)
  return { speaker, pureText, ignorable }
}

function getEpisode(episodeId: number) {
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  return ep || null
}

function getStoryboardCharacterIds(storyboardId: number) {
  return db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId)).all()
    .map(link => link.characterId)
}

function parseReferenceImages(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch {
    return []
  }
}

function buildShotImagePrompt(
  sb: typeof schema.storyboards.$inferSelect,
  frameType: 'first_frame' | 'last_frame',
  dramaId: number,
) {
  const chars = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, dramaId)).all()
    .filter(c => !c.deletedAt)
  const charIds = getStoryboardCharacterIds(sb.id)
  const charNames = chars.filter(c => charIds.includes(c.id)).map(c => c.name).join('、')

  let location = sb.location || ''
  if (sb.sceneId) {
    const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sb.sceneId)).all()
    if (scene) location = `${scene.location}${scene.time ? ` · ${scene.time}` : ''}`
  }

  const frameHint = frameType === 'first_frame'
    ? '生成这个镜头的起始关键帧，突出建立关系和动作开始瞬间'
    : '生成这个镜头的结束关键帧，突出动作结束、情绪落点或结果状态'

  return [
    sb.title ? `镜头标题：${sb.title}` : '',
    (sb.imagePrompt || sb.description) ? `画面描述：${sb.imagePrompt || sb.description}` : '',
    sb.shotType ? `景别：${sb.shotType}` : '',
    sb.angle ? `机位：${sb.angle}` : '',
    sb.movement ? `运镜：${sb.movement}` : '',
    charNames ? `角色：${charNames}` : '',
    location ? `地点：${location}` : '',
    sb.time ? `时间：${sb.time}` : '',
    sb.action ? `动作：${sb.action}` : '',
    sb.atmosphere ? `氛围：${sb.atmosphere}` : '',
    frameHint,
  ].filter(Boolean).join('；')
}

function collectShotReferenceImages(sb: typeof schema.storyboards.$inferSelect, dramaId: number) {
  const refs: string[] = []
  const push = (url?: string | null) => {
    if (url && !refs.includes(url)) refs.push(url)
  }

  if (sb.sceneId) {
    const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sb.sceneId)).all()
    push(scene ? resolveSceneImageForStoryboard(scene, sb) : null)
  }

  push(sb.blockingImage)

  const characterImageRefs = parseStoryboardCharacterImageRefs(sb.characterImageRefs)
  const chars = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, dramaId)).all()
  for (const charId of getStoryboardCharacterIds(sb.id)) {
    const char = chars.find(c => c.id === charId)
    push(char ? resolveCharacterImageForStoryboard(char, characterImageRefs) : null)
  }

  for (const ref of parseReferenceImages(sb.referenceImages)) push(ref)
  push(sb.firstFrameImage)
  push(sb.lastFrameImage)

  return refs.filter(Boolean).slice(0, 6)
}

function buildVideoParams(sb: typeof schema.storyboards.$inferSelect, dramaId: number) {
  const params: Record<string, unknown> = {
    storyboardId: sb.id,
    dramaId,
    prompt: sb.videoPrompt || sb.description || sb.title || '',
    duration: Number(sb.duration || 5),
    aspectRatio: getDramaImageAspectRatio(dramaId),
  }

  const first = sb.firstFrameImage
  const last = sb.lastFrameImage
  const refs = parseReferenceImages(sb.referenceImages)

  if (first && last) {
    params.referenceMode = 'first_last'
    params.firstFrameUrl = first
    params.lastFrameUrl = last
  } else if (refs.length || first) {
    params.referenceMode = 'multiple'
    params.referenceImageUrls = [first, ...refs].filter(Boolean)
  } else if (first) {
    params.referenceMode = 'single'
    params.imageUrl = first
  }

  return params
}

export function createProductionTools(episodeId: number, dramaId: number) {
  const readProductionStatus = createTool({
    id: 'read_production_status',
    description: '读取当前集制作进度：角色/场景/镜头的图片、配音、视频、合成状态。',
    inputSchema: z.object({}),
    execute: async () => {
      const ep = getEpisode(episodeId)
      const chars = db.select().from(schema.characters)
        .where(eq(schema.characters.dramaId, dramaId)).all()
        .filter(c => !c.deletedAt)
      const scenes = db.select().from(schema.scenes)
        .where(eq(schema.scenes.dramaId, dramaId)).all()
        .filter(s => !s.deletedAt)
      const sbs = db.select().from(schema.storyboards)
        .where(eq(schema.storyboards.episodeId, episodeId)).all()
        .filter(sb => !sb.deletedAt)
        .sort((a, b) => a.storyboardNumber - b.storyboardNumber)

      return {
        episode_id: episodeId,
        characters: chars.map(c => ({
          id: c.id,
          name: c.name,
          has_image: !!c.imageUrl,
          has_voice: !!c.voiceStyle,
          has_voice_sample: !!c.voiceSampleUrl,
        })),
        scenes: scenes.map(s => ({
          id: s.id,
          location: s.location,
          time: s.time,
          has_image: !!s.imageUrl,
        })),
        storyboards: sbs.map(sb => ({
          id: sb.id,
          number: sb.storyboardNumber,
          title: sb.title || sb.description || '',
          has_first_frame: !!sb.firstFrameImage,
          has_last_frame: !!sb.lastFrameImage,
          has_video: !!sb.videoUrl,
          has_tts: !!sb.ttsAudioUrl,
          has_composed: !!sb.composedVideoUrl,
        })),
        summary: {
          characters_with_image: chars.filter(c => c.imageUrl).length,
          characters_total: chars.length,
          scenes_with_image: scenes.filter(s => s.imageUrl).length,
          scenes_total: scenes.length,
          shots_with_video: sbs.filter(sb => sb.videoUrl).length,
          shots_total: sbs.length,
          shots_composed: sbs.filter(sb => sb.composedVideoUrl).length,
        },
        configs: {
          image_config_id: ep?.imageConfigId ?? null,
          video_config_id: ep?.videoConfigId ?? null,
          audio_config_id: ep?.audioConfigId ?? null,
        },
      }
    },
  })

  const updateCharacterImagePrompt = createTool({
    id: 'update_character_image_prompt',
    description: '更新角色的 image_prompt（生成图片前可先优化提示词）。',
    inputSchema: z.object({
      character_id: z.number(),
      image_prompt: z.string(),
    }),
    execute: async ({ character_id, image_prompt }) => {
      const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, character_id)).all()
      if (!char) return { error: 'Character not found' }
      db.update(schema.characters)
        .set({ imagePrompt: image_prompt.trim(), updatedAt: now() })
        .where(eq(schema.characters.id, character_id)).run()
      return { character_id, character_name: char.name, image_prompt: image_prompt.trim() }
    },
  })

  const updateSceneImagePrompt = createTool({
    id: 'update_scene_image_prompt',
    description: '更新场景的 prompt（生成场景图前可先优化提示词）。',
    inputSchema: z.object({
      scene_id: z.number(),
      prompt: z.string(),
    }),
    execute: async ({ scene_id, prompt }) => {
      const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, scene_id)).all()
      if (!scene) return { error: 'Scene not found' }
      db.update(schema.scenes)
        .set({ prompt: prompt.trim(), updatedAt: now() })
        .where(eq(schema.scenes.id, scene_id)).run()
      return { scene_id, location: scene.location, prompt: prompt.trim() }
    },
  })

  const generateCharacterImage = createTool({
    id: 'generate_character_image',
    description: '为单个角色发起 AI 图片生成（异步，完成后 image_url 会更新）。重新生成也调用此工具。',
    inputSchema: z.object({
      character_id: z.number(),
      prompt: z.string().optional(),
    }),
    execute: async ({ character_id, prompt }) => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }
      const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, character_id)).all()
      if (!char) return { error: 'Character not found' }

      const resolved = resolveCharacterImagePrompt(char, prompt)
      if (prompt?.trim()) {
        db.update(schema.characters).set({ imagePrompt: resolved, updatedAt: now() }).where(eq(schema.characters.id, character_id)).run()
      }

      const genId = await generateImage({
        characterId: character_id,
        dramaId: char.dramaId,
        prompt: resolved,
        configId: ep.imageConfigId ?? undefined,
      })
      return {
        status: 'processing',
        character_id,
        character_name: char.name,
        image_generation_id: genId,
        message: '角色图片生成已提交，请稍后刷新查看结果',
      }
    },
  })

  const batchGenerateCharacterImages = createTool({
    id: 'batch_generate_character_images',
    description: '批量为多个角色发起图片生成。不传 character_ids 则生成所有尚无图片的角色。',
    inputSchema: z.object({
      character_ids: z.array(z.number()).optional(),
    }),
    execute: async ({ character_ids }) => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }

      const allChars = db.select().from(schema.characters)
        .where(eq(schema.characters.dramaId, dramaId)).all()
        .filter(c => !c.deletedAt)

      const targetIds = character_ids?.length
        ? character_ids
        : allChars.filter(c => !c.imageUrl).map(c => c.id)

      const started: number[] = []
      const items: { character_id: number; character_name: string }[] = []
      for (const cid of targetIds) {
        const char = allChars.find(c => c.id === cid)
        if (!char) continue
        try {
          const genId = await generateImage({
            characterId: cid,
            dramaId: char.dramaId,
            prompt: resolveCharacterImagePrompt(char),
            configId: ep.imageConfigId ?? undefined,
          })
          started.push(genId)
          items.push({ character_id: cid, character_name: char.name })
        } catch {}
      }
      return {
        status: 'processing',
        requested: targetIds.length,
        started: started.length,
        character_ids: items.map(row => row.character_id),
        items,
        image_generation_ids: started,
        message: `已提交 ${started.length} 个角色图片生成任务`,
      }
    },
  })

  const generateSceneImage = createTool({
    id: 'generate_scene_image',
    description: '为单个场景发起 AI 图片生成（异步）。重新生成也调用此工具。',
    inputSchema: z.object({
      scene_id: z.number(),
      prompt: z.string().optional(),
    }),
    execute: async ({ scene_id, prompt }) => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }
      const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, scene_id)).all()
      if (!scene) return { error: 'Scene not found' }

      const resolved = resolveSceneImagePrompt(scene, prompt)
      if (prompt?.trim()) {
        db.update(schema.scenes).set({ prompt: resolved, updatedAt: now() }).where(eq(schema.scenes.id, scene_id)).run()
      }

      db.update(schema.scenes).set({ status: 'processing', updatedAt: now() }).where(eq(schema.scenes.id, scene_id)).run()
      const genId = await generateImage({
        sceneId: scene_id,
        dramaId: scene.dramaId,
        prompt: resolved,
        configId: ep.imageConfigId ?? undefined,
      })
      return {
        status: 'processing',
        scene_id,
        location: scene.location,
        image_generation_id: genId,
        message: '场景图片生成已提交',
      }
    },
  })

  const batchGenerateSceneImages = createTool({
    id: 'batch_generate_scene_images',
    description: '批量为多个场景发起图片生成。不传 scene_ids 则生成所有尚无图片的场景。',
    inputSchema: z.object({
      scene_ids: z.array(z.number()).optional(),
    }),
    execute: async ({ scene_ids }) => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }

      const allScenes = db.select().from(schema.scenes)
        .where(eq(schema.scenes.dramaId, dramaId)).all()
        .filter(s => !s.deletedAt)

      const targetIds = scene_ids?.length
        ? scene_ids
        : allScenes.filter(s => !s.imageUrl).map(s => s.id)

      const started: number[] = []
      const items: { scene_id: number; location: string }[] = []
      for (const sid of targetIds) {
        const scene = allScenes.find(s => s.id === sid)
        if (!scene) continue
        try {
          const genId = await generateImage({
            sceneId: sid,
            dramaId: scene.dramaId,
            prompt: resolveSceneImagePrompt(scene),
            configId: ep.imageConfigId ?? undefined,
          })
          started.push(genId)
          items.push({ scene_id: sid, location: scene.location })
        } catch {}
      }
      return {
        status: 'processing',
        requested: targetIds.length,
        started: started.length,
        scene_ids: items.map(row => row.scene_id),
        items,
        image_generation_ids: started,
      }
    },
  })

  const generateShotFrame = createTool({
    id: 'generate_shot_frame',
    description: '为镜头生成首帧或尾帧图片（异步）。frame_type: first_frame | last_frame',
    inputSchema: z.object({
      storyboard_id: z.number(),
      frame_type: z.enum(['first_frame', 'last_frame']),
      prompt: z.string().optional(),
    }),
    execute: async ({ storyboard_id, frame_type, prompt }) => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard_id)).all()
      if (!sb || sb.episodeId !== episodeId) return { error: 'Storyboard not found' }

      const resolvedPrompt = prompt?.trim() || buildShotImagePrompt(sb, frame_type, dramaId)
      const referenceImages = collectShotReferenceImages(sb, dramaId)

      const genId = await generateImage({
        storyboardId: storyboard_id,
        dramaId,
        prompt: resolvedPrompt,
        frameType: frame_type,
        referenceImages: referenceImages.length ? referenceImages : undefined,
        configId: ep.imageConfigId ?? undefined,
      })

      return {
        status: 'processing',
        storyboard_id,
        frame_type,
        image_generation_id: genId,
        message: `${frame_type === 'first_frame' ? '首帧' : '尾帧'}生成已提交`,
      }
    },
  })

  const generateVoiceSampleTool = createTool({
    id: 'generate_voice_sample',
    description: '为角色生成音色试听文件（需已分配 voice_style）。',
    inputSchema: z.object({
      character_id: z.number(),
    }),
    execute: async ({ character_id }) => {
      const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, character_id)).all()
      if (!char) return { error: 'Character not found' }
      if (!char.voiceStyle) return { error: '请先分配音色' }

      const ep = getEpisode(episodeId)
      const audioPath = await generateVoiceSample(char.name, char.voiceStyle, ep?.audioConfigId ?? undefined)
      db.update(schema.characters)
        .set({ voiceSampleUrl: audioPath, updatedAt: now() })
        .where(eq(schema.characters.id, character_id)).run()

      return { character_id, character_name: char.name, voice_sample_url: audioPath }
    },
  })

  const generateShotTts = createTool({
    id: 'generate_shot_tts',
    description: '为单个镜头生成配音（TTS），使用镜头 dialogue 与角色音色。',
    inputSchema: z.object({
      storyboard_id: z.number(),
    }),
    execute: async ({ storyboard_id }) => {
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard_id)).all()
      if (!sb || sb.episodeId !== episodeId) return { error: 'Storyboard not found' }

      const parsed = parseDialogueForTTS(sb.dialogue)
      if (parsed.ignorable) return { error: '该镜头没有可生成的对白或旁白' }
      if (!parsed.pureText) return { error: '未提取到可合成的文本' }

      let voiceId = 'alloy'
      if (parsed.speaker && !/^(旁白|画外音|narrator)$/i.test(parsed.speaker)) {
        const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()
        const found = chars.find(c => c.name === parsed.speaker)
        if (found?.voiceStyle) voiceId = found.voiceStyle
      }

      const ep = getEpisode(episodeId)
      const audioPath = await generateTTS({
        text: parsed.pureText,
        voice: voiceId,
        configId: ep?.audioConfigId ?? null,
      })

      db.update(schema.storyboards)
        .set({ ttsAudioUrl: audioPath, updatedAt: now() })
        .where(eq(schema.storyboards.id, storyboard_id)).run()

      return {
        storyboard_id,
        tts_audio_url: audioPath,
        voice_id: voiceId,
        text: parsed.pureText,
      }
    },
  })

  const batchGenerateShotTts = createTool({
    id: 'batch_generate_shot_tts',
    description: '批量为多个镜头生成配音。不传 storyboard_ids 则处理所有有对白但尚无 TTS 的镜头。',
    inputSchema: z.object({
      storyboard_ids: z.array(z.number()).optional(),
    }),
    execute: async ({ storyboard_ids }) => {
      const sbs = db.select().from(schema.storyboards)
        .where(eq(schema.storyboards.episodeId, episodeId)).all()
        .filter(sb => !sb.deletedAt)

      const targets = storyboard_ids?.length
        ? sbs.filter(sb => storyboard_ids.includes(sb.id))
        : sbs.filter(sb => {
          const p = parseDialogueForTTS(sb.dialogue)
          return !p.ignorable && !sb.ttsAudioUrl
        })

      const results: { storyboard_id: number; ok: boolean; error?: string }[] = []
      const ep = getEpisode(episodeId)

      for (const sb of targets) {
        const parsed = parseDialogueForTTS(sb.dialogue)
        if (parsed.ignorable || !parsed.pureText) {
          results.push({ storyboard_id: sb.id, ok: false, error: '无可生成对白' })
          continue
        }
        try {
          let voiceId = 'alloy'
          if (parsed.speaker && !/^(旁白|画外音|narrator)$/i.test(parsed.speaker)) {
            const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()
            const found = chars.find(c => c.name === parsed.speaker)
            if (found?.voiceStyle) voiceId = found.voiceStyle
          }
          const audioPath = await generateTTS({
            text: parsed.pureText,
            voice: voiceId,
            configId: ep?.audioConfigId ?? null,
          })
          db.update(schema.storyboards)
            .set({ ttsAudioUrl: audioPath, updatedAt: now() })
            .where(eq(schema.storyboards.id, sb.id)).run()
          results.push({ storyboard_id: sb.id, ok: true })
        } catch (err: any) {
          results.push({ storyboard_id: sb.id, ok: false, error: err.message })
        }
      }

      return {
        total: targets.length,
        succeeded: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        results,
      }
    },
  })

  const generateShotVideo = createTool({
    id: 'generate_shot_video',
    description: '为单个镜头发起视频生成（异步）。重新生成也调用此工具。会使用首帧/尾帧/参考图与 video_prompt。',
    inputSchema: z.object({
      storyboard_id: z.number(),
      prompt: z.string().optional(),
      duration: z.number().optional(),
      aspect_ratio: z.string().optional(),
    }),
    execute: async ({ storyboard_id, prompt, duration, aspect_ratio }) => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard_id)).all()
      if (!sb || sb.episodeId !== episodeId) return { error: 'Storyboard not found' }

      const base = buildVideoParams(sb, dramaId)
      if (prompt?.trim()) base.prompt = prompt.trim()
      if (duration) base.duration = duration
      if (aspect_ratio) base.aspectRatio = aspect_ratio
      const contentRefs = buildOrderedStoryboardContentRefs(sb, dramaId, prompt?.trim() || sb.videoPrompt)

      const genId = await generateVideo({
        storyboardId: base.storyboardId as number,
        dramaId: base.dramaId as number,
        prompt: String(base.prompt || ''),
        referenceMode: base.referenceMode as string | undefined,
        imageUrl: base.imageUrl as string | undefined,
        firstFrameUrl: base.firstFrameUrl as string | undefined,
        lastFrameUrl: base.lastFrameUrl as string | undefined,
        referenceImageUrls: base.referenceImageUrls as string[] | undefined,
        duration: base.duration as number | undefined,
        aspectRatio: base.aspectRatio as string | undefined,
        contentRefs: contentRefs.length ? contentRefs : undefined,
        configId: ep.videoConfigId ?? undefined,
      })

      return {
        status: 'processing',
        storyboard_id,
        video_generation_id: genId,
        message: '视频生成已提交，完成后 video_url 会更新',
      }
    },
  })

  const batchGenerateShotVideos = createTool({
    id: 'batch_generate_shot_videos',
    description: '批量为多个镜头发起视频生成。不传 storyboard_ids 则处理所有尚无 video 的镜头。',
    inputSchema: z.object({
      storyboard_ids: z.array(z.number()).optional(),
    }),
    execute: async ({ storyboard_ids }) => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }

      const sbs = db.select().from(schema.storyboards)
        .where(eq(schema.storyboards.episodeId, episodeId)).all()
        .filter(sb => !sb.deletedAt)

      const targets = storyboard_ids?.length
        ? sbs.filter(sb => storyboard_ids.includes(sb.id))
        : sbs.filter(sb => !sb.videoUrl)

      const started: { storyboard_id: number; video_generation_id: number }[] = []
      const failed: { storyboard_id: number; error: string }[] = []
      for (const sb of targets) {
        try {
          const base = buildVideoParams(sb, dramaId)
          const contentRefs = buildOrderedStoryboardContentRefs(sb, dramaId, sb.videoPrompt)
          const genId = await generateVideo({
            storyboardId: sb.id,
            dramaId,
            prompt: String(base.prompt || ''),
            referenceMode: base.referenceMode as string | undefined,
            imageUrl: base.imageUrl as string | undefined,
            firstFrameUrl: base.firstFrameUrl as string | undefined,
            lastFrameUrl: base.lastFrameUrl as string | undefined,
            referenceImageUrls: base.referenceImageUrls as string[] | undefined,
            duration: base.duration as number | undefined,
            aspectRatio: base.aspectRatio as string | undefined,
            contentRefs: contentRefs.length ? contentRefs : undefined,
            configId: ep.videoConfigId ?? undefined,
          })
          started.push({ storyboard_id: sb.id, video_generation_id: genId })
        } catch (err: any) {
          failed.push({ storyboard_id: sb.id, error: err?.message || '视频生成失败' })
        }
      }

      return {
        status: 'processing',
        requested: targets.length,
        started: started.length,
        failed: failed.length,
        items: started,
        errors: failed,
      }
    },
  })

  const composeShot = createTool({
    id: 'compose_shot',
    description: '合成单个镜头（视频 + 配音 + 字幕 → composed_video_url）。',
    inputSchema: z.object({
      storyboard_id: z.number(),
    }),
    execute: async ({ storyboard_id }) => {
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard_id)).all()
      if (!sb || sb.episodeId !== episodeId) return { error: 'Storyboard not found' }
      if (!sb.videoUrl) return { error: '请先生成镜头视频' }

      const composedUrl = await composeStoryboard(storyboard_id)
      return {
        storyboard_id,
        composed_video_url: composedUrl,
        message: '镜头合成完成',
      }
    },
  })

  const composeAllShots = createTool({
    id: 'compose_all_shots',
    description: '批量合成当前集所有已有视频的镜头。',
    inputSchema: z.object({}),
    execute: async () => {
      const sbs = db.select().from(schema.storyboards)
        .where(eq(schema.storyboards.episodeId, episodeId)).all()
        .filter(sb => !sb.deletedAt && sb.videoUrl)

      for (const sb of sbs) {
        db.update(schema.storyboards)
          .set({ status: 'compose_processing', updatedAt: now() })
          .where(eq(schema.storyboards.id, sb.id)).run()
      }

      const results: { storyboard_id: number; ok: boolean; error?: string }[] = []
      for (const sb of sbs) {
        try {
          await composeStoryboard(sb.id)
          results.push({ storyboard_id: sb.id, ok: true })
        } catch (err: any) {
          results.push({ storyboard_id: sb.id, ok: false, error: err.message })
        }
      }

      return {
        total: sbs.length,
        succeeded: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        results,
        message: '批量合成已完成（部分镜头可能失败，请查看 results）',
      }
    },
  })

  const mergeEpisode = createTool({
    id: 'merge_episode',
    description: '拼接当前集所有已合成镜头为成片（异步）。',
    inputSchema: z.object({}),
    execute: async () => {
      const ep = getEpisode(episodeId)
      if (!ep) return { error: 'Episode not found' }

      const mergeId = await mergeEpisodeVideos(episodeId, ep.dramaId)
      return {
        status: 'processing',
        merge_id: mergeId,
        message: '全集拼接已提交，完成后 merged_url 会更新',
      }
    },
  })

  return {
    readProductionStatus,
    updateCharacterImagePrompt,
    updateSceneImagePrompt,
    generateCharacterImage,
    batchGenerateCharacterImages,
    generateSceneImage,
    batchGenerateSceneImages,
    generateShotFrame,
    generateVoiceSample: generateVoiceSampleTool,
    generateShotTts,
    batchGenerateShotTts,
    generateShotVideo,
    batchGenerateShotVideos,
    composeShot,
    composeAllShots,
    mergeEpisode,
  }
}

export type ProductionTools = ReturnType<typeof createProductionTools>

export function pickProductionTools(tools: ProductionTools, keys: (keyof ProductionTools)[]) {
  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    picked[key as string] = tools[key]
  }
  return picked
}
