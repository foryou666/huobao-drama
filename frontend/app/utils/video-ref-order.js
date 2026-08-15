import { resolveCharacterImageUrl } from './character-image-variants.js'
import { formatVoicePromptLabel } from './voice-refs.js'

/** 匹配「图片1是xx」与简写「图1是xx」 */
export const PROMPT_IMAGE_LABEL_RE = /(?:@)?(?:图片|图)\s*(\d+)\s*是\s*([^，,@。\n]+)/gi

/** 匹配「音频1是xx的声音」；兼容旧写法「音色1是…」 */
export const PROMPT_AUDIO_LABEL_RE = /(?:@)?(?:音频|音色)\s*(\d+)\s*是\s*([^，,@。\n]+)/gi

export function parsePromptImageLabels(prompt) {
  if (!prompt?.trim()) return []
  const items = []
  for (const match of String(prompt).matchAll(PROMPT_IMAGE_LABEL_RE)) {
    const index = Number(match[1])
    const label = String(match[2] || '').trim()
    if (!Number.isFinite(index) || index <= 0 || !label) continue
    if (!items.some(item => item.index === index)) items.push({ index, label })
  }
  return items.sort((a, b) => a.index - b.index)
}

export function parsePromptAudioLabels(prompt) {
  if (!prompt?.trim()) return []
  const items = []
  for (const match of String(prompt).matchAll(PROMPT_AUDIO_LABEL_RE)) {
    const index = Number(match[1])
    const label = String(match[2] || '').trim()
    if (!Number.isFinite(index) || index <= 0 || !label) continue
    if (!items.some(item => item.index === index)) items.push({ index, label })
  }
  return items.sort((a, b) => a.index - b.index)
}

function normalizeLabel(raw) {
  return String(raw || '')
    .replace(/[（(].+?[)）]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function labelsMatch(promptLabel, candidateLabel, source) {
  const a = normalizeLabel(promptLabel)
  const b = normalizeLabel(candidateLabel)
  if (!a || !b) return false
  if (a === b) return true
  if (source === 'character') return a.includes(b) || b.includes(a)
  if (source === 'prop') return a.includes(b) || b.includes(a)
  // 场景名包含短角色名（如「太后」⊂「行宫太后寝殿」）不能算匹配
  if (source === 'scene') return a.includes(b)
  const keywords = ['车间', '全景', '场景', '首帧', '尾帧', '站位']
  return keywords.some(kw => a.includes(kw) && b.includes(kw)) || a.includes(b) || b.includes(a)
}

function sceneCandidateLabel(scene) {
  if (!scene) return '场景'
  const time = String(scene.time || '').trim()
  return time ? `${scene.location} · ${time}` : String(scene.location || '场景')
}

function getStoryboardSceneIds(sb) {
  if (Array.isArray(sb?.scene_ids) && sb.scene_ids.length) {
    return sb.scene_ids.map(id => Number(id)).filter(Number.isFinite)
  }
  if (Array.isArray(sb?.sceneIds) && sb.sceneIds.length) {
    return sb.sceneIds.map(id => Number(id)).filter(Number.isFinite)
  }
  const legacy = Number(sb?.scene_id ?? sb?.sceneId)
  return Number.isFinite(legacy) ? [legacy] : []
}

export function findCandidateForPromptLabel(promptLabel, candidates, usedKeys = null) {
  const pool = usedKeys?.size
    ? candidates.filter(candidate => !usedKeys.has(candidate.key))
    : candidates
  const normalized = normalizeLabel(promptLabel)
  if (normalized.startsWith('参考图')) {
    const numbered = normalized.match(/^参考图(\d+)$/)
    if (numbered) {
      const refIndex = Number(numbered[1])
      const indexed = pool.find(candidate =>
        candidate.source === 'reference' && candidate.refIndex === refIndex,
      )
      if (indexed) return indexed
    }
    const refs = pool.filter(candidate => candidate.source === 'reference')
    if (refs.length === 1) return refs[0]
  }

  const charExact = pool.find(candidate =>
    candidate.source === 'character' && normalizeLabel(candidate.label) === normalized,
  )
  if (charExact) return charExact

  const sceneExact = pool.find(candidate =>
    candidate.source === 'scene' && normalizeLabel(candidate.label) === normalized,
  )
  if (sceneExact) return sceneExact

  const propExact = pool.find(candidate =>
    candidate.source === 'prop' && normalizeLabel(candidate.label) === normalized,
  )
  if (propExact) return propExact

  // 角色多形态：优先更长/更具体的标签（避免「涂山赤娆面部」误匹配「涂山赤娆」原图）
  const charFuzzy = pool
    .filter(candidate =>
      candidate.source === 'character' && labelsMatch(promptLabel, candidate.label, candidate.source),
    )
    .sort((a, b) => normalizeLabel(b.label).length - normalizeLabel(a.label).length)
  if (charFuzzy.length) return charFuzzy[0]

  const direct = pool.find(candidate => labelsMatch(promptLabel, candidate.label, candidate.source))
  if (direct) return direct
  if (normalized.includes('站位') || normalized.includes('blocking')) {
    return pool.find(candidate => candidate.source === 'blocking')
  }
  if (normalized.includes('首帧')) {
    return pool.find(candidate => candidate.source === 'first_frame')
  }
  if (normalized.includes('尾帧')) {
    return pool.find(candidate => candidate.source === 'last_frame')
  }
  const sceneMatches = pool.filter(candidate =>
    candidate.source === 'scene' && labelsMatch(promptLabel, candidate.label, candidate.source),
  )
  if (sceneMatches.length) return sceneMatches[0]

  if (normalized.includes('车间') || normalized.includes('场景')) {
    return pool.find(candidate => candidate.source === 'scene')
  }
  return pool.find(candidate =>
    candidate.source === 'character' && labelsMatch(promptLabel, candidate.label, candidate.source),
  )
}

export function buildVideoImageCatalog(sb, prompt, chars, scenes, helpers) {
  const displayItems = buildPromptOrderedDisplayItems(sb, prompt, chars, scenes, helpers)
  return displayItems
    .filter(item => item.type === 'image')
    .map((item, index) => ({
      index: item.imageIndex ?? index + 1,
      label: item.label,
      promptLabel: item.promptLabel,
      url: item.url,
      source: item.source,
      key: item.key,
      charId: item.charId,
      sceneId: item.sceneId,
    }))
}

export function findCatalogEntryByPromptRef(index, label, catalog) {
  const entry = catalog.find(item => item.index === index)
  if (!entry?.url) return null
  if (labelsMatch(label, entry.label) || labelsMatch(label, entry.promptLabel || '')) return entry
  if (entry.promptLabel && normalizeLabel(entry.promptLabel) === normalizeLabel(label)) return entry
  return entry
}

export function assignDisplayImageIndices(items) {
  let displayIndex = 0
  return items.map((item) => {
    if (item.type !== 'image') return item
    displayIndex += 1
    return { ...item, displayImageIndex: displayIndex }
  })
}

export function buildReferenceCandidates(
  sb,
  chars,
  scenes,
  getRefs,
  getFirstFrame,
  getLastFrame,
  getStoryboardCharacterIds,
  getCharacterImageRefs,
  getBlockingImage,
  resolveSceneImage,
  helpers,
) {
  const items = []
  const characterImageRefs = getCharacterImageRefs?.(sb) || {}
  const propsList = helpers?.getProps?.() || []
  const first = getFirstFrame(sb)
  if (first) items.push({ key: `first:${sb.id}`, source: 'first_frame', label: '首帧', url: first })
  const last = getLastFrame(sb)
  if (last) items.push({ key: `last:${sb.id}`, source: 'last_frame', label: '尾帧', url: last })
  const blocking = getBlockingImage?.(sb)
  if (blocking) items.push({ key: `blocking:${sb.id}`, source: 'blocking', label: '站位图', url: blocking })

  const sceneIds = getStoryboardSceneIds(sb)
  for (const sceneId of sceneIds) {
    const scene = scenes.find(item => item.id === sceneId)
    if (!scene) continue
    const url = resolveSceneImage?.(scene, sb) || scene.image_url || scene.imageUrl || null
    items.push({
      key: `scene:${scene.id}`,
      source: 'scene',
      label: sceneCandidateLabel(scene),
      url,
      sceneId: scene.id,
    })
  }

  for (const charId of getStoryboardCharacterIds(sb)) {
    const char = chars.find(item => item.id === charId)
    if (!char) continue
    items.push({
      key: `char:${char.id}`,
      source: 'character',
      label: char.name,
      url: resolveCharacterImageUrl(char, characterImageRefs),
      charId: char.id,
    })
  }

  for (const propId of (helpers?.getStoryboardPropIds?.(sb) || [])) {
    const prop = propsList.find(item => item.id === propId)
    if (!prop) continue
    items.push({
      key: `prop:${prop.id}`,
      source: 'prop',
      label: prop.name || `道具#${prop.id}`,
      url: helpers?.resolvePropImage?.(prop, sb) || prop.image_url || prop.imageUrl || null,
      propId: prop.id,
    })
  }

  const refs = getRefs(sb)
  refs.forEach((ref, index) => {
    items.push({
      key: `ref:${ref}`,
      source: 'reference',
      label: refs.length > 1 ? `参考图${index + 1}` : '参考图',
      url: ref,
      refIndex: index + 1,
    })
  })

  return items
}

export function buildPromptOrderedDisplayItems(sb, prompt, chars, scenes, helpers) {
  const {
    getRefs,
    getFirstFrame,
    getLastFrame,
    getStoryboardCharacterIds,
    getCharacterImageRefs,
    getTTSUrl,
    frameMode,
  } = helpers
  const promptLabels = parsePromptImageLabels(prompt)
  const candidates = buildReferenceCandidates(
    sb,
    chars,
    scenes,
    getRefs,
    getFirstFrame,
    getLastFrame,
    getStoryboardCharacterIds,
    getCharacterImageRefs,
    helpers.getBlockingImage,
    helpers.resolveSceneImage,
    helpers,
  )
  const referenceCandidates = candidates.filter(candidate =>
    candidate.source === 'blocking'
    || candidate.source === 'scene'
    || candidate.source === 'character'
    || candidate.source === 'prop'
    || candidate.source === 'reference',
  )
  const used = new Set()
  const items = []

  if (promptLabels.length) {
    for (const { index, label } of promptLabels) {
      const match = findCandidateForPromptLabel(label, referenceCandidates)
      if (match) used.add(match.key)
      items.push({
        key: match?.key || `prompt:${index}`,
        source: match?.source || 'prompt',
        type: 'image',
        url: match?.url || null,
        label: match?.label || label,
        typeLabel: match?.source === 'blocking' ? '站位'
          : match?.source === 'character' ? '角色'
          : match?.source === 'scene' ? '场景'
          : match?.source === 'prop' ? '道具' : '参考图',
        promptLabel: label,
        imageIndex: index,
        charId: match?.charId,
        sceneId: match?.sceneId,
        propId: match?.propId,
        missing: !match?.url,
      })
    }
  }

  const appendTechnical = (candidate) => {
    if (!candidate || used.has(candidate.key)) return
    used.add(candidate.key)
    items.push({
      key: candidate.key,
      source: candidate.source,
      type: 'image',
      url: candidate.url,
      label: candidate.label,
      typeLabel: candidate.source === 'first_frame' ? '首帧' : '尾帧',
      missing: !candidate.url,
      technical: true,
    })
  }

  appendTechnical(candidates.find(candidate => candidate.source === 'first_frame'))
  if (frameMode === 'first_last') {
    appendTechnical(candidates.find(candidate => candidate.source === 'last_frame'))
  }

  if (!promptLabels.length) {
    for (const candidate of referenceCandidates) {
      if (used.has(candidate.key)) continue
      used.add(candidate.key)
      items.push({
        key: candidate.key,
        source: candidate.source,
        type: 'image',
        url: candidate.url,
        label: candidate.label,
        typeLabel: candidate.source === 'blocking' ? '站位'
          : candidate.source === 'character' ? '角色'
          : candidate.source === 'scene' ? '场景'
          : candidate.source === 'prop' ? '道具'
          : candidate.label || '参考图',
        charId: candidate.charId,
        sceneId: candidate.sceneId,
        propId: candidate.propId,
        missing: !candidate.url,
      })
    }
  } else {
    for (const candidate of referenceCandidates) {
      if (used.has(candidate.key)) continue
      used.add(candidate.key)
      items.push({
        key: candidate.key,
        source: candidate.source,
        type: 'image',
        url: candidate.url,
        label: candidate.label,
        typeLabel: candidate.source === 'blocking' ? '站位'
          : candidate.source === 'character' ? '角色'
          : candidate.source === 'scene' ? '场景'
          : candidate.source === 'prop' ? '道具'
          : candidate.label || '参考图',
        charId: candidate.charId,
        sceneId: candidate.sceneId,
        propId: candidate.propId,
        missing: !candidate.url,
        extra: true,
      })
    }
  }

  const tts = getTTSUrl(sb)
  if (tts) {
    items.push({
      key: `tts:${sb.id}`,
      source: 'tts',
      type: 'audio',
      url: tts,
      label: '配音',
      typeLabel: '音频',
    })
  }

  const voiceRefs = helpers.getVoiceRefs?.(sb) || []
  voiceRefs.forEach((ref, index) => {
    if (!ref?.path) return
    items.push({
      key: `voice:${ref.asset_id || ref.path}:${index}`,
      source: 'voice',
      type: 'audio',
      url: ref.path,
      label: ref.name || `音色${index + 1}`,
      typeLabel: '音色',
      assetId: ref.asset_id,
    })
  })

  return items
}

function normalizeRefUrlKey(url) {
  return String(url || '').trim().replace(/^\/+/, '').split('?')[0].toLowerCase()
}

export function buildOrderedVideoContentRefs(sb, prompt, chars, scenes, helpers) {
  const {
    getRefs,
    getFirstFrame,
    getLastFrame,
    getStoryboardCharacterIds,
    getCharacterImageRefs,
    getTTSUrl,
  } = helpers
  const promptLabels = parsePromptImageLabels(prompt)
  const candidates = buildReferenceCandidates(
    sb,
    chars,
    scenes,
    getRefs,
    getFirstFrame,
    getLastFrame,
    getStoryboardCharacterIds,
    getCharacterImageRefs,
    helpers.getBlockingImage,
    helpers.resolveSceneImage,
    helpers,
  )
  const referenceCandidates = candidates.filter(candidate =>
    candidate.source === 'blocking'
    || candidate.source === 'scene'
    || candidate.source === 'character'
    || candidate.source === 'prop'
    || candidate.source === 'reference',
  )
  const items = []
  const usedKeys = new Set()
  const usedUrls = new Set()

  const pushImage = (candidate, role, opts = {}) => {
    const url = String(candidate.url || '').trim().replace(/^\/+/, '')
    const urlKey = normalizeRefUrlKey(url)
    const key = candidate.key || (opts.promptIndex != null ? `prompt:${opts.promptIndex}` : '')
    if (!url || !key) return

    const slotKey = opts.promptIndex != null ? `prompt:${opts.promptIndex}` : key
    if (usedKeys.has(slotKey)) return
    // 按提示词序号绑定时，允许不同角色/场景引用相同 URL（避免 5 图变 4 图）
    if (opts.promptIndex == null && usedUrls.has(urlKey)) return

    usedKeys.add(slotKey)
    usedUrls.add(urlKey)
    items.push({ type: 'image', url, role, label: candidate.label })
  }

  const first = candidates.find(candidate => candidate.source === 'first_frame')
  const last = candidates.find(candidate => candidate.source === 'last_frame')
  if (first) pushImage(first, 'first_frame')
  if (last) pushImage(last, 'last_frame')

  const catalog = buildVideoImageCatalog(sb, prompt, chars, scenes, helpers)

  if (promptLabels.length) {
    const displayItems = buildPromptOrderedDisplayItems(sb, prompt, chars, scenes, helpers)
      .filter(item => item.type === 'image')
    const usedCandidateKeys = new Set()

    for (const { index, label } of promptLabels) {
      const byIndex = displayItems.find(item => item.imageIndex === index && item.url)
      if (byIndex) {
        pushImage({
          key: byIndex.key || `prompt:${index}`,
          url: byIndex.url,
          label: byIndex.promptLabel || byIndex.label || label,
        }, 'reference_image', { promptIndex: index })
        if (byIndex.key) usedCandidateKeys.add(byIndex.key)
        continue
      }

      const catalogEntry = findCatalogEntryByPromptRef(index, label, catalog)
      if (catalogEntry?.url) {
        pushImage({
          key: catalogEntry.key || `prompt:${index}`,
          url: catalogEntry.url,
          label: catalogEntry.promptLabel || catalogEntry.label || label,
        }, 'reference_image', { promptIndex: index })
        if (catalogEntry.key) usedCandidateKeys.add(catalogEntry.key)
        continue
      }

      const match = findCandidateForPromptLabel(label, referenceCandidates, usedCandidateKeys)
      if (match?.url) {
        pushImage({
          key: match.key || `prompt:${index}`,
          url: match.url,
          label: match.label || label,
        }, 'reference_image', { promptIndex: index })
        usedCandidateKeys.add(match.key)
      }
    }
  } else {
    for (const candidate of referenceCandidates) {
      pushImage(candidate, 'reference_image')
    }
  }

  const tts = getTTSUrl(sb)
  if (tts) items.push({ type: 'audio', url: String(tts).replace(/^\/+/, ''), label: '配音', role: 'reference_audio' })

  const voiceRefs = helpers.getVoiceRefs?.(sb) || []
  const maxVoiceRefsRaw = helpers.maxVoiceRefs ?? helpers.getMaxVoiceRefs?.(sb)
  const maxVoiceRefs = Number.isFinite(Number(maxVoiceRefsRaw)) && Number(maxVoiceRefsRaw) >= 0
    ? Math.floor(Number(maxVoiceRefsRaw))
    : 3
  for (const ref of voiceRefs.slice(0, maxVoiceRefs)) {
    const url = String(ref?.path || '').trim().replace(/^\/+/, '')
    if (!url) continue
    items.push({ type: 'audio', url, label: formatVoicePromptLabel(ref.name || '音色参考'), role: 'reference_audio' })
  }

  return items
}

export function validatePromptImageRefs(prompt, sb, chars, scenes, helpers) {
  const promptLabels = parsePromptImageLabels(prompt)
  if (!promptLabels.length) return []

  const candidates = buildReferenceCandidates(
    sb,
    chars,
    scenes,
    helpers.getRefs,
    helpers.getFirstFrame,
    helpers.getLastFrame,
    helpers.getStoryboardCharacterIds,
    helpers.getCharacterImageRefs,
    helpers.getBlockingImage,
    helpers.resolveSceneImage,
  )
  const catalog = buildVideoImageCatalog(sb, prompt, chars, scenes, helpers)
  const displayItems = buildPromptOrderedDisplayItems(sb, prompt, chars, scenes, helpers)
    .filter(item => item.type === 'image')
  const issues = []
  for (const { index, label } of promptLabels) {
    const byIndex = displayItems.find(item => item.imageIndex === index)
    const catalogEntry = findCatalogEntryByPromptRef(index, label, catalog)
    const match = byIndex?.url
      ? { url: byIndex.url, label: byIndex.promptLabel || byIndex.label }
      : catalogEntry
        ? { url: catalogEntry.url, label: catalogEntry.label }
        : findCandidateForPromptLabel(label, candidates)
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

export function formatPromptImageRefIssues(issues) {
  if (!issues.length) return ''
  const parts = issues.map((issue) => {
    if (issue.reason === 'not_found') {
      return `图片${issue.index}（${issue.label}）未绑定对应角色/场景/道具`
    }
    return `图片${issue.index}（${issue.label}）缺少参考图，请先生成或上传`
  })
  return `提示词中的参考图未就绪：${parts.join('；')}`
}
