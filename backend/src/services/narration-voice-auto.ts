import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import type { NarrationAnalysis, NarrationCharacter } from './narration-types.js'
import { isRunningHubVoiceRef } from './narration-voice.js'

export type VoiceGender = '男' | '女' | '中性'
export type VoiceAge = '少年' | '青年' | '中年' | '老年' | '未知'
export type VoiceTone = '沉稳' | '温柔' | '活泼' | '磁性' | '清亮' | '新闻' | '系统' | '旁白' | '未知'

export interface NarrationVoiceProfile {
  gender: VoiceGender
  age: VoiceAge
  tone: VoiceTone
  /** 一两句音色描述，便于展示与匹配 */
  desc: string
}

export interface VoiceAssetCandidate {
  id: number
  name: string
  description: string
  dramaId: number | null
  path: string
  score: number
  reasons: string[]
}

const FEMALE_RE = /女|她|姐|妹|妈|母|娘|姑|婆|妃|姬|小姐|姑娘|阿姨|萝莉|御姐|少妇|狐女|魔女/
const MALE_RE = /男|他|哥|弟|爸|父|爷|叔|伯|公|少爷|先生|大叔|少年|青年男|中年男|老头/
const YOUNG_RE = /少年|少女|年轻|青年|学生|小孩|儿童/
const MID_RE = /中年|成熟/
const OLD_RE = /老年|老太|老头|暮年|苍老/
const TONE_RULES: Array<[VoiceTone, RegExp]> = [
  ['旁白', /旁白|解说|narrat/i],
  ['新闻', /新闻|主播|播报|主持/],
  ['系统', /系统|电子|机械|AI|提示音/i],
  ['沉稳', /沉稳|低沉|厚重|冷静|稳重|纪录片/],
  ['温柔', /温柔|柔和|轻柔|甜美|软萌/],
  ['活泼', /活泼|欢快|俏皮|元气|爽朗/],
  ['磁性', /磁性|沙哑|性感|魅惑/],
  ['清亮', /清亮|清脆|明亮|干净/],
]

function textOfCharacter(c: Pick<NarrationCharacter, 'name' | 'role' | 'appearance' | 'personality' | 'description' | 'voice_profile'>) {
  return [
    c.name,
    c.role,
    c.appearance,
    c.personality,
    c.description,
    c.voice_profile?.desc,
    c.voice_profile?.gender,
    c.voice_profile?.age,
    c.voice_profile?.tone,
  ].filter(Boolean).join(' ')
}

export function inferVoiceProfileFromText(raw: string, fallbackName = ''): NarrationVoiceProfile {
  const text = `${fallbackName} ${raw || ''}`.trim()
  let gender: VoiceGender = '中性'
  if (FEMALE_RE.test(text) && !MALE_RE.test(text)) gender = '女'
  else if (MALE_RE.test(text) && !FEMALE_RE.test(text)) gender = '男'
  else if (FEMALE_RE.test(text)) gender = '女'
  else if (MALE_RE.test(text)) gender = '男'

  let age: VoiceAge = '未知'
  if (OLD_RE.test(text)) age = '老年'
  else if (MID_RE.test(text)) age = '中年'
  else if (YOUNG_RE.test(text)) age = '青年'

  let tone: VoiceTone = '未知'
  for (const [t, re] of TONE_RULES) {
    if (re.test(text)) {
      tone = t
      break
    }
  }

  const parts = [
    gender !== '中性' ? gender : '',
    age !== '未知' ? age : '',
    tone !== '未知' ? tone : '',
  ].filter(Boolean)
  const desc = parts.length
    ? `${parts.join('·')}音色`
    : (text.slice(0, 40) || '通用旁白音色')

  return { gender, age, tone, desc }
}

export function ensureCharacterVoiceProfile(c: NarrationCharacter): NarrationVoiceProfile {
  if (c.voice_profile?.desc || c.voice_profile?.gender) {
    const inferred = inferVoiceProfileFromText(
      textOfCharacter(c),
      c.name,
    )
    return {
      gender: (c.voice_profile.gender as VoiceGender) || inferred.gender,
      age: (c.voice_profile.age as VoiceAge) || inferred.age,
      tone: (c.voice_profile.tone as VoiceTone) || inferred.tone,
      desc: c.voice_profile.desc || inferred.desc,
    }
  }
  const profile = inferVoiceProfileFromText(textOfCharacter(c), c.name)
  c.voice_profile = profile
  if (!c.personality) c.personality = profile.desc
  return profile
}

export function ensureAnalysisVoiceProfiles(analysis: NarrationAnalysis) {
  for (const c of analysis.characters) ensureCharacterVoiceProfile(c)
  return analysis
}

function listVoiceAssets(opts?: { dramaId?: number | null }) {
  const rows = db.select().from(schema.assets)
    .where(and(eq(schema.assets.type, 'voice'), isNull(schema.assets.deletedAt)))
    .all()
  const list = rows
    .map((row) => {
      const path = String(row.localPath || row.url || '').trim().replace(/^\/+/, '')
      if (!path) return null
      return {
        id: row.id,
        name: String(row.name || `音色#${row.id}`),
        description: String(row.description || ''),
        dramaId: row.dramaId ?? null,
        path,
      }
    })
    .filter((x): x is { id: number; name: string; description: string; dramaId: number | null; path: string } => !!x)

  return list.sort((a, b) => {
    const dramaId = opts?.dramaId
    if (dramaId) {
      const ad = a.dramaId === dramaId ? 0 : 1
      const bd = b.dramaId === dramaId ? 0 : 1
      if (ad !== bd) return ad - bd
    }
    return b.id - a.id
  })
}

function scoreAsset(
  asset: { id: number; name: string; description: string; dramaId: number | null },
  profile: NarrationVoiceProfile,
  opts: { dramaId?: number | null; preferName?: string; role?: 'narrator' | 'character' },
): VoiceAssetCandidate {
  const blob = `${asset.name} ${asset.description}`
  const reasons: string[] = []
  let score = 0

  if (opts.dramaId && asset.dramaId === opts.dramaId) {
    score += 30
    reasons.push('同项目音色库')
  }
  if (opts.preferName && (asset.name.includes(opts.preferName) || opts.preferName.includes(asset.name.replace(/音频|音色|说话的|的参考/g, '')))) {
    score += 80
    reasons.push('名称接近角色')
  }

  if (opts.role === 'narrator') {
    if (/旁白|解说|narrat|系统/i.test(blob)) {
      score += 50
      reasons.push('旁白/解说音色')
    }
  }

  const assetProfile = inferVoiceProfileFromText(blob, asset.name)
  if (profile.gender !== '中性' && assetProfile.gender === profile.gender) {
    score += 25
    reasons.push(`性别${profile.gender}`)
  } else if (profile.gender !== '中性' && assetProfile.gender !== '中性' && assetProfile.gender !== profile.gender) {
    score -= 20
  }

  if (profile.age !== '未知' && assetProfile.age === profile.age) {
    score += 10
    reasons.push(`年龄${profile.age}`)
  }
  if (profile.tone !== '未知' && assetProfile.tone === profile.tone) {
    score += 18
    reasons.push(`风格${profile.tone}`)
  }

  // 弱启发：名称中的性别词
  if (profile.gender === '女' && FEMALE_RE.test(blob)) {
    score += 8
  }
  if (profile.gender === '男' && MALE_RE.test(blob)) {
    score += 8
  }

  return {
    id: asset.id,
    name: asset.name,
    description: asset.description,
    dramaId: asset.dramaId,
    path: '',
    score,
    reasons,
  }
}

export function matchVoiceAssetForProfile(
  profile: NarrationVoiceProfile,
  opts: {
    dramaId?: number | null
    preferName?: string
    role?: 'narrator' | 'character'
    excludeIds?: Set<number>
  } = {},
): VoiceAssetCandidate | null {
  const assets = listVoiceAssets({ dramaId: opts.dramaId })
  if (!assets.length) return null

  const ranked = assets
    .filter(a => !opts.excludeIds?.has(a.id))
    .map((a) => {
      const hit = scoreAsset(a, profile, opts)
      hit.path = a.path
      return hit
    })
    .sort((a, b) => b.score - a.score || b.id - a.id)

  const best = ranked[0]
  if (!best || best.score < 8) {
    // 兜底：旁白优先叫「旁白」的；否则取同项目最新一条，再否则全局最新
    const fallback = assets.find(a => /旁白|解说/.test(a.name))
      || assets.find(a => opts.dramaId && a.dramaId === opts.dramaId)
      || assets[0]
    if (!fallback) return null
    return {
      id: fallback.id,
      name: fallback.name,
      description: fallback.description,
      dramaId: fallback.dramaId,
      path: fallback.path,
      score: 1,
      reasons: ['音色库兜底'],
    }
  }
  return best
}

export function autoAssignNarrationVoices(opts: {
  analysis: NarrationAnalysis
  narratorVoice?: string | null
  dramaId?: number | null
  force?: boolean
}): {
  narrator_voice: string
  narrator_match: VoiceAssetCandidate | null
  characters: NarrationCharacter[]
  assignments: Array<{ target: string; voice: string; name: string; profile: NarrationVoiceProfile; reasons: string[] }>
} {
  ensureAnalysisVoiceProfiles(opts.analysis)
  const used = new Set<number>()
  const assignments: Array<{ target: string; voice: string; name: string; profile: NarrationVoiceProfile; reasons: string[] }> = []

  let narratorVoice = String(opts.narratorVoice || '').trim()
  let narratorMatch: VoiceAssetCandidate | null = null
  if (opts.force || !isRunningHubVoiceRef(narratorVoice)) {
    const narratorProfile = inferVoiceProfileFromText('纪录片旁白 沉稳 中性 解说', '旁白')
    narratorMatch = matchVoiceAssetForProfile(narratorProfile, {
      dramaId: opts.dramaId,
      role: 'narrator',
      preferName: '旁白',
    })
    if (narratorMatch) {
      narratorVoice = `asset:${narratorMatch.id}`
      used.add(narratorMatch.id)
      assignments.push({
        target: '旁白',
        voice: narratorVoice,
        name: narratorMatch.name,
        profile: narratorProfile,
        reasons: narratorMatch.reasons,
      })
    }
  } else {
    const m = /^asset:(\d+)$/i.exec(narratorVoice)
    if (m) used.add(Number(m[1]))
  }

  for (const c of opts.analysis.characters) {
    const existing = String(c.voice_id || '').trim()
    if (!opts.force && isRunningHubVoiceRef(existing)) {
      const m = /^asset:(\d+)$/i.exec(existing)
      if (m) used.add(Number(m[1]))
      continue
    }
    const profile = ensureCharacterVoiceProfile(c)
    const matched = matchVoiceAssetForProfile(profile, {
      dramaId: opts.dramaId,
      preferName: c.name,
      role: 'character',
      excludeIds: used,
    })
    if (matched) {
      c.voice_id = `asset:${matched.id}`
      used.add(matched.id)
      assignments.push({
        target: c.name,
        voice: c.voice_id,
        name: matched.name,
        profile,
        reasons: matched.reasons,
      })
    } else if (narratorVoice) {
      c.voice_id = narratorVoice
      assignments.push({
        target: c.name,
        voice: narratorVoice,
        name: '跟随旁白',
        profile,
        reasons: ['无合适音色，跟随旁白'],
      })
    }
  }

  return {
    narrator_voice: narratorVoice,
    narrator_match: narratorMatch,
    characters: opts.analysis.characters,
    assignments,
  }
}
