export const CHENGMENT_PROMPT_MAX_LENGTH = 2000

/** 按字符计（中文 1 字 = 1 字符），非字节数 */

export function formatVideoPromptOverLimitMessage(sendLength, limit = CHENGMENT_PROMPT_MAX_LENGTH) {
  const over = Math.max(0, sendLength - limit)
  return `视频提示词约 ${sendLength} 字符，超过上限 ${limit} 字符（含 @图片N 前缀），超出 ${over} 字符。请精简后再生成，否则部分内容不会发送。`
}

export function stripChengmengInlineTags(prompt) {
  return String(prompt || '').trim()
    .replace(/@图片\s*(\d+)/gi, '图片$1')
    .replace(/@素材\s*(\d+)/gi, '素材$1')
    .replace(/@音频\s*(\d+)/gi, '音频$1')
}

export function normalizeChengmengAudioLabels(prompt) {
  return String(prompt || '').replace(/音色\s*(\d+)/gi, '音频$1')
}

export function buildChengmengTagPrefix(imageCount, videoCount = 0, audioCount = 0) {
  const imageTags = Array.from({ length: Math.max(0, imageCount) }, (_, i) => `@图片${i + 1}`)
  const videoTags = Array.from({ length: Math.max(0, videoCount) }, (_, i) => `@素材${i + 1}`)
  const audioTags = Array.from({ length: Math.max(0, audioCount) }, (_, i) => `@音频${i + 1}`)
  const tags = [...imageTags, ...videoTags, ...audioTags]
  return tags.length ? `${tags.join(' ')} ` : ''
}

export function estimateChengmengPromptLength(prompt, imageCount, videoCount = 0, audioCount = 0) {
  return buildChengmengTagPrefix(imageCount, videoCount, audioCount).length
    + stripChengmengInlineTags(normalizeChengmengAudioLabels(prompt)).length
}

export function countChengmengReferenceImages(contentRefs = []) {
  return contentRefs.filter(item =>
    item?.type === 'image' && item?.role !== 'first_frame' && item?.role !== 'last_frame',
  ).length
}

export function countChengmengReferenceAudios(contentRefs = []) {
  return contentRefs.filter(item => item?.type === 'audio').length
}
