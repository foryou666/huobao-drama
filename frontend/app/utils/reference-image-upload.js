import { toast } from 'vue-sonner'

const BATCH_TOAST_ID = 'ref-image-upload-batch'

export function createPendingUploadEntry(file) {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    preview: URL.createObjectURL(file),
  }
}

export function disposePendingUploadEntry(entry) {
  if (entry?.preview?.startsWith('blob:')) {
    URL.revokeObjectURL(entry.preview)
  }
}

export function removePendingUpload(pendingUploadsRef, id) {
  const list = pendingUploadsRef.value
  const idx = list.findIndex((item) => item.id === id)
  if (idx < 0) return
  disposePendingUploadEntry(list[idx])
  list.splice(idx, 1)
}

/**
 * 批量上传参考图：立即显示占位 + toast，后台执行，不阻塞调用方
 */
export function startReferenceImageUpload({
  files,
  maxRemain,
  pendingUploadsRef,
  uploadOne,
  onSuccess,
  feedback = {},
}) {
  const list = Array.from(files || []).filter((f) => f && String(f.type || '').startsWith('image/'))
  if (!list.length) return

  const remain = maxRemain
  if (remain <= 0) {
    toast.warning(feedback.limitMessage || '已达到参考图数量上限')
    return
  }

  const batch = list.slice(0, remain)
  const pendingEntries = batch.map((file) => {
    const entry = createPendingUploadEntry(file)
    pendingUploadsRef.value.push(entry)
    return { entry, file }
  })

  toast.loading(
    batch.length > 1 ? `正在上传 ${batch.length} 张参考图…` : '正在上传参考图…',
    { id: BATCH_TOAST_ID, duration: Infinity },
  )

  void runBatchUpload({
    pendingEntries,
    pendingUploadsRef,
    uploadOne,
    onSuccess,
    feedback,
  })
}

async function runBatchUpload({
  pendingEntries,
  pendingUploadsRef,
  uploadOne,
  onSuccess,
  feedback,
}) {
  let ok = 0
  let fail = 0
  let lastError = '上传失败'

  for (const { entry, file } of pendingEntries) {
    try {
      const res = await uploadOne(file)
      await onSuccess({ file, res, entry })
      ok += 1
    } catch (err) {
      fail += 1
      lastError = err?.message || '上传失败'
    } finally {
      removePendingUpload(pendingUploadsRef, entry.id)
    }
  }

  if (fail && ok) {
    toast.warning(`上传完成：${ok} 成功，${fail} 失败`, { id: BATCH_TOAST_ID })
  } else if (fail) {
    toast.error(fail > 1 ? `${fail} 张参考图上传失败` : lastError, { id: BATCH_TOAST_ID })
  } else if (ok) {
    const msg = feedback.successMessage
      || (ok > 1 ? `已添加 ${ok} 张参考图` : '参考图已添加')
    toast.success(msg, { id: BATCH_TOAST_ID })
  } else {
    toast.dismiss(BATCH_TOAST_ID)
  }
}
