import { toast } from 'vue-sonner'

const BATCH_TOAST_ID = 'ref-video-upload-batch'

export function isVideoUploadFile(file) {
  if (!file) return false
  const mime = String(file.type || '').toLowerCase()
  if (mime.startsWith('video/')) return true
  const name = String(file.name || '').toLowerCase()
  return ['.mp4', '.mov', '.webm', '.m4v', '.mkv'].some(ext => name.endsWith(ext))
}

export function isImageUploadFile(file) {
  if (!file) return false
  const mime = String(file.type || '').toLowerCase()
  if (mime.startsWith('image/')) return true
  const name = String(file.name || '').toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].some(ext => name.endsWith(ext))
}

/**
 * 上传参考视频：toast 进度 + 不阻塞调用方
 */
export function startReferenceVideoUpload({
  files,
  maxRemain,
  pendingUploadsRef,
  uploadOne,
  onSuccess,
  feedback = {},
}) {
  const list = Array.from(files || []).filter(isVideoUploadFile)
  if (!list.length) {
    if (Array.from(files || []).length) {
      toast.warning(feedback.invalidMessage || '请选择 MP4 / MOV / WebM 视频')
    }
    return
  }

  if (maxRemain <= 0) {
    toast.warning(feedback.limitMessage || '已达到参考视频数量上限')
    return
  }

  const batch = list.slice(0, maxRemain)
  if (batch.length < list.length) {
    toast.warning(`最多还可上传 ${maxRemain} 个参考视频，已忽略多余文件`)
  }

  if (pendingUploadsRef) {
    pendingUploadsRef.value += batch.length
  }

  toast.loading(
    batch.length > 1 ? `正在上传 ${batch.length} 个参考视频…` : '正在上传参考视频…',
    { id: BATCH_TOAST_ID, duration: Infinity },
  )

  void runBatchUpload({ batch, pendingUploadsRef, uploadOne, onSuccess, feedback })
}

async function runBatchUpload({ batch, pendingUploadsRef, uploadOne, onSuccess, feedback }) {
  let ok = 0
  let fail = 0
  let lastError = '视频上传失败'

  for (const file of batch) {
    try {
      const res = await uploadOne(file)
      await onSuccess({ file, res })
      ok += 1
    } catch (err) {
      fail += 1
      lastError = err?.message || '视频上传失败'
    } finally {
      if (pendingUploadsRef) {
        pendingUploadsRef.value = Math.max(0, pendingUploadsRef.value - 1)
      }
    }
  }

  if (fail && ok) {
    toast.warning(`上传完成：${ok} 成功，${fail} 失败`, { id: BATCH_TOAST_ID })
  } else if (fail) {
    toast.error(fail > 1 ? `${fail} 个参考视频上传失败` : lastError, { id: BATCH_TOAST_ID })
  } else if (ok) {
    const msg = feedback.successMessage
      || (ok > 1 ? `已添加 ${ok} 个参考视频` : '参考视频已上传')
    toast.success(msg, { id: BATCH_TOAST_ID })
  } else {
    toast.dismiss(BATCH_TOAST_ID)
  }
}
