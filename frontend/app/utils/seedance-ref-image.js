/**
 * Seedance 参考图尺寸前端校验（与官方规范 / 后端一致：宽高均需 300–6000）
 */
import { normalizeMediaPath } from './media-url.js'

export const SEEDANCE_REF_IMAGE_MIN_PX = 300
export const SEEDANCE_REF_IMAGE_MAX_PX = 6000

function probeUrlForPath(raw) {
  const path = normalizeMediaPath(raw)
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('static/')) return `/${path}`
  return path.startsWith('/') ? path : `/${path}`
}

export function probeImageDimensions(src) {
  const url = String(src || '').trim()
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const width = Number(img.naturalWidth) || 0
      const height = Number(img.naturalHeight) || 0
      resolve(width > 0 && height > 0 ? { width, height } : null)
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function formatDimIssue(index, url, width, height) {
  const name = String(url || '').split('/').pop() || url
  const badW = width < SEEDANCE_REF_IMAGE_MIN_PX || width > SEEDANCE_REF_IMAGE_MAX_PX
  const badH = height < SEEDANCE_REF_IMAGE_MIN_PX || height > SEEDANCE_REF_IMAGE_MAX_PX
  const which = badW && badH ? '宽高' : badW ? '宽度' : '高度'
  return (
    `参考图${index}（${name}）${which}不符合要求：需在 ${SEEDANCE_REF_IMAGE_MIN_PX}–${SEEDANCE_REF_IMAGE_MAX_PX} 像素内，`
    + `当前 ${width}×${height}`
  )
}

/**
 * @param {Array<{ type?: string, url?: string }|string>} images
 * @returns {Promise<string|null>} 错误文案；通过则 null
 */
export async function validateSeedanceReferenceImageDimensions(images) {
  const list = []
  const seen = new Set()
  for (const item of images || []) {
    const url = typeof item === 'string'
      ? item
      : (item?.type && String(item.type).toLowerCase() !== 'image'
        ? ''
        : (item?.url || item?.image_url || ''))
    const path = normalizeMediaPath(url)
    if (!path || seen.has(path)) continue
    seen.add(path)
    list.push(path)
  }

  for (let i = 0; i < list.length; i++) {
    const path = list[i]
    const dims = await probeImageDimensions(probeUrlForPath(path))
    if (!dims) continue
    const { width, height } = dims
    if (
      width < SEEDANCE_REF_IMAGE_MIN_PX
      || height < SEEDANCE_REF_IMAGE_MIN_PX
      || width > SEEDANCE_REF_IMAGE_MAX_PX
      || height > SEEDANCE_REF_IMAGE_MAX_PX
    ) {
      return formatDimIssue(i + 1, path, width, height)
    }
  }
  return null
}
