<template>
  <div class="upscale-page">
    <header class="upscale-topbar">
      <div class="upscale-balance">
        <span class="dim">账户剩余积分</span>
        <strong class="mono">{{ balance.toLocaleString() }}</strong>
      </div>
      <div class="upscale-consume">
        <span class="dim">本次消耗</span>
        <strong class="mono">{{ estimatedCost }} 积分</strong>
      </div>
    </header>

    <section class="upscale-panel card">
      <div class="upscale-panel-head">
        <div>
          <h1>视频超分</h1>
          <p class="dim">上传后自动提交；上游同时最多 2 路，超出本地自动排队，无需手动重试</p>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" @click="showTips = !showTips">上传须知</button>
      </div>

      <p v-if="showTips" class="upscale-tips dim">
        仅支持 MP4；单次最多 {{ maxFiles }} 个；单个不超过 3 分钟 / 500MB。
        计费约 {{ creditsPerSecond }} 积分/秒（按源视频时长）。成品请及时下载。
      </p>
      <p v-if="!metaReady" class="upscale-error">{{ publicMetaDetail }}</p>

      <input
        ref="fileInputRef"
        type="file"
        accept="video/mp4,.mp4"
        multiple
        class="upscale-file-input"
        @change="onFilePick"
      />

      <div
        class="upscale-dropzone"
        :class="{ 'is-dragover': isDragOver, 'has-files': pickedItems.length }"
        @click="openFilePicker"
        @dragenter.prevent="isDragOver = true"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="onDrop"
      >
        <template v-if="!pickedItems.length">
          <div class="upscale-drop-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke-linecap="round" />
            </svg>
          </div>
          <p class="upscale-drop-label">拖拽视频到这里，或点击选择</p>
          <p class="dim upscale-drop-hint">
            支持 MP4，单次最多 {{ maxFiles }} 个，单个不超过 3 分钟 / 500MB
          </p>
          <button type="button" class="btn btn-primary" @click.stop="openFilePicker">选择文件</button>
        </template>
        <template v-else>
          <ul class="upscale-file-list" @click.stop>
            <li v-for="(item, idx) in pickedItems" :key="item.id" class="upscale-file-card">
              <div class="upscale-file-preview">
                <video
                  :src="item.url"
                  controls
                  playsinline
                  preload="metadata"
                  @loadedmetadata="onLocalMeta(item, $event)"
                />
              </div>
              <div class="upscale-file-meta">
                <span class="upscale-file-name" :title="item.file.name">{{ item.file.name }}</span>
                <span class="mono dim">
                  {{ formatBytes(item.file.size) }}
                  <template v-if="item.durationSec"> · {{ formatDuration(item.durationSec) }}</template>
                </span>
              </div>
              <button type="button" class="btn btn-sm btn-ghost" :disabled="submitting" @click="removeFile(idx)">移除</button>
            </li>
          </ul>
          <div class="upscale-file-actions" @click.stop>
            <button type="button" class="btn btn-sm" :disabled="submitting || pickedItems.length >= maxFiles" @click="openFilePicker">
              继续添加
            </button>
            <button type="button" class="btn btn-sm btn-ghost" :disabled="submitting" @click="clearFiles">清空</button>
          </div>
        </template>
      </div>

      <button
        type="button"
        class="btn btn-primary upscale-submit"
        :disabled="!canSubmit"
        @click="submitJobs"
      >
        {{ submitting ? `提交中 ${uploadProgress}%…` : '提交超分' }}
      </button>
      <p v-if="submitError" class="upscale-error">{{ submitError }}</p>
    </section>

    <section class="upscale-panel card">
      <div class="upscale-panel-head">
        <div>
          <h1>任务管理</h1>
          <p class="dim">共 {{ stats.total }} 个任务</p>
        </div>
      </div>

      <div class="upscale-stats">
        <div class="upscale-stat">
          <span class="upscale-stat-label">处理中</span>
          <strong>{{ stats.processing }}</strong>
        </div>
        <div class="upscale-stat is-ok">
          <span class="upscale-stat-label">已完成</span>
          <strong>{{ stats.completed }}</strong>
        </div>
        <div class="upscale-stat is-fail">
          <span class="upscale-stat-label">失败</span>
          <strong>{{ stats.failed }}</strong>
        </div>
      </div>

      <div class="upscale-filters">
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
      <div v-else-if="!items.length" class="studio-empty">还没有超分任务</div>
      <div v-else class="upscale-table-wrap">
        <table class="user-table upscale-table">
          <thead>
            <tr>
              <th>任务ID</th>
              <th>文件名</th>
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
                <div class="dim mono" style="font-size: 12px">
                  超分输出 · {{ formatTime(item.created_at) }}
                </div>
              </td>
              <td class="mono">{{ formatDuration(item.duration_sec) }}</td>
              <td class="mono dim">{{ formatTime(item.created_at) }}</td>
              <td>
                <span class="tag" :class="statusTagClass(item.status)">{{ statusLabel(item.status) }}</span>
                <div v-if="item.status === 'queued'" class="dim" style="font-size: 11px; margin-top: 4px">
                  {{ formatUpscaleQueueHint(item) }}
                </div>
                <div v-else-if="isActive(item)" class="dim mono" style="font-size: 11px; margin-top: 4px">
                  {{ item.progress || 0 }}%
                  <span v-if="formatUpscaleEta(item.eta_sec)"> · {{ formatUpscaleEta(item.eta_sec) }}</span>
                </div>
                <div v-if="item.error_msg" class="upscale-error" style="font-size: 12px; margin-top: 4px">
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

    <!-- 预览（图2） -->
    <div v-if="preview" class="upscale-modal-overlay" @click.self="closePreview">
      <div class="upscale-preview-modal card">
        <div class="upscale-preview-head">
          <h3 :title="preview.title">{{ preview.title }}</h3>
          <button type="button" class="upscale-icon-btn" aria-label="关闭" @click="closePreview">×</button>
        </div>

        <div class="upscale-preview-media">
          <video
            ref="previewVideoRef"
            :src="videoPlayUrl(preview.output_video_url)"
            controls
            playsinline
            autoplay
            @loadedmetadata="onPreviewMeta"
          />
        </div>

        <div class="upscale-preview-meta">
          <div>
            <span class="label">原始时长</span>
            <strong>{{ formatDuration(preview.duration_sec) }}</strong>
          </div>
          <div>
            <span class="label">输出分辨率</span>
            <strong>{{ previewResolution }}</strong>
          </div>
          <div>
            <span class="label">完成时间</span>
            <strong>{{ formatTime(preview.updated_at || preview.created_at) }}</strong>
          </div>
          <div>
            <span class="label">消耗积分</span>
            <strong>{{ estimateJobCost(preview) }} 积分</strong>
          </div>
        </div>

        <div class="upscale-preview-actions">
          <button
            type="button"
            class="btn upscale-btn-compare"
            :disabled="!preview.source_video_url"
            @click="openCompare(preview)"
          >
            查看对比视频
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="downloadingId === preview.id"
            @click="downloadItem(preview)"
          >
            {{ downloadingId === preview.id ? '下载中…' : '下载输出视频' }}
          </button>
        </div>

        <p class="upscale-preview-note">
          <span class="upscale-info-dot" aria-hidden="true">i</span>
          个别镜头效果不理想？模型仍在持续迭代，属小概率事件。请节选 3–5 秒问题片段反馈，走客服绿色通道免费处理。
        </p>
      </div>
    </div>

    <!-- 效果对比（图3） -->
    <div v-if="compare" class="upscale-compare-overlay">
      <div class="upscale-compare-shell">
        <header class="upscale-compare-bar">
          <div class="upscale-compare-bar-left">
            <button type="button" class="upscale-icon-btn" aria-label="关闭" @click="closeCompare">×</button>
            <h2>效果对比</h2>
          </div>
          <div class="upscale-compare-zoom">
            <button type="button" class="upscale-icon-btn sm" @click="nudgeZoom(-0.1)">−</button>
            <span class="mono">{{ Math.round(compareZoom * 100) }}%</span>
            <button type="button" class="upscale-icon-btn sm" @click="nudgeZoom(0.1)">+</button>
            <button type="button" class="btn btn-sm" @click="resetCompareView">重置</button>
          </div>
        </header>

        <div class="upscale-compare-stage" @wheel.prevent="onCompareWheel">
          <div
            ref="compareFrameRef"
            class="upscale-compare-frame"
            :style="{ transform: `scale(${compareZoom})` }"
            @pointerdown="onSplitPointerDown"
          >
            <video
              ref="afterVideoRef"
              class="upscale-compare-video"
              :src="compareAfterSrc"
              muted
              playsinline
              preload="auto"
              @loadedmetadata="syncCompareDuration"
              @canplay="syncCompareDuration"
            />
            <video
              ref="beforeVideoRef"
              class="upscale-compare-video upscale-compare-before"
              :src="compareBeforeSrc"
              muted
              playsinline
              preload="auto"
              :style="{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }"
              @loadedmetadata="syncCompareDuration"
            />
            <div class="upscale-compare-divider" :style="{ left: `${splitPct}%` }">
              <div class="upscale-compare-handle" aria-hidden="true">
                <span>‹</span><span>›</span>
              </div>
            </div>
            <span class="upscale-compare-tag is-before">当前</span>
            <span class="upscale-compare-tag is-after">超分</span>
          </div>
        </div>

        <footer class="upscale-compare-footer">
          <div class="upscale-compare-controls">
            <button
              type="button"
              class="upscale-play-btn"
              :aria-label="comparePlaying ? '暂停' : '播放'"
              @click="toggleComparePlay"
            >
              <svg v-if="!comparePlaying" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
              </svg>
            </button>
            <span class="mono upscale-compare-clock">{{ formatClock(compareTime) }} / {{ formatClock(compareDuration) }}</span>
            <input
              class="upscale-compare-seek"
              type="range"
              min="0"
              :max="Math.max(0.1, compareDuration)"
              step="0.05"
              :value="compareTime"
              @input="onCompareSeek"
            >
            <button
              type="button"
              class="upscale-mute-btn"
              :class="{ active: !compareMuted }"
              :aria-label="compareMuted ? '取消静音' : '静音'"
              @click="toggleCompareMute"
            >
              <svg v-if="compareMuted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M11 5L6 9H3v6h3l5 4V5z" stroke-linejoin="round" />
                <path d="M15 9l5 5M20 9l-5 5" stroke-linecap="round" />
              </svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M11 5L6 9H3v6h3l5 4V5z" stroke-linejoin="round" />
                <path d="M15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <button type="button" class="btn btn-primary" :disabled="applyingCompare" @click="useCompareForUpload">
            {{ applyingCompare ? '处理中…' : '使用于此上传' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { videoUpscaleAPI } from '~/composables/useApi'
import { mediaDisplayUrl, normalizeMediaPath, prefetchMediaUrls } from '~/utils/media-url.js'
import { downloadMediaFile } from '~/utils/download-media.js'
import { formatUpscaleEta, formatUpscaleQueueHint, formatUpscaleSubmitToast } from '~/utils/upscale-queue.js'
import { toast } from 'vue-sonner'

/** 对比/预览优先用已解析 OSS；未就绪时回退 /static，避免 src 为空无法播放 */
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
const creditsPerSecond = ref(20)
const maxFiles = ref(10)
const metaReady = ref(false)
const metaDetail = ref('')
const publicMetaDetail = computed(() => {
  const raw = String(metaDetail.value || '').trim()
  if (!raw) return '服务暂未就绪，请联系管理员'
  if (/runninghub|seedvr|index.?tts/i.test(raw)) return '服务暂未就绪，请联系管理员'
  return raw
})

const fileInputRef = ref(null)
/** @type {import('vue').Ref<Array<{ id: string, file: File, url: string, durationSec: number|null }>>} */
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
const previewVideoRef = ref(null)
const previewResolution = ref('—')

const compare = ref(null)
const compareFrameRef = ref(null)
const beforeVideoRef = ref(null)
const afterVideoRef = ref(null)
const splitPct = ref(50)
const compareZoom = ref(1)
const comparePlaying = ref(false)
const compareMuted = ref(true)
const compareTime = ref(0)
const compareDuration = ref(0)
const applyingCompare = ref(false)
const compareBeforeSrc = ref('')
const compareAfterSrc = ref('')
let splitDragging = false
let compareRaf = 0
let pollTimer = null
let splitMoved = false

watch(compare, (val) => {
  document.body.classList.toggle('upscale-compare-open', !!val)
}, { immediate: true })

const estimatedCost = computed(() => {
  if (!pickedItems.value.length) return 0
  const rate = Math.max(1, Number(creditsPerSecond.value) || 20)
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

function formatClock(sec) {
  const n = Math.max(0, Number(sec) || 0)
  const m = Math.floor(n / 60)
  const s = Math.floor(n % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function estimateJobCost(item) {
  const sec = Math.max(1, Math.ceil(Number(item?.duration_sec) || 1))
  return sec * Math.max(1, Number(creditsPerSecond.value) || 20)
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
    const res = await videoUpscaleAPI.meta()
    metaReady.value = !!res?.ready
    metaDetail.value = res?.detail || ''
    creditsPerSecond.value = Number(res?.credits_per_second) || 6
    maxFiles.value = Number(res?.max_files) || 10
  } catch {
    metaReady.value = false
    metaDetail.value = '加载配置失败'
  }
}

async function loadBalance() {
  try {
    const res = await videoUpscaleAPI.balance()
    balance.value = Number(res?.balance) || 0
    if (res?.credits_per_second != null) creditsPerSecond.value = Number(res.credits_per_second) || creditsPerSecond.value
  } catch {
    /* ignore */
  }
}

async function reloadList() {
  loading.value = true
  try {
    const res = await videoUpscaleAPI.list({
      status: filterStatus.value,
      range: filterRange.value,
      limit: 50,
      offset: 0,
    })
    items.value = res?.items || []
    stats.value = res?.stats || { processing: 0, completed: 0, failed: 0, total: 0 }
  } catch (err) {
    toast.error(err?.message || '加载任务失败')
  } finally {
    loading.value = false
  }
}

async function submitJobs() {
  if (!canSubmit.value) return
  submitting.value = true
  uploadProgress.value = 0
  submitError.value = ''
  try {
    const form = new FormData()
    for (const item of pickedItems.value) form.append('files', item.file)
    const res = await videoUpscaleAPI.create(form, {
      onProgress: (p) => { uploadProgress.value = p },
    })
    const created = res?.items || []
    const count = res?.count || created.length || pickedItems.value.length
    if (created.length === 1) {
      toast.success(formatUpscaleSubmitToast(created[0]))
    } else {
      const queued = created.filter(j => j.status === 'queued' && (j.queue_ahead || 0) > 0).length
      toast.success(
        queued
          ? `已提交 ${count} 个任务；其中 ${queued} 个进入本地排队，将自动陆续开始`
          : `已提交 ${count} 个超分任务，将自动陆续处理`,
      )
    }
    clearFiles()
    if (res?.balance != null) balance.value = Number(res.balance)
    await reloadList()
    startPolling()
  } catch (err) {
    submitError.value = err?.message || '提交失败'
    toast.error(submitError.value)
  } finally {
    submitting.value = false
  }
}

function openPreview(item) {
  previewResolution.value = '—'
  preview.value = item
}

function closePreview() {
  preview.value = null
}

function onPreviewMeta(e) {
  const v = e?.target
  const w = Number(v?.videoWidth) || 0
  const h = Number(v?.videoHeight) || 0
  if (!w || !h) {
    previewResolution.value = '—'
    return
  }
  const long = Math.max(w, h)
  if (long >= 3800) previewResolution.value = '4K'
  else if (long >= 2500) previewResolution.value = '2K'
  else if (long >= 1800) previewResolution.value = '1080P'
  else previewResolution.value = `${w}×${h}`
}

async function openCompare(item) {
  if (!item?.source_video_url || !item?.output_video_url) {
    toast.warning('缺少原片，无法对比')
    return
  }
  closePreview()
  splitPct.value = 50
  compareZoom.value = 1
  comparePlaying.value = false
  compareMuted.value = true
  compareTime.value = 0
  compareDuration.value = 0
  compareBeforeSrc.value = videoPlayUrl(item.source_video_url)
  compareAfterSrc.value = videoPlayUrl(item.output_video_url)
  compare.value = item

  const paths = [
    normalizeMediaPath(item.source_video_url),
    normalizeMediaPath(item.output_video_url),
  ].filter((p) => p.startsWith('static/'))
  if (paths.length) {
    try {
      await prefetchMediaUrls(paths)
      compareBeforeSrc.value = videoPlayUrl(item.source_video_url)
      compareAfterSrc.value = videoPlayUrl(item.output_video_url)
    } catch { /* 已有 /static 回退 */ }
  }

  await nextTick()
  bindCompareVideos()
  // 打开后自动静音播放，避免用户找不到播放按钮
  await playCompareVideos()
}

function closeCompare() {
  stopCompareTick()
  pauseCompareVideos()
  compare.value = null
  compareBeforeSrc.value = ''
  compareAfterSrc.value = ''
}

function bindCompareVideos() {
  const before = beforeVideoRef.value
  const after = afterVideoRef.value
  if (!before || !after) return
  before.muted = true
  after.muted = true
  after.onended = () => {
    comparePlaying.value = false
    before.pause()
    stopCompareTick()
  }
}

function syncCompareDuration() {
  const after = afterVideoRef.value
  const before = beforeVideoRef.value
  const d = Math.max(Number(after?.duration) || 0, Number(before?.duration) || 0)
  if (Number.isFinite(d) && d > 0) compareDuration.value = d
}

function pauseCompareVideos() {
  beforeVideoRef.value?.pause()
  afterVideoRef.value?.pause()
  comparePlaying.value = false
}

async function playCompareVideos() {
  const before = beforeVideoRef.value
  const after = afterVideoRef.value
  if (!before || !after) return false
  if (!compareBeforeSrc.value || !compareAfterSrc.value) {
    toast.error('视频地址未就绪，请稍后重试')
    return false
  }
  // 浏览器策略：自动播放必须静音
  before.muted = true
  after.muted = true
  compareMuted.value = true
  try {
    await Promise.all([after.play(), before.play()])
    comparePlaying.value = true
    startCompareTick()
    return true
  } catch (err) {
    console.warn('[upscale-compare] play failed', err)
    toast.error('无法播放对比视频，请点击播放按钮重试')
    return false
  }
}

async function toggleComparePlay() {
  if (comparePlaying.value) {
    pauseCompareVideos()
    stopCompareTick()
    return
  }
  await playCompareVideos()
  // 用户点击后允许取消静音状态保持（仍默认静音，由静音按钮控制）
  if (beforeVideoRef.value) beforeVideoRef.value.muted = compareMuted.value
  if (afterVideoRef.value) afterVideoRef.value.muted = true
}

function startCompareTick() {
  stopCompareTick()
  const tick = () => {
    const after = afterVideoRef.value
    const before = beforeVideoRef.value
    if (after) compareTime.value = after.currentTime || 0
    if (after && before && Math.abs(before.currentTime - after.currentTime) > 0.08) {
      before.currentTime = after.currentTime
    }
    compareRaf = requestAnimationFrame(tick)
  }
  compareRaf = requestAnimationFrame(tick)
}

function stopCompareTick() {
  if (compareRaf) {
    cancelAnimationFrame(compareRaf)
    compareRaf = 0
  }
}

function onCompareSeek(e) {
  const t = Number(e.target.value) || 0
  compareTime.value = t
  if (beforeVideoRef.value) beforeVideoRef.value.currentTime = t
  if (afterVideoRef.value) afterVideoRef.value.currentTime = t
}

function toggleCompareMute() {
  compareMuted.value = !compareMuted.value
  if (beforeVideoRef.value) beforeVideoRef.value.muted = compareMuted.value
  // 只播原片音轨，避免双轨叠加
  if (afterVideoRef.value) afterVideoRef.value.muted = true
}

function nudgeZoom(delta) {
  compareZoom.value = Math.min(3, Math.max(0.5, Math.round((compareZoom.value + delta) * 10) / 10))
}

function resetCompareView() {
  compareZoom.value = 1
  splitPct.value = 50
}

function onCompareWheel(e) {
  nudgeZoom(e.deltaY > 0 ? -0.1 : 0.1)
}

function onSplitPointerDown(e) {
  if (e.target?.closest?.('.upscale-compare-tag')) return
  splitDragging = true
  splitMoved = false
  const startX = e.clientX
  updateSplitFromEvent(e)
  const move = (ev) => {
    if (!splitDragging) return
    if (Math.abs(ev.clientX - startX) > 4) splitMoved = true
    updateSplitFromEvent(ev)
  }
  const up = () => {
    splitDragging = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    // 点击画面（非拖动）切换播放
    if (!splitMoved) void toggleComparePlay()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function updateSplitFromEvent(e) {
  const frame = compareFrameRef.value
  if (!frame) return
  const rect = frame.getBoundingClientRect()
  if (!rect.width) return
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  splitPct.value = Math.min(92, Math.max(8, pct))
}

async function useCompareForUpload() {
  if (!compare.value?.output_video_url) return
  applyingCompare.value = true
  try {
    const url = mediaDisplayUrl(compare.value.output_video_url)
    const res = await fetch(url)
    if (!res.ok) throw new Error('读取输出视频失败')
    const blob = await res.blob()
    const name = `${String(compare.value.title || 'video').replace(/\.mp4$/i, '')}-upscale.mp4`
    const file = new File([blob], name, { type: blob.type || 'video/mp4' })
    addFiles([file])
    closeCompare()
    toast.success('已加入上传列表，确认后可再次提交超分')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (err) {
    toast.error(err?.message || '加入上传失败')
  } finally {
    applyingCompare.value = false
  }
}

async function downloadItem(item) {
  if (!item?.id) return
  downloadingId.value = item.id
  try {
    const filename = `${String(item.title || 'video').replace(/\.mp4$/i, '')}-upscale.mp4`
    const playUrl = videoPlayUrl(item.output_video_url)
    await downloadMediaFile(item.output_video_path || item.output_video_url, filename, {
      playUrl,
      item: {
        local_path: item.output_video_path,
        display_video_url: playUrl,
      },
    })
  } catch (err) {
    toast.error(err?.message || '下载失败')
  } finally {
    downloadingId.value = null
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!items.value.some(isActive)) return
    try {
      await reloadList()
      await loadBalance()
    } catch { /* ignore */ }
  }, 5000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(async () => {
  await Promise.all([loadMeta(), loadBalance(), reloadList()])
  startPolling()
})

onUnmounted(() => {
  stopPolling()
  stopCompareTick()
  clearFiles()
  document.body.classList.remove('upscale-compare-open')
})
</script>

<style scoped>
/* 对比全屏时隐藏全局版本角标，避免挡住播放控件 */
</style>
<style>
body.upscale-compare-open .app-version-root {
  display: none !important;
}
</style>
<style scoped>
.upscale-page {
  width: 100%;
  max-width: 1100px;
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
.upscale-topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-1) 88%, #1a2332);
  border: 1px solid var(--border);
}
.upscale-balance,
.upscale-consume {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.upscale-panel {
  padding: 20px;
}
.upscale-panel-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.upscale-panel-head h1 {
  margin: 0;
  font-size: 22px;
}
.upscale-panel-head > div:first-child {
  margin-right: auto;
}
.upscale-panel-head .dim {
  margin: 4px 0 0;
  font-size: 13px;
}
.upscale-tips {
  margin: 0 0 14px;
  line-height: 1.55;
  font-size: 13px;
}
.upscale-file-input {
  display: none;
}
.upscale-dropzone {
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
  transition: border-color 0.15s, background 0.15s;
}
.upscale-dropzone.is-dragover,
.upscale-dropzone:hover {
  border-color: #4c7dff;
  background: color-mix(in srgb, #4c7dff 12%, transparent);
}
.upscale-dropzone.has-files {
  align-items: stretch;
  cursor: default;
}
.upscale-drop-icon {
  color: #4c7dff;
  opacity: 0.9;
}
.upscale-drop-label {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.upscale-drop-hint {
  margin: 0;
  text-align: center;
  max-width: 520px;
  font-size: 13px;
  line-height: 1.5;
}
.upscale-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.upscale-file-card {
  display: grid;
  grid-template-columns: minmax(160px, 280px) 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-2);
}
.upscale-file-preview {
  border-radius: 10px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 16 / 9;
  max-height: 160px;
}
.upscale-file-preview video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  background: #000;
}
.upscale-file-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.upscale-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.upscale-file-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
@media (max-width: 720px) {
  .upscale-file-card {
    grid-template-columns: 1fr;
  }
  .upscale-file-preview {
    max-height: 200px;
  }
}
.upscale-submit {
  width: 100%;
  margin-top: 14px;
  height: 44px;
  font-size: 15px;
}
.upscale-submit:disabled {
  opacity: 0.45;
}
.upscale-error {
  color: #ff8f8f;
  margin: 10px 0 0;
}
.upscale-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.upscale-stat {
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.upscale-stat strong {
  font-size: 22px;
}
.upscale-stat.is-ok strong { color: #3ecf8e; }
.upscale-stat.is-fail strong { color: #ff7b7b; }
.upscale-stat-label {
  font-size: 12px;
  color: var(--text-2);
}
.upscale-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.upscale-table-wrap {
  overflow-x: auto;
}
.upscale-table td,
.upscale-table th {
  vertical-align: top;
}

/* —— 预览弹窗 —— */
.upscale-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10050;
  background: rgba(0, 0, 0, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.upscale-preview-modal {
  width: min(560px, 100%);
  padding: 18px 18px 16px;
  border-radius: 16px;
  background: #1a1c22;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
}
.upscale-preview-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.upscale-preview-head h3 {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upscale-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-1);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.upscale-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.upscale-icon-btn.sm {
  width: 28px;
  height: 28px;
  font-size: 14px;
}
.upscale-icon-btn.active {
  color: #4c7dff;
}
.upscale-preview-media {
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 16 / 10;
}
.upscale-preview-media video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  background: #000;
}
.upscale-preview-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 20px;
  margin: 16px 0 18px;
}
.upscale-preview-meta .label {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 4px;
}
.upscale-preview-meta strong {
  font-size: 16px;
  font-weight: 700;
}
.upscale-preview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.upscale-preview-actions .btn {
  height: 42px;
  border-radius: 10px;
  font-weight: 600;
}
.upscale-btn-compare {
  background: color-mix(in srgb, #7b61ff 28%, var(--bg-2));
  border: 1px solid color-mix(in srgb, #7b61ff 45%, transparent);
  color: #e8e4ff;
}
.upscale-btn-compare:hover:not(:disabled) {
  background: color-mix(in srgb, #7b61ff 40%, var(--bg-2));
}
.upscale-preview-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-2);
}
.upscale-info-dot {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 50%;
  background: #3b82f6;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* —— 效果对比 —— */
.upscale-compare-overlay {
  position: fixed;
  inset: 0;
  z-index: 10050;
  background: #0d0f14;
  display: flex;
  flex-direction: column;
}
.upscale-compare-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.upscale-compare-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.upscale-compare-bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.upscale-compare-bar h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.upscale-compare-zoom {
  display: flex;
  align-items: center;
  gap: 8px;
}
.upscale-compare-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 20px;
  cursor: ew-resize;
  user-select: none;
  touch-action: none;
}
.upscale-compare-frame {
  position: relative;
  width: min(960px, 92vw);
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
  transform-origin: center center;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.upscale-compare-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  pointer-events: none;
}
.upscale-compare-before {
  z-index: 2;
}
.upscale-compare-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.9);
  transform: translateX(-50%);
  z-index: 3;
  pointer-events: none;
}
.upscale-compare-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #fff;
  color: #222;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
.upscale-compare-tag {
  position: absolute;
  top: 12px;
  z-index: 4;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
}
.upscale-compare-tag.is-before {
  left: 12px;
  background: rgba(40, 40, 40, 0.72);
  color: #eee;
}
.upscale-compare-tag.is-after {
  right: 12px;
  background: rgba(59, 130, 246, 0.9);
  color: #fff;
}
.upscale-compare-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-wrap: wrap;
  background: #0d0f14;
  position: relative;
  z-index: 2;
}
.upscale-compare-controls {
  flex: 1;
  min-width: 280px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.upscale-play-btn,
.upscale-mute-btn {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.upscale-play-btn:hover,
.upscale-mute-btn:hover {
  background: rgba(255, 255, 255, 0.22);
}
.upscale-mute-btn.active {
  border-color: color-mix(in srgb, #4c7dff 55%, transparent);
  color: #8eb6ff;
}
.upscale-compare-clock {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
}
.upscale-compare-seek {
  flex: 1;
  height: 6px;
  accent-color: #7b61ff;
}
@media (max-width: 720px) {
  .upscale-stats { grid-template-columns: 1fr; }
  .upscale-topbar { flex-direction: column; }
  .upscale-preview-actions { grid-template-columns: 1fr; }
  .upscale-compare-footer { flex-direction: column; align-items: stretch; }
}
</style>
