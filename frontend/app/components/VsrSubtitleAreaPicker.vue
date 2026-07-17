<template>
  <div class="vsr-area-picker" :class="{ 'is-immediate': immediate }">
    <div v-if="!immediate" class="vsr-area-picker-head">
      <label class="vsr-area-toggle">
        <input v-model="manualMode" type="checkbox" />
        <span>手动框选字幕区域</span>
      </label>
      <span class="dim vsr-area-hint">不框选时使用「STTN 自动检测」；框选后可改用「STTN 框选重绘」</span>
    </div>

    <p v-else class="vsr-area-immediate-hint dim">拖动画面框选字幕区域，或点击下方「底部字幕条预设」</p>

    <div v-if="showBody" class="vsr-area-body">
      <div ref="stageRef" class="vsr-area-stage">
        <video
          ref="videoRef"
          class="vsr-area-video"
          :src="previewUrl"
          muted
          playsinline
          preload="auto"
          @loadedmetadata="onVideoMetadata"
          @timeupdate="onVideoTimeUpdate"
          @seeked="syncCanvasSize"
        />
        <canvas
          ref="canvasRef"
          class="vsr-area-canvas"
          @mousedown="onPointerDown"
          @mousemove="onPointerMove"
          @mouseup="onPointerUp"
          @mouseleave="onPointerUp"
        />
      </div>

      <div class="vsr-area-scrub">
        <button type="button" class="btn btn-sm" :disabled="!videoReady" @click="togglePlay">
          {{ playing ? '暂停' : '播放' }}
        </button>
        <input
          type="range"
          class="vsr-area-scrub-range"
          min="0"
          :max="durationSec || 0"
          step="0.05"
          :value="currentTimeSec"
          :disabled="!videoReady"
          @input="onScrubInput"
          @change="onScrubChange"
        />
        <span class="dim mono vsr-area-scrub-time">{{ formatClock(currentTimeSec) }} / {{ formatClock(durationSec) }}</span>
      </div>

      <div class="vsr-area-toolbar">
        <button type="button" class="btn btn-sm" :disabled="!videoReady" @click="addBottomPreset">
          底部字幕条预设
        </button>
        <button type="button" class="btn btn-sm" :disabled="!areas.length" @click="clearAreas">
          清除全部
        </button>
        <span class="dim vsr-area-drag-hint">拖到字幕位置框选</span>
      </div>

      <ul v-if="areas.length" class="vsr-area-list">
        <li v-for="(area, index) in areas" :key="`area:${index}`" class="vsr-area-item">
          <span class="mono">区域 {{ index + 1 }} · {{ formatVsrArea(area) }}</span>
          <button type="button" class="btn btn-sm" @click="removeArea(index)">删除</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import {
  buildBottomSubtitlePreset,
  displayRectToVsrArea,
  formatVsrArea,
  getVideoContentRect,
  vsrAreaToDisplayRect,
} from '~/utils/vsr-subtitle-area.js'

const props = defineProps({
  file: { type: Object, default: null },
  /** 上传后直接展示预览与框选，无需勾选开关 */
  immediate: { type: Boolean, default: false },
})

const areas = defineModel({ type: Array, default: () => [] })
const manualMode = defineModel('manual', { type: Boolean, default: false })

const showBody = computed(() => props.immediate ? !!props.file : manualMode.value)
const previewUrl = ref('')
const videoReady = ref(false)
const playing = ref(false)
const durationSec = ref(0)
const currentTimeSec = ref(0)
const scrubbing = ref(false)
const stageRef = ref(null)
const videoRef = ref(null)
const canvasRef = ref(null)

const dragging = ref(false)
const dragStart = ref(null)
const dragCurrent = ref(null)

let resizeObserver = null
let objectUrl = ''

function formatClock(sec) {
  const total = Math.max(0, Number(sec) || 0)
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function syncCanvasSize() {
  const stage = stageRef.value
  const canvas = canvasRef.value
  if (!stage || !canvas) return
  const w = stage.clientWidth
  const h = stage.clientHeight
  if (w > 0 && h > 0) {
    canvas.width = w
    canvas.height = h
  }
  redraw()
}

function redraw() {
  const canvas = canvasRef.value
  const video = videoRef.value
  if (!canvas || !video) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const contentRect = getVideoContentRect(video)
  for (const area of areas.value) {
    const rect = vsrAreaToDisplayRect(area, contentRect)
    if (!rect) continue
    ctx.fillStyle = 'rgba(34, 211, 238, 0.18)'
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
  }

  if (dragging.value && dragStart.value && dragCurrent.value) {
    const rect = normalizeDragRect(dragStart.value, dragCurrent.value)
    ctx.fillStyle = 'rgba(250, 204, 21, 0.2)'
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
    ctx.setLineDash([])
  }
}

function normalizeDragRect(start, end) {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  return {
    x,
    y,
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  }
}

function canvasPoint(event) {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}

function onPointerDown(event) {
  if (!videoReady.value) return
  dragging.value = true
  dragStart.value = canvasPoint(event)
  dragCurrent.value = dragStart.value
  redraw()
}

function onPointerMove(event) {
  if (!dragging.value) return
  dragCurrent.value = canvasPoint(event)
  redraw()
}

function onPointerUp() {
  if (!dragging.value) return
  const video = videoRef.value
  const start = dragStart.value
  const end = dragCurrent.value
  dragging.value = false
  dragStart.value = null
  dragCurrent.value = null

  if (!video || !start || !end) {
    redraw()
    return
  }

  const dragRect = normalizeDragRect(start, end)
  if (dragRect.w < 6 || dragRect.h < 6) {
    redraw()
    return
  }

  const area = displayRectToVsrArea(dragRect, getVideoContentRect(video))
  if (!area) {
    redraw()
    return
  }

  areas.value = [...areas.value, area]
  redraw()
}

function onVideoMetadata() {
  const video = videoRef.value
  if (!video) return
  videoReady.value = true
  durationSec.value = Number.isFinite(video.duration) ? video.duration : 0
  currentTimeSec.value = video.currentTime || 0
  syncCanvasSize()
}

function onVideoTimeUpdate() {
  if (scrubbing.value) return
  const video = videoRef.value
  if (!video) return
  currentTimeSec.value = video.currentTime
  if (video.paused) redraw()
}

function onScrubInput(event) {
  const video = videoRef.value
  if (!video) return
  scrubbing.value = true
  const next = Number(event.target.value)
  currentTimeSec.value = next
  video.currentTime = next
  redraw()
}

function onScrubChange() {
  scrubbing.value = false
  redraw()
}

async function togglePlay() {
  const video = videoRef.value
  if (!video) return
  if (video.paused) {
    try {
      await video.play()
      playing.value = true
    } catch {
      playing.value = false
    }
    return
  }
  video.pause()
  playing.value = false
  redraw()
}

function addBottomPreset() {
  const video = videoRef.value
  if (!video?.videoWidth) return
  areas.value = [
    ...areas.value,
    buildBottomSubtitlePreset(video.videoWidth, video.videoHeight),
  ]
  redraw()
}

function clearAreas() {
  areas.value = []
  redraw()
}

function removeArea(index) {
  areas.value = areas.value.filter((_, i) => i !== index)
  redraw()
}

function resetPreview() {
  videoReady.value = false
  playing.value = false
  durationSec.value = 0
  currentTimeSec.value = 0
  scrubbing.value = false
  dragging.value = false
  dragStart.value = null
  dragCurrent.value = null
  areas.value = []
  manualMode.value = props.immediate

  const video = videoRef.value
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
  previewUrl.value = ''
}

watch(() => props.file, (file) => {
  resetPreview()
  if (!file) return
  objectUrl = URL.createObjectURL(file)
  previewUrl.value = objectUrl
  if (props.immediate) manualMode.value = true
}, { immediate: true })

watch(manualMode, (enabled) => {
  if (props.immediate) return
  if (!enabled) {
    areas.value = []
    dragging.value = false
    dragStart.value = null
    dragCurrent.value = null
    const video = videoRef.value
    if (video && !video.paused) {
      video.pause()
      playing.value = false
    }
    redraw()
  }
})

watch(areas, () => {
  redraw()
}, { deep: true })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && stageRef.value) {
    resizeObserver = new ResizeObserver(() => syncCanvasSize())
    resizeObserver.observe(stageRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  const video = videoRef.value
  if (video && !video.paused) video.pause()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<style scoped>
.vsr-area-picker {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.vsr-area-picker.is-immediate {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.vsr-area-picker.is-immediate .vsr-area-stage,
.vsr-area-picker.is-immediate .vsr-area-scrub {
  max-width: none;
}
.vsr-area-immediate-hint {
  margin: 0 0 10px;
  font-size: 12px;
}

.vsr-area-picker-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
}

.vsr-area-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.vsr-area-hint,
.vsr-area-drag-hint {
  font-size: 12px;
}

.vsr-area-body {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vsr-area-stage {
  position: relative;
  width: 100%;
  max-width: 720px;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.vsr-area-video,
.vsr-area-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.vsr-area-video {
  object-fit: contain;
  pointer-events: none;
}

.vsr-area-canvas {
  cursor: crosshair;
}

.vsr-area-scrub {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  max-width: 720px;
}

.vsr-area-scrub-range {
  flex: 1;
  min-width: 180px;
  accent-color: var(--accent, #22d3ee);
}

.vsr-area-scrub-time {
  font-size: 12px;
  min-width: 88px;
}

.vsr-area-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.vsr-area-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vsr-area-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--bg-2);
  font-size: 12px;
}
</style>
