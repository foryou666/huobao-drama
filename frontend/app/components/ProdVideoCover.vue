<template>
  <div
    ref="rootRef"
    class="prod-video-cover"
    :class="{ 'prod-video-cover-portrait': portrait, 'prod-video-cover-clickable': clickable }"
    @click="handleCoverClick"
  >
    <img
      v-if="posterUrl"
      :src="posterUrl"
      class="prod-video-cover-poster"
      loading="lazy"
      decoding="async"
      alt=""
    />
    <video
      v-else-if="videoUrl && inView"
      :src="videoUrl"
      class="prod-video prod-video-thumb"
      muted
      playsinline
      preload="metadata"
      disablePictureInPicture
      @click.stop
    />
    <div v-else-if="videoUrl" class="prod-video-cover-empty prod-video-cover-video-placeholder">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    </div>
    <slot v-else />

    <span v-if="indexLabel" class="prod-video-cover-idx">{{ indexLabel }}</span>
    <slot name="badges" />

    <button
      v-if="videoUrl && showPlay"
      type="button"
      class="prod-video-cover-play-btn"
      aria-label="播放视频"
      @click.stop="emit('play')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="8 5 19 12 8 19 8 5" />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useInViewport } from '~/composables/useInViewport'

const props = defineProps({
  videoUrl: { type: String, default: '' },
  posterUrl: { type: String, default: '' },
  indexLabel: { type: String, default: '' },
  clickable: { type: Boolean, default: false },
  showPlay: { type: Boolean, default: true },
  portrait: { type: Boolean, default: false },
})

const emit = defineEmits(['play', 'cover-click'])

const rootRef = ref(null)
const { inView } = useInViewport(rootRef)

function handleCoverClick() {
  if (props.clickable) emit('cover-click')
}
</script>

<style scoped>
.prod-video-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--bg-2);
  overflow: hidden;
}
.prod-video-cover-portrait {
  aspect-ratio: 9 / 16;
}
.prod-video-cover-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}
.prod-video-cover-portrait .prod-video-cover-poster,
.prod-video-cover-portrait .prod-video {
  object-fit: contain;
}
.prod-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
  display: block;
}
.prod-video-thumb {
  pointer-events: none;
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
  top: 5px;
  left: 5px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  padding: 1px 5px;
  border-radius: 3px;
  z-index: 1;
}
.prod-video-cover-play-btn {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  width: 44px;
  height: 44px;
  margin: -22px 0 0 -22px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}
.prod-video-cover-clickable {
  cursor: pointer;
}
.prod-video-cover-clickable:hover .prod-video-cover-play-btn {
  background: rgba(76, 125, 255, 0.88);
  transform: scale(1.05);
}
</style>
