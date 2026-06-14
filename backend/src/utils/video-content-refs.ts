import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import type { VideoContentRef } from './seedance-content.js'
import {
  parseStoryboardCharacterImageRefs,
  resolveCharacterImageForStoryboard,
} from './character-image-variants.js'
import { resolveSceneImageForStoryboard } from './scene-image-variants.js'
import {
  resolvePropImageForStoryboard,
} from './prop-image-variants.js'

export interface PromptImageLabel {
  index: number
  label: string
}

export interface ReferenceCandidate {
  key: string
  source: 'first_frame' | 'last_frame' | 'blocking' | 'scene' | 'character' | 'prop' | 'reference'
  label: string
  url?: string | null
  charId?: number
  sceneId?: number
  propId?: number
}

function parseReferenceImages(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function getStoryboardCharacterIds(storyboardId: number): number[] {
  return db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId)).all()
    .map(row => row.characterId)
}

function getStoryboardPropIds(storyboardId: number): number[] {
  return db.select().from(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId)).all()
    .map(row => row.propId)
}

export function parsePromptImageLabels(prompt?: string | null): PromptImageLabel[] {
  if (!prompt?.trim()) return []
  const items: PromptImageLabel[] = []
  const re = /(?:@)?(?:图片|图)\s*(\d+)\s*是\s*([^，,@。\n]+)/gi
  for (const match of prompt.matchAll(re)) {
    const index = Number(match[1])
    const label = String(match[2] || '').trim()
    if (!Number.isFinite(index) || index <= 0 || !label) continue
    if (!items.some(item => item.index === index)) {
      items.push({ index, label })
    }
  }
  return items.sort((a, b) => a.index - b.index)
}

function normalizeLabel(raw: string) {
  return String(raw || '')
    .replace(/[（(].+?[)）]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function labelsMatch(promptLabel: string, candidateLabel: string, source?: ReferenceCandidate['source']) {
  const a = normalizeLabel(promptLabel)
  const b = normalizeLabel(candidateLabel)
  if (!a || !b) return false
  if (a === b) return true
  if (source === 'character') return a.includes(b) || b.includes(a)
  if (source === 'prop') return a.includes(b) || b.includes(a)
  if (source === 'scene') return a.includes(b)

  const pairs: [string, string][] = [
    ['车间', '车间'],
    ['全景', '全景'],
    ['场景', '场景'],
    ['首帧', '首帧'],
    ['尾帧', '尾帧'],
  ]
  return pairs.some(([kw]) => a.includes(kw) && b.includes(kw)) || a.includes(b) || b.includes(a)
}

export function findCandidateForPromptLabel(
  promptLabel: string,
  candidates: ReferenceCandidate[],
  usedKeys?: Set<string> | null,
): ReferenceCandidate | undefined {
  const pool = usedKeys?.size
    ? candidates.filter(candidate => !usedKeys.has(candidate.key))
    : candidates

  const charExact = pool.find(candidate =>
    candidate.source === 'character' && normalizeLabel(candidate.label) === normalizeLabel(promptLabel),
  )
  if (charExact) return charExact

  const sceneExact = pool.find(candidate =>
    candidate.source === 'scene' && normalizeLabel(candidate.label) === normalizeLabel(promptLabel),
  )
  if (sceneExact) return sceneExact

  const propExact = pool.find(candidate =>
    candidate.source === 'prop' && normalizeLabel(candidate.label) === normalizeLabel(promptLabel),
  )
  if (propExact) return propExact

  const direct = pool.find(candidate => labelsMatch(promptLabel, candidate.label, candidate.source))
  if (direct) return direct

  if (normalizeLabel(promptLabel).includes('站位') || normalizeLabel(promptLabel).includes('blocking')) {
    return pool.find(candidate => candidate.source === 'blocking')
  }
  if (normalizeLabel(promptLabel).includes('首帧')) {
    return pool.find(candidate => candidate.source === 'first_frame')
  }
  if (normalizeLabel(promptLabel).includes('尾帧')) {
    return pool.find(candidate => candidate.source === 'last_frame')
  }
  if (normalizeLabel(promptLabel).includes('车间') || normalizeLabel(promptLabel).includes('场景')) {
    return pool.find(candidate => candidate.source === 'scene')
  }

  return pool.find(candidate =>
    candidate.source === 'character' && labelsMatch(promptLabel, candidate.label, candidate.source),
  )
}

export function buildReferenceCandidates(
  sb: typeof schema.storyboards.$inferSelect,
  dramaId: number,
): ReferenceCandidate[] {
  const items: ReferenceCandidate[] = []
  const characterImageRefs = parseStoryboardCharacterImageRefs(sb.characterImageRefs)

  if (sb.firstFrameImage) {
    items.push({
      key: `first:${sb.id}`,
      source: 'first_frame',
      label: '首帧',
      url: sb.firstFrameImage,
    })
  }
  if (sb.lastFrameImage) {
    items.push({
      key: `last:${sb.id}`,
      source: 'last_frame',
      label: '尾帧',
      url: sb.lastFrameImage,
    })
  }
  if (sb.blockingImage) {
    items.push({
      key: `blocking:${sb.id}`,
      source: 'blocking',
      label: '站位图',
      url: sb.blockingImage,
    })
  }

  if (sb.sceneId) {
    const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sb.sceneId)).all()
    const sceneUrl = scene ? resolveSceneImageForStoryboard(scene, sb) : null
    items.push({
      key: `scene:${sb.sceneId}`,
      source: 'scene',
      label: scene?.location || '场景',
      url: sceneUrl,
      sceneId: sb.sceneId,
    })
  }

  const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)).all()
  for (const charId of getStoryboardCharacterIds(sb.id)) {
    const char = chars.find(row => row.id === charId)
    if (!char) continue
    items.push({
      key: `char:${char.id}`,
      source: 'character',
      label: char.name,
      url: resolveCharacterImageForStoryboard(char, characterImageRefs),
      charId: char.id,
    })
  }

  const props = db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)).all()
  for (const propId of getStoryboardPropIds(sb.id)) {
    const prop = props.find(row => row.id === propId)
    if (!prop) continue
    items.push({
      key: `prop:${prop.id}`,
      source: 'prop',
      label: prop.name || `道具#${prop.id}`,
      url: resolvePropImageForStoryboard(prop, sb),
      propId: prop.id,
    })
  }

  for (const ref of parseReferenceImages(sb.referenceImages)) {
    items.push({
      key: `ref:${ref}`,
      source: 'reference',
      label: '参考图',
      url: ref,
    })
  }

  return items
}

export function buildOrderedStoryboardContentRefs(
  sb: typeof schema.storyboards.$inferSelect,
  dramaId: number,
  prompt?: string | null,
): VideoContentRef[] {
  const resolvedPrompt = prompt ?? sb.videoPrompt ?? ''
  const promptLabels = parsePromptImageLabels(resolvedPrompt)
  const candidates = buildReferenceCandidates(sb, dramaId)
  const items: VideoContentRef[] = []
  const used = new Set<string>()

  const pushImage = (candidate: ReferenceCandidate, role: VideoContentRef['role']) => {
    const url = String(candidate.url || '').trim()
    if (!url || used.has(candidate.key)) return
    used.add(candidate.key)
    items.push({
      type: 'image',
      url,
      role,
      label: candidate.label,
    })
  }

  // 首尾帧走 API role，不参与 @图片N 编号
  const first = candidates.find(candidate => candidate.source === 'first_frame')
  const last = candidates.find(candidate => candidate.source === 'last_frame')
  if (first) pushImage(first, 'first_frame')
  if (last) pushImage(last, 'last_frame')

  const referenceCandidates = candidates.filter(candidate =>
    candidate.source === 'blocking'
    || candidate.source === 'scene'
    || candidate.source === 'character'
    || candidate.source === 'prop'
    || candidate.source === 'reference',
  )

  if (promptLabels.length) {
    for (const { label } of promptLabels) {
      const match = findCandidateForPromptLabel(label, referenceCandidates)
      if (match) pushImage(match, 'reference_image')
    }
  } else {
    for (const candidate of referenceCandidates) {
      pushImage(candidate, 'reference_image')
    }
  }

  for (const candidate of referenceCandidates) {
    pushImage(candidate, 'reference_image')
  }

  if (sb.ttsAudioUrl) {
    items.push({ type: 'audio', url: sb.ttsAudioUrl, label: '配音' })
  }

  return items
}

// Backward-compatible export
export function buildStoryboardContentRefs(
  sb: typeof schema.storyboards.$inferSelect,
  dramaId: number,
): VideoContentRef[] {
  return buildOrderedStoryboardContentRefs(sb, dramaId, sb.videoPrompt)
}

export function buildPromptImageIndexMap(
  sb: typeof schema.storyboards.$inferSelect,
  dramaId: number,
  prompt?: string | null,
): Map<string, number> {
  const resolvedPrompt = prompt ?? sb.videoPrompt ?? ''
  const promptLabels = parsePromptImageLabels(resolvedPrompt)
  const candidates = buildReferenceCandidates(sb, dramaId)
  const referenceCandidates = candidates.filter(candidate =>
    candidate.source === 'blocking'
    || candidate.source === 'scene'
    || candidate.source === 'character'
    || candidate.source === 'prop'
    || candidate.source === 'reference',
  )
  const map = new Map<string, number>()

  for (const { index, label } of promptLabels) {
    const match = findCandidateForPromptLabel(label, referenceCandidates)
    if (match) map.set(match.key, index)
  }

  return map
}

export interface PromptImageRefIssue {
  index: number
  label: string
  reason: 'missing_image' | 'not_found'
}

export function validatePromptImageRefs(
  prompt: string | null | undefined,
  sb: typeof schema.storyboards.$inferSelect,
  dramaId: number,
): PromptImageRefIssue[] {
  const promptLabels = parsePromptImageLabels(prompt)
  if (!promptLabels.length) return []

  const candidates = buildReferenceCandidates(sb, dramaId)
  const issues: PromptImageRefIssue[] = []
  for (const { index, label } of promptLabels) {
    const match = findCandidateForPromptLabel(label, candidates)
    if (!String(match?.url || '').trim()) {
      issues.push({
        index,
        label,
        reason: match ? 'missing_image' : 'not_found',
      })
    }
  }
  return issues
}

export function formatPromptImageRefIssues(issues: PromptImageRefIssue[]): string {
  if (!issues.length) return ''
  const parts = issues.map((issue) => {
    if (issue.reason === 'not_found') {
      return `图片${issue.index}（${issue.label}）未绑定对应角色/场景/道具`
    }
    return `图片${issue.index}（${issue.label}）缺少参考图，请先生成或上传`
  })
  return `提示词中的参考图未就绪：${parts.join('；')}`
}
