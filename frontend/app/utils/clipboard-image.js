const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i

function isImageFile(file) {
  if (!file) return false
  if (String(file.type || '').startsWith('image/')) return true
  return IMAGE_FILE_RE.test(String(file.name || ''))
}

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

/** 从拖放或粘贴的 DataTransfer 中提取图片文件 */
export function extractImageFilesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return []
  const fromFiles = Array.from(dataTransfer.files || []).filter(isImageFile)
  if (fromFiles.length) return fromFiles
  return extractClipboardImageFiles(dataTransfer)
}

export function isFileDragEvent(event) {
  return Array.from(event?.dataTransfer?.types || []).includes('Files')
}

/** 粘贴事件：有图片则上传并阻止默认行为，纯文本粘贴不受影响 */
export function handlePasteImageUpload(event, uploadFiles) {
  const files = extractClipboardImageFiles(event?.clipboardData)
  if (!files.length) return false
  event.preventDefault()
  uploadFiles(files, { source: 'paste' })
  return true
}

/** 拖放事件：有图片则上传并阻止默认行为 */
export function handleDropImageUpload(event, uploadFiles) {
  const files = extractImageFilesFromDataTransfer(event?.dataTransfer)
  if (!files.length) return false
  event.preventDefault()
  uploadFiles(files, { source: 'drop' })
  return true
}
