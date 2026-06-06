<template>
  <div v-if="open" class="entity-picker-overlay" @click.self="close">
    <div class="entity-picker-dialog card">
      <div class="entity-picker-head">
        <div>
          <h3 class="entity-picker-title">{{ title }}</h3>
          <p class="dim entity-picker-sub">{{ subtitle }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div class="entity-picker-toolbar">
        <input v-model="keyword" class="input" :placeholder="searchPlaceholder" />
      </div>

      <div v-if="!filteredItems.length" class="dim entity-picker-empty">暂无匹配项</div>
      <div v-else class="entity-picker-grid">
        <button
          v-for="item in filteredItems"
          :key="item.id"
          type="button"
          class="entity-picker-item"
          :class="{ selected: isSelected(item.id) }"
          @click="onItemClick(item)"
        >
          <GridMediaImage
            v-if="item.thumb"
            :src="item.thumb"
            :alt="item.label"
            :placeholder="item.label.slice(0, 1)"
          />
          <div v-else class="entity-picker-thumb-empty">{{ item.label.slice(0, 1) }}</div>
          <span class="entity-picker-name">{{ item.label }}</span>
          <span v-if="item.sub" class="entity-picker-tag dim">{{ item.sub }}</span>
        </button>
      </div>

      <div class="entity-picker-foot">
        <span class="dim">{{ selectedSummary }}</span>
        <div class="entity-picker-actions">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button type="button" class="btn btn-primary btn-sm" @click="confirm">确认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { resolveCharacterImageUrl } from '~/utils/character-image-variants.js'
import { normalizeMediaPath } from '~/utils/media-url.js'
import GridMediaImage from '~/components/GridMediaImage.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'character' },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  selectedCharacterIds: { type: Array, default: () => [] },
  selectedSceneIds: { type: Array, default: () => [] },
  selectedSceneId: { type: [Number, String, null], default: null },
})

const emit = defineEmits(['close', 'confirm'])

const keyword = ref('')
const pendingCharIds = ref([])
const pendingSceneIds = ref([])

const title = computed(() => (props.mode === 'scene' ? '选择场景' : '选择角色'))
const subtitle = computed(() => (
  props.mode === 'scene'
    ? '可多选；确认后绑定场景，可用 @ 关联参考图'
    : '可多选；确认后写入提示词并绑定角色'
))
const searchPlaceholder = computed(() => (props.mode === 'scene' ? '搜索场景地点…' : '搜索角色名…'))

const items = computed(() => {
  if (props.mode === 'scene') {
    return (props.scenes || []).map(scene => ({
      id: scene.id,
      label: scene.location || `场景#${scene.id}`,
      sub: scene.time || '',
      thumb: normalizeMediaPath(scene.image_url || scene.imageUrl || scene.local_path || scene.localPath),
    }))
  }
  return (props.characters || []).map(char => ({
    id: char.id,
    label: char.name || `角色#${char.id}`,
    sub: char.role || '',
    thumb: resolveCharacterImageUrl(char, {}),
  }))
})

const filteredItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(item =>
    item.label.toLowerCase().includes(q)
    || String(item.sub || '').toLowerCase().includes(q),
  )
})

const selectedSummary = computed(() => {
  if (props.mode === 'scene') {
    return pendingSceneIds.value.length
      ? `已选 ${pendingSceneIds.value.length} 个场景`
      : '未选择场景'
  }
  return pendingCharIds.value.length
    ? `已选 ${pendingCharIds.value.length} 个角色`
    : '未选择角色'
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    keyword.value = ''
    pendingCharIds.value = [...(props.selectedCharacterIds || [])]
    pendingSceneIds.value = props.selectedSceneIds?.length
      ? [...props.selectedSceneIds]
      : (props.selectedSceneId ? [Number(props.selectedSceneId)] : [])
  },
)

function isSelected(id) {
  if (props.mode === 'scene') return pendingSceneIds.value.includes(id)
  return pendingCharIds.value.includes(id)
}

function onItemClick(item) {
  if (props.mode === 'scene') {
    const idx = pendingSceneIds.value.indexOf(item.id)
    if (idx >= 0) pendingSceneIds.value.splice(idx, 1)
    else pendingSceneIds.value.push(item.id)
    return
  }
  const idx = pendingCharIds.value.indexOf(item.id)
  if (idx >= 0) pendingCharIds.value.splice(idx, 1)
  else pendingCharIds.value.push(item.id)
}

function close() {
  emit('close')
}

function confirm() {
  if (props.mode === 'scene') {
    const picked = items.value.filter(item => pendingSceneIds.value.includes(item.id))
    emit('confirm', { mode: 'scene', scenes: picked, sceneIds: [...pendingSceneIds.value] })
  } else {
    const picked = items.value.filter(item => pendingCharIds.value.includes(item.id))
    emit('confirm', { mode: 'character', characters: picked, characterIds: [...pendingCharIds.value] })
  }
  emit('close')
}
</script>

<style scoped>
.entity-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.entity-picker-dialog {
  width: min(720px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.entity-picker-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.entity-picker-title {
  margin: 0;
  font-size: 16px;
}

.entity-picker-sub {
  margin: 4px 0 0;
  font-size: 12px;
}

.entity-picker-toolbar {
  margin-bottom: 12px;
}

.entity-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 10px;
  overflow: auto;
  flex: 1;
  min-height: 180px;
  padding-right: 4px;
}

.entity-picker-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-2);
  cursor: pointer;
  text-align: left;
}

.entity-picker-item.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.entity-picker-item :deep(.grid-media-image),
.entity-picker-item :deep(.grid-media-empty) {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
}

.entity-picker-item img,
.entity-picker-thumb-empty {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  background: var(--bg-3);
}

.entity-picker-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: var(--text-3);
}

.entity-picker-name {
  font-size: 12px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-picker-tag {
  font-size: 10px;
}

.entity-picker-empty {
  padding: 32px;
  text-align: center;
}

.entity-picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.entity-picker-actions {
  display: flex;
  gap: 8px;
}
</style>
