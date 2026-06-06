import {
  parsePromptImageLabels,
  buildPromptOrderedDisplayItems,
  buildOrderedVideoContentRefs,
  validatePromptImageRefs,
  formatPromptImageRefIssues,
} from './video-ref-order.js'
import { resolveCharacterImageUrl } from './character-image-variants.js'

export { validatePromptImageRefs, formatPromptImageRefIssues, parsePromptImageLabels }

export function createStudioBindingState() {
  return {
    character_ids: [],
    character_image_refs: {},
    scene_ids: [],
    scene_id: null,
    reference_images: [],
    voice_refs: [],
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
    reference_images: JSON.stringify(refs),
    referenceImages: JSON.stringify(refs),
    voice_refs: [...(binding.voice_refs || [])],
    voiceRefs: [...(binding.voice_refs || [])],
  }
}

export function createStudioHelpers(binding) {
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
    resolveSceneImage: (scene) => {
      const url = scene?.image_url || scene?.imageUrl || scene?.local_path || scene?.localPath
      return url ? String(url).replace(/^\/+/, '') : null
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

export function replaceMentionWithImageLabel(prompt, mentionStart, cursorEnd, index, label) {
  return insertPromptImageLabel(prompt, mentionStart, cursorEnd, index, label)
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

export function buildStudioDisplayItems(binding, prompt, chars, scenes) {
  const sb = bindingToStoryboard(binding)
  const helpers = createStudioHelpers(binding)
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

/** 参考图栏：每个绑定角色/场景/上传图只显示一次，不随 @ 重复扩增 */
export function buildStudioRefStripItems(binding, chars, scenes, uploadedRefs, previewUrl) {
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
    const path = resolveSceneStripPath(scene)
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

  for (const [uploadIndex, img] of (uploadedRefs || []).entries()) {
    const path = normalizeStripPath(img?.path)
    if (!path || seenPaths.has(path)) continue
    seenPaths.add(path)
    items.push({
      key: `upload:${path}:${uploadIndex}`,
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

  return items
}

export function buildStudioContentRefs(binding, prompt, chars, scenes) {
  const sb = bindingToStoryboard(binding)
  const helpers = createStudioHelpers(binding)
  let finalPrompt = String(prompt || '').trim()
  const labels = parsePromptImageLabels(finalPrompt)
  if (!labels.length) {
    const header = buildAutoPromptHeader(sb, finalPrompt, chars, scenes, helpers)
    if (header) finalPrompt = `${header}${finalPrompt}`
  }
  const contentRefs = buildOrderedVideoContentRefs(sb, finalPrompt, chars, scenes, helpers)
  return { prompt: finalPrompt, contentRefs }
}

export function validateStudioPrompt(prompt, binding, chars, scenes) {
  const sb = bindingToStoryboard(binding)
  const helpers = createStudioHelpers(binding)
  return validatePromptImageRefs(prompt, sb, chars, scenes, helpers)
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
      sub: source === 'character' ? '角色' : source === 'scene' ? '场景' : '参考图',
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

/** @ 菜单仅列出参考图栏中已出现的图片（角色/场景/上传图） */
export function buildMentionOptions(stripItems, query) {
  const q = String(query || '').trim().toLowerCase()
  const items = []

  for (const item of stripItems || []) {
    const mention = stripItemToMention(item)
    if (!mention) continue
    if (!matchesMentionQuery(q, mention.label, mention.sub)) continue
    items.push(mention)
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

export function bindScene(binding, sceneId) {
  if (!sceneId) {
    binding.scene_ids = []
    binding.scene_id = null
    return
  }
  const ids = new Set(getBindingSceneIds(binding))
  ids.add(Number(sceneId))
  binding.scene_ids = [...ids]
  binding.scene_id = binding.scene_ids[0] ?? null
}

export function unbindScene(binding, sceneId) {
  const parsed = Number(sceneId)
  binding.scene_ids = getBindingSceneIds(binding).filter(id => id !== parsed)
  binding.scene_id = binding.scene_ids[0] ?? null
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
    const byIndex = new RegExp(`[,，]?\\s*@?图片\\s*${index}\\s*是[^，,@。\\n]+`, 'g')
    text = text.replace(byIndex, '')
  }
  if (labelHint) {
    const escaped = String(labelHint).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const byLabel = new RegExp(`[,，]?\\s*@?图片\\s*\\d+\\s*是\\s*${escaped}`, 'g')
    text = text.replace(byLabel, '')
  }
  return cleanupPromptCommas(text)
}

export function canUnlinkStudioRef(ref) {
  if (!ref || ref.missing) return false
  return ['character', 'scene', 'reference', 'prompt'].includes(ref.source)
}
