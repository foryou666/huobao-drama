import {
  parsePromptImageLabels,
  parsePromptAudioLabels,
  buildPromptOrderedDisplayItems,
  buildOrderedVideoContentRefs,
  validatePromptImageRefs,
  formatPromptImageRefIssues,
  findCandidateForPromptLabel,
} from './video-ref-order.js'
import { resolveCharacterImageUrl, listCharacterImages } from './character-image-variants.js'
import { resolveSceneImageUrl, listSceneImages } from './scene-image-variants.js'
import { resolvePropImageUrl } from './prop-image-variants.js'
import { parseVoiceRefs, formatVoicePromptLabel } from './voice-refs.js'

export {
  validatePromptImageRefs,
  formatPromptImageRefIssues,
  parsePromptImageLabels,
  parsePromptAudioLabels,
}

export function createStudioBindingState() {
  return {
    character_ids: [],
    character_image_refs: {},
    scene_ids: [],
    scene_id: null,
    scene_image_refs: {},
    prop_ids: [],
    prop_image_refs: {},
    reference_images: [],
    voice_refs: [],
    ref_strip_order: [],
  }
}

export function sceneDisplayLabel(scene) {
  if (!scene) return '场景'
  const location = String(scene.location || '场景').trim()
  const time = String(scene.time || '').trim()
  return time ? `${location} · ${time}` : location
}

export function getBindingSceneIds(binding) {
  if (Array.isArray(binding?.scene_ids) && binding.scene_ids.length) {
    return binding.scene_ids.map(id => Number(id)).filter(Number.isFinite)
  }
  const legacy = Number(binding?.scene_id)
  return Number.isFinite(legacy) ? [legacy] : []
}

export function bindingToStoryboard(binding) {
  const refs = Array.isArray(binding.reference_images) ? binding.reference_images : []
  const sceneIds = getBindingSceneIds(binding)
  return {
    id: 'studio',
    character_ids: [...(binding.character_ids || [])],
    characterIds: [...(binding.character_ids || [])],
    character_image_refs: { ...(binding.character_image_refs || {}) },
    characterImageRefs: { ...(binding.character_image_refs || {}) },
    scene_ids: [...sceneIds],
    sceneIds: [...sceneIds],
    scene_id: sceneIds[0] ?? null,
    sceneId: sceneIds[0] ?? null,
    scene_image_refs: { ...(binding.scene_image_refs || {}) },
    sceneImageRefs: { ...(binding.scene_image_refs || {}) },
    prop_ids: [...(binding.prop_ids || [])],
    propIds: [...(binding.prop_ids || [])],
    prop_image_refs: { ...(binding.prop_image_refs || {}) },
    propImageRefs: { ...(binding.prop_image_refs || {}) },
    reference_images: JSON.stringify(refs),
    referenceImages: JSON.stringify(refs),
    voice_refs: [...(binding.voice_refs || [])],
    voiceRefs: [...(binding.voice_refs || [])],
  }
}

export function createStudioHelpers(binding, dramaProps = []) {
  return {
    getRefs: (sb) => {
      const raw = sb?.reference_images || sb?.referenceImages
      if (!raw) return []
      if (Array.isArray(raw)) return raw.filter(Boolean)
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter(Boolean) : []
      } catch {
        return []
      }
    },
    getFirstFrame: () => null,
    getLastFrame: () => null,
    getBlockingImage: () => null,
    getStoryboardCharacterIds: (sb) => sb?.character_ids || sb?.characterIds || [],
    getCharacterImageRefs: (sb) => sb?.character_image_refs || sb?.characterImageRefs || {},
    getStoryboardPropIds: (sb) => sb?.prop_ids || sb?.propIds || [],
    getPropImageRefs: (sb) => sb?.prop_image_refs || sb?.propImageRefs || {},
    getProps: () => dramaProps || [],
    resolvePropImage: (prop) => {
      const propId = Number(prop?.id)
      const refUrl = Number.isFinite(propId) ? binding.prop_image_refs?.[propId] : null
      if (refUrl) return normalizeStripPath(refUrl)
      return normalizeStripPath(resolvePropImageUrl(prop, binding.prop_image_refs || {})) || null
    },
    resolveSceneImage: (scene) => {
      const sceneId = Number(scene?.id)
      const refUrl = Number.isFinite(sceneId) ? binding.scene_image_refs?.[sceneId] : null
      if (refUrl) return normalizeStripPath(refUrl)
      return resolveSceneStripPath(scene) || null
    },
    frameMode: 'reference',
    getTTSUrl: () => null,
    getVoiceRefs: (sb) => {
      const raw = sb?.voice_refs ?? sb?.voiceRefs ?? binding?.voice_refs
      if (Array.isArray(raw)) return raw
      return []
    },
  }
}

export function nextPromptImageIndex(prompt) {
  const labels = parsePromptImageLabels(prompt)
  if (!labels.length) return 1
  return Math.max(...labels.map(item => item.index)) + 1
}

export function buildPromptImageSnippet(index, label) {
  return `图片${index}是${label}`
}

export function insertPromptImageLabel(prompt, cursorStart, cursorEnd, index, label) {
  const before = String(prompt || '').slice(0, cursorStart)
  const after = String(prompt || '').slice(cursorEnd)
  const needsSep = before.trim() && !/[，,。\n]$/.test(before.trim())
  const snippet = `${needsSep ? '，' : ''}${buildPromptImageSnippet(index, label)}`
  const next = `${before}${snippet}${after}`
  return { text: next, cursor: before.length + snippet.length }
}

export function replaceMentionWithImageLabel(prompt, mentionStart, cursorEnd, index, _label) {
  const before = String(prompt || '').slice(0, mentionStart)
  const after = String(prompt || '').slice(cursorEnd)
  const snippet = `@图片${index}`
  const needsSep = before.trim() && !/[，,。\n\s@]$/.test(before.slice(-1))
  const text = `${before}${needsSep ? ' ' : ''}${snippet}${after}`
  return { text, cursor: before.length + (needsSep ? 1 : 0) + snippet.length }
}

export function replaceMentionWithVideoRef(prompt, mentionStart, cursorEnd, index) {
  const before = String(prompt || '').slice(0, mentionStart)
  const after = String(prompt || '').slice(cursorEnd)
  const snippet = `@视频${index}`
  const needsSep = before.trim() && !/[，,。\n\s@]$/.test(before.slice(-1))
  const text = `${before}${needsSep ? ' ' : ''}${snippet}${after}`
  return { text, cursor: before.length + (needsSep ? 1 : 0) + snippet.length }
}

export function replaceMentionWithAudioRef(prompt, mentionStart, cursorEnd, index) {
  const before = String(prompt || '').slice(0, mentionStart)
  const after = String(prompt || '').slice(cursorEnd)
  const snippet = `@音频${index}`
  const needsSep = before.trim() && !/[，,。\n\s@]$/.test(before.slice(-1))
  const text = `${before}${needsSep ? ' ' : ''}${snippet}${after}`
  return { text, cursor: before.length + (needsSep ? 1 : 0) + snippet.length }
}

export function buildVideoMentionItems(uploadedVideoRefs, options = {}) {
  const useMaterial = options?.labelKind === 'material'
  return (uploadedVideoRefs || [])
    .filter(item => item?.path)
    .map((item, index) => {
      const videoIndex = index + 1
      const defaultLabel = useMaterial ? `参考素材${videoIndex}` : `参考视频${videoIndex}`
      const label = item.label || defaultLabel
      return {
        type: 'video',
        key: `video:${normalizeStripPath(item.path)}`,
        path: normalizeStripPath(item.path),
        label,
        promptLabel: label,
        sub: useMaterial ? '参考素材' : '参考视频',
        thumb: null,
        videoIndex,
      }
    })
}

/** @ 菜单：已选音色/参考音频（按绑定顺序，插入 @音频N） */
export function buildAudioMentionItems(voiceRefs = []) {
  return (voiceRefs || [])
    .filter(item => item?.path)
    .map((item, index) => {
      const audioIndex = index + 1
      const label = String(item.name || item.label || `参考音频${audioIndex}`).trim() || `参考音频${audioIndex}`
      return {
        type: 'audio',
        key: `audio:${normalizeStripPath(item.path)}`,
        path: normalizeStripPath(item.path),
        label,
        promptLabel: label,
        sub: '参考音频',
        thumb: null,
        audioIndex,
      }
    })
}

export function buildAutoPromptHeader(sb, prompt, chars, scenes, helpers) {
  const items = buildPromptOrderedDisplayItems(sb, prompt, chars, scenes, helpers)
    .filter(item => item.type === 'image' && item.imageIndex && !item.technical)
  if (!items.length) return ''
  return items
    .sort((a, b) => a.imageIndex - b.imageIndex)
    .map(item => buildPromptImageSnippet(item.imageIndex, item.promptLabel || item.label))
    .join('，') + '。'
}

/** 移除提示词中所有「图片N是…」片段，保留用户正文 */
export function stripPromptImageLabels(prompt) {
  let text = String(prompt || '')
  text = text.replace(/[,，]?\s*@?(?:图片|图)\s*\d+\s*是[^，,@。\n]+/g, '')
  return cleanupPromptCommas(text)
}

/** 移除提示词中所有「音频N是…」片段，保留用户正文 */
export function stripPromptAudioLabels(prompt) {
  let text = String(prompt || '')
  text = text.replace(/[,，]?\s*@?(?:音频|音色)\s*\d+\s*是[^，,@。\n]+/g, '')
  return cleanupPromptCommas(text)
}

export function parsePromptVideoLabels(prompt) {
  const labels = []
  const re = /[,，]?\s*@?(?:视频)\s*(\d+)\s*是([^，,@。\n]+)/gi
  let match
  while ((match = re.exec(String(prompt || ''))) !== null) {
    labels.push({ index: Number(match[1]), label: String(match[2] || '').trim() })
  }
  return labels
}

/** 移除提示词中所有「视频N是…」片段，保留用户正文 */
export function stripPromptVideoLabels(prompt) {
  let text = String(prompt || '')
  text = text.replace(/[,，]?\s*@?(?:视频)\s*\d+\s*是[^，,@。\n]+/g, '')
  return cleanupPromptCommas(text)
}

export function parsePromptMaterialLabels(prompt) {
  const labels = []
  const re = /[,，]?\s*@?(?:素材)\s*(\d+)\s*是([^，,@。\n]+)/gi
  let match
  while ((match = re.exec(String(prompt || ''))) !== null) {
    labels.push({ index: Number(match[1]), label: String(match[2] || '').trim() })
  }
  return labels
}

/** 移除提示词中所有「素材N是…」片段（橙盟参考视频），保留用户正文 */
export function stripPromptMaterialLabels(prompt) {
  let text = String(prompt || '')
  text = text.replace(/[,，]?\s*@?(?:素材)\s*\d+\s*是[^，,@。\n]+/g, '')
  return cleanupPromptCommas(text)
}

export function buildPromptMaterialSnippet(index, label) {
  return `素材${index}是${label}`
}

export function buildPromptVideoSnippet(index, label) {
  return `视频${index}是${label}`
}

export function buildPromptAudioSnippet(index, label) {
  return `音频${index}是${formatVoicePromptLabel(label)}`
}

/** 按绑定音色顺序生成「音频1是A的声音，音频2是B的声音。」前缀 */
export function buildStudioPromptAudioHeader(voiceRefs, preservedLabels) {
  const voices = parseVoiceRefs(voiceRefs)
  if (!voices.length) return ''
  return voices
    .map((voice, index) => {
      const audioIndex = index + 1
      const label = preservedLabels?.get?.(audioIndex) || voice.name || '参考音色'
      return buildPromptAudioSnippet(audioIndex, label)
    })
    .join('，') + '。'
}

/** 按上传顺序生成「视频1是A，视频2是B。」前缀（VIP 等 @视频N） */
export function buildStudioPromptVideoHeader(uploadedVideoRefs, preservedLabels, options) {
  const items = (uploadedVideoRefs || []).filter(item => item?.path)
  if (!items.length) return ''
  const useMaterial = options?.labelKind === 'material'
  return items
    .map((item, index) => {
      const videoIndex = index + 1
      const defaultLabel = useMaterial ? `参考素材${videoIndex}` : `参考视频${videoIndex}`
      const label = preservedLabels?.get?.(videoIndex) || item.label || defaultLabel
      return useMaterial
        ? buildPromptMaterialSnippet(videoIndex, label)
        : buildPromptVideoSnippet(videoIndex, label)
    })
    .join('，') + '。'
}

/** 从当前提示词提取用户已编辑的「图片/视频/音频N是…」标签，供重写前缀时保留 */
export function collectPreservedMediaLabels(prompt) {
  const text = String(prompt || '')
  return {
    preservedLabels: new Map(
      parsePromptImageLabels(text).map(entry => [entry.index, entry.label]),
    ),
    preservedAudioLabels: new Map(
      parsePromptAudioLabels(text).map(entry => [entry.index, entry.label]),
    ),
    preservedVideoLabels: new Map(
      [
        ...parsePromptVideoLabels(text),
        ...parsePromptMaterialLabels(text),
      ].map(entry => [entry.index, entry.label]),
    ),
  }
}

/** 根据当前绑定参考图、参考视频与音色，重写提示词开头的说明前缀
 * @deprecated 视频通道已改为用户手写 @图片N；保留函数供旧调用/历史兼容，勿再用于自动改写输入框
 */
export function applyStudioPromptMediaHeader(prompt, binding, chars, scenes, props, uploadedRefs, options) {
  const preservedFromPrompt = options?.preservedLabels
    ? null
    : collectPreservedMediaLabels(prompt)
  let body = stripPromptImageLabels(prompt)
  body = stripPromptAudioLabels(body)
  body = stripPromptVideoLabels(body)
  body = stripPromptMaterialLabels(body)
  const imageHeader = buildStudioPromptImageHeader(
    binding,
    chars,
    scenes,
    props,
    uploadedRefs,
    options?.preservedLabels ?? preservedFromPrompt?.preservedLabels,
  )
  const videoHeader = buildStudioPromptVideoHeader(
    options?.uploadedVideoRefs,
    options?.preservedVideoLabels ?? preservedFromPrompt?.preservedVideoLabels,
    { labelKind: options?.videoRefLabel || 'video' },
  )
  const audioHeader = buildStudioPromptAudioHeader(
    binding?.voice_refs ?? binding?.voiceRefs,
    options?.preservedAudioLabels ?? preservedFromPrompt?.preservedAudioLabels,
  )
  const headers = [imageHeader, videoHeader, audioHeader].filter(Boolean).join('')
  if (!headers) return body
  if (!body) return headers
  return `${headers}${body}`
}

/** @deprecated 使用 applyStudioPromptMediaHeader */
export function applyStudioPromptImageHeader(prompt, binding, chars, scenes, props, uploadedRefs, options) {
  return applyStudioPromptMediaHeader(prompt, binding, chars, scenes, props, uploadedRefs, options)
}

/** 按参考图栏顺序生成「图片1是A，图片2是B。」前缀 */
export function buildStudioPromptImageHeader(binding, chars, scenes, props, uploadedRefs, preservedLabels) {
  const items = buildStudioRefStripItems(binding, chars, scenes, props, uploadedRefs, () => '')
    .filter(item => item.path && !item.missing)
  if (!items.length) return ''
  return items
    .map((item, index) => {
      const imageIndex = index + 1
      const label = pickStudioHeaderLabel(item, imageIndex, preservedLabels)
      return buildPromptImageSnippet(imageIndex, label)
    })
    .join('，') + '。'
}

export function buildStudioDisplayItems(binding, prompt, chars, scenes, props = []) {
  const sb = bindingToStoryboard(binding)
  const helpers = createStudioHelpers(binding, props)
  return buildPromptOrderedDisplayItems(sb, prompt, chars, scenes, helpers)
    .filter(item => item.type === 'image'
      && item.source !== 'first_frame'
      && item.source !== 'last_frame'
      && item.source !== 'reference')
}

function normalizeStripPath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function resolveSceneStripPath(scene) {
  return normalizeStripPath(
    scene?.image_url || scene?.imageUrl || scene?.local_path || scene?.localPath,
  )
}

export function applyRefStripOrder(items, orderKeys) {
  if (!orderKeys?.length) return items
  const map = new Map(items.map(item => [item.key, item]))
  const ordered = []
  for (const key of orderKeys) {
    const item = map.get(key)
    if (item) {
      ordered.push(item)
      map.delete(key)
    }
  }
  for (const item of map.values()) ordered.push(item)
  return ordered
}

export function ensureRefStripOrderKeys(binding, items) {
  const keys = new Set(items.map(item => item.key))
  const next = (binding.ref_strip_order || []).filter(key => keys.has(key))
  for (const item of items) {
    if (!next.includes(item.key)) next.push(item.key)
  }
  binding.ref_strip_order = next
}

/** 按参考图栏顺序写回 character_ids / scene_ids / 上传图列表 */
export function applyRefStripOrderToBinding(binding, orderedItems, uploadedRefs) {
  const charIds = []
  const sceneIds = []
  const propIds = []
  const uploads = []
  const uploadByPath = new Map(
    (uploadedRefs || []).map(item => [normalizeStripPath(item.path), item]),
  )

  for (const item of orderedItems || []) {
    if (item.kind === 'linked' && item.ref?.source === 'character' && item.ref.charId != null) {
      charIds.push(item.ref.charId)
    } else if (item.kind === 'linked' && item.ref?.source === 'scene' && item.ref.sceneId != null) {
      sceneIds.push(item.ref.sceneId)
    } else if (item.kind === 'linked' && item.ref?.source === 'prop' && item.ref.propId != null) {
      propIds.push(item.ref.propId)
    } else if (item.kind === 'upload' && item.path) {
      const upload = uploadByPath.get(normalizeStripPath(item.path))
      if (upload) uploads.push(upload)
    }
  }

  binding.character_ids = charIds
  binding.scene_ids = sceneIds
  binding.scene_id = sceneIds[0] ?? null
  binding.prop_ids = propIds
  binding.ref_strip_order = (orderedItems || []).map(item => item.key)
  return uploads
}

/** 参考图栏：每个绑定角色/场景/上传图只显示一次，不随 @ 重复扩增 */
export function buildStudioRefStripItems(binding, chars, scenes, props, uploadedRefs, previewUrl) {
  const items = []
  const seenPaths = new Set()
  const toPreview = typeof previewUrl === 'function' ? previewUrl : path => path

  for (const charId of binding.character_ids || []) {
    const char = (chars || []).find(item => item.id === charId)
    if (!char) continue
    const path = normalizeStripPath(resolveCharacterImageUrl(char, binding.character_image_refs || {}))
    if (path) seenPaths.add(path)
    items.push({
      key: `char:${charId}`,
      kind: 'linked',
      ref: {
        key: `char:${charId}`,
        source: 'character',
        charId,
        label: char.name,
        url: path || null,
      },
      path,
      preview: path ? toPreview(path) : '',
      missing: !path,
      tagLabel: char.name,
    })
  }

  for (const sceneId of getBindingSceneIds(binding)) {
    const scene = (scenes || []).find(item => item.id === sceneId)
    if (!scene) continue
    const path = normalizeStripPath(
      binding.scene_image_refs?.[sceneId]
      || resolveSceneImageUrl(scene, 'hero')
      || resolveSceneStripPath(scene),
    )
    const label = sceneDisplayLabel(scene)
    if (path) seenPaths.add(path)
    items.push({
      key: `scene:${sceneId}`,
      kind: 'linked',
      ref: {
        key: `scene:${sceneId}`,
        source: 'scene',
        sceneId,
        label,
        url: path || null,
      },
      path,
      preview: path ? toPreview(path) : '',
      missing: !path,
      tagLabel: label,
    })
  }

  for (const propId of binding.prop_ids || []) {
    const prop = (props || []).find(item => item.id === propId)
    if (!prop) continue
    const path = normalizeStripPath(
      binding.prop_image_refs?.[propId]
      || resolvePropImageUrl(prop, binding.prop_image_refs || {}),
    )
    const label = prop.name || `道具#${propId}`
    if (path) seenPaths.add(path)
    items.push({
      key: `prop:${propId}`,
      kind: 'linked',
      ref: {
        key: `prop:${propId}`,
        source: 'prop',
        propId,
        label,
        url: path || null,
      },
      path,
      preview: path ? toPreview(path) : '',
      missing: !path,
      tagLabel: label,
    })
  }

  for (const [uploadIndex, img] of (uploadedRefs || []).entries()) {
    const path = normalizeStripPath(img?.path)
    if (!path || seenPaths.has(path)) continue
    seenPaths.add(path)
    items.push({
      key: `upload:${path}`,
      kind: 'upload',
      uploadIndex,
      path,
      preview: img.preview || toPreview(path),
      ossUrl: img.ossUrl || null,
      label: img.label,
      missing: false,
      tagLabel: img.label || `参考${uploadIndex + 1}`,
    })
  }

  return applyRefStripOrder(items, binding.ref_strip_order)
}

export function buildStudioContentRefs(binding, prompt, chars, scenes, props, uploadedRefs = [], uploadedVideoRefs = [], options = {}) {
  // 用户提示词原样提交；不再自动改写「图片1是…」前缀。上游适配在后端按通道规则处理。
  const finalPrompt = String(prompt || '')
  const stripItems = buildStudioRefStripItems(binding, chars, scenes, props, uploadedRefs, () => '')
    .filter(item => item.path && !item.missing)

  const imageRefs = stripItems.map((item, index) => ({
    type: 'image',
    url: normalizeStripPath(item.path),
    role: 'reference_image',
    label: item.ref?.label
      || item.tagLabel
      || item.label
      || `参考图${index + 1}`,
  }))

  const videoRefs = (uploadedVideoRefs || [])
    .map((item, index) => {
      const path = normalizeStripPath(item?.path)
      if (!path) return null
      return {
        type: 'video',
        url: path,
        role: 'reference_video',
        label: item.label || `参考视频${index + 1}`,
      }
    })
    .filter(Boolean)

  const sb = bindingToStoryboard(binding)
  const helpers = createStudioHelpers(binding, props)
  const fullRefs = buildOrderedVideoContentRefs(sb, finalPrompt, chars, scenes, helpers)
  const audioRefs = fullRefs.filter(ref => ref.type !== 'image')

  return { prompt: finalPrompt, contentRefs: [...imageRefs, ...videoRefs, ...audioRefs] }
}

export function validateStudioPrompt(prompt, binding, chars, scenes, props = [], uploadedRefs = []) {
  const sb = bindingToStoryboard(binding)
  const helpers = createStudioHelpers(binding, props)
  const issues = validatePromptImageRefs(prompt, sb, chars, scenes, helpers)
  if (!issues.length) return issues

  const stripItems = buildStudioRefStripItems(binding, chars, scenes, props, uploadedRefs, () => '')
    .filter(item => item.path && !item.missing)

  return issues.filter((issue) => {
    const stripItem = stripItems[issue.index - 1]
    return !(stripItem?.path)
  })
}

const MENTION_LIMITS = { strip: 12 }

function matchesMentionQuery(q, ...parts) {
  if (!q) return true
  return parts.some(part => String(part || '').toLowerCase().includes(q))
}

function stripItemToMention(item) {
  if (!item?.path || item.missing) return null

  if (item.kind === 'linked' && item.ref) {
    const source = item.ref.source || 'linked'
    const label = item.ref.label || item.ref.promptLabel || item.tagLabel
    if (!label) return null
    return {
      type: source,
      key: item.key,
      path: item.path,
      label,
      promptLabel: label,
      sub: source === 'character' ? '角色' : source === 'scene' ? '场景' : source === 'prop' ? '道具' : '参考图',
      thumb: item.preview || item.path,
    }
  }

  if (item.kind === 'upload') {
    const index = (item.uploadIndex ?? 0) + 1
    const label = item.label && !/^参考\d+$/.test(item.label)
      ? item.label
      : `参考图${index}`
    return {
      type: 'upload',
      key: item.key,
      path: item.path,
      label,
      promptLabel: label,
      sub: '上传参考图',
      thumb: item.preview || item.path,
    }
  }

  return null
}

/** @ 菜单：参考图栏图片 + 可选参考视频/音频（序号与条上顺序一致，插入 @图片N / @视频N / @音频N） */
export function buildMentionOptions(stripItems, query, extraItems = []) {
  const q = String(query || '').trim().toLowerCase()
  const items = []
  let imageIndex = 0

  for (const item of stripItems || []) {
    const mention = stripItemToMention(item)
    if (!mention) continue
    imageIndex += 1
    mention.imageIndex = imageIndex
    if (!matchesMentionQuery(q, mention.label, mention.sub, `@图片${imageIndex}`)) continue
    items.push(mention)
  }

  for (const item of extraItems || []) {
    if (!item?.path) continue
    const tag = item.audioIndex
      ? `@音频${item.audioIndex}`
      : item.videoIndex
        ? `@视频${item.videoIndex}`
        : ''
    if (!matchesMentionQuery(q, item.label, item.sub, tag, '音频', '音色')) continue
    items.push(item)
  }

  return items.slice(0, MENTION_LIMITS.strip)
}

export function bindCharacter(binding, charId, chars) {
  const ids = new Set(binding.character_ids || [])
  ids.add(charId)
  binding.character_ids = [...ids]

  const char = chars.find(item => item.id === charId)
  const url = resolveCharacterImageUrl(char, binding.character_image_refs)
  if (url && char) {
    binding.character_image_refs = {
      ...(binding.character_image_refs || {}),
      [charId]: url,
    }
  }
}

export function unbindCharacter(binding, charId) {
  binding.character_ids = (binding.character_ids || []).filter(id => id !== charId)
  const refs = { ...(binding.character_image_refs || {}) }
  delete refs[charId]
  binding.character_image_refs = refs
}

export function toggleCharacterBinding(binding, charId, chars) {
  if ((binding.character_ids || []).includes(charId)) {
    unbindCharacter(binding, charId)
    return false
  }
  bindCharacter(binding, charId, chars)
  return true
}

export function bindScene(binding, sceneId, scenes) {
  if (!sceneId) {
    binding.scene_ids = []
    binding.scene_id = null
    return
  }
  const parsed = Number(sceneId)
  const ids = new Set(getBindingSceneIds(binding))
  ids.add(parsed)
  binding.scene_ids = [...ids]
  binding.scene_id = binding.scene_ids[0] ?? null

  const scene = (scenes || []).find(item => item.id === parsed)
  const url = resolveSceneImageUrl(scene, 'hero') || resolveSceneStripPath(scene)
  if (url) {
    binding.scene_image_refs = {
      ...(binding.scene_image_refs || {}),
      [parsed]: url,
    }
  }
}

export function unbindScene(binding, sceneId) {
  const parsed = Number(sceneId)
  binding.scene_ids = getBindingSceneIds(binding).filter(id => id !== parsed)
  binding.scene_id = binding.scene_ids[0] ?? null
  const refs = { ...(binding.scene_image_refs || {}) }
  delete refs[parsed]
  binding.scene_image_refs = refs
}

export function setCharacterImageRef(binding, charId, url, char) {
  const refs = { ...(binding.character_image_refs || {}) }
  const normalized = normalizeStripPath(url)
  const primary = normalizeStripPath(resolveCharacterImageUrl(char, {}))
  if (!normalized || primary === normalized) delete refs[charId]
  else refs[charId] = normalized
  binding.character_image_refs = refs
}

export function setSceneImageRef(binding, sceneId, url, scene) {
  const refs = { ...(binding.scene_image_refs || {}) }
  const normalized = normalizeStripPath(url)
  const primary = normalizeStripPath(resolveSceneImageUrl(scene, 'hero') || resolveSceneStripPath(scene))
  if (!normalized || primary === normalized) delete refs[sceneId]
  else refs[sceneId] = normalized
  binding.scene_image_refs = refs
}

export function isCharacterImageRefSelected(binding, charId, url, char) {
  const normalized = normalizeStripPath(url)
  const selected = binding.character_image_refs?.[charId]
  if (selected) return normalizeStripPath(selected) === normalized
  return normalizeStripPath(resolveCharacterImageUrl(char, binding.character_image_refs || {})) === normalized
}

export function isSceneImageRefSelected(binding, sceneId, url, scene) {
  const normalized = normalizeStripPath(url)
  const selected = binding.scene_image_refs?.[sceneId]
  if (selected) return normalizeStripPath(selected) === normalized
  const primary = normalizeStripPath(resolveSceneImageUrl(scene, 'hero') || resolveSceneStripPath(scene))
  return primary === normalized
}

export function bindProp(binding, propId, props) {
  const ids = new Set(binding.prop_ids || [])
  ids.add(propId)
  binding.prop_ids = [...ids]

  const prop = (props || []).find(item => item.id === propId)
  const url = resolvePropImageUrl(prop, binding.prop_image_refs)
  if (url && prop) {
    binding.prop_image_refs = {
      ...(binding.prop_image_refs || {}),
      [propId]: url,
    }
  }
}

export function unbindProp(binding, propId) {
  binding.prop_ids = (binding.prop_ids || []).filter(id => id !== propId)
  const refs = { ...(binding.prop_image_refs || {}) }
  delete refs[propId]
  binding.prop_image_refs = refs
}

export function setPropImageRef(binding, propId, url, prop) {
  const refs = { ...(binding.prop_image_refs || {}) }
  const normalized = normalizeStripPath(url)
  const primary = normalizeStripPath(resolvePropImageUrl(prop, {}))
  if (!normalized || primary === normalized) delete refs[propId]
  else refs[propId] = normalized
  binding.prop_image_refs = refs
}

export function isPropImageRefSelected(binding, propId, url, prop) {
  const normalized = normalizeStripPath(url)
  const selected = binding.prop_image_refs?.[propId]
  if (selected) return normalizeStripPath(selected) === normalized
  return normalizeStripPath(resolvePropImageUrl(prop, binding.prop_image_refs || {})) === normalized
}

export function isGenericReuseLabel(label) {
  const normalized = String(label || '').replace(/\s+/g, '').trim()
  return !normalized || /^参考(图)?\d+$/.test(normalized)
}

function pickStudioHeaderLabel(item, imageIndex, preservedLabels) {
  const preserved = String(preservedLabels?.get?.(imageIndex) || '').trim()
  if (preserved) return preserved
  if (item.kind === 'linked' && item.ref?.label && !isGenericReuseLabel(item.ref.label)) {
    return item.ref.label
  }
  const candidate = item.ref?.label || item.tagLabel || item.label
  if (candidate && !isGenericReuseLabel(candidate)) return candidate
  return `参考图${imageIndex}`
}

function resolveReuseRefLabel(ref, index, labelByIndex) {
  const fromPrompt = labelByIndex.get(index + 1)
  if (fromPrompt && !isGenericReuseLabel(fromPrompt)) return fromPrompt
  const fromRef = String(ref?.label || '').trim()
  if (fromRef && !isGenericReuseLabel(fromRef)) return fromRef
  return fromPrompt || fromRef || ''
}

function pathsEquivalent(a, b) {
  const na = normalizeStripPath(a)
  const nb = normalizeStripPath(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const fa = na.split('/').pop() || ''
  const fb = nb.split('/').pop() || ''
  return !!fa && fa === fb
}

function entityPathsIncludePath(entityPaths, path) {
  for (const entityPath of entityPaths) {
    if (pathsEquivalent(entityPath, path)) return true
  }
  return false
}

function buildStudioLabelCandidates(chars, scenes, props) {
  const candidates = []
  for (const char of chars || []) {
    candidates.push({
      key: `char:${char.id}`,
      source: 'character',
      charId: char.id,
      label: char.name,
    })
  }
  for (const prop of props || []) {
    candidates.push({
      key: `prop:${prop.id}`,
      source: 'prop',
      propId: prop.id,
      label: prop.name || `道具#${prop.id}`,
    })
  }
  for (const scene of scenes || []) {
    candidates.push({
      key: `scene:${scene.id}`,
      source: 'scene',
      sceneId: scene.id,
      label: sceneDisplayLabel(scene),
    })
  }
  return candidates
}

function collectStudioEntityImagePaths(entity, type) {
  const paths = new Set()
  if (type === 'character') {
    for (const img of listCharacterImages(entity)) {
      const url = normalizeStripPath(img?.url)
      if (url) paths.add(url)
    }
    return paths
  }
  if (type === 'scene') {
    for (const img of listSceneImages(entity)) {
      const url = normalizeStripPath(img?.url || img?.path || img?.local_path)
      if (url) paths.add(url)
    }
    const hero = normalizeStripPath(resolveSceneImageUrl(entity, 'hero') || resolveSceneStripPath(entity))
    if (hero) paths.add(hero)
    return paths
  }
  if (type === 'prop') {
    const primary = normalizeStripPath(resolvePropImageUrl(entity, {}))
    if (primary) paths.add(primary)
  }
  return paths
}

function matchStudioEntityByPath(path, chars, scenes, props, usedKeys) {
  const norm = normalizeStripPath(path)
  if (!norm) return null

  for (const char of chars || []) {
    const key = `char:${char.id}`
    if (usedKeys?.has(key)) continue
    if (entityPathsIncludePath(collectStudioEntityImagePaths(char, 'character'), norm)) {
      return { key, source: 'character', charId: char.id }
    }
  }
  for (const prop of props || []) {
    const key = `prop:${prop.id}`
    if (usedKeys?.has(key)) continue
    if (entityPathsIncludePath(collectStudioEntityImagePaths(prop, 'prop'), norm)) {
      return { key, source: 'prop', propId: prop.id }
    }
  }
  for (const scene of scenes || []) {
    const key = `scene:${scene.id}`
    if (usedKeys?.has(key)) continue
    if (entityPathsIncludePath(collectStudioEntityImagePaths(scene, 'scene'), norm)) {
      return { key, source: 'scene', sceneId: scene.id }
    }
  }
  return null
}

/** 从历史视频记录恢复角色/场景/道具绑定与上传参考图 */
export function restoreStudioBindingsFromVideoItem(item, binding, chars, scenes, props, callbacks) {
  const normalizePath = callbacks?.normalizePath || normalizeStripPath
  const addUpload = callbacks?.addUpload
  const refs = item?.reference_images || []
  const promptLabels = parsePromptImageLabels(String(item?.prompt || ''))
  const labelByIndex = new Map(promptLabels.map(entry => [entry.index, entry.label]))
  const candidates = buildStudioLabelCandidates(chars, scenes, props)
  const usedKeys = new Set()
  const stripOrderKeys = []

  for (let idx = 0; idx < refs.length; idx += 1) {
    const ref = refs[idx]
    const path = normalizePath(ref.path || ref.display_url)
    if (!path) continue

    const label = resolveReuseRefLabel(ref, idx, labelByIndex)
    let matched = label ? findCandidateForPromptLabel(label, candidates, usedKeys) : null
    if (!matched) matched = matchStudioEntityByPath(path, chars, scenes, props, usedKeys)

    if (matched?.source === 'character' && matched.charId != null) {
      usedKeys.add(matched.key)
      bindCharacter(binding, matched.charId, chars)
      const char = (chars || []).find(entry => entry.id === matched.charId)
      setCharacterImageRef(binding, matched.charId, path, char)
      stripOrderKeys.push(`char:${matched.charId}`)
    } else if (matched?.source === 'scene' && matched.sceneId != null) {
      usedKeys.add(matched.key)
      bindScene(binding, matched.sceneId, scenes)
      const scene = (scenes || []).find(entry => entry.id === matched.sceneId)
      setSceneImageRef(binding, matched.sceneId, path, scene)
      stripOrderKeys.push(`scene:${matched.sceneId}`)
    } else if (matched?.source === 'prop' && matched.propId != null) {
      usedKeys.add(matched.key)
      bindProp(binding, matched.propId, props)
      const prop = (props || []).find(entry => entry.id === matched.propId)
      setPropImageRef(binding, matched.propId, path, prop)
      stripOrderKeys.push(`prop:${matched.propId}`)
    } else if (typeof addUpload === 'function') {
      addUpload(path, { label: label || null, preview: ref.display_url || null })
      stripOrderKeys.push(`upload:${normalizeStripPath(path)}`)
    }
  }

  if (stripOrderKeys.length) {
    binding.ref_strip_order = stripOrderKeys
  }
}

export function setSceneBindings(binding, sceneIds) {
  binding.scene_ids = [...new Set((sceneIds || []).map(id => Number(id)).filter(Number.isFinite))]
  binding.scene_id = binding.scene_ids[0] ?? null
}

function cleanupPromptCommas(text) {
  return String(text || '')
    .replace(/^[，,\s]+/, '')
    .replace(/\s*[，,]\s*[，,]\s*/g, '，')
    .replace(/^[，,]+/, '')
    .replace(/[，,]+$/g, '')
    .trim()
}

/** 从提示词中移除指定的 图片N是… 片段 */
export function removePromptImageLabel(prompt, index, labelHint) {
  let text = String(prompt || '')
  if (index) {
    const byIndex = new RegExp(`[,，]?\\s*@?(?:图片|图)\\s*${index}\\s*是[^，,@。\\n]+`, 'g')
    text = text.replace(byIndex, '')
  }
  if (labelHint) {
    const escaped = String(labelHint).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const byLabel = new RegExp(`[,，]?\\s*@?(?:图片|图)\\s*\\d+\\s*是\\s*${escaped}`, 'g')
    text = text.replace(byLabel, '')
  }
  return cleanupPromptCommas(text)
}

export function canUnlinkStudioRef(ref) {
  if (!ref || ref.missing) return false
  return ['character', 'scene', 'prop', 'reference', 'prompt'].includes(ref.source)
}
