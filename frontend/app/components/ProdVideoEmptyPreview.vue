<template>
  <div
    class="prod-video-empty"
    :class="{
      'prod-video-empty-portrait': portrait,
      'prod-video-empty-compact': compact,
    }"
  >
    <img
      v-if="coverUrl"
      class="prod-video-empty-bg"
      :src="coverUrl"
      alt=""
      loading="lazy"
      decoding="async"
    />
    <div
      class="prod-video-empty-stage"
      :class="{ 'prod-video-empty-stage-clickable': coverUrl }"
      @click="onStageClick"
    >
      <img
        v-if="coverUrl"
        :src="coverUrl"
        class="prod-video-empty-ref"
        alt=""
        loading="lazy"
        decoding="async"
      />
      <div v-else class="prod-video-empty-placeholder">
        <div class="prod-video-empty-icon-ring">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <span class="prod-video-empty-title">{{ emptyTitle }}</span>
        <span class="prod-video-empty-hint">{{ emptyHint }}</span>
      </div>
    </div>
    <span v-if="coverUrl" class="prod-video-empty-ref-hint">参考图 · 点击放大</span>
    <span v-if="indexLabel" class="prod-video-empty-idx">{{ indexLabel }}</span>
    <slot name="badges" />
  </div>
</template>

<script setup>
const props = defineProps({
  coverUrl: { type: String, default: '' },
  indexLabel: { type: String, default: '' },
  portrait: { type: Boolean, default: false },
  compact: { type: Boolean, default: true },
  emptyTitle: { type: String, default: '暂无视频' },
  emptyHint: { type: String, default: '填写提示词后点击生成视频' },
})

const emit = defineEmits(['preview-cover'])

function onStageClick() {
  if (props.coverUrl) emit('preview-cover')
}
</script>

<style scoped>
.prod-video-empty {
  position: relative;
  aspect-ratio: 16 / 9;
  background: linear-gradient(180deg, #e9eef5, #dfe6f0);
  overflow: hidden;
}
.prod-video-empty-compact {
  aspect-ratio: auto;
  height: 310px;
}
.prod-video-empty-portrait.prod-video-empty-compact {
  height: 310px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(90deg, #e3e8f0 0%, #edf1f7 38%, #edf1f7 62%, #e3e8f0 100%);
}
.prod-video-empty-bg {
  position: absolute;
  inset: -8%;
  width: 116%;
  height: 116%;
  object-fit: cover;
  filter: blur(22px) saturate(1.08);
  opacity: 0.34;
  pointer-events: none;
}
.prod-video-empty-stage {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #101620;
}
.prod-video-empty-portrait .prod-video-empty-stage {
  width: auto;
  max-width: 42%;
  height: 100%;
}
.prod-video-empty-stage-clickable {
  cursor: zoom-in;
}
.prod-video-empty-ref {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #101620;
}
.prod-video-empty-portrait .prod-video-empty-ref {
  width: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.prod-video-empty-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 12px;
  text-align: center;
}
.prod-video-empty-icon-ring {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(148, 163, 184, 0.95);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.prod-video-empty-title {
  font-size: 12px;
  font-weight: 700;
  color: rgba(226, 232, 240, 0.96);
  letter-spacing: 0.02em;
}
.prod-video-empty-hint {
  max-width: 132px;
  font-size: 10px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.88);
}
.prod-video-empty-ref-hint {
  position: absolute;
  left: 50%;
  bottom: 8px;
  z-index: 2;
  transform: translateX(-50%);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(0, 0, 0, 0.42);
  padding: 2px 8px;
  border-radius: 999px;
  pointer-events: none;
}
.prod-video-empty-idx {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  background: rgba(0, 0, 0, 0.52);
  color: #fff;
  padding: 2px 6px;
  border-radius: 6px;
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
