import {
  parsePromptImageLabels,
  parsePromptAudioLabels,
  buildPromptOrderedDisplayItems,
  buildOrderedVideoContentRefs,
  validatePromptImageRefs,
  formatPromptImageRefIssues,
  findCandidateForPromptLabel,
} from './video-ref-order.js'
import {
  resolveCharacterImageUrl,
  resolveCharacterImageUrls,
  normalizeCharacterImageRefList,
  labelForCharacterImage,
  mergeCharacterImageRefs,
  listCharacterImages,
} from './character-image-variants.js'
import { resolveSceneImageUrl, listSceneImages } from './scene-image-variants.js'
import { resolvePropImageUrl } from './prop-image-variants.js'
import { parseVoiceRefs, formatVoicePromptLabel, voiceRefFromAsset, MAX_VOICE_REFS } from './voice-refs.js'
import { isCertifiedPortraitImage } from './portrait-status.js'

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

export function createStudioHelpers(binding, dramaProps = [], options = {}) {
  const maxVoiceRefsRaw = options?.maxVoiceRefs
  const maxVoiceRefs = Number.isFinite(Number(maxVoiceRefsRaw)) && Number(maxVoiceRefsRaw) >= 0
    ? Math.floor(Number(maxVoiceRefsRaw))
    : MAX_VOICE_REFS
  return {
    maxVoiceRefs,
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

/**
 * 参考图条带顺序变化时，同步改写提示词里的 @图片N / 图片N。
 * oldToNew: Map 或 Record，旧序号 → 新序号（1-based）。
 */
export function remapPromptImageIndices(prompt, oldToNew) {
  const map = oldToNew instanceof Map
    ? oldToNew
    : new Map(Object.entries(oldToNew || {}).map(([k, v]) => [Number(k), Number(v)]))
  if (!map.size) return String(prompt || '')

  let text = String(prompt || '')
  // 先换成占位符，避免 1↔2 互换时互相覆盖
  text = text.replace(/(@?(?:图片|图))\s*(\d+)/gi, (match, prefix, numStr) => {
    const oldIdx = Number(numStr)
    if (!Number.isFinite(oldIdx) || !map.has(oldIdx)) return match
    return `\0IMGREF:${prefix}:${oldIdx}\0`
  })
  text = text.replace(/\0IMGREF:(@?(?:图片|图)):(\d+)\0/gi, (_, prefix, numStr) => {
    const next = map.get(Number(numStr))
    return `${prefix}${next}`
  })
  return text
}

/** 根据条带 key 顺序变化，生成图片序号映射并改写提示词 */
export function remapPromptImageIndicesByKeys(prompt, oldKeys, newKeys) {
  const oldToNew = new Map()
  ;(oldKeys || []).forEach((key, oldIdx) => {
    if (!key) return
    const newIdx = (newKeys || []).indexOf(key)
    if (newIdx < 0) return
    oldToNew.set(oldIdx + 1, newIdx + 1)
  })
  return remapPromptImageIndices(prompt, oldToNew)
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
export function buildStudioPromptAudioHeader(voiceRefs, preservedLabels, max = MAX_VOICE_REFS) {
  const voices = parseVoiceRefs(voiceRefs, max)
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
    options?.maxVoiceRefs ?? MAX_VOICE_REFS,
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
  const charImageRefs = {}
  const sceneIds = []
  const propIds = []
  const uploads = []
  const uploadByPath = new Map(
    (uploadedRefs || []).map(item => [normalizeStripPath(item.path), item]),
  )

  for (const item of orderedItems || []) {
    if (item.kind === 'linked' && item.ref?.source === 'character' && item.ref.charId != null) {
      const charId = item.ref.charId
      if (!charIds.includes(charId)) charIds.push(charId)
      const path = normalizeStripPath(item.path || item.ref.url)
      if (path) {
        const list = normalizeCharacterImageRefList(charImageRefs[charId])
        if (!list.includes(path)) list.push(path)
        charImageRefs[charId] = list.length === 1 ? list[0] : list
      }
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
  binding.character_image_refs = charImageRefs
  binding.scene_ids = sceneIds
  binding.scene_id = sceneIds[0] ?? null
  binding.prop_ids = propIds
  binding.ref_strip_order = (orderedItems || []).map(item => item.key)
  return uploads
}

/** 参考图栏：同一角色可出现多张形态图（人形态/蛇形态等） */
export function buildStudioRefStripItems(binding, chars, scenes, props, uploadedRefs, previewUrl) {
  const items = []
  const seenPaths = new Set()
  const toPreview = typeof previewUrl === 'function' ? previewUrl : path => path

  for (const charId of binding.character_ids || []) {
    const char = (chars || []).find(item => item.id === charId)
    if (!char) continue
    const urls = resolveCharacterImageUrls(char, binding.character_image_refs || {})
    if (!urls.length) {
      items.push({
        key: `char:${charId}`,
        kind: 'linked',
        ref: {
          key: `char:${charId}`,
          source: 'character',
          charId,
          label: char.name,
          url: null,
        },
        path: '',
        preview: '',
        missing: true,
        tagLabel: char.name,
      })
      continue
    }
    urls.forEach((rawPath, index) => {
      const path = normalizeStripPath(rawPath)
      if (path) seenPaths.add(path)
      const baseLabel = urls.length > 1
        ? labelForCharacterImage(char, path)
        : char.name
      const certified = isCertifiedPortraitImage(char, path)
      const label = certified ? `${baseLabel} ·已认证` : baseLabel
      const key = `char:${charId}:${path || index}`
      items.push({
        key,
        kind: 'linked',
        ref: {
          key,
          source: 'character',
          charId,
          label: baseLabel,
          url: path || null,
          certified,
        },
        path,
        preview: path ? toPreview(path) : '',
        missing: !path,
        certified,
        tagLabel: label,
      })
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
      const oss = String(item?.ossUrl || '').trim()
      const path = normalizeStripPath(item?.path)
      const url = (oss.startsWith('http://') || oss.startsWith('https://')) ? oss : path
      if (!url) return null
      return {
        type: 'video',
        url,
        role: 'reference_video',
        label: item.label || `参考视频${index + 1}`,
      }
    })
    .filter(Boolean)

  const sb = bindingToStoryboard(binding)
  const helpers = createStudioHelpers(binding, props, {
    maxVoiceRefs: options?.maxVoiceRefs ?? MAX_VOICE_REFS,
  })
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

/** @ 菜单条数上限：覆盖 S 2.5 合计 50（30 图 + 10 视频 + 10 音频） */
const MENTION_LIMITS = { strip: 50 }

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
    const certified = !!(item.certified || item.ref.certified)
    let sub = source === 'character' ? '角色' : source === 'scene' ? '场景' : source === 'prop' ? '道具' : '参考图'
    if (source === 'character') {
      sub = certified ? '角色 ·已认证' : '角色'
    }
    return {
      type: source,
      key: item.key,
      path: item.path,
      label,
      promptLabel: label,
      sub,
      certified,
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
export function buildMentionOptions(stripItems, query, extraItems = [], limit = MENTION_LIMITS.strip) {
  const q = String(query || '').trim().toLowerCase()
  const items = []
  let imageIndex = 0
  const maxItems = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.floor(Number(limit))
    : MENTION_LIMITS.strip

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

  return items.slice(0, maxItems)
}

export function bindCharacter(binding, charId, chars) {
  const ids = new Set(binding.character_ids || [])
  ids.add(charId)
  binding.character_ids = [...ids]

  const char = chars.find(item => item.id === charId)
  const existing = normalizeCharacterImageRefList(binding.character_image_refs?.[charId])
  if (existing.length) return

  const url = resolveCharacterImageUrl(char, {})
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

/** 移除角色的某一张形态图；若已无图则解绑角色 */
export function unbindCharacterImage(binding, charId, imageUrl, char) {
  const normalized = normalizeStripPath(imageUrl)
  const list = normalizeCharacterImageRefList(binding.character_image_refs?.[charId])
  const primary = normalizeStripPath(resolveCharacterImageUrl(char, {}))
  let next = list.length ? [...list] : (primary ? [primary] : [])
  if (normalized) next = next.filter(url => url !== normalized)
  if (!next.length) {
    unbindCharacter(binding, charId)
    return
  }
  const refs = { ...(binding.character_image_refs || {}) }
  refs[charId] = next.length === 1 ? next[0] : next
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
  if (!normalized || primary === normalized) {
    // 显式选原图时，若已有多形态则保留原图为唯一；否则清除覆盖
    const current = normalizeCharacterImageRefList(refs[charId])
    if (current.length > 1 && normalized) {
      refs[charId] = normalized
    } else {
      delete refs[charId]
    }
  } else {
    refs[charId] = normalized
  }
  binding.character_image_refs = refs
}

/** 切换/追加角色形态图（同一角色可多选） */
export function toggleCharacterImageRef(binding, charId, url, char) {
  const refs = { ...(binding.character_image_refs || {}) }
  const normalized = normalizeStripPath(url)
  if (!normalized) return
  const primary = normalizeStripPath(resolveCharacterImageUrl(char, {}))
  let list = normalizeCharacterImageRefList(refs[charId])
  if (!list.length && primary) list = [primary]

  const idx = list.indexOf(normalized)
  if (idx >= 0) {
    if (list.length <= 1) return
    list.splice(idx, 1)
  } else {
    list.push(normalized)
  }

  if (list.length === 1 && list[0] === primary) delete refs[charId]
  else refs[charId] = list.length === 1 ? list[0] : list
  binding.character_image_refs = refs
}

/** 复用历史任务时追加角色参考图（不注入默认原图，保留多图顺序） */
export function appendCharacterImageRef(binding, charId, url) {
  const normalized = normalizeStripPath(url)
  if (!normalized || !Number.isFinite(Number(charId))) return
  const id = Number(charId)
  const refs = { ...(binding.character_image_refs || {}) }
  const list = normalizeCharacterImageRefList(refs[id])
  if (!list.includes(normalized)) list.push(normalized)
  refs[id] = list.length === 1 ? list[0] : list
  binding.character_image_refs = refs
  if (!(binding.character_ids || []).includes(id)) {
    binding.character_ids = [...(binding.character_ids || []), id]
  }
}

export function characterStripKey(charId, path) {
  return `char:${charId}:${normalizeStripPath(path)}`
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
  const selected = normalizeCharacterImageRefList(binding.character_image_refs?.[charId])
  if (selected.length) return selected.includes(normalized)
  return normalizeStripPath(resolveCharacterImageUrl(char, {})) === normalized
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
    const images = listCharacterImages(char)
    if (!images.length) {
      candidates.push({
        key: `char:${char.id}`,
        source: 'character',
        charId: char.id,
        label: char.name,
      })
      continue
    }
    for (const img of images) {
      const path = normalizeStripPath(img?.url)
      if (!path) continue
      candidates.push({
        key: characterStripKey(char.id, path),
        source: 'character',
        charId: char.id,
        label: labelForCharacterImage(char, path),
        path,
      })
    }
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
    const key = characterStripKey(char.id, norm)
    if (usedKeys?.has(key)) continue
    if (entityPathsIncludePath(collectStudioEntityImagePaths(char, 'character'), norm)) {
      return { key, source: 'character', charId: char.id, path: norm }
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

function collectImageRefsFromVideoItem(item) {
  if (Array.isArray(item?.reference_images) && item.reference_images.length) {
    return item.reference_images
      .map(ref => ({
        path: ref?.path || ref?.url || ref?.display_url,
        label: ref?.label || null,
        display_url: ref?.display_url || null,
      }))
      .filter(ref => ref.path)
  }
  return parseVideoItemContentRefs(item)
    .filter(ref => ref?.type === 'image' && ref.role !== 'first_frame' && ref.role !== 'last_frame')
    .map(ref => ({
      path: ref.url || ref.path,
      label: ref.label || null,
      display_url: null,
    }))
    .filter(ref => ref.path)
}

function parseVideoItemContentRefs(item) {
  const payloadRaw = item?.reference_payload || item?.referencePayload
  if (!payloadRaw) return []
  try {
    const refs = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw
    return Array.isArray(refs) ? refs : []
  } catch {
    return []
  }
}

function collectAudioRefsFromVideoItem(item) {
  if (Array.isArray(item?.reference_audios) && item.reference_audios.length) {
    return item.reference_audios
      .map(ref => ({
        path: normalizeStripPath(ref?.path || ref?.url),
        label: ref?.label || ref?.name || null,
      }))
      .filter(ref => ref.path)
  }
  return parseVideoItemContentRefs(item)
    .filter(ref => ref?.type === 'audio')
    .map(ref => ({
      path: normalizeStripPath(ref.url || ref.path),
      label: ref.label || null,
    }))
    .filter(ref => ref.path)
}

function voiceNameFromAudioLabel(label) {
  const raw = String(label || '').trim()
  if (!raw) return '音色'
  return raw.replace(/的声音$/u, '').trim() || '音色'
}

/** 从历史视频记录恢复音色绑定（参考音频） */
export function restoreVoiceRefsFromVideoItem(item, voiceAssets = [], max = MAX_VOICE_REFS) {
  const limit = Number.isFinite(Number(max)) && Number(max) >= 0 ? Math.floor(Number(max)) : MAX_VOICE_REFS
  const assets = Array.isArray(voiceAssets) ? voiceAssets : []
  const seen = new Set()
  const result = []
  for (const ref of collectAudioRefsFromVideoItem(item)) {
    const path = normalizeStripPath(ref.path)
    if (!path || seen.has(path)) continue
    seen.add(path)
    const asset = assets.find((entry) => {
      const assetPath = normalizeStripPath(entry?.local_path || entry?.localPath || entry?.url)
      return assetPath && assetPath === path
    })
    const voice = asset
      ? voiceRefFromAsset(asset)
      : {
          asset_id: null,
          path,
          name: voiceNameFromAudioLabel(ref.label),
          duration: null,
        }
    if (!voice?.path) continue
    result.push(voice)
    if (result.length >= limit) break
  }
  return result
}

/** 从历史视频记录恢复角色/场景/道具绑定与上传参考图 */
export function restoreStudioBindingsFromVideoItem(item, binding, chars, scenes, props, callbacks) {
  const normalizePath = callbacks?.normalizePath || normalizeStripPath
  const addUpload = callbacks?.addUpload
  const refs = collectImageRefsFromVideoItem(item)
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
    // 优先按路径匹配，保证与历史 content_refs 顺序一致；同一角色多图可并存
    let matched = matchStudioEntityByPath(path, chars, scenes, props, usedKeys)
    if (!matched && label) {
      matched = findCandidateForPromptLabel(label, candidates, usedKeys)
    }

    if (matched?.source === 'character' && matched.charId != null) {
      // 路径匹配时 matched.path === 历史路径；按标签匹配时优先用角色当前图，避免旧路径失效
      const bindPath = matched.path || path
      const stripKey = characterStripKey(matched.charId, bindPath)
      usedKeys.add(matched.key)
      usedKeys.add(stripKey)
      appendCharacterImageRef(binding, matched.charId, bindPath)
      stripOrderKeys.push(stripKey)
    } else if (matched?.source === 'scene' && matched.sceneId != null) {
      usedKeys.add(matched.key)
      const scene = (scenes || []).find(entry => entry.id === matched.sceneId)
      if (!(getBindingSceneIds(binding).includes(matched.sceneId))) {
        bindScene(binding, matched.sceneId, scenes)
      }
      const onEntity = entityPathsIncludePath(collectStudioEntityImagePaths(scene, 'scene'), path)
      const bindPath = onEntity
        ? path
        : (normalizeStripPath(resolveSceneImageUrl(scene, 'hero') || resolveSceneStripPath(scene)) || path)
      setSceneImageRef(binding, matched.sceneId, bindPath, scene)
      stripOrderKeys.push(`scene:${matched.sceneId}`)
    } else if (matched?.source === 'prop' && matched.propId != null) {
      usedKeys.add(matched.key)
      bindProp(binding, matched.propId, props)
      const prop = (props || []).find(entry => entry.id === matched.propId)
      const onEntity = entityPathsIncludePath(collectStudioEntityImagePaths(prop, 'prop'), path)
      const bindPath = onEntity
        ? path
        : (normalizeStripPath(resolvePropImageUrl(prop, {})) || path)
      setPropImageRef(binding, matched.propId, bindPath, prop)
      stripOrderKeys.push(`prop:${matched.propId}`)
    } else if (typeof addUpload === 'function') {
      addUpload(path, { label: label || null, preview: ref.display_url || null })
      stripOrderKeys.push(`upload:${normalizeStripPath(path)}`)
    }
  }

  if (stripOrderKeys.length) {
    binding.ref_strip_order = stripOrderKeys
  }

  if (callbacks?.restoreVoices !== false && binding) {
    const voices = restoreVoiceRefsFromVideoItem(item, callbacks?.voiceAssets, callbacks?.maxVoiceRefs)
    if (voices.length) binding.voice_refs = voices
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
