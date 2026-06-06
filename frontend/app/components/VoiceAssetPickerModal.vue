<template>
  <div v-if="open" class="voice-picker-overlay" @click.self="close">
    <div class="voice-picker-dialog card">
      <div class="voice-picker-head">
        <div>
          <h3 class="voice-picker-title">选择音色参考</h3>
          <p class="dim voice-picker-sub">最多选择 {{ max }} 个（3~10 秒 MP3）</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div v-if="!items.length" class="dim voice-picker-empty">暂无可用音色，请先在音色库上传</div>
      <div v-else class="voice-picker-list">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="voice-picker-item"
          :class="{ selected: pendingIds.includes(item.id), disabled: !pendingIds.includes(item.id) && pendingIds.length >= max }"
          @click="toggle(item.id)"
        >
          <div class="voice-picker-meta">
            <span class="voice-picker-name">{{ item.name }}</span>
            <span v-if="item.duration" class="dim">{{ formatVoiceDuration(item.duration) }}</span>
          </div>
          <audio
            v-if="item.path"
            class="voice-picker-audio"
            :src="'/' + item.path"
            controls
            preload="none"
            @click.stop
          />
        </button>
      </div>

      <div class="voice-picker-foot">
        <span class="dim">{{ pendingIds.length ? `已选 ${pendingIds.length}/${max}` : '未选择音色' }}</span>
        <div class="voice-picker-actions">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button type="button" class="btn btn-primary btn-sm" @click="confirm">确认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { formatVoiceDuration, voiceRefFromAsset, MAX_VOICE_REFS } from '~/utils/voice-refs.js'
import { normalizeMediaPath } from '~/utils/media-url.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  voices: { type: Array, default: () => [] },
  selected: { type: Array, default: () => [] },
  max: { type: Number, default: MAX_VOICE_REFS },
})

const emit = defineEmits(['close', 'confirm'])

const pendingIds = ref([])

const items = computed(() =>
  (props.voices || []).map(v => ({
    id: v.id,
    name: v.name || `音色#${v.id}`,
    duration: v.duration,
    path: normalizeMediaPath(v.local_path || v.localPath || v.url),
  })).filter(v => v.path),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    pendingIds.value = (props.selected || [])
      .map(ref => ref.asset_id ?? ref.assetId)
      .filter(Boolean)
  },
)

function toggle(id) {
  const idx = pendingIds.value.indexOf(id)
  if (idx >= 0) {
    pendingIds.value.splice(idx, 1)
    return
  }
  if (pendingIds.value.length >= props.max) return
  pendingIds.value.push(id)
}

function close() {
  emit('close')
}

function confirm() {
  const picked = items.value
    .filter(item => pendingIds.value.includes(item.id))
    .map(item => {
      const asset = (props.voices || []).find(v => v.id === item.id)
      return voiceRefFromAsset(asset)
    })
    .filter(Boolean)
  emit('confirm', picked.slice(0, props.max))
  emit('close')
}
</script>

<style scoped>
.voice-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.voice-picker-dialog {
  width: min(560px, 100%);
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.voice-picker-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.voice-picker-title {
  margin: 0;
  font-size: 16px;
}

.voice-picker-sub {
  margin: 4px 0 0;
  font-size: 12px;
}

.voice-picker-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  flex: 1;
  min-height: 180px;
}

.voice-picker-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-2);
  text-align: left;
  cursor: pointer;
}

.voice-picker-item.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.voice-picker-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.voice-picker-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.voice-picker-name {
  font-size: 13px;
  font-weight: 600;
}

.voice-picker-audio {
  width: 100%;
  height: 32px;
}

.voice-picker-empty {
  padding: 32px;
  text-align: center;
}

.voice-picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.voice-picker-actions {
  display: flex;
  gap: 8px;
}
</style>
