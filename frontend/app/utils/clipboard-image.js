/** 从剪贴板提取图片文件（Ctrl+V 粘贴） */
export function extractClipboardImageFiles(dataTransfer) {
  if (!dataTransfer?.items?.length) return []
  const files = []
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file') continue
    if (!String(item.type || '').startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

/** 粘贴事件：有图片则上传并阻止默认行为，纯文本粘贴不受影响 */
export function handlePasteImageUpload(event, uploadFiles) {
  const files = extractClipboardImageFiles(event?.clipboardData)
  if (!files.length) return false
  event.preventDefault()
  uploadFiles(files, { source: 'paste' })
  return true
}
