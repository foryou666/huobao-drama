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

      <div v-if="showMediaPicker" class="entity-picker-media">
        <div class="entity-picker-media-head">
          <span class="entity-picker-media-title">选择参考图</span>
          <span class="dim entity-picker-media-hint">
            {{ mode === 'scene' ? '按视角分组，点击切换场景参考图' : mode === 'prop' ? '按视角分组，点击切换道具参考图' : '按服装分组，点击可展开备选造型' }}
          </span>
        </div>
        <div v-if="mode === 'character'" class="entity-picker-media-list">
          <div
            v-for="char in selectedCharacters"
            :key="`char-media:${char.id}`"
            class="entity-picker-media-segment"
          >
            <span class="entity-picker-media-name">{{ char.name }}</span>
            <CharacterMediaStrip
              :char="char"
              layout="outfits"
              compact
              :show-summary="false"
              :max-visible="12"
              expandable
              pick-default-on-click
              clickable
              :is-active="(url) => isCharImageActive(char.id, url)"
              @preview="(img) => onCharImagePick(char.id, img.url)"
            />
          </div>
        </div>
        <div v-else-if="mode === 'scene'" class="entity-picker-media-list">
          <div
            v-for="scene in selectedScenes"
            :key="`scene-media:${scene.id}`"
            class="entity-picker-media-segment"
          >
            <span class="entity-picker-media-name">{{ scene.location || `场景#${scene.id}` }}</span>
            <EntityViewMediaStrip
              v-if="getSceneMedia(scene)"
              :media="getSceneMedia(scene)"
              theme="scene"
              compact
              :show-summary="false"
              :max-visible="12"
              clickable
              :is-view-active="(view) => isSceneImageActive(scene.id, view.url)"
              @preview="(img) => onSceneImagePick(scene.id, img.url)"
            />
          </div>
        </div>
        <div v-else class="entity-picker-media-list">
          <div
            v-for="prop in selectedProps"
            :key="`prop-media:${prop.id}`"
            class="entity-picker-media-segment"
          >
            <span class="entity-picker-media-name">{{ prop.name || `道具#${prop.id}` }}</span>
            <EntityViewMediaStrip
              v-if="getPropMedia(prop)"
              :media="getPropMedia(prop)"
              theme="prop"
              compact
              :show-summary="false"
              :max-visible="12"
              clickable
              :is-view-active="(view) => isPropImageActive(prop.id, view.url)"
              @preview="(img) => onPropImagePick(prop.id, img.url)"
            />
          </div>
        </div>
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
import { resolveCharacterImageUrl, listCharacterOutfitPreviews } from '~/utils/character-image-variants.js'
import { listSceneImages } from '~/utils/scene-image-variants.js'
import { listPropImages } from '~/utils/prop-image-variants.js'
import { buildSceneMediaFromImages, summarizePropMedia } from '~/utils/entity-view-media.js'
import { normalizeMediaPath } from '~/utils/media-url.js'
import GridMediaImage from '~/components/GridMediaImage.vue'
import CharacterMediaStrip from '~/components/CharacterMediaStrip.vue'
import EntityViewMediaStrip from '~/components/EntityViewMediaStrip.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'character' },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  dramaProps: { type: Array, default: () => [] },
  selectedCharacterIds: { type: Array, default: () => [] },
  selectedSceneIds: { type: Array, default: () => [] },
  selectedPropIds: { type: Array, default: () => [] },
  selectedSceneId: { type: [Number, String, null], default: null },
  selectedCharacterImageRefs: { type: Object, default: () => ({}) },
  selectedSceneImageRefs: { type: Object, default: () => ({}) },
  selectedPropImageRefs: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['close', 'confirm'])

const keyword = ref('')
const pendingCharIds = ref([])
const pendingSceneIds = ref([])
const pendingPropIds = ref([])
const pendingCharImageRefs = ref({})
const pendingSceneImageRefs = ref({})
const pendingPropImageRefs = ref({})

const title = computed(() => {
  if (props.mode === 'scene') return '选择场景'
  if (props.mode === 'prop') return '选择道具'
  return '选择角色'
})
const subtitle = computed(() => {
  if (props.mode === 'scene') return '可多选；确认后绑定场景，可用 @ 关联参考图'
  if (props.mode === 'prop') return '可多选；确认后绑定道具，可用 @ 关联参考图'
  return '点击选择角色并配置参考图；选中新角色会取消上一个选中'
})
const searchPlaceholder = computed(() => {
  if (props.mode === 'scene') return '搜索场景地点…'
  if (props.mode === 'prop') return '搜索道具名…'
  return '搜索角色名…'
})

const items = computed(() => {
  if (props.mode === 'prop') {
    return (props.dramaProps || []).map(prop => {
      const viewCount = listPropImages(prop).length
      const viewHint = viewCount > 1 ? `${viewCount}张视角` : ''
      return {
        id: prop.id,
        label: prop.name || `道具#${prop.id}`,
        sub: viewHint,
        thumb: normalizeMediaPath(prop.image_url || prop.imageUrl || prop.local_path || prop.localPath),
      }
    })
  }
  if (props.mode === 'scene') {
    return (props.scenes || []).map(scene => {
      const viewCount = listSceneImages(scene).length
      const time = scene.time || ''
      const viewHint = viewCount > 1 ? `${viewCount}张视角` : ''
      return {
        id: scene.id,
        label: scene.location || `场景#${scene.id}`,
        sub: [time, viewHint].filter(Boolean).join(' · '),
        thumb: normalizeMediaPath(scene.image_url || scene.imageUrl || scene.local_path || scene.localPath),
      }
    })
  }
  return (props.characters || []).map(char => {
    const outfitCount = listCharacterOutfitPreviews(char).length
    const role = char.role || ''
    const outfitHint = outfitCount > 0 ? `${outfitCount}套服装` : ''
    return {
      id: char.id,
      label: char.name || `角色#${char.id}`,
      sub: [role, outfitHint].filter(Boolean).join(' · '),
      thumb: resolveCharacterImageUrl(char, {}),
    }
  })
})

const filteredItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(item =>
    item.label.toLowerCase().includes(q)
    || String(item.sub || '').toLowerCase().includes(q),
  )
})

const selectedCharacters = computed(() =>
  (props.characters || []).filter(char => pendingCharIds.value.includes(char.id)),
)

const selectedScenes = computed(() =>
  (props.scenes || []).filter(scene => pendingSceneIds.value.includes(scene.id)),
)

const selectedProps = computed(() =>
  (props.dramaProps || []).filter(prop => pendingPropIds.value.includes(prop.id)),
)

const showMediaPicker = computed(() => {
  if (props.mode === 'scene') return pendingSceneIds.value.length > 0
  if (props.mode === 'prop') return pendingPropIds.value.length > 0
  return pendingCharIds.value.length > 0
})

const selectedSummary = computed(() => {
  if (props.mode === 'scene') {
    return pendingSceneIds.value.length
      ? `已选 ${pendingSceneIds.value.length} 个场景`
      : '未选择场景'
  }
  if (props.mode === 'prop') {
    return pendingPropIds.value.length
      ? `已选 ${pendingPropIds.value.length} 个道具`
      : '未选择道具'
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
    pendingCharImageRefs.value = { ...(props.selectedCharacterImageRefs || {}) }
    pendingSceneImageRefs.value = { ...(props.selectedSceneImageRefs || {}) }
    pendingPropImageRefs.value = { ...(props.selectedPropImageRefs || {}) }
    if (props.mode === 'character') {
      pendingCharIds.value = []
      pendingSceneIds.value = []
      pendingPropIds.value = []
    } else if (props.mode === 'scene') {
      pendingCharIds.value = [...(props.selectedCharacterIds || [])]
      pendingSceneIds.value = props.selectedSceneIds?.length
        ? [...props.selectedSceneIds]
        : (props.selectedSceneId ? [Number(props.selectedSceneId)] : [])
      pendingPropIds.value = [...(props.selectedPropIds || [])]
    } else {
      pendingCharIds.value = [...(props.selectedCharacterIds || [])]
      pendingSceneIds.value = props.selectedSceneIds?.length
        ? [...props.selectedSceneIds]
        : (props.selectedSceneId ? [Number(props.selectedSceneId)] : [])
      pendingPropIds.value = [...(props.selectedPropIds || [])]
    }
  },
)

function isSelected(id) {
  if (props.mode === 'scene') return pendingSceneIds.value.includes(id)
  if (props.mode === 'prop') return pendingPropIds.value.includes(id)
  return pendingCharIds.value.includes(id)
}

function getSceneMedia(scene) {
  const images = listSceneImages(scene)
  if (!images.length) return null
  return buildSceneMediaFromImages(images)
}

function isCharImageActive(charId, url) {
  const char = (props.characters || []).find(item => item.id === charId)
  const normalized = normalizeMediaPath(url)
  const selected = pendingCharImageRefs.value[charId]
  if (selected) return normalizeMediaPath(selected) === normalized
  return normalizeMediaPath(resolveCharacterImageUrl(char, {})) === normalized
}

function isSceneImageActive(sceneId, url) {
  const scene = (props.scenes || []).find(item => item.id === sceneId)
  const normalized = normalizeMediaPath(url)
  const selected = pendingSceneImageRefs.value[sceneId]
  if (selected) return normalizeMediaPath(selected) === normalized
  const primary = normalizeMediaPath(scene?.image_url || scene?.imageUrl || scene?.local_path || scene?.localPath)
  return primary === normalized
}

function onCharImagePick(charId, url) {
  const char = (props.characters || []).find(item => item.id === charId)
  const normalized = normalizeMediaPath(url)
  const primary = normalizeMediaPath(resolveCharacterImageUrl(char, {}))
  const next = { ...pendingCharImageRefs.value }
  if (!normalized || primary === normalized) delete next[charId]
  else next[charId] = normalized
  pendingCharImageRefs.value = next
}

function onSceneImagePick(sceneId, url) {
  const scene = (props.scenes || []).find(item => item.id === sceneId)
  const normalized = normalizeMediaPath(url)
  const primary = normalizeMediaPath(scene?.image_url || scene?.imageUrl || scene?.local_path || scene?.localPath)
  const next = { ...pendingSceneImageRefs.value }
  if (!normalized || primary === normalized) delete next[sceneId]
  else next[sceneId] = normalized
  pendingSceneImageRefs.value = next
}

function getPropMedia(prop) {
  const media = summarizePropMedia(prop)
  return media?.preview_images?.length ? media : null
}

function isPropImageActive(propId, url) {
  const prop = (props.dramaProps || []).find(item => item.id === propId)
  const normalized = normalizeMediaPath(url)
  const selected = pendingPropImageRefs.value[propId]
  if (selected) return normalizeMediaPath(selected) === normalized
  const images = listPropImages(prop)
  const primary = images.find(item => item.view_id === 'hero')?.url || images[0]?.url
  return normalizeMediaPath(primary) === normalized
}

function onPropImagePick(propId, url) {
  const prop = (props.dramaProps || []).find(item => item.id === propId)
  const normalized = normalizeMediaPath(url)
  const primary = normalizeMediaPath(listPropImages(prop).find(item => item.view_id === 'hero')?.url || listPropImages(prop)[0]?.url)
  const next = { ...pendingPropImageRefs.value }
  if (!normalized || primary === normalized) delete next[propId]
  else next[propId] = normalized
  pendingPropImageRefs.value = next
}

function onItemClick(item) {
  if (props.mode === 'scene') {
    const idx = pendingSceneIds.value.indexOf(item.id)
    if (idx >= 0) {
      pendingSceneIds.value.splice(idx, 1)
      const next = { ...pendingSceneImageRefs.value }
      delete next[item.id]
      pendingSceneImageRefs.value = next
    } else {
      pendingSceneIds.value.push(item.id)
    }
    return
  }
  if (props.mode === 'prop') {
    const idx = pendingPropIds.value.indexOf(item.id)
    if (idx >= 0) {
      pendingPropIds.value.splice(idx, 1)
      const next = { ...pendingPropImageRefs.value }
      delete next[item.id]
      pendingPropImageRefs.value = next
    } else {
      pendingPropIds.value.push(item.id)
    }
    return
  }
  const idx = pendingCharIds.value.indexOf(item.id)
  if (idx >= 0) {
    pendingCharIds.value = []
    pendingCharImageRefs.value = {}
    return
  }
  pendingCharIds.value = [item.id]
  const savedRef = pendingCharImageRefs.value[item.id]
  pendingCharImageRefs.value = savedRef ? { [item.id]: savedRef } : {}
}

function close() {
  emit('close')
}

function confirm() {
  if (props.mode === 'scene') {
    const picked = items.value.filter(item => pendingSceneIds.value.includes(item.id))
    emit('confirm', {
      mode: 'scene',
      scenes: picked,
      sceneIds: [...pendingSceneIds.value],
      sceneImageRefs: { ...pendingSceneImageRefs.value },
    })
  } else if (props.mode === 'prop') {
    const picked = items.value.filter(item => pendingPropIds.value.includes(item.id))
    emit('confirm', {
      mode: 'prop',
      props: picked,
      propIds: [...pendingPropIds.value],
      propImageRefs: { ...pendingPropImageRefs.value },
    })
  } else {
    const picked = items.value.filter(item => pendingCharIds.value.includes(item.id))
    emit('confirm', {
      mode: 'character',
      characters: picked,
      characterIds: [...pendingCharIds.value],
      characterImageRefs: { ...pendingCharImageRefs.value },
    })
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

.entity-picker-media {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 280px;
  overflow: auto;
}

.entity-picker-media-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.entity-picker-media-title {
  font-size: 12px;
  font-weight: 700;
}

.entity-picker-media-hint {
  font-size: 11px;
}

.entity-picker-media-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entity-picker-media-segment {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-2);
}

.entity-picker-media-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
}

.entity-picker-media-segment :deep(.char-outfit-grid),
.entity-picker-media-segment :deep(.entity-view-grid) {
  gap: 6px;
}
</style>
