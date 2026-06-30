<template>
  <div class="studio-card-media" :class="ratioClass">
    <img
      v-if="posterSrc"
      :src="posterSrc"
      class="studio-card-poster"
      loading="lazy"
      decoding="async"
      alt=""
    />
    <div v-else-if="processing" class="studio-card-loading">
      <div class="studio-spinner" />
      <span>{{ processingLabel }}</span>
    </div>
    <div v-else-if="playable" class="studio-card-fallback studio-card-playable-placeholder">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
      <span>点击查看视频</span>
    </div>
    <div v-else class="studio-card-fallback">
      <span>{{ fallbackLabel }}</span>
      <p v-if="errorMsg" class="studio-card-error">{{ errorMsg }}</p>
    </div>

    <div v-if="posterSrc && playable" class="studio-card-play-badge" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>

    <div v-if="refCount" class="studio-card-ref-badge">
      {{ refCount }} 图
    </div>
    <div class="studio-card-status">
      <span class="tag" :class="statusClass">{{ statusLabel }}</span>
    </div>
    <button
      v-if="playable"
      type="button"
      class="studio-card-download"
      title="下载视频"
      @click.stop="$emit('download')"
    >
      ↓
    </button>
  </div>
</template>

<script setup>
defineProps({
  posterSrc: { type: String, default: '' },
  playable: { type: Boolean, default: false },
  processing: { type: Boolean, default: false },
  ratioClass: { type: String, default: '' },
  statusLabel: { type: String, default: '' },
  statusClass: { type: String, default: '' },
  processingLabel: { type: String, default: '生成中' },
  fallbackLabel: { type: String, default: '' },
  errorMsg: { type: String, default: '' },
  refCount: { type: Number, default: 0 },
})

defineEmits(['download'])
</script>

<style scoped>
.studio-card-media {
  position: relative;
  aspect-ratio: 9 / 16;
  background: #101620;
  overflow: hidden;
  border-radius: 12px 12px 0 0;
}
.studio-card-media.ratio-landscape {
  aspect-ratio: 16 / 9;
}
.studio-card-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #101620;
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
.studio-card-loading,
.studio-card-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 13px;
  padding: 12px;
  text-align: center;
}
.studio-card-playable-placeholder {
  color: rgba(255, 255, 255, 0.85);
  background: linear-gradient(180deg, #1a2230, #101620);
}
.studio-card-playable-placeholder svg {
  opacity: 0.9;
}
.studio-card-error {
  font-size: 11px;
  color: var(--danger);
  margin: 0;
  max-height: 4.5em;
  overflow: hidden;
}
.studio-card-ref-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  padding: 2px 8px;
  border-radius: 999px;
  z-index: 2;
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
}
.studio-card-media:hover .studio-card-download {
  opacity: 1;
}
.studio-card-download:hover {
  background: rgba(76, 125, 255, 0.88);
}
</style>
