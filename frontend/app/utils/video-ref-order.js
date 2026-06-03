import { resolveCharacterImageUrl } from './character-image-variants.js'

export function parsePromptImageLabels(prompt) {  if (!prompt?.trim()) return []
  const items = []
  const re = /(?:@)?图片\s*(\d+)\s*是\s*([^，,@。\n]+)/gi
  for (const match of prompt.matchAll(re)) {
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

function labelsMatch(promptLabel, candidateLabel) {
  const a = normalizeLabel(promptLabel)
  const b = normalizeLabel(candidateLabel)
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const keywords = ['车间', '全景', '场景', '首帧', '尾帧', '站位']
  return keywords.some(kw => a.includes(kw) && b.includes(kw))
}

export function findCandidateForPromptLabel(promptLabel, candidates) {
  const normalized = normalizeLabel(promptLabel)
  if (normalized.startsWith('参考图')) {
    const numbered = normalized.match(/^参考图(\d+)$/)
    if (numbered) {
      const refIndex = Number(numbered[1])
      const indexed = candidates.find(candidate =>
        candidate.source === 'reference' && candidate.refIndex === refIndex,
      )
      if (indexed) return indexed
    }
    const refs = candidates.filter(candidate => candidate.source === 'reference')
    if (refs.length === 1) return refs[0]
  }

  const direct = candidates.find(candidate => labelsMatch(promptLabel, candidate.label))
  if (direct) return direct
  if (normalized.includes('站位') || normalized.includes('blocking')) {
    return candidates.find(candidate => candidate.source === 'blocking')
  }
  if (normalized.includes('首帧')) {
    return candidates.find(candidate => candidate.source === 'first_frame')
  }
  if (normalized.includes('尾帧')) {
    return candidates.find(candidate => candidate.source === 'last_frame')
  }
  if (normalized.includes('车间') || normalized.includes('场景')) {
    return candidates.find(candidate => candidate.source === 'scene')
  }
  return candidates.find(candidate => candidate.source === 'character' && labelsMatch(promptLabel, candidate.label))
}

export function buildVideoImageCatalog(sb, prompt, chars, scenes, helpers) {
  const displayItems = buildPromptOrderedDisplayItems(sb, prompt, chars, scenes, helpers)
  return displayItems
    .filter(item => item.type === 'image')
    .map((item, index) => ({
      index: index + 1,
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
  if (!entry) return null
  const normalized = normalizeLabel(label)
  if (labelsMatch(label, entry.label) || labelsMatch(label, entry.promptLabel || '')) return entry
  if (normalized.includes('参考图') && entry.source === 'reference') return entry
  return null
}

export function assignDisplayImageIndices(items) {
  let imageIndex = 0
  return items.map((item) => {
    if (item.type !== 'image') return item
    imageIndex += 1
    return { ...item, imageIndex }
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
) {
  const items = []
  const characterImageRefs = getCharacterImageRefs?.(sb) || {}
  const first = getFirstFrame(sb)
  if (first) items.push({ key: `first:${sb.id}`, source: 'first_frame', label: '首帧', url: first })
  const last = getLastFrame(sb)
  if (last) items.push({ key: `last:${sb.id}`, source: 'last_frame', label: '尾帧', url: last })
  const blocking = getBlockingImage?.(sb)
  if (blocking) items.push({ key: `blocking:${sb.id}`, source: 'blocking', label: '站位图', url: blocking })

  const sceneId = sb.scene_id || sb.sceneId
  const scene = scenes.find(item => item.id === sceneId)
  if (scene) {
    const url = resolveSceneImage?.(scene, sb) || scene.image_url || scene.imageUrl || null
    items.push({
      key: `scene:${scene.id}`,
      source: 'scene',
      label: scene.location || '场景',
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
  )
  const referenceCandidates = candidates.filter(candidate =>
    candidate.source === 'blocking' || candidate.source === 'scene' || candidate.source === 'character' || candidate.source === 'reference',
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
          : match?.source === 'scene' ? '场景' : '参考图',
        promptLabel: label,
        imageIndex: index,
        charId: match?.charId,
        sceneId: match?.sceneId,
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
          : candidate.label || '参考图',
        charId: candidate.charId,
        sceneId: candidate.sceneId,
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
          : candidate.label || '参考图',
        charId: candidate.charId,
        sceneId: candidate.sceneId,
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
  )
  const referenceCandidates = candidates.filter(candidate =>
    candidate.source === 'blocking' || candidate.source === 'scene' || candidate.source === 'character' || candidate.source === 'reference',
  )
  const items = []
  const usedKeys = new Set()
  const usedUrls = new Set()

  const pushImage = (candidate, role) => {
    const url = String(candidate.url || '').trim().replace(/^\/+/, '')
    const urlKey = normalizeRefUrlKey(url)
    if (!url || !candidate.key || usedKeys.has(candidate.key) || usedUrls.has(urlKey)) return
    usedKeys.add(candidate.key)
    usedUrls.add(urlKey)
    items.push({ type: 'image', url, role, label: candidate.label })
  }

  const first = candidates.find(candidate => candidate.source === 'first_frame')
  const last = candidates.find(candidate => candidate.source === 'last_frame')
  if (first) pushImage(first, 'first_frame')
  if (last) pushImage(last, 'last_frame')

  const catalog = buildVideoImageCatalog(sb, prompt, chars, scenes, helpers)

  if (promptLabels.length) {
    for (const { index, label } of promptLabels) {
      const catalogEntry = findCatalogEntryByPromptRef(index, label, catalog)
      if (catalogEntry?.url) {
        pushImage({
          key: catalogEntry.key,
          url: catalogEntry.url,
          label: catalogEntry.label,
        }, 'reference_image')
        continue
      }
      const match = findCandidateForPromptLabel(label, referenceCandidates)
      if (match) pushImage(match, 'reference_image')
    }
  } else {
    for (const candidate of referenceCandidates) {
      pushImage(candidate, 'reference_image')
    }
  }

  const tts = getTTSUrl(sb)
  if (tts) items.push({ type: 'audio', url: String(tts).replace(/^\/+/, ''), label: '配音' })

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
  const issues = []
  for (const { index, label } of promptLabels) {
    const catalogEntry = findCatalogEntryByPromptRef(index, label, catalog)
    const match = catalogEntry
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
      return `图片${issue.index}（${issue.label}）未绑定对应角色/场景`
    }
    return `图片${issue.index}（${issue.label}）缺少参考图，请先生成或上传`
  })
  return `提示词中的参考图未就绪：${parts.join('；')}`
}
