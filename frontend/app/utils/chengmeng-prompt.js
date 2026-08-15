export const CHENGMENT_PROMPT_MAX_LENGTH = 2000

/** 按字符计（中文 1 字 = 1 字符），非字节数。2000 仅作建议值，橙盟未规定硬上限。 */
export function formatVideoPromptOverLimitMessage(sendLength, limit = CHENGMENT_PROMPT_MAX_LENGTH) {
  const over = Math.max(0, sendLength - limit)
  return `视频提示词约 ${sendLength} 字符（含 @图片N 引用），已超过建议 ${limit} 字符（超出 ${over}）。上游未规定硬上限，仍可提交。`
}

/** 音色 → 音频（保留已有 @） */
export function normalizeChengmengAudioLabels(prompt) {
  return String(prompt || '')
    .replace(/@音色\s*(\d+)/gi, '@音频$1')
    .replace(/(?<!@)音色\s*(\d+)/gi, '音频$1')
}

/** 与后端一致：保留 @，并把「图片1是…」补成 @图片1 */
export function ensureChengmengAtMentions(prompt) {
  return normalizeChengmengAudioLabels(prompt)
    .replace(/@视频\s*(\d+)/gi, '@素材$1')
    .replace(/(?<!@)图片\s*(\d+)/gi, '@图片$1')
    .replace(/(?<!@)素材\s*(\d+)/gi, '@素材$1')
    .replace(/(?<!@)视频\s*(\d+)/gi, '@素材$1')
    .replace(/(?<!@)音频\s*(\d+)/gi, '@音频$1')
}

export function buildChengmengTagPrefix(imageCount, videoCount = 0, audioCount = 0) {
  const imageTags = Array.from({ length: Math.max(0, imageCount) }, (_, i) => `@图片${i + 1}`)
  const videoTags = Array.from({ length: Math.max(0, videoCount) }, (_, i) => `@素材${i + 1}`)
  const audioTags = Array.from({ length: Math.max(0, audioCount) }, (_, i) => `@音频${i + 1}`)
  const tags = [...imageTags, ...videoTags, ...audioTags]
  return tags.length ? `${tags.join(' ')} ` : ''
}

export function estimateChengmengPromptLength(prompt, imageCount, videoCount = 0, audioCount = 0) {
  const text = ensureChengmengAtMentions(String(prompt || '').trim())
  const hasMentions = /@(?:图片|素材|音频)\s*\d/i.test(text)
  const prefixLen = hasMentions ? 0 : buildChengmengTagPrefix(imageCount, videoCount, audioCount).length
  return prefixLen + text.length
}

export function countChengmengReferenceImages(contentRefs = []) {
  return contentRefs.filter(item =>
    item?.type === 'image' && item?.role !== 'first_frame' && item?.role !== 'last_frame',
  ).length
}

export function countChengmengReferenceAudios(contentRefs = []) {
  return contentRefs.filter(item => item?.type === 'audio').length
}
