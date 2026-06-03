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
    scene_id: null,
    reference_images: [],
  }
}

export function bindingToStoryboard(binding) {
  const refs = Array.isArray(binding.reference_images) ? binding.reference_images : []
  return {
    id: 'studio',
    character_ids: [...(binding.character_ids || [])],
    characterIds: [...(binding.character_ids || [])],
    character_image_refs: { ...(binding.character_image_refs || {}) },
    characterImageRefs: { ...(binding.character_image_refs || {}) },
    scene_id: binding.scene_id || null,
    sceneId: binding.scene_id || null,
    reference_images: JSON.stringify(refs),
    referenceImages: JSON.stringify(refs),
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
    .filter(item => item.type === 'image' && item.source !== 'first_frame' && item.source !== 'last_frame')
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

export function buildMentionOptions(chars, scenes, uploads, query) {
  const q = String(query || '').trim().toLowerCase()
  const items = []

  for (const char of chars || []) {
    const label = char.name || `角色#${char.id}`
    if (q && !label.toLowerCase().includes(q)) continue
    items.push({
      type: 'character',
      id: char.id,
      label,
      sub: '角色',
      thumb: resolveCharacterImageUrl(char, {}),
    })
  }

  for (const scene of scenes || []) {
    const label = scene.location || `场景#${scene.id}`
    if (q && !label.toLowerCase().includes(q) && !(scene.time || '').toLowerCase().includes(q)) continue
    items.push({
      type: 'scene',
      id: scene.id,
      label,
      sub: scene.time ? `场景 · ${scene.time}` : '场景',
      thumb: scene.image_url || scene.imageUrl || scene.local_path || scene.localPath || '',
    })
  }

  for (const upload of uploads || []) {
    const label = upload.label || `参考图${upload.index || ''}`
    if (q && !label.toLowerCase().includes(q)) continue
    items.push({
      type: 'upload',
      path: upload.path,
      label,
      sub: '上传参考图',
      thumb: upload.preview || upload.path,
    })
  }

  return items.slice(0, 12)
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
  binding.scene_id = sceneId || null
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
