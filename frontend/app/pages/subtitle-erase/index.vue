<template>
  <div class="erase-page">
    <header class="erase-topbar">
      <div class="erase-balance">
        <span class="dim">账户剩余积分</span>
        <strong class="mono">{{ balance.toLocaleString() }}</strong>
      </div>
      <div class="erase-consume">
        <span class="dim">本次消耗</span>
        <strong class="mono">{{ estimatedCost }} 积分</strong>
      </div>
    </header>

    <section class="erase-panel card">
      <div class="erase-panel-head">
        <div>
          <h1>去字幕</h1>
          <p class="dim">RunningHub 视频去字幕 LTX2.3；单段建议不超过 {{ maxDurationSec }} 秒</p>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" @click="showTips = !showTips">上传须知</button>
      </div>

      <p v-if="showTips" class="erase-tips dim">
        仅支持 MP4；单次最多 {{ maxFiles }} 个；单个不超过 {{ maxDurationSec }} 秒 / 500MB。
        计费约 {{ creditsPerSecond }} 积分/秒（按源视频时长）。成品请及时下载。
      </p>
      <p v-if="!metaReady" class="erase-error">{{ publicMetaDetail }}</p>

      <div class="erase-mode-row">
        <span class="dim">处理模式</span>
        <div class="erase-mode-toggle">
          <button
            type="button"
            class="erase-mode-btn active"
            disabled
          >
            去字幕（LTX2.3）
          </button>
        </div>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        accept="video/mp4,.mp4"
        multiple
        class="erase-file-input"
        @change="onFilePick"
      >

      <div
        class="erase-dropzone"
        :class="{ 'is-dragover': isDragOver, 'has-files': pickedItems.length }"
        @click="openFilePicker"
        @dragenter.prevent="isDragOver = true"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="onDrop"
      >
        <template v-if="!pickedItems.length">
          <div class="erase-drop-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke-linecap="round" />
            </svg>
          </div>
          <p class="erase-drop-label">拖拽视频到这里，或点击选择</p>
          <p class="dim erase-drop-hint">支持 MP4，单次最多 {{ maxFiles }} 个，单个不超过 {{ maxDurationSec }} 秒 / 500MB</p>
          <button type="button" class="btn btn-primary" @click.stop="openFilePicker">选择文件</button>
        </template>
        <template v-else>
          <ul class="erase-file-list" @click.stop>
            <li v-for="(item, idx) in pickedItems" :key="item.id" class="erase-file-card">
              <div class="erase-file-preview">
                <video
                  :src="item.url"
                  controls
                  playsinline
                  preload="metadata"
                  @loadedmetadata="onLocalMeta(item, $event)"
                />
              </div>
              <div class="erase-file-meta">
                <span class="erase-file-name" :title="item.file.name">{{ item.file.name }}</span>
                <span class="mono dim">
                  {{ formatBytes(item.file.size) }}
                  <template v-if="item.durationSec"> · {{ formatDuration(item.durationSec) }}</template>
                </span>
              </div>
              <button type="button" class="btn btn-sm btn-ghost" :disabled="submitting" @click="removeFile(idx)">移除</button>
            </li>
          </ul>
          <div class="erase-file-actions" @click.stop>
            <button type="button" class="btn btn-sm" :disabled="submitting || pickedItems.length >= maxFiles" @click="openFilePicker">
              继续添加
            </button>
            <button type="button" class="btn btn-sm btn-ghost" :disabled="submitting" @click="clearFiles">清空</button>
          </div>
        </template>
      </div>

      <button
        type="button"
        class="btn btn-primary erase-submit"
        :disabled="!canSubmit"
        @click="submitJobs"
      >
        {{ submitting ? `提交中 ${uploadProgress}%…` : submitLabel }}
      </button>
      <p v-if="submitError" class="erase-error">{{ submitError }}</p>
    </section>

    <section class="erase-panel card">
      <div class="erase-panel-head">
        <div>
          <h1>任务管理</h1>
          <p class="dim">共 {{ stats.total }} 个任务</p>
        </div>
      </div>

      <div class="erase-stats">
        <div class="erase-stat">
          <span class="erase-stat-label">处理中</span>
          <strong>{{ stats.processing }}</strong>
        </div>
        <div class="erase-stat is-ok">
          <span class="erase-stat-label">已完成</span>
          <strong>{{ stats.completed }}</strong>
        </div>
        <div class="erase-stat is-fail">
          <span class="erase-stat-label">失败</span>
          <strong>{{ stats.failed }}</strong>
        </div>
      </div>

      <div class="erase-filters">
        <select v-model="filterStatus" class="composer-select" @change="reloadList">
          <option value="all">全部状态</option>
          <option value="processing">处理中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
        </select>
        <select v-model="filterRange" class="composer-select" @change="reloadList">
          <option value="week">最近一周</option>
          <option value="month">最近一月</option>
          <option value="all">全部时间</option>
        </select>
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reloadList">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>

      <div v-if="loading && !items.length" class="dim" style="padding: 24px">加载中…</div>
      <div v-else-if="!items.length" class="studio-empty">还没有去字幕任务</div>
      <div v-else class="erase-table-wrap">
        <table class="user-table erase-table">
          <thead>
            <tr>
              <th>任务ID</th>
              <th>文件名</th>
              <th>模式</th>
              <th>时长</th>
              <th>提交时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td class="mono">{{ item.remote_task_id || item.id }}</td>
              <td>
                <div>{{ item.title }}</div>
                <div class="dim mono" style="font-size: 12px">{{ formatTime(item.created_at) }}</div>
              </td>
              <td>{{ modeLabel(item.mode) }}</td>
              <td class="mono">{{ formatDuration(item.duration_sec) }}</td>
              <td class="mono dim">{{ formatTime(item.created_at) }}</td>
              <td>
                <span class="tag" :class="statusTagClass(item.status)">{{ statusLabel(item.status) }}</span>
                <div v-if="item.status === 'queued'" class="dim" style="font-size: 11px; margin-top: 4px">
                  排队第 {{ item.queue_position || '—' }} 位
                </div>
                <div v-else-if="isActive(item)" class="dim mono" style="font-size: 11px; margin-top: 4px">
                  {{ item.progress || 0 }}%
                </div>
                <div v-if="item.error_msg" class="erase-error" style="font-size: 12px; margin-top: 4px">
                  {{ item.error_msg }}
                </div>
              </td>
              <td>
                <button
                  v-if="item.output_video_url"
                  type="button"
                  class="btn btn-sm"
                  @click="openPreview(item)"
                >
                  预览
                </button>
                <button
                  v-if="item.output_video_url"
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="downloadingId === item.id"
                  @click="downloadItem(item)"
                >
                  {{ downloadingId === item.id ? '…' : '下载' }}
                </button>
                <span v-if="!item.output_video_url && !isActive(item)" class="dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="preview" class="erase-modal-overlay" @click.self="closePreview">
      <div class="erase-preview-modal card">
        <div class="erase-preview-head">
          <h3 :title="preview.title">{{ preview.title }}</h3>
          <button type="button" class="erase-icon-btn" aria-label="关闭" @click="closePreview">×</button>
        </div>
        <div class="erase-preview-media">
          <video :src="videoPlayUrl(preview.output_video_url)" controls playsinline autoplay />
        </div>
        <div class="erase-preview-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="downloadingId === preview.id"
            @click="downloadItem(preview)"
          >
            {{ downloadingId === preview.id ? '下载中…' : '下载输出视频' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { subtitleEraseAPI } from '~/composables/useApi'
import { mediaDisplayUrl, normalizeMediaPath, prefetchMediaUrls } from '~/utils/media-url.js'
import { downloadMediaFile } from '~/utils/download-media.js'
import { toast } from 'vue-sonner'

function videoPlayUrl(raw) {
  const resolved = mediaDisplayUrl(raw)
  if (resolved) return resolved
  const path = normalizeMediaPath(raw)
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('static/')) return `/${path}`
  return path.startsWith('/') ? path : `/${path}`
}

const showTips = ref(false)
const balance = ref(0)
const creditsPerSecond = ref(4)
const maxFiles = ref(10)
const maxDurationSec = ref(60)
const metaReady = ref(false)
const metaDetail = ref('')
const mode = ref('subtitle')

const submitLabel = computed(() => '提交去字幕')

function modeLabel(_value) {
  return '去字幕'
}

const publicMetaDetail = computed(() => {
  const raw = String(metaDetail.value || '').trim()
  if (!raw) return '服务暂未就绪，请联系管理员'
  if (/runninghub|webapp|openapi/i.test(raw)) return '服务暂未就绪，请联系管理员'
  return raw
})

const fileInputRef = ref(null)
const pickedItems = ref([])
const isDragOver = ref(false)
const submitting = ref(false)
const uploadProgress = ref(0)
const submitError = ref('')

const loading = ref(false)
const items = ref([])
const stats = ref({ processing: 0, completed: 0, failed: 0, total: 0 })
const filterStatus = ref('all')
const filterRange = ref('week')
const downloadingId = ref(null)
const preview = ref(null)
let pollTimer = null

const estimatedCost = computed(() => {
  if (!pickedItems.value.length) return 0
  const rate = Math.max(1, Number(creditsPerSecond.value) || 4)
  return pickedItems.value.reduce((sum, item) => {
    const sec = Math.max(1, Math.ceil(Number(item.durationSec) || 1))
    return sum + sec * rate
  }, 0)
})

const canSubmit = computed(() =>
  metaReady.value && pickedItems.value.length > 0 && !submitting.value,
)

function formatBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${Math.round(n)}秒`
}

function formatTime(raw) {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function isActive(item) {
  return ['queued', 'uploading', 'processing'].includes(item?.status)
}

function statusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'uploading') return '上传中'
  if (status === 'queued') return '排队中'
  if (status === 'processing') return '处理中'
  return status || '未知'
}

function statusTagClass(status) {
  if (status === 'completed') return 'tag-success'
  if (status === 'failed') return 'tag-danger'
  if (isActive({ status })) return 'tag-accent'
  return ''
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function revokePreview(item) {
  if (item?.url) {
    try { URL.revokeObjectURL(item.url) } catch { /* ignore */ }
  }
}

function addFiles(list) {
  const incoming = Array.from(list || [])
  const next = [...pickedItems.value]
  for (const file of incoming) {
    if (!/\.mp4$/i.test(file.name) && file.type && !file.type.includes('mp4')) {
      toast.warning(`跳过非 MP4：${file.name}`)
      continue
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.warning(`超过 500MB：${file.name}`)
      continue
    }
    if (next.length >= maxFiles.value) {
      toast.warning(`单次最多 ${maxFiles.value} 个文件`)
      break
    }
    next.push({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      url: URL.createObjectURL(file),
      durationSec: null,
    })
  }
  pickedItems.value = next
}

function onFilePick(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

function onDrop(e) {
  isDragOver.value = false
  addFiles(e.dataTransfer?.files)
}

function onLocalMeta(item, e) {
  const d = Number(e?.target?.duration)
  if (!item || !Number.isFinite(d) || d <= 0) return
  item.durationSec = Math.round(d * 10) / 10
}

function removeFile(idx) {
  const removed = pickedItems.value[idx]
  revokePreview(removed)
  pickedItems.value = pickedItems.value.filter((_, i) => i !== idx)
}

function clearFiles() {
  for (const item of pickedItems.value) revokePreview(item)
  pickedItems.value = []
}

async function loadMeta() {
  try {
    const res = await subtitleEraseAPI.meta()
    metaReady.value = !!res?.ready
    metaDetail.value = res?.detail || ''
    creditsPerSecond.value = Number(res?.credits_per_second) || 4
    maxFiles.value = Number(res?.max_files) || 10
    maxDurationSec.value = Number(res?.max_duration_sec) || 60
  } catch {
    metaReady.value = false
    metaDetail.value = '加载配置失败'
  }
}

async function loadBalance() {
  try {
    const res = await subtitleEraseAPI.balance()
    balance.value = Number(res?.balance) || 0
    if (res?.credits_per_second) creditsPerSecond.value = Number(res.credits_per_second) || creditsPerSecond.value
  } catch { /* ignore */ }
}

async function reloadList() {
  loading.value = true
  try {
    const res = await subtitleEraseAPI.list({
      status: filterStatus.value,
      range: filterRange.value,
      limit: 50,
    })
    items.value = Array.isArray(res?.items) ? res.items : []
    stats.value = res?.stats || { processing: 0, completed: 0, failed: 0, total: 0 }
    const urls = items.value
      .flatMap((it) => [it.output_video_url, it.source_video_url])
      .filter(Boolean)
    prefetchMediaUrls(urls)
  } catch (e) {
    toast.error(e?.message || '加载任务失败')
  } finally {
    loading.value = false
  }
}

function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (items.value.some(isActive)) reloadList()
  }, 5000)
}

async function submitJobs() {
  if (!canSubmit.value) return
  submitting.value = true
  uploadProgress.value = 0
  submitError.value = ''
  try {
    const form = new FormData()
    form.append('mode', 'subtitle')
    for (const item of pickedItems.value) form.append('files', item.file)
    const res = await subtitleEraseAPI.create(form, {
      onProgress: (p) => { uploadProgress.value = p },
    })
    const count = Array.isArray(res?.items) ? res.items.length : 1
    if (res?.balance != null) balance.value = Number(res.balance) || balance.value
    toast.success(`已提交 ${count} 个任务`)
    clearFiles()
    await reloadList()
    await loadBalance()
  } catch (e) {
    submitError.value = e?.message || '提交失败'
    toast.error(submitError.value)
  } finally {
    submitting.value = false
    uploadProgress.value = 0
  }
}

function openPreview(item) {
  preview.value = item
}

function closePreview() {
  preview.value = null
}

async function downloadItem(item) {
  if (!item?.id || !item.output_video_url) return
  downloadingId.value = item.id
  try {
    const suffix = item.mode === 'watermark' ? 'no-wm' : item.mode === 'both' ? 'clean' : 'no-sub'
    const filename = `${String(item.title || 'video').replace(/\.mp4$/i, '')}-${suffix}.mp4`
    const playUrl = videoPlayUrl(item.output_video_url)
    // 优先走与预览三点菜单相同的可播放地址（OSS/static），避免鉴权 API 读错 token
    await downloadMediaFile(item.output_video_path || item.output_video_url, filename, {
      playUrl,
      item: {
        local_path: item.output_video_path,
        display_video_url: playUrl,
      },
    })
  } catch (e) {
    toast.error(e?.message || '下载失败')
  } finally {
    downloadingId.value = null
  }
}

onMounted(async () => {
  await Promise.all([loadMeta(), loadBalance(), reloadList()])
  schedulePoll()
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  clearFiles()
})
</script>

<style scoped>
.erase-page {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
}
.erase-topbar {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.erase-balance,
.erase-consume {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--bg-2);
  border: 1px solid var(--border);
}
.erase-panel {
  padding: 18px 18px 16px;
  border-radius: 14px;
}
.erase-panel-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}
.erase-panel-head h1 {
  margin: 0;
  font-size: 20px;
}
.erase-panel-head .dim {
  margin: 4px 0 0;
  font-size: 13px;
}
.erase-tips {
  margin: 0 0 14px;
  line-height: 1.55;
  font-size: 13px;
}
.erase-mode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.erase-mode-toggle {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.erase-mode-btn {
  border: none;
  background: transparent;
  color: var(--text-2);
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
}
.erase-mode-btn.active {
  background: color-mix(in srgb, #4c7dff 18%, transparent);
  color: var(--text-1);
  font-weight: 600;
}
.erase-file-input { display: none; }
.erase-dropzone {
  border: 1.5px dashed color-mix(in srgb, #4c7dff 55%, var(--border));
  border-radius: 14px;
  min-height: 180px;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  background: color-mix(in srgb, #4c7dff 6%, transparent);
}
.erase-dropzone.is-dragover,
.erase-dropzone:hover {
  border-color: #4c7dff;
  background: color-mix(in srgb, #4c7dff 12%, transparent);
}
.erase-dropzone.has-files {
  align-items: stretch;
  cursor: default;
}
.erase-drop-icon { color: #4c7dff; }
.erase-drop-label {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.erase-drop-hint {
  margin: 0;
  text-align: center;
  max-width: 520px;
  font-size: 13px;
}
.erase-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.erase-file-card {
  display: grid;
  grid-template-columns: minmax(160px, 280px) 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-2);
}
.erase-file-preview {
  border-radius: 10px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 16 / 9;
  max-height: 160px;
}
.erase-file-preview video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.erase-file-name {
  display: block;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.erase-file-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.erase-submit {
  width: 100%;
  margin-top: 14px;
}
.erase-error {
  color: #ff7b7b;
  margin: 10px 0 0;
}
.erase-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.erase-stat {
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.erase-stat strong { font-size: 22px; }
.erase-stat.is-ok strong { color: #3ecf8e; }
.erase-stat.is-fail strong { color: #ff7b7b; }
.erase-stat-label {
  font-size: 12px;
  color: var(--text-2);
}
.erase-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.erase-table-wrap { overflow-x: auto; }
.erase-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10050;
  background: rgba(0, 0, 0, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.erase-preview-modal {
  width: min(560px, 100%);
  padding: 18px;
  border-radius: 16px;
}
.erase-preview-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.erase-preview-head h3 {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.erase-icon-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-1);
  font-size: 22px;
  cursor: pointer;
}
.erase-preview-media {
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 16 / 10;
}
.erase-preview-media video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.erase-preview-actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 720px) {
  .erase-file-card {
    grid-template-columns: 1fr;
  }
  .erase-stats {
    grid-template-columns: 1fr;
  }
}
</style>
