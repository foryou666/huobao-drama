import type { DetectedShot } from '../utils/shot-detect.js'
import type { RepaintUtterance } from './repaint-asr.js'

export interface RepaintCharacterDraft {
  id: string
  name: string
  role?: string
  appearance?: string
  personality?: string
  description?: string
  shot_ids: string[]
  character_id?: number
}

export interface RepaintSceneDraft {
  id: string
  location: string
  time?: string
  prompt?: string
  shot_ids: string[]
  scene_id?: number
}

export interface RepaintPropDraft {
  id: string
  name: string
  type?: string
  description?: string
  prompt?: string
  shot_ids: string[]
  prop_id?: number
}

export interface RepaintShotAssignment {
  shot_id: string
  scene_id?: string
  character_ids: string[]
  prop_ids: string[]
  utterance_ids: string[]
}

/** 单镜头视觉理解（Qwen-VL 关键帧分析） */
export interface RepaintShotVisual {
  shot_id: string
  shot_size?: string
  shot_size_detail?: string
  camera_angle?: string
  camera_movement?: string
  movement_motivation?: string
  action_blocking?: string
  dialogue_note?: string
  frame_path?: string
}

export interface RepaintAnalysis {
  version: 1
  shots: DetectedShot[]
  utterances: RepaintUtterance[]
  characters: RepaintCharacterDraft[]
  scenes: RepaintSceneDraft[]
  props: RepaintPropDraft[]
  shot_assignments: RepaintShotAssignment[]
  shot_visuals?: RepaintShotVisual[]
  audio_path?: string
  analyzed_at?: string
  warnings?: string[]
}

export function emptyRepaintAnalysis(): RepaintAnalysis {
  return {
    version: 1,
    shots: [],
    utterances: [],
    characters: [],
    scenes: [],
    props: [],
    shot_assignments: [],
  }
}

export function parseRepaintAnalysis(raw?: string | null): RepaintAnalysis | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      version: 1,
      shots: Array.isArray(parsed.shots) ? parsed.shots : [],
      utterances: Array.isArray(parsed.utterances) ? parsed.utterances : [],
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      props: Array.isArray(parsed.props) ? parsed.props : [],
      shot_assignments: Array.isArray(parsed.shot_assignments) ? parsed.shot_assignments : [],
      shot_visuals: Array.isArray(parsed.shot_visuals) ? parsed.shot_visuals : undefined,
      audio_path: parsed.audio_path,
      analyzed_at: parsed.analyzed_at,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : undefined,
    }
  } catch {
    return null
  }
}

function overlapSec(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

export function assignUtterancesToShots(
  shots: DetectedShot[],
  utterances: RepaintUtterance[],
): RepaintShotAssignment[] {
  return shots.map((shot) => {
    const utterance_ids = utterances
      .filter(u => overlapSec(shot.start_sec, shot.end_sec, u.start_sec, u.end_sec) > 0.05)
      .map(u => u.id)
    return {
      shot_id: shot.id,
      character_ids: [],
      prop_ids: [],
      utterance_ids,
    }
  })
}

export function attachEntityShotIds<T extends { id: string; name: string; shot_ids?: string[] }>(
  entities: T[],
  assignments: RepaintShotAssignment[],
  utterances: RepaintUtterance[],
  match: (entity: T, utterance: RepaintUtterance, assignment: RepaintShotAssignment) => boolean,
): T[] {
  return entities.map((entity) => {
    const shotIds = new Set<string>(entity.shot_ids || [])
    for (const assignment of assignments) {
      const utts = utterances.filter(u => assignment.utterance_ids.includes(u.id))
      if (utts.some(u => match(entity, u, assignment))) {
        shotIds.add(assignment.shot_id)
      }
    }
    return { ...entity, shot_ids: [...shotIds] }
  })
}

export function mergeShotAssignments(
  base: RepaintShotAssignment[],
  shotNotes: Array<{
    shot_id: string
    scene_id?: string
    character_ids?: string[]
    prop_ids?: string[]
  }>,
): RepaintShotAssignment[] {
  const map = new Map(base.map(item => [item.shot_id, { ...item }]))
  for (const note of shotNotes) {
    const current = map.get(note.shot_id)
    if (!current) continue
    if (note.scene_id) current.scene_id = note.scene_id
    if (note.character_ids?.length) current.character_ids = [...new Set(note.character_ids)]
    if (note.prop_ids?.length) current.prop_ids = [...new Set(note.prop_ids)]
  }
  return [...map.values()]
}
