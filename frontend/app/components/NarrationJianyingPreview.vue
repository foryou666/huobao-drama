<template>
  <div class="jy-preview">
    <div class="jy-preview-stage">
      <div class="jy-preview-monitor">
        <video
          ref="videoEl"
          class="jy-preview-video"
          playsinline
          muted
          preload="auto"
          @ended="onVideoEnded"
          @timeupdate="onVideoTimeUpdate"
          @error="onMediaError"
        />
        <audio ref="audioEl" preload="auto" @ended="onAudioEnded" @error="onMediaError" />
        <div v-if="!readyClips.length" class="jy-preview-empty">
          <p>暂无完整镜头</p>
          <p class="dim">请先完成各段 TTS 与 Grok 视频后再预览拼接效果</p>
        </div>
        <div v-else-if="!playing && currentGlobalSec <= 0.05" class="jy-preview-empty jy-preview-empty-overlay">
          <button type="button" class="btn btn-primary" :disabled="!readyClips.length" @click="togglePlay">
            播放全片预览
          </button>
        </div>
        <div v-if="currentClip" class="jy-preview-caption">
          <span class="jy-preview-caption-idx">#{{ currentClip.index + 1 }}</span>
          {{ currentClip.text }}
        </div>
      </div>
    </div>

    <div class="jy-preview-transport">
      <button type="button" class="btn btn-sm" :disabled="!readyClips.length" @click="togglePlay">
        {{ playing ? '暂停' : '播放' }}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="!readyClips.length" @click="stopPlayback">
        停止
      </button>
      <span class="jy-preview-time">{{ formatClock(currentGlobalSec) }} / {{ formatClock(totalDuration) }}</span>
      <span class="dim jy-preview-hint">
        按旁白时长对齐 · 视频不足时循环铺满（与剪映草稿一致）
      </span>
    </div>

    <div
      ref="rulerRef"
      class="jy-preview-ruler"
      :class="{ disabled: !readyClips.length }"
      @pointerdown="onRulerPointerDown"
    >
      <div class="jy-preview-ruler-track">
        <button
          v-for="clip in readyClips"
          :key="clip.id"
          type="button"
          class="jy-preview-clip"
          :class="{ active: currentClip?.id === clip.id }"
          :style="{ width: `${clipWidthPercent(clip)}%` }"
          :title="`#${clip.index + 1} · ${formatClock(clip.duration)}`"
          @click.stop="seekToClip(clip)"
        >
          <span class="jy-preview-clip-label">{{ clip.index + 1 }}</span>
        </button>
        <div
          class="jy-preview-playhead"
          :style="{ left: `${playheadPercent}%` }"
        />
      </div>
    </div>

    <div v-if="missingCount" class="jy-preview-warn dim">
      还有 {{ missingCount }} 段缺少旁白或视频，预览仅包含已完成片段。
    </div>
  </div>
</template>

<script setup>
import { mediaDisplayUrl } from '~/utils/media-url.js'

const props = defineProps({
  segments: { type: Array, default: () => [] },
})

const videoEl = ref(null)
const audioEl = ref(null)
const rulerRef = ref(null)
const playing = ref(false)
const currentGlobalSec = ref(0)
const currentClipId = ref(null)
const seeking = ref(false)

let rafId = 0
let clipCursor = 0
let clipLocalOffset = 0

const readyClips = computed(() => {
  const list = []
  for (const seg of props.segments || []) {
    const videoUrl = String(seg?.video_url || seg?.videoUrl || '').trim()
    const audioUrl = String(
      seg?.tts_audio_url
      || seg?.ttsAudioUrl
      || seg?.tts_audio_path
      || seg?.ttsAudioPath
      || '',
    ).trim()
    const hasVideo = !!videoUrl || seg?.status === 'completed'
    if (!hasVideo || !audioUrl || !videoUrl) continue
    const duration = Math.max(
      0.2,
      Number(seg.tts_duration_sec) || Number(seg.video_duration_sec) || 3,
    )
    list.push({
      id: seg.id,
      index: Number(seg.segment_index ?? list.length),
      text: String(seg.text || '').trim(),
      duration,
      videoDuration: Math.max(0.2, Number(seg.video_duration_sec) || duration),
      videoUrl: mediaDisplayUrl(videoUrl),
      audioUrl: mediaDisplayUrl(audioUrl),
      start: 0,
    })
  }
  let cursor = 0
  for (const clip of list) {
    clip.start = cursor
    cursor += clip.duration
  }
  return list
})

const missingCount = computed(() => {
  const total = (props.segments || []).length
  return Math.max(0, total - readyClips.value.length)
})

const totalDuration = computed(() => {
  const last = readyClips.value[readyClips.value.length - 1]
  return last ? last.start + last.duration : 0
})

const currentClip = computed(() =>
  readyClips.value.find(c => c.id === currentClipId.value) || readyClips.value[0] || null,
)

const playheadPercent = computed(() => {
  if (!totalDuration.value) return 0
  return Math.min(100, Math.max(0, (currentGlobalSec.value / totalDuration.value) * 100))
})

function clipWidthPercent(clip) {
  if (!totalDuration.value) return 0
  return Math.max(1.2, (clip.duration / totalDuration.value) * 100)
}

function formatClock(sec) {
  const n = Math.max(0, Number(sec) || 0)
  const m = Math.floor(n / 60)
  const s = Math.floor(n % 60)
  const ms = Math.floor((n % 1) * 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}

function findClipAt(globalSec) {
  const clips = readyClips.value
  if (!clips.length) return null
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]
    if (globalSec < clip.start + clip.duration || i === clips.length - 1) {
      return { clip, index: i, local: Math.max(0, globalSec - clip.start) }
    }
  }
  const last = clips[clips.length - 1]
  return { clip: last, index: clips.length - 1, local: last.duration }
}

async function loadClip(clip, localSec = 0, shouldPlay = false) {
  const video = videoEl.value
  const audio = audioEl.value
  if (!video || !audio || !clip) return

  currentClipId.value = clip.id
  clipLocalOffset = Math.min(Math.max(0, localSec), clip.duration - 0.05)

  const videoNeedsLoad = video.dataset.src !== clip.videoUrl
  const audioNeedsLoad = audio.dataset.src !== clip.audioUrl
  if (videoNeedsLoad) {
    video.dataset.src = clip.videoUrl
    video.src = clip.videoUrl
  }
  if (audioNeedsLoad) {
    audio.dataset.src = clip.audioUrl
    audio.src = clip.audioUrl
  }

  await Promise.all([
    videoNeedsLoad ? waitMediaReady(video) : Promise.resolve(),
    audioNeedsLoad ? waitMediaReady(audio) : Promise.resolve(),
  ])

  const videoTime = clip.videoDuration > 0
    ? clipLocalOffset % clip.videoDuration
    : 0
  try {
    video.currentTime = videoTime
    audio.currentTime = clipLocalOffset
  } catch { /* ignore seek race */ }

  if (shouldPlay) {
    try {
      await Promise.all([video.play(), audio.play()])
      playing.value = true
      startTicker()
    } catch {
      playing.value = false
    }
  } else {
    video.pause()
    audio.pause()
  }
}

function waitMediaReady(el) {
  if (!el) return Promise.resolve()
  if (el.readyState >= 2) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('loadeddata', done)
      el.removeEventListener('error', done)
      resolve()
    }
    el.addEventListener('loadeddata', done, { once: true })
    el.addEventListener('error', done, { once: true })
  })
}

function startTicker() {
  stopTicker()
  const tick = () => {
    if (!playing.value) return
    const audio = audioEl.value
    const clip = currentClip.value
    if (audio && clip) {
      currentGlobalSec.value = clip.start + (audio.currentTime || 0)
    }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopTicker() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

async function togglePlay() {
  if (!readyClips.value.length) return
  if (playing.value) {
    pausePlayback()
    return
  }
  const hit = findClipAt(currentGlobalSec.value)
  if (!hit) return
  clipCursor = hit.index
  await loadClip(hit.clip, hit.local, true)
}

function pausePlayback() {
  playing.value = false
  stopTicker()
  videoEl.value?.pause()
  audioEl.value?.pause()
}

function stopPlayback() {
  pausePlayback()
  currentGlobalSec.value = 0
  clipCursor = 0
  const first = readyClips.value[0]
  if (first) void loadClip(first, 0, false)
}

async function seekToGlobal(globalSec) {
  if (!readyClips.value.length) return
  const clamped = Math.min(Math.max(0, globalSec), Math.max(0, totalDuration.value - 0.05))
  currentGlobalSec.value = clamped
  const hit = findClipAt(clamped)
  if (!hit) return
  clipCursor = hit.index
  await loadClip(hit.clip, hit.local, playing.value)
}

function seekToClip(clip) {
  void seekToGlobal(clip.start)
}

function onRulerPointerDown(event) {
  if (!readyClips.value.length || !rulerRef.value) return
  const rect = rulerRef.value.getBoundingClientRect()
  if (!rect.width) return
  seeking.value = true
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  void seekToGlobal(ratio * totalDuration.value)

  const onMove = (e) => {
    const r = rulerRef.value?.getBoundingClientRect()
    if (!r?.width) return
    const next = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    void seekToGlobal(next * totalDuration.value)
  }
  const onUp = () => {
    seeking.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

async function advanceToNextClip() {
  const next = readyClips.value[clipCursor + 1]
  if (!next) {
    stopPlayback()
    currentGlobalSec.value = totalDuration.value
    return
  }
  clipCursor += 1
  currentGlobalSec.value = next.start
  await loadClip(next, 0, true)
}

function onAudioEnded() {
  if (!playing.value) return
  void advanceToNextClip()
}

function onVideoEnded() {
  // 视频短于旁白时循环，直到音频结束
  const video = videoEl.value
  const clip = currentClip.value
  if (!playing.value || !video || !clip) return
  const audio = audioEl.value
  if (audio && !audio.ended && audio.currentTime < clip.duration - 0.08) {
    try {
      video.currentTime = 0
      void video.play()
    } catch { /* ignore */ }
  }
}

function onVideoTimeUpdate() {
  // 保险：若视频自然时长探测不准，靠 audio 推进时间轴
  if (!playing.value || seeking.value) return
  const audio = audioEl.value
  const clip = currentClip.value
  if (audio && clip) {
    currentGlobalSec.value = clip.start + (audio.currentTime || 0)
  }
}

function onMediaError() {
  // 单段失败时尝试跳到下一段，避免整预览卡死
  if (playing.value) void advanceToNextClip()
}

watch(
  readyClips,
  (clips) => {
    pausePlayback()
    currentGlobalSec.value = 0
    clipCursor = 0
    if (clips[0]) void loadClip(clips[0], 0, false)
  },
  { immediate: true },
)

onUnmounted(() => {
  pausePlayback()
  const video = videoEl.value
  const audio = audioEl.value
  if (video) {
    video.removeAttribute('src')
    video.load()
  }
  if (audio) {
    audio.removeAttribute('src')
    audio.load()
  }
})
</script>

<style scoped>
.jy-preview {
  flex: 1;
  min-width: 0;
  min-height: 0;
  margin: 0 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #0f1218;
  border: 1px solid #1f2733;
  border-radius: 12px;
  padding: 16px;
  color: #e8edf5;
}

.jy-preview-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.jy-preview-monitor {
  position: relative;
  width: min(360px, 42vh);
  aspect-ratio: 9 / 16;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.jy-preview-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}

.jy-preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  text-align: center;
  background: #12151c;
  color: #9aa6b8;
}

.jy-preview-empty-overlay {
  background: rgba(8, 10, 14, 0.55);
}

.jy-preview-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 12px 14px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
  font-size: 13px;
  line-height: 1.45;
  max-height: 42%;
  overflow: hidden;
}

.jy-preview-caption-idx {
  display: inline-block;
  margin-right: 6px;
  color: #8eb0ff;
  font-weight: 600;
}

.jy-preview-transport {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.jy-preview-time {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: #c5d0e0;
}

.jy-preview-hint {
  font-size: 12px;
  color: #7f8b9c;
}

.jy-preview-ruler {
  height: 56px;
  border-radius: 8px;
  background: #161b24;
  border: 1px solid #273142;
  padding: 8px;
  cursor: pointer;
  user-select: none;
  touch-action: none;
}

.jy-preview-ruler.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.jy-preview-ruler-track {
  position: relative;
  display: flex;
  height: 100%;
  gap: 2px;
  overflow: hidden;
  border-radius: 6px;
}

.jy-preview-clip {
  position: relative;
  flex: 0 0 auto;
  min-width: 18px;
  height: 100%;
  border: 0;
  border-radius: 4px;
  background: linear-gradient(180deg, #3d5fbf 0%, #2a4490 100%);
  color: #fff;
  cursor: pointer;
  padding: 0;
  overflow: hidden;
}

.jy-preview-clip.active {
  outline: 2px solid #8eb0ff;
  outline-offset: -2px;
  background: linear-gradient(180deg, #5b7fe0 0%, #3556b5 100%);
}

.jy-preview-clip-label {
  position: absolute;
  left: 4px;
  top: 4px;
  font-size: 10px;
  font-weight: 600;
  opacity: 0.9;
}

.jy-preview-playhead {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  margin-left: -1px;
  background: #ff6b6b;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 2;
}

.jy-preview-warn {
  font-size: 12px;
}

@media (max-width: 900px) {
  .jy-preview {
    margin: 0 16px 12px;
  }

  .jy-preview-monitor {
    width: min(280px, 48vw);
  }
}
</style>
