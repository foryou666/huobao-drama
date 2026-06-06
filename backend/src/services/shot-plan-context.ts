import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { repairEpisodeSceneLinks } from '../utils/scene-redirect.js'

export interface ShotPlanContextPayload {
  episode: {
    id: number
    title: string
    episode_number: number
    description: string
  }
  script: string
  character_library: Array<{
    tag: string
    id: number
    name: string
    role: string
    description: string
    appearance: string
    personality: string
    voice_style: string
  }>
  scene_library: Array<{
    tag: string
    id: number
    location: string
    time: string
    prompt: string
  }>
  existing_shot_plans: Array<{
    id: number
    shot_number: number
    title: string
    status: string
  }>
}

export function buildShotPlanContext(episodeId: number, dramaId: number): ShotPlanContextPayload | { error: string } {
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!ep || ep.deletedAt) return { error: 'Episode not found' }
  repairEpisodeSceneLinks(episodeId, dramaId)

  const script = ep.scriptContent || ep.content
  if (!script?.trim()) return { error: 'Episode has no script' }

  const charLinks = db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
  const sceneLinks = db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId)).all()

  const linkedCharacterIds = new Set(charLinks.map(link => link.characterId))
  const linkedSceneIds = new Set(sceneLinks.map(link => link.sceneId))

  const chars = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, dramaId)).all()
    .filter(c => !c.deletedAt)
    .filter(c => !linkedCharacterIds.size || linkedCharacterIds.has(c.id))

  const scns = db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, dramaId)).all()
    .filter(s => !s.deletedAt)
    .filter(s => !linkedSceneIds.size || linkedSceneIds.has(s.id))

  const existingPlans = db.select().from(schema.shotPlans)
    .where(eq(schema.shotPlans.episodeId, episodeId)).all()
    .filter(p => !p.deletedAt)

  return {
    episode: {
      id: ep.id,
      title: ep.title || '',
      episode_number: ep.episodeNumber,
      description: ep.description || '',
    },
    script,
    character_library: chars.map((c, i) => ({
      tag: `R${String(i + 1).padStart(2, '0')}`,
      id: c.id,
      name: c.name,
      role: c.role || '',
      description: c.description || '',
      appearance: c.appearance || '',
      personality: c.personality || '',
      voice_style: c.voiceStyle || '',
    })),
    scene_library: scns.map((s, i) => ({
      tag: `S${String(i + 1).padStart(2, '0')}`,
      id: s.id,
      location: s.location,
      time: s.time || '',
      prompt: s.prompt || '',
    })),
    existing_shot_plans: existingPlans.map(p => ({
      id: p.id,
      shot_number: p.shotNumber,
      title: p.title || '',
      status: p.status || 'draft',
    })),
  }
}

export function formatShotPlanContextForPrompt(ctx: ShotPlanContextPayload): string {
  const lines: string[] = [
    `【集数】第 ${ctx.episode.episode_number} 集`,
    `【标题】${ctx.episode.title || '未命名'}`,
  ]
  if (ctx.episode.description) lines.push(`【简介】${ctx.episode.description}`)

  lines.push('', '## 固定角色库（生成时使用 R 标签）')
  for (const ch of ctx.character_library) {
    const parts = [ch.name, ch.role, ch.appearance || ch.description, ch.personality, ch.voice_style].filter(Boolean)
    lines.push(`【${ch.tag} ${ch.name}】${parts.join('；')}`)
  }

  lines.push('', '## 固定场景库（生成时使用 S 标签）')
  for (const sc of ctx.scene_library) {
    lines.push(`【${sc.tag} ${sc.location}（${sc.time || '未设时间'}）】${sc.prompt || sc.location}`)
  }

  lines.push('', '## 格式化剧本', ctx.script)
  return lines.join('\n')
}
