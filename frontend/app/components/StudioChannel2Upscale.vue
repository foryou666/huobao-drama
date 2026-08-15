<template>
  <div v-if="videoId" class="c2-upscale" @click.stop>
    <div class="c2-upscale-actions">
      <!-- 已完成：下载超分 → 效果对比 → 再次超分 -->
      <template v-if="isCompleted">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="downloading"
          @click="downloadUpscaled"
        >
          {{ downloading ? '下载中…' : '下载超分' }}
        </button>
        <button
          type="button"
          class="btn btn-sm c2-upscale-btn is-compare"
          @click="openCompare"
        >
          效果对比
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="submitting"
          @click="onUpscaleClick"
        >
          {{ submitting ? '提交中…' : '再次超分' }}
        </button>
      </template>
      <button
        v-else-if="showUpscaleEntry"
        type="button"
        class="btn btn-sm btn-primary"
        :disabled="submitting"
        @click="onUpscaleClick"
      >
        {{ submitting ? '提交中…' : upscaleButtonLabel }}
      </button>
    </div>

    <div v-if="isActive" class="c2-upscale-progress">
      <div class="c2-upscale-progress-head">
        <span>{{ progressTitle }}</span>
        <span class="mono">{{ progressRight }}</span>
      </div>
      <p v-if="queueHint" class="c2-upscale-progress-hint">{{ queueHint }}</p>
      <div v-if="job?.status !== 'queued'" class="c2-upscale-progress-track">
        <div class="c2-upscale-progress-bar" :style="{ width: `${displayProgress}%` }" />
      </div>
    </div>

    <p v-else-if="job?.status === 'failed'" class="c2-upscale-error">
      {{ job.error_msg || '超分失败' }}
    </p>

    <!-- 对比浮层：挂到 body，避免卡片重绘带动闪烁 -->
    <Teleport to="body">
      <div v-if="compareOpen" class="c2-compare-overlay" @click.self="closeCompare">
        <div class="c2-compare-shell" @click.stop>
          <header class="c2-compare-bar">
            <h3>效果对比 #{{ videoId }}</h3>
            <button type="button" class="btn btn-sm" @click="closeCompare">关闭</button>
          </header>
          <div
            ref="compareFrameRef"
            class="c2-compare-frame"
            @pointerdown="onSplitPointerDown"
          >
            <video
              ref="afterVideoRef"
              class="c2-compare-video"
              :src="compareAfterSrc"
              playsinline
              preload="auto"
              @loadedmetadata="syncCompareDuration"
              @timeupdate="onCompareTimeUpdate"
              @ended="onCompareEnded"
            />
            <video
              ref="beforeVideoRef"
              class="c2-compare-video is-before"
              :src="compareBeforeSrc"
              muted
              playsinline
              preload="auto"
              @loadedmetadata="syncCompareDuration"
            />
            <div ref="compareDividerRef" class="c2-compare-divider">
              <div class="c2-compare-handle"><span>‹</span><span>›</span></div>
            </div>
            <span class="c2-compare-tag is-before">原片</span>
            <span class="c2-compare-tag is-after">超分</span>
          </div>
          <footer class="c2-compare-footer">
            <button type="button" class="btn btn-sm" @click="toggleComparePlay">
              {{ comparePlaying ? '暂停' : '播放' }}
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ active: !compareMuted }"
              @click="toggleCompareMute"
            >
              {{ compareMuted ? '取消静音' : '静音' }}
            </button>
            <span ref="compareClockRef" class="mono dim">00:00 / 00:00</span>
            <input
              ref="compareSeekRef"
              class="c2-compare-seek"
              type="range"
              min="0"
              step="0.05"
              value="0"
              @input="onCompareSeek"
            >
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { videoUpscaleAPI } from '~/composables/useApi'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { downloadMediaFile } from '~/utils/download-media.js'
import {
  formatUpscaleEta,
  formatUpscaleQueueHint,
  formatUpscaleSubmitToast,
} from '~/utils/upscale-queue.js'

const ESTIMATE_MS = 15 * 60 * 1000
const ACTIVE = new Set(['queued', 'uploading', 'processing'])

const props = defineProps({
  videoId: { type: Number, required: true },
  durationSec: { type: [Number, String], default: 0 },
  sourceUrl: { type: String, default: '' },
  /** 外部注入的最新超分任务（可选） */
  initialJob: { type: Object, default: null },
})

const emit = defineEmits(['updated'])

const job = ref(props.initialJob || null)
const submitting = ref(false)
const downloading = ref(false)
const displayProgress = ref(0)
let pollTimer = null
let tickTimer = null

const compareOpen = ref(false)
const compareFrameRef = ref(null)
const compareDividerRef = ref(null)
const compareClockRef = ref(null)
const compareSeekRef = ref(null)
const beforeVideoRef = ref(null)
const afterVideoRef = ref(null)
const comparePlaying = ref(false)
/** 对比默认有声（播超分轨）；原片轨始终静音避免叠音 */
const compareMuted = ref(false)
const compareBeforeSrc = ref('')
const compareAfterSrc = ref('')
/** 分割线百分比：只写 DOM，避免 Vue 每帧重绑 clip-path 导致闪烁 */
let splitPct = 50
let compareDuration = 0
let lastClockMs = 0
let splitDragging = false

const isActive = computed(() => job.value && ACTIVE.has(job.value.status))
const isCompleted = computed(() => job.value?.status === 'completed' && !!job.value.output_video_url)
const canSubmit = computed(() => {
  if (!props.videoId) return false
  if (!job.value) return true
  // 进行中不可重复提交；失败可重试；已完成可再次超分
  return job.value.status === 'failed' || job.value.status === 'completed'
})

const showUpscaleEntry = computed(() => {
  if (!props.videoId) return false
  return canSubmit.value || isActive.value
})

const upscaleButtonLabel = computed(() => {
  if (job.value?.status === 'failed') return '重新超分'
  if (job.value?.status === 'completed') return '再次超分'
  if (job.value?.status === 'queued') return '排队中'
  if (isActive.value) return '超分中'
  return '超分'
})

const queueHint = computed(() => formatUpscaleQueueHint(job.value))

const progressTitle = computed(() => {
  const st = job.value?.status
  if (st === 'queued') return '排队中'
  if (st === 'uploading') return '上传中'
  if (st === 'processing') return '超分中'
  return '超分中'
})

const progressRight = computed(() => {
  const j = job.value
  if (!j) return ''
  if (j.status === 'queued') {
    const ahead = Math.max(0, Number(j.queue_ahead) || 0)
    return ahead > 0 ? `前方 ${ahead} 个` : '即将开始'
  }
  const eta = formatUpscaleEta(j.eta_sec) || '约 15 分钟'
  return `${displayProgress.value}% · ${eta}`
})

const upscaledPlayUrl = computed(() => {
  const raw = job.value?.output_video_url
  return raw ? (mediaDisplayUrl(raw) || raw) : ''
})

function refreshDisplayProgress() {
  const j = job.value
  if (!j) {
    displayProgress.value = 0
    return
  }
  if (j.status === 'completed') {
    displayProgress.value = 100
    return
  }
  if (j.status === 'failed' || j.status === 'queued') {
    displayProgress.value = 0
    return
  }
  const server = Math.max(0, Math.min(100, Number(j.progress) || 0))
  // 仅在实际上传/处理后用时间估算，避免排队时进度条虚涨
  const started = new Date(j.updated_at || j.created_at || Date.now()).getTime()
  const timed = Math.min(95, Math.floor(((Date.now() - started) / ESTIMATE_MS) * 100))
  displayProgress.value = Math.max(server, timed)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

function ensurePolling() {
  stopPolling()
  if (!isActive.value || !job.value?.id) return
  pollTimer = setInterval(() => { void pollJob() }, 5000)
  tickTimer = setInterval(() => { refreshDisplayProgress() }, 1000)
  refreshDisplayProgress()
}

async function pollJob() {
  if (!job.value?.id) return
  try {
    const res = await videoUpscaleAPI.get(job.value.id)
    job.value = res
    emit('updated', res)
    refreshDisplayProgress()
    if (!ACTIVE.has(res.status)) {
      stopPolling()
      if (res.status === 'completed') {
        toast.success(`视频 #${props.videoId} 超分完成`)
      } else if (res.status === 'failed') {
        toast.error(res.error_msg || '超分失败')
      }
    }
  } catch {
    /* ignore transient */
  }
}

async function loadInitial() {
  if (props.initialJob) {
    job.value = props.initialJob
    ensurePolling()
    return
  }
  try {
    const res = await videoUpscaleAPI.forGenerations([props.videoId])
    const found = res?.items?.[String(props.videoId)] || null
    if (found) {
      job.value = found
      ensurePolling()
    }
  } catch {
    /* ignore */
  }
}

function onUpscaleClick() {
  if (isActive.value) {
    toast.info(formatUpscaleQueueHint(job.value) || '超分进行中，请稍候')
    return
  }
  void confirmAndSubmit()
}

async function confirmAndSubmit() {
  if (submitting.value || !props.videoId) return
  if (isActive.value) {
    toast.info(formatUpscaleQueueHint(job.value) || '超分进行中，请稍候')
    return
  }
  const again = job.value?.status === 'completed'
  const ok = window.confirm(
    again
      ? `确认对视频 #${props.videoId} 再次超分？\n\n将重新扣费；完成后可在详情页下载对比。`
      : `确认对视频 #${props.videoId} 提交超分？\n\n完成后可在详情页下载与对比。`,
  )
  if (!ok) return
  submitting.value = true
  try {
    const res = await videoUpscaleAPI.fromGeneration(props.videoId)
    job.value = res?.item || res
    emit('updated', job.value)
    if (res?.reused) {
      toast.info(formatUpscaleQueueHint(job.value) || '已有进行中的超分任务，继续跟踪')
    } else {
      toast.success(formatUpscaleSubmitToast(job.value))
    }
    ensurePolling()
  } catch (err) {
    toast.error(err?.message || '提交超分失败')
  } finally {
    submitting.value = false
  }
}

async function downloadUpscaled() {
  if (!job.value?.id || downloading.value) return
  downloading.value = true
  try {
    const path = job.value.output_video_path || job.value.output_video_url || ''
    const play = mediaDisplayUrl(path) || upscaledPlayUrl.value || ''
    await downloadMediaFile(path, `video-${props.videoId}-upscale.mp4`, {
      playUrl: play,
    })
    toast.success('开始下载超分视频')
  } catch (err) {
    toast.error(err?.message || '下载失败')
  } finally {
    downloading.value = false
  }
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function applySplitPct(pct) {
  splitPct = Math.min(92, Math.max(8, pct))
  const before = beforeVideoRef.value
  const divider = compareDividerRef.value
  // 直接改 DOM，不走 Vue 响应式，避免每帧重绘视频
  if (before) before.style.clipPath = `inset(0 ${100 - splitPct}% 0 0)`
  if (divider) divider.style.left = `${splitPct}%`
}

function updateCompareClock(current) {
  const now = Date.now()
  // 节流：最多约 5 次/秒更新文案与滑条，避免闪烁
  if (now - lastClockMs < 200 && current > 0 && current < compareDuration) return
  lastClockMs = now
  const clock = compareClockRef.value
  if (clock) clock.textContent = `${formatClock(current)} / ${formatClock(compareDuration)}`
  const seek = compareSeekRef.value
  if (seek && document.activeElement !== seek) {
    seek.value = String(current)
  }
}

function openCompare() {
  if (!isCompleted.value) return
  const before = mediaDisplayUrl(props.sourceUrl) || props.sourceUrl
  const after = upscaledPlayUrl.value
  if (!before || !after) {
    toast.warning('缺少对比视频地址')
    return
  }
  compareBeforeSrc.value = before
  compareAfterSrc.value = after
  comparePlaying.value = false
  compareMuted.value = false
  compareDuration = 0
  lastClockMs = 0
  compareOpen.value = true
  requestAnimationFrame(() => {
    applySplitPct(50)
    updateCompareClock(0)
    applyCompareMute()
  })
}

function closeCompare() {
  try {
    beforeVideoRef.value?.pause()
    afterVideoRef.value?.pause()
  } catch { /* ignore */ }
  comparePlaying.value = false
  compareOpen.value = false
}

function syncCompareDuration() {
  const d = afterVideoRef.value?.duration || beforeVideoRef.value?.duration || 0
  if (!Number.isFinite(d) || d <= 0) return
  compareDuration = d
  const seek = compareSeekRef.value
  if (seek) {
    seek.max = String(Math.max(0.1, d))
  }
  updateCompareClock(afterVideoRef.value?.currentTime || 0)
  applySplitPct(splitPct)
}

function onCompareTimeUpdate() {
  const after = afterVideoRef.value
  const before = beforeVideoRef.value
  if (!after) return
  // 保持双轨同步，避免画面撕裂/闪烁
  if (before && Math.abs((before.currentTime || 0) - (after.currentTime || 0)) > 0.12) {
    try { before.currentTime = after.currentTime } catch { /* ignore */ }
  }
  updateCompareClock(after.currentTime || 0)
}

function onCompareEnded() {
  comparePlaying.value = false
  try {
    beforeVideoRef.value?.pause()
    afterVideoRef.value?.pause()
  } catch { /* ignore */ }
  updateCompareClock(compareDuration || 0)
}

function applyCompareMute() {
  const before = beforeVideoRef.value
  const after = afterVideoRef.value
  // 原片始终静音；超分轨按开关出声，避免双轨叠音
  if (before) before.muted = true
  if (after) after.muted = compareMuted.value
}

function toggleCompareMute() {
  compareMuted.value = !compareMuted.value
  applyCompareMute()
}

async function toggleComparePlay() {
  const before = beforeVideoRef.value
  const after = afterVideoRef.value
  if (!before || !after) return
  if (comparePlaying.value) {
    before.pause()
    after.pause()
    comparePlaying.value = false
    return
  }
  applyCompareMute()
  try {
    // 先对齐时间再播，减少双视频不同步闪动
    before.currentTime = after.currentTime || 0
    await Promise.all([before.play(), after.play()])
    comparePlaying.value = true
    applyCompareMute()
  } catch {
    comparePlaying.value = false
    toast.error('无法播放对比视频')
  }
}

function onCompareSeek(e) {
  const t = Number(e.target?.value || 0)
  if (beforeVideoRef.value) beforeVideoRef.value.currentTime = t
  if (afterVideoRef.value) afterVideoRef.value.currentTime = t
  updateCompareClock(t)
}

function onSplitPointerDown(e) {
  if (e.target?.closest?.('.c2-compare-tag')) return
  e.preventDefault()
  splitDragging = true
  updateSplitFromEvent(e)
  const move = (ev) => {
    if (!splitDragging) return
    updateSplitFromEvent(ev)
  }
  const up = () => {
    splitDragging = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
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
  applySplitPct(pct)
}

watch(() => props.initialJob, (val) => {
  if (val) {
    job.value = val
    ensurePolling()
  }
})

onMounted(() => {
  void loadInitial()
})

onUnmounted(() => {
  stopPolling()
  closeCompare()
})

defineExpose({ job, refresh: loadInitial })
</script>

<style scoped>
.c2-upscale {
  margin-top: 8px;
  display: grid;
  gap: 8px;
}
.c2-upscale-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.c2-upscale-btn.is-compare {
  background: linear-gradient(135deg, #ff6a00 0%, #ee0935 55%, #c4008c 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 800;
  letter-spacing: 0.04em;
  box-shadow:
    0 0 0 1px rgba(255, 120, 40, 0.35),
    0 6px 16px rgba(238, 9, 53, 0.35);
}
.c2-upscale-btn.is-compare:hover {
  filter: brightness(1.06);
}
.c2-upscale-progress {
  display: grid;
  gap: 4px;
}
.c2-upscale-progress-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #475569;
}
.c2-upscale-progress-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(40, 64, 104, 0.12);
  overflow: hidden;
}
.c2-upscale-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #1d4ed8);
  transition: width 0.4s ease;
}
.c2-upscale-progress-hint,
.c2-upscale-error {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
}
.c2-upscale-error { color: #b91c1c; }

.c2-compare-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(8, 12, 20, 0.72);
  display: grid;
  place-items: center;
  padding: 20px;
}
.c2-compare-shell {
  width: min(960px, 100%);
  background: #111827;
  color: #f8fafc;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
}
.c2-compare-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.c2-compare-bar h3 {
  margin: 0;
  font-size: 15px;
}
.c2-compare-frame {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #000;
  overflow: hidden;
  touch-action: none;
  cursor: ew-resize;
}
.c2-compare-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.c2-compare-video.is-before {
  z-index: 2;
  /* 初始对半；运行时由 JS 直接写 style.clipPath，不走 Vue 绑定 */
  clip-path: inset(0 50% 0 0);
}
.c2-compare-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  background: rgba(255, 255, 255, 0.9);
  z-index: 3;
  transform: translateX(-50%);
  pointer-events: none;
}
.c2-compare-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #fff;
  color: #111;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}
.c2-compare-tag {
  position: absolute;
  top: 12px;
  z-index: 4;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
}
.c2-compare-tag.is-before { left: 12px; }
.c2-compare-tag.is-after { right: 12px; }
.c2-compare-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.c2-compare-seek {
  flex: 1;
}
.c2-compare-footer .btn.active {
  background: #1f4fc0;
  border-color: #1f4fc0;
  color: #fff;
}
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dim { color: #94a3b8; }
</style>
