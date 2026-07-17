/** VSR 字幕区域：视频像素坐标 [ymin, ymax, xmin, xmax] */

export function getVideoContentRect(video) {
  const vw = video.videoWidth || 0
  const vh = video.videoHeight || 0
  const elW = video.clientWidth || 0
  const elH = video.clientHeight || 0
  if (!vw || !vh || !elW || !elH) {
    return { displayW: 0, displayH: 0, offsetX: 0, offsetY: 0, vw, vh }
  }

  const videoAspect = vw / vh
  const elAspect = elW / elH
  if (videoAspect > elAspect) {
    const displayW = elW
    const displayH = elW / videoAspect
    return {
      displayW,
      displayH,
      offsetX: 0,
      offsetY: (elH - displayH) / 2,
      vw,
      vh,
    }
  }

  const displayH = elH
  const displayW = elH * videoAspect
  return {
    displayW,
    displayH,
    offsetX: (elW - displayW) / 2,
    offsetY: 0,
    vw,
    vh,
  }
}

export function displayRectToVsrArea(rect, contentRect) {
  const { displayW, displayH, offsetX, offsetY, vw, vh } = contentRect
  if (!displayW || !displayH || !vw || !vh) return null

  const x1 = Math.max(0, rect.x - offsetX)
  const y1 = Math.max(0, rect.y - offsetY)
  const x2 = Math.min(displayW, rect.x + rect.w - offsetX)
  const y2 = Math.min(displayH, rect.y + rect.h - offsetY)
  if (x2 <= x1 || y2 <= y1) return null

  const xmin = Math.round((x1 / displayW) * vw)
  const xmax = Math.round((x2 / displayW) * vw)
  const ymin = Math.round((y1 / displayH) * vh)
  const ymax = Math.round((y2 / displayH) * vh)
  return [ymin, ymax, xmin, xmax]
}

export function vsrAreaToDisplayRect(area, contentRect) {
  const [ymin, ymax, xmin, xmax] = area
  const { displayW, displayH, offsetX, offsetY, vw, vh } = contentRect
  if (!displayW || !displayH || !vw || !vh) return null

  return {
    x: offsetX + (xmin / vw) * displayW,
    y: offsetY + (ymin / vh) * displayH,
    w: ((xmax - xmin) / vw) * displayW,
    h: ((ymax - ymin) / vh) * displayH,
  }
}

export function formatVsrArea(area) {
  if (!Array.isArray(area) || area.length !== 4) return '—'
  const [ymin, ymax, xmin, xmax] = area
  return `y ${ymin}–${ymax}, x ${xmin}–${xmax}`
}

export function buildBottomSubtitlePreset(videoWidth, videoHeight, opts = {}) {
  const marginRatio = opts.marginRatio ?? 0.05
  const heightRatio = opts.heightRatio ?? 0.14
  const margin = Math.round(videoWidth * marginRatio)
  const h = Math.max(8, Math.round(videoHeight * heightRatio))
  return [videoHeight - h, videoHeight, margin, videoWidth - margin]
}
