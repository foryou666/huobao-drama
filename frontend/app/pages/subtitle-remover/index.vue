<template>
  <div class="studio-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">去字幕</h1>
        <p class="studio-desc">
          上传带硬字幕或文字水印的视频，由本机 GPU 上的
          <a href="https://github.com/foryou666/video-subtitle-remover" target="_blank" rel="noopener">VSR</a>
          处理；线上服务器通过 API 转发任务（需在设置中配置 VSR 地址）。
        </p>
      </div>
      <div class="studio-header-actions">
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="studio-feed">
      <div class="vsr-compose">
        <input
          ref="fileInputRef"
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"
          class="vsr-file-input"
          @change="onFilePick"
        />

        <div
          v-if="!pickedFile"
          class="vsr-upload-card card"
          :class="{ 'is-dragover': isDragOver }"
          @click="openFilePicker"
          @dragenter.prevent="isDragOver = true"
          @dragover.prevent="isDragOver = true"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <div class="vsr-upload-zone">
            <div class="vsr-upload-icon" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke-linecap="round" />
              </svg>
            </div>
            <p class="vsr-upload-label">点击或拖拽上传视频</p>
            <p class="dim vsr-upload-hint">MP4 / MOV / WebM · 最长 10 分钟</p>
          </div>
        </div>

        <div v-else class="vsr-compose-card card" @click.stop>
          <div class="vsr-compose-head">
            <span class="vsr-compose-filename" :title="pickedFile.name">{{ pickedFile.name }}</span>
            <button type="button" class="btn btn-sm btn-ghost" :disabled="uploading" @click="clearPickedFile">
              换视频
            </button>
          </div>

          <VsrSubtitleAreaPicker
            :file="pickedFile"
            immediate
            v-model="subtitleAreas"
            v-model:manual="manualSubtitleAreas"
          />

          <div class="vsr-compose-actions">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="uploading"
              @click="startUpload"
            >
              {{ uploadButtonLabel }}
            </button>
          </div>

          <div v-if="uploading" class="vsr-upload-progress">
            <div class="vsr-progress-head">
              <span class="dim">上传中</span>
              <span class="mono">{{ uploadProgress }}%</span>
            </div>
            <div class="vsr-progress-track">
              <div class="vsr-progress-fill" :style="{ width: `${uploadProgress}%` }" />
            </div>
          </div>
        </div>

        <p v-if="uploadError" class="vsr-error">{{ uploadError }}</p>
      </div>

      <div class="vsr-history-head">
        <h2 class="vsr-history-title">历史任务</h2>
        <p class="dim vsr-history-desc">点击卡片可预览成品视频</p>
      </div>

      <div v-if="loading && !items.length" class="studio-grid studio-grid-skeleton">
        <article v-for="n in 6" :key="n" class="studio-card studio-card-skeleton">
          <div class="studio-card-media ratio-portrait studio-skeleton-block" />
          <div class="studio-card-body">
            <div class="studio-skeleton-line studio-skeleton-line-wide" />
            <div class="studio-skeleton-line studio-skeleton-line-narrow" />
          </div>
        </article>
      </div>
      <div v-else-if="!items.length" class="studio-empty card">
        <p>还没有去字幕任务</p>
      </div>

      <div v-else class="studio-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="studio-card"
          @click="openDetail(item)"
        >
          <div class="studio-card-media ratio-portrait">
            <video
              v-if="hasPlayableOutput(item)"
              :src="outputPreviewUrl(item)"
              muted
              playsinline
              preload="metadata"
              class="vsr-card-video"
            />
            <div v-else-if="isActiveJob(item)" class="studio-card-loading">
              <div class="studio-spinner" />
              <span>{{ processingLabel(item) }}</span>
              <div class="vsr-card-progress">
                <div class="vsr-progress-track">
                  <div
                    class="vsr-progress-fill"
                    :class="{ 'is-indeterminate': item.status === 'queued' && !item.progress }"
                    :style="{ width: `${jobProgress(item)}%` }"
                  />
                </div>
                <span class="mono dim">{{ jobProgress(item) }}%</span>
              </div>
            </div>
            <div v-else class="studio-card-fallback">
              <span>{{ statusLabel(item.status) }}</span>
              <p v-if="item.error_msg" class="studio-card-error">{{ item.error_msg }}</p>
            </div>

            <div v-if="hasPlayableOutput(item)" class="studio-card-play-badge" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>

            <div class="studio-card-status">
              <span class="tag" :class="statusTagClass(item.status)">{{ statusLabel(item.status) }}</span>
            </div>

            <button
              v-if="hasPlayableOutput(item)"
              type="button"
              class="studio-card-download"
              title="下载视频"
              :disabled="downloadingId === item.id"
              @click.stop="downloadOutput(item)"
            >
              {{ downloadingId === item.id ? '…' : '↓' }}
            </button>
          </div>

          <div class="studio-card-body">
            <p class="studio-card-prompt">{{ previewTitle(item.title) }}</p>
            <div class="studio-card-meta">
              <span class="mono dim">#{{ item.id }}</span>
              <span class="tag">{{ inpaintModeLabel(item.inpaint_mode) }}</span>
              <span v-if="item.subtitle_areas?.length" class="dim">框选 {{ item.subtitle_areas.length }} 区</span>
              <button
                v-if="hasPlayableOutput(item)"
                type="button"
                class="studio-card-download-link"
                :disabled="downloadingId === item.id"
                @click.stop="downloadOutput(item)"
              >
                {{ downloadingId === item.id ? '下载中…' : '下载' }}
              </button>
            </div>
            <p class="studio-card-time dim">{{ formatTime(item.updated_at || item.created_at) }}</p>
          </div>
        </article>
      </div>
    </div>

    <div v-if="detailItem" class="studio-detail-overlay" @click.self="detailItem = null">
      <div class="studio-detail card">
        <div class="studio-detail-head">
          <div>
            <h3>{{ previewTitle(detailItem.title) }}</h3>
            <p class="dim">
              #{{ detailItem.id }} · {{ statusLabel(detailItem.status) }}
              · {{ formatTime(detailItem.updated_at || detailItem.created_at) }}
            </p>
          </div>
          <div class="studio-detail-actions">
            <button
              v-if="hasPlayableOutput(detailItem)"
              type="button"
              class="btn btn-sm"
              :disabled="downloadingId === detailItem.id"
              @click="downloadOutput(detailItem)"
            >
              {{ downloadingId === detailItem.id ? '下载中…' : '下载' }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="detailItem = null">关闭</button>
          </div>
        </div>
        <div class="studio-detail-body">
          <div class="studio-detail-media ratio-portrait">
            <video
              v-if="hasPlayableOutput(detailItem)"
              :src="outputPreviewUrl(detailItem)"
              controls
              playsinline
              autoplay
              class="studio-detail-player"
            />
            <div v-else-if="isActiveJob(detailItem)" class="studio-detail-empty">
              <p>{{ processingLabel(detailItem) }}</p>
              <div class="vsr-progress-block">
                <div class="vsr-progress-head">
                  <span class="dim">处理进度</span>
                  <span class="mono">{{ jobProgress(detailItem) }}%</span>
                </div>
                <div class="vsr-progress-track">
                  <div
                    class="vsr-progress-fill"
                    :class="{ 'is-indeterminate': detailItem.status === 'queued' && !detailItem.progress }"
                    :style="{ width: `${jobProgress(detailItem)}%` }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="studio-detail-empty">
              {{ detailItem.error_msg || statusLabel(detailItem.status) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import VsrSubtitleAreaPicker from '~/components/VsrSubtitleAreaPicker.vue'
import { subtitleRemoverAPI } from '~/composables/useApi'
import { mediaDisplayUrl, normalizeMediaPath, prefetchMediaUrls } from '~/utils/media-url'
import { downloadMediaFile } from '~/utils/download-media.js'

const fileInputRef = ref(null)
const loading = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const items = ref([])
const pickedFile = ref(null)
const subtitleAreas = ref([])
const manualSubtitleAreas = ref(true)
const uploadProgress = ref(0)
const downloadingId = ref(null)
const detailItem = ref(null)
const isDragOver = ref(false)
let pollTimer = null

const INPAINT_LABELS = {
  'sttn-auto': 'STTN 框选',
  'sttn-det': 'STTN 检测',
  lama: 'LAMA',
  propainter: 'ProPainter',
  opencv: 'OpenCV',
}

const uploadButtonLabel = computed(() => {
  if (uploading.value) return `上传中 ${uploadProgress.value}%`
  if (pickedFile.value) return '开始去字幕'
  return '选择视频'
})

const STATUS_LABELS = {
  uploaded: '已上传',
  queued: '排队中',
  remote_processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

function statusLabel(s) {
  return STATUS_LABELS[s] || s || '—'
}

function statusTagClass(status) {
  if (status === 'completed') return 'tag-success'
  if (status === 'queued' || status === 'remote_processing') return 'tag-accent'
  if (status === 'failed') return 'tag-danger'
  return ''
}

function inpaintModeLabel(mode) {
  return INPAINT_LABELS[mode] || mode || 'STTN'
}

function previewTitle(title) {
  const text = String(title || '去字幕任务').trim()
  return text.length > 48 ? `${text.slice(0, 48)}…` : text
}

function hasPlayableOutput(item) {
  return item?.status === 'completed' && !!outputPreviewUrl(item)
}

function openDetail(item) {
  detailItem.value = item
}

function isActiveJob(item) {
  return ['queued', 'remote_processing'].includes(item.status)
}

function jobProgress(item) {
  const value = Number(item.progress)
  if (Number.isFinite(value) && value > 0) return Math.min(100, Math.round(value))
  if (item.status === 'remote_processing') return 5
  if (item.status === 'queued') return 0
  return 0
}

function processingLabel(item) {
  if (item.status === 'queued') return '排队中，等待转发到本机 VSR…'
  if (item.status === 'remote_processing') return '本机 VSR 处理中'
  return statusLabel(item.status)
}

function formatTime(v) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return v
  }
}

function openFilePicker() {
  if (uploading.value) return
  fileInputRef.value?.click()
}

function onDragLeave(e) {
  if (!e.currentTarget?.contains(e.relatedTarget)) {
    isDragOver.value = false
  }
}

function applyPickedFile(file) {
  pickedFile.value = file || null
  subtitleAreas.value = []
  manualSubtitleAreas.value = !!file
  uploadError.value = ''
}

function onFilePick(e) {
  applyPickedFile(e.target.files?.[0] || null)
}

function onDrop(e) {
  isDragOver.value = false
  if (uploading.value) return
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
    uploadError.value = '请上传视频文件'
    toast.error(uploadError.value)
    return
  }
  applyPickedFile(file)
}

function clearPickedFile() {
  if (uploading.value) return
  applyPickedFile(null)
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function buildDownloadFilename(item) {
  const base = String(item?.title || '去字幕')
    .slice(0, 40)
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
  return `${base || '去字幕'}_${item?.id || 'out'}.mp4`
}

function outputStaticPath(item) {
  return normalizeMediaPath(item?.output_video_url || item?.outputVideoPath || '')
}

function outputPreviewUrl(item) {
  const staticPath = outputStaticPath(item)
  const resolved = mediaDisplayUrl(item?.output_video_url || staticPath)
  if (resolved) return resolved
  return staticPath.startsWith('static/') ? `/${staticPath}` : ''
}

async function downloadOutput(item) {
  if (!item?.id || downloadingId.value != null) return
  downloadingId.value = item.id
  try {
    await downloadMediaFile(null, buildDownloadFilename(item), {
      subtitleRemoverJobId: item.id,
    })
    toast.success('开始下载')
  } catch (e) {
    toast.error(e?.message || '下载失败')
  } finally {
    downloadingId.value = null
  }
}

async function reload() {
  loading.value = true
  try {
    const res = await subtitleRemoverAPI.list()
    items.value = res?.items || []
    if (detailItem.value) {
      const fresh = items.value.find(i => i.id === detailItem.value.id)
      if (fresh) detailItem.value = fresh
    }
    const outputPaths = items.value
      .map(outputStaticPath)
      .filter(p => p.startsWith('static/'))
    if (outputPaths.length) {
      void prefetchMediaUrls(outputPaths, { force: true })
    }
  } catch (e) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function startUpload() {
  if (!pickedFile.value) return

  if (!subtitleAreas.value.length) {
    uploadError.value = '请框选字幕区域，或点击「底部字幕条预设」'
    toast.error(uploadError.value)
    return
  }

  uploading.value = true
  uploadProgress.value = 0
  uploadError.value = ''
  try {
    const form = new FormData()
    form.append('file', pickedFile.value)
    form.append('inpaint_mode', 'sttn-auto')
    form.append('subtitle_areas', JSON.stringify(subtitleAreas.value))
    await subtitleRemoverAPI.create(form, {
      onProgress: (percent) => {
        uploadProgress.value = percent
      },
    })
    pickedFile.value = null
    subtitleAreas.value = []
    manualSubtitleAreas.value = false
    if (fileInputRef.value) fileInputRef.value.value = ''
    toast.success('任务已创建，正在转发到本机 VSR')
    await reload()
  } catch (e) {
    uploadError.value = e.message || '上传失败'
    toast.error(uploadError.value)
  } finally {
    uploading.value = false
    uploadProgress.value = 0
  }
}

function schedulePoll() {
  clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    const active = items.value.some(i => isActiveJob(i))
    if (active) reload()
  }, 3000)
}

onMounted(async () => {
  await reload()
  schedulePoll()
})

onUnmounted(() => {
  clearInterval(pollTimer)
})
</script>

<style scoped>
.studio-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background:
    radial-gradient(circle at top right, rgba(124, 77, 255, 0.08), transparent 40%),
    radial-gradient(circle at top left, rgba(76, 125, 255, 0.08), transparent 35%),
    var(--bg-base);
}

.studio-header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 12px;
  flex-shrink: 0;
}

.studio-title {
  margin: 0 0 6px;
  font-size: 22px;
}

.studio-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-dim);
  max-width: 720px;
  line-height: 1.5;
}

.studio-feed {
  flex: 1;
  overflow: auto;
  padding: 0 24px 24px;
}

.vsr-history-head {
  margin-bottom: 14px;
}

.vsr-history-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.vsr-history-desc {
  margin: 0;
  font-size: 12px;
}

.studio-empty {
  padding: 48px 24px;
  text-align: center;
  color: var(--text-3);
}

.studio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}

.studio-grid-skeleton {
  pointer-events: none;
}

.studio-skeleton-block {
  background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3, #1e2430) 50%, var(--bg-2) 75%);
  background-size: 200% 100%;
  animation: vsr-skeleton-shimmer 1.2s ease-in-out infinite;
}

.studio-skeleton-line {
  height: 10px;
  border-radius: 4px;
  background: var(--bg-2);
  margin-bottom: 8px;
}

.studio-skeleton-line-wide { width: 88%; }
.studio-skeleton-line-narrow { width: 52%; margin-bottom: 0; }

@keyframes vsr-skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.studio-card {
  border-radius: 16px;
  overflow: hidden;
  background: var(--bg-1);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.studio-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.studio-card-media {
  position: relative;
  background: #000;
  overflow: hidden;
}

.ratio-portrait { aspect-ratio: 9 / 16; }

.vsr-card-video,
.studio-detail-player {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}

.studio-card-loading,
.studio-card-fallback {
  width: 100%;
  height: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

.studio-spinner {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--accent);
  animation: vsr-spin 0.8s linear infinite;
}

@keyframes vsr-spin { to { transform: rotate(360deg); } }

.studio-card-error {
  margin: 0;
  font-size: 11px;
  color: #ef5350;
  line-height: 1.4;
  max-height: 4.5em;
  overflow: hidden;
}

.studio-card-play-badge {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(0, 0, 0, 0.18);
  pointer-events: none;
}

.studio-card-play-badge svg {
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.45));
}

.studio-card-status {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}

.studio-card-download {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 3;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  font-size: 14px;
  line-height: 1;
}

.studio-card:hover .studio-card-download {
  opacity: 1;
}

.studio-card-download:hover {
  background: rgba(76, 125, 255, 0.88);
}

.studio-card-body {
  padding: 10px 12px 12px;
}

.studio-card-prompt {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.studio-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}

.studio-card-time {
  margin: 6px 0 0;
  font-size: 11px;
}

.studio-card-download-link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}

.studio-card-download-link:hover {
  text-decoration: underline;
}

.vsr-card-progress {
  width: 100%;
  max-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}

.studio-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.studio-detail {
  width: min(520px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 16px;
}

.studio-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.studio-detail-head h3 {
  margin: 0 0 4px;
  font-size: 16px;
}

.studio-detail-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.studio-detail-media {
  background: #000;
  border-radius: 12px;
  overflow: hidden;
}

.studio-detail-empty {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
}

.vsr-compose {
  margin-bottom: 20px;
}

.vsr-upload-card {
  width: min(100%, 280px);
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.vsr-compose-card {
  width: min(100%, 720px);
  padding: 14px;
}

.vsr-compose-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.vsr-compose-filename {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}

.vsr-compose-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.vsr-upload-card.is-dragover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(76, 125, 255, 0.2);
}

.vsr-file-input {
  display: none;
}

.vsr-upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 148px;
  padding: 20px 16px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  margin: 12px;
  background: var(--bg-2);
  text-align: center;
}

.vsr-upload-card.is-dragover .vsr-upload-zone {
  border-color: var(--accent);
  background: rgba(76, 125, 255, 0.06);
}

.vsr-upload-icon {
  color: var(--accent);
  opacity: 0.9;
}

.vsr-upload-label {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
}

.vsr-upload-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
}

.vsr-upload-progress {
  margin-top: 12px;
}

.vsr-error {
  margin: 8px 0 0;
  max-width: 720px;
  color: var(--danger, #ef4444);
  font-size: 12px;
}

.vsr-progress-block {
  margin-top: 12px;
  max-width: 100%;
  width: 100%;
}

.vsr-progress-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}

.vsr-progress-track {
  height: 8px;
  border-radius: 999px;
  background: var(--bg-2);
  overflow: hidden;
}

.vsr-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent, #22d3ee), #38bdf8);
  transition: width 0.25s ease;
}

.vsr-progress-fill.is-indeterminate {
  width: 36% !important;
  animation: vsr-progress-indeterminate 1.2s ease-in-out infinite;
}

@keyframes vsr-progress-indeterminate {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

@media (max-width: 640px) {
  .studio-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
}
</style>
