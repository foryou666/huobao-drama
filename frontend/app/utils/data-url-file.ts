export function dataUrlToFile(dataUrl: string, fileName = 'capture.png'): File {
  const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!match) throw new Error('无效的图片数据')
  const mime = match[1] || 'image/png'
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''
  const bytes = isBase64
    ? Uint8Array.from(atob(payload), c => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return new File([bytes], fileName, { type: mime })
}
