<template>
  <div
    ref="rootRef"
    class="prod-video-cover"
    :class="{
      'prod-video-cover-portrait': portrait,
      'prod-video-cover-compact': compact,
    }"
  >
    <div
      v-if="videoUrl && shouldShowVideo"
      class="prod-video-cover-player-wrap"
    >
      <video
        ref="videoRef"
        :src="videoUrl"
        :poster="posterUrl || undefined"
        class="prod-video-cover-player"
        controls
        controlsList="nofullscreen"
        playsinline
        preload="metadata"
        @click="onPreviewVideoClick"
      />
      <button
        type="button"
        class="prod-video-cover-zoom-btn"
        aria-label="放大观看"
        @click.stop="emit('expand')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>
    <img
      v-else-if="videoUrl && posterUrl && !shouldShowVideo"
      :src="posterUrl"
      class="prod-video-cover-poster prod-video-cover-poster-clickable"
      loading="lazy"
      decoding="async"
      alt=""
      @click="emit('expand')"
    />
    <div v-else-if="videoUrl" class="prod-video-cover-empty">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    </div>
    <slot v-else />

    <span v-if="indexLabel" class="prod-video-cover-idx">{{ indexLabel }}</span>
    <slot name="badges" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useInViewport } from '~/composables/useInViewport'

defineProps({
  videoUrl: { type: String, default: '' },
  posterUrl: { type: String, default: '' },
  indexLabel: { type: String, default: '' },
  portrait: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['expand'])

const rootRef = ref(null)
const videoRef = ref(null)
const hasActivatedVideo = ref(false)
const { inView } = useInViewport(rootRef)

const shouldShowVideo = computed(() => inView.value || hasActivatedVideo.value)

watch(inView, (visible) => {
  if (visible) hasActivatedVideo.value = true
  if (!visible && videoRef.value) videoRef.value.pause()
})

function onPreviewVideoClick(event) {
  const video = videoRef.value
  if (!video) return
  const rect = video.getBoundingClientRect()
  if (!rect.height) return
  const controlBarHeight = Math.min(64, Math.max(48, rect.height * 0.18))
  const offsetY = event.clientY - rect.top
  if (offsetY >= rect.height - controlBarHeight) return
  video.pause()
  emit('expand')
}
</script>

<style scoped>
.prod-video-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background: linear-gradient(180deg, #e9eef5, #dfe6f0);
  overflow: hidden;
}
.prod-video-cover-compact {
  aspect-ratio: auto;
  height: 310px;
}
.prod-video-cover-portrait.prod-video-cover-compact {
  height: 310px;
}
.prod-video-cover-player-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-in;
}
.prod-video-cover-player-wrap :deep(video::-webkit-media-controls-enclosure) {
  cursor: default;
}
.prod-video-cover-portrait .prod-video-cover-player-wrap {
  width: auto;
  max-width: 42%;
  height: 100%;
}
.prod-video-cover-player {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #101620;
  display: block;
  position: relative;
  z-index: 1;
  pointer-events: auto;
}
.prod-video-cover-portrait .prod-video-cover-player {
  width: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.prod-video-cover-zoom-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.52);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.88;
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
}
.prod-video-cover-zoom-btn:hover {
  background: rgba(76, 125, 255, 0.88);
  opacity: 1;
  transform: scale(1.05);
}
.prod-video-cover-poster {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #101620;
}
.prod-video-cover-portrait .prod-video-cover-poster {
  width: auto;
  max-width: 38%;
  margin: 0 auto;
  display: block;
}
.prod-video-cover-poster-clickable {
  cursor: zoom-in;
}
.prod-video-cover-portrait.prod-video-cover-compact {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(90deg, #e3e8f0 0%, #edf1f7 38%, #edf1f7 62%, #e3e8f0 100%);
}
.prod-video-cover-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
.prod-video-cover-idx {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  background: rgba(0, 0, 0, 0.52);
  color: #fff;
  padding: 2px 6px;
  border-radius: 6px;
  z-index: 2;
  pointer-events: none;
}
:deep(.prod-overlay-badge) {
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 2;
  pointer-events: none;
}
</style>
