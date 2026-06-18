<template>
  <div v-if="open" class="attach-overlay" @click.self="close">
    <div class="attach-dialog card">
      <div class="attach-head">
        <div>
          <h3 class="attach-title">添加到项目资产</h3>
          <p class="dim attach-sub">加入已有角色/场景/道具，或新建后写入对应分组</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div v-if="previewUrl" class="attach-preview">
        <img :src="previewUrl" alt="" />
      </div>

      <label class="attach-field">
        <span class="attach-label">所属项目</span>
        <select v-model="selectedDramaId" class="input" @change="onDramaChange">
          <option value="">请选择项目</option>
          <option v-for="d in dramas" :key="d.id" :value="String(d.id)">{{ d.title }}</option>
        </select>
      </label>

      <div class="attach-type-tabs">
        <button
          v-for="tab in entityTabs"
          :key="tab.id"
          type="button"
          class="attach-type-tab"
          :class="{ active: entityType === tab.id }"
          @click="setEntityType(tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="attach-target-mode">
        <label class="attach-radio">
          <input v-model="entityTargetMode" type="radio" value="existing" />
          <span>选择已有{{ entityTypeLabel }}</span>
        </label>
        <label class="attach-radio">
          <input v-model="entityTargetMode" type="radio" value="new" />
          <span>新建{{ entityTypeLabel }}</span>
        </label>
      </div>

      <template v-if="entityTargetMode === 'existing'">
        <label class="attach-field">
          <span class="attach-label">搜索{{ entityTypeLabel }}</span>
          <input v-model="entityKeyword" class="input" :placeholder="`搜索${entityTypeLabel}名称…`" />
        </label>

        <div v-if="loadingDrama" class="dim attach-empty">加载项目资产…</div>
        <div v-else-if="!selectedDramaId" class="dim attach-empty">请先选择项目</div>
        <div v-else-if="!filteredEntities.length" class="dim attach-empty">
          暂无{{ entityTypeLabel }}，可切换为「新建{{ entityTypeLabel }}」
        </div>
        <div v-else class="attach-entity-list">
          <button
            v-for="item in filteredEntities"
            :key="item.id"
            type="button"
            class="attach-entity-item"
            :class="{ selected: selectedEntityId === item.id }"
            @click="selectEntity(item)"
          >
            <GridMediaImage
              v-if="item.thumb"
              :src="item.thumb"
              :alt="item.label"
              :placeholder="item.label.slice(0, 1)"
            />
            <div v-else class="attach-entity-thumb-empty">{{ item.label.slice(0, 1) }}</div>
            <span class="attach-entity-name">{{ item.label }}</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div v-if="!selectedDramaId" class="dim attach-empty">请先选择项目</div>
        <div v-else class="attach-create-form">
          <template v-if="entityType === 'character'">
            <label class="attach-field">
              <span class="attach-label">角色名称 *</span>
              <input v-model="createForm.name" class="input" placeholder="如：岑柚" />
            </label>
            <label class="attach-field">
              <span class="attach-label">角色类型</span>
              <input v-model="createForm.role" class="input" placeholder="如：女主 / 配角" />
            </label>
            <label class="attach-field">
              <span class="attach-label">外貌 / 描述</span>
              <textarea v-model="createForm.appearance" class="textarea" rows="2" placeholder="可选，用于后续生成" />
            </label>
          </template>

          <template v-else-if="entityType === 'scene'">
            <label class="attach-field">
              <span class="attach-label">场景地点 *</span>
              <input v-model="createForm.location" class="input" placeholder="如：养心殿" />
            </label>
            <label class="attach-field">
              <span class="attach-label">时间段</span>
              <input v-model="createForm.time" class="input" placeholder="如：日 / 夜" />
            </label>
            <label class="attach-field">
              <span class="attach-label">场景描述</span>
              <textarea v-model="createForm.prompt" class="textarea" rows="2" placeholder="可选" />
            </label>
            <p class="dim attach-hint">新建场景时，图片默认作为「主视角」。</p>
          </template>

          <template v-else>
            <label class="attach-field">
              <span class="attach-label">道具名称 *</span>
              <input v-model="createForm.name" class="input" placeholder="如：玉佩" />
            </label>
            <label class="attach-field">
              <span class="attach-label">道具描述</span>
              <textarea v-model="createForm.description" class="textarea" rows="2" placeholder="可选" />
            </label>
            <p class="dim attach-hint">新建道具时，图片默认作为「主图」。</p>
          </template>
        </div>
      </template>

      <div v-if="showGroupPanel" class="attach-group-panel">
        <div class="attach-group-head">目标分组</div>
        <div class="attach-group-mode">
          <label class="attach-radio">
            <input v-model="groupMode" type="radio" value="existing" :disabled="!existingGroups.length" />
            <span>已有分组</span>
          </label>
          <label class="attach-radio">
            <input v-model="groupMode" type="radio" value="new" />
            <span>新建分组</span>
          </label>
        </div>

        <div v-if="groupMode === 'existing'" class="attach-group-list">
          <button
            v-for="group in existingGroups"
            :key="group.id"
            type="button"
            class="attach-group-item"
            :class="{ selected: selectedGroupId === group.id }"
            @click="selectedGroupId = group.id"
          >
            <img v-if="group.url" :src="displaySrc(group.url)" alt="" />
            <span>{{ group.label }}</span>
            <span v-if="group.count > 1" class="dim attach-group-count">{{ group.count }} 张</span>
          </button>
        </div>

        <label v-else class="attach-field">
          <span class="attach-label">新分组名称</span>
          <input
            v-model="newGroupLabel"
            class="input"
            :placeholder="groupPlaceholder"
          />
        </label>

        <label v-if="entityType === 'character' && groupMode === 'existing'" class="attach-checkbox">
          <input v-model="setAsDefault" type="checkbox" />
          <span>设为本组定稿（不勾选则作为备选图追加上传）</span>
        </label>

        <p v-if="entityType !== 'character' && groupMode === 'existing'" class="dim attach-hint">
          场景/道具每个分组仅保留一张图，添加后将替换该分组当前图片。
        </p>
      </div>

      <div class="attach-foot">
        <span class="dim">{{ footSummary }}</span>
        <div class="attach-actions">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="submitDisabled" @click="submit">
            {{ submitting ? '添加中…' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { dramaAPI, imageAPI } from '~/composables/useApi'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { listCharacterOutfitPreviews } from '~/utils/character-image-variants.js'
import { listSceneImages } from '~/utils/scene-image-variants.js'
import { listPropImages } from '~/utils/prop-image-variants.js'
import GridMediaImage from '~/components/GridMediaImage.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  imageItem: { type: Object, default: null },
  dramas: { type: Array, default: () => [] },
  defaultDramaId: { type: [String, Number], default: '' },
})

const emit = defineEmits(['close', 'success'])

const entityTabs = [
  { id: 'character', label: '角色' },
  { id: 'scene', label: '场景' },
  { id: 'prop', label: '道具' },
]

const selectedDramaId = ref('')
const entityType = ref('character')
const entityTargetMode = ref('existing')
const entityKeyword = ref('')
const loadingDrama = ref(false)
const dramaDetail = ref(null)
const selectedEntityId = ref(null)
const groupMode = ref('new')
const selectedGroupId = ref('')
const newGroupLabel = ref('')
const setAsDefault = ref(false)
const submitting = ref(false)
const createForm = reactive({
  name: '',
  role: '',
  appearance: '',
  location: '',
  time: '',
  prompt: '',
  description: '',
})

const previewUrl = computed(() => {
  const raw = props.imageItem?.display_image_url
    || props.imageItem?.local_path
    || props.imageItem?.localPath
    || props.imageItem?.image_url
    || props.imageItem?.imageUrl
  return raw ? mediaDisplayUrl(raw) : ''
})

const entityTypeLabel = computed(() => {
  if (entityType.value === 'scene') return '场景'
  if (entityType.value === 'prop') return '道具'
  return '角色'
})

const confirmLabel = computed(() =>
  entityTargetMode.value === 'new' ? '新建并添加' : '确认添加',
)

const groupPlaceholder = computed(() => {
  if (entityType.value === 'character') return '如：日常、宫装、战场'
  if (entityType.value === 'scene') return '如：夜景、雨天、左45°'
  return '如：破损、特写、备用'
})

const entityRows = computed(() => {
  if (!dramaDetail.value) return []
  if (entityType.value === 'scene') {
    return (dramaDetail.value.scenes || []).map(scene => ({
      id: scene.id,
      label: formatSceneLabel(scene),
      raw: scene,
      thumb: scene.image_url || scene.imageUrl || scene.local_path || scene.localPath,
    }))
  }
  if (entityType.value === 'prop') {
    return (dramaDetail.value.props || []).map(prop => ({
      id: prop.id,
      label: prop.name || `道具 #${prop.id}`,
      raw: prop,
      thumb: prop.image_url || prop.imageUrl || prop.local_path || prop.localPath,
    }))
  }
  return (dramaDetail.value.characters || []).map(char => ({
    id: char.id,
    label: char.name || `角色 #${char.id}`,
    raw: char,
    thumb: char.image_url || char.imageUrl || char.local_path || char.localPath,
  }))
})

const filteredEntities = computed(() => {
  const q = entityKeyword.value.trim().toLowerCase()
  if (!q) return entityRows.value
  return entityRows.value.filter(item => String(item.label || '').toLowerCase().includes(q))
})

const selectedEntity = computed(() =>
  entityRows.value.find(item => item.id === selectedEntityId.value) || null,
)

const existingGroups = computed(() => {
  if (entityTargetMode.value === 'new') return []
  const entity = selectedEntity.value?.raw
  if (!entity) return []

  if (entityType.value === 'character') {
    return listCharacterOutfitPreviews(entity).map(outfit => ({
      id: outfit.outfit_id,
      label: outfit.label,
      url: outfit.url,
      count: outfit.candidate_count || outfit.candidates?.length || 0,
    }))
  }
  if (entityType.value === 'scene') {
    return listSceneImages(entity).map(view => ({
      id: view.angle_id,
      label: view.label,
      url: view.url,
      count: 1,
    }))
  }
  return listPropImages(entity).map(view => ({
    id: view.view_id,
    label: view.label,
    url: view.url,
    count: 1,
  }))
})

const showGroupPanel = computed(() => {
  if (entityTargetMode.value === 'new') {
    return entityType.value === 'character'
  }
  return !!selectedEntityId.value
})

const createFormValid = computed(() => {
  if (entityType.value === 'character') return !!createForm.name.trim()
  if (entityType.value === 'scene') return !!createForm.location.trim()
  return !!createForm.name.trim()
})

const footSummary = computed(() => {
  if (!selectedDramaId.value) return '请先选择项目'
  if (entityTargetMode.value === 'new') {
    if (!createFormValid.value) {
      return entityType.value === 'scene' ? '请填写场景地点' : `请填写${entityTypeLabel.value}名称`
    }
    if (entityType.value === 'character') {
      if (groupMode.value === 'new') {
        return newGroupLabel.value.trim()
          ? `将新建角色「${createForm.name.trim()}」并添加至「${newGroupLabel.value.trim()}」`
          : '请填写造型分组名称'
      }
      return '请选择已有分组'
    }
    if (entityType.value === 'scene') {
      return `将新建场景「${formatSceneDraftLabel()}」并设为主视角`
    }
    return `将新建道具「${createForm.name.trim()}」并设为主图`
  }

  if (!selectedEntity.value) return `请选择${entityTypeLabel.value}`
  if (groupMode.value === 'new') {
    return newGroupLabel.value.trim()
      ? `将添加到 ${selectedEntity.value.label} · 新建「${newGroupLabel.value.trim()}」`
      : '请填写新分组名称'
  }
  const group = existingGroups.value.find(item => item.id === selectedGroupId.value)
  return group
    ? `将添加到 ${selectedEntity.value.label} · ${group.label}`
    : '请选择已有分组'
})

const submitDisabled = computed(() => {
  if (submitting.value || !props.imageItem?.id || !selectedDramaId.value) return true
  if (entityTargetMode.value === 'new') {
    if (!createFormValid.value) return true
    if (entityType.value === 'character') {
      if (groupMode.value === 'new') return !newGroupLabel.value.trim()
      return !selectedGroupId.value
    }
    return false
  }
  if (!selectedEntityId.value) return true
  if (groupMode.value === 'new') return !newGroupLabel.value.trim()
  return !selectedGroupId.value
})

function formatSceneLabel(scene) {
  const location = scene?.location || `场景 #${scene?.id}`
  const time = String(scene?.time || '').trim()
  return time ? `${location} · ${time}` : location
}

function formatSceneDraftLabel() {
  const location = createForm.location.trim()
  const time = createForm.time.trim()
  return time ? `${location} · ${time}` : location
}

function displaySrc(raw) {
  return mediaDisplayUrl(raw)
}

function resetCreateForm() {
  createForm.name = ''
  createForm.role = ''
  createForm.appearance = ''
  createForm.location = ''
  createForm.time = ''
  createForm.prompt = ''
  createForm.description = ''
}

function resetSelection() {
  selectedEntityId.value = null
  selectedGroupId.value = ''
  newGroupLabel.value = ''
  setAsDefault.value = false
  groupMode.value = 'new'
  resetCreateForm()
  applyDefaultGroupLabel()
}

function applyDefaultGroupLabel() {
  if (entityTargetMode.value === 'new' && entityType.value === 'character') {
    newGroupLabel.value = '基准'
  } else if (entityTargetMode.value === 'existing') {
    newGroupLabel.value = ''
  }
}

function setEntityType(type) {
  if (entityType.value === type) return
  entityType.value = type
  resetSelection()
}

async function loadDramaDetail(dramaId) {
  if (!dramaId) {
    dramaDetail.value = null
    return
  }
  loadingDrama.value = true
  try {
    dramaDetail.value = await dramaAPI.get(Number(dramaId))
  } catch (e) {
    dramaDetail.value = null
    toast.error(e?.message || '加载项目失败')
  } finally {
    loadingDrama.value = false
  }
}

function onDramaChange() {
  resetSelection()
  loadDramaDetail(selectedDramaId.value)
}

function selectEntity(item) {
  selectedEntityId.value = item.id
  selectedGroupId.value = ''
  newGroupLabel.value = ''
  setAsDefault.value = false
  groupMode.value = existingGroups.value.length ? 'existing' : 'new'
  if (groupMode.value === 'existing' && existingGroups.value.length === 1) {
    selectedGroupId.value = existingGroups.value[0].id
  }
  if (groupMode.value === 'new') {
    newGroupLabel.value = entityType.value === 'character' ? '基准' : ''
  }
}

function buildCreateEntityPayload() {
  if (entityType.value === 'character') {
    return {
      name: createForm.name.trim(),
      role: createForm.role.trim() || undefined,
      appearance: createForm.appearance.trim() || undefined,
      description: createForm.appearance.trim() || undefined,
    }
  }
  if (entityType.value === 'scene') {
    return {
      location: createForm.location.trim(),
      time: createForm.time.trim() || undefined,
      prompt: createForm.prompt.trim() || undefined,
      description: createForm.prompt.trim() || undefined,
    }
  }
  return {
    name: createForm.name.trim(),
    description: createForm.description.trim() || undefined,
  }
}

function buildGroupPayload() {
  if (entityTargetMode.value === 'new') {
    if (entityType.value === 'scene') {
      return { group_id: 'hero', group_label: '主视角' }
    }
    if (entityType.value === 'prop') {
      return { group_id: 'hero', group_label: '主图' }
    }
  }

  if (groupMode.value === 'new') {
    return { group_label: newGroupLabel.value.trim() }
  }

  const group = existingGroups.value.find(item => item.id === selectedGroupId.value)
  return {
    group_id: selectedGroupId.value,
    group_label: group?.label,
  }
}

function close() {
  emit('close')
}

async function submit() {
  if (submitDisabled.value) return
  submitting.value = true
  try {
    const payload = {
      entity_type: entityType.value,
      drama_id: Number(selectedDramaId.value),
      set_as_default: entityType.value === 'character' ? setAsDefault.value : undefined,
      ...buildGroupPayload(),
    }

    if (entityTargetMode.value === 'new') {
      payload.create_entity = buildCreateEntityPayload()
    } else {
      payload.entity_id = selectedEntityId.value
    }

    const result = await imageAPI.attachToEntity(props.imageItem.id, payload)
    const label = result?.entity_label
      || selectedEntity.value?.label
      || createForm.name.trim()
      || formatSceneDraftLabel()
    const created = !!result?.created_entity
    toast.success(created ? `已新建${entityTypeLabel.value}「${label}」并添加图片` : `已添加到${entityTypeLabel.value}「${label}」`)
    emit('success')
    close()
  } catch (e) {
    toast.error(e?.message || '添加失败')
  } finally {
    submitting.value = false
  }
}

watch(() => props.open, (value) => {
  if (!value) return
  const dramaId = String(props.defaultDramaId || props.imageItem?.drama_id || props.imageItem?.dramaId || '')
  selectedDramaId.value = dramaId
  entityType.value = 'character'
  entityTargetMode.value = 'existing'
  entityKeyword.value = ''
  resetSelection()
  loadDramaDetail(dramaId)
}, { immediate: true })

watch(entityTargetMode, (mode) => {
  selectedEntityId.value = null
  selectedGroupId.value = ''
  setAsDefault.value = false
  if (mode === 'new') {
    resetCreateForm()
    groupMode.value = 'new'
    applyDefaultGroupLabel()
  } else {
    newGroupLabel.value = ''
  }
})

watch(existingGroups, (groups) => {
  if (entityTargetMode.value !== 'existing' || !selectedEntityId.value) return
  if (groupMode.value === 'existing' && !groups.some(item => item.id === selectedGroupId.value)) {
    selectedGroupId.value = groups[0]?.id || ''
  }
  if (!groups.length) groupMode.value = 'new'
})
</script>

<style scoped>
.attach-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.attach-dialog {
  width: min(560px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 16px;
}

.attach-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.attach-title { margin: 0 0 4px; font-size: 18px; }
.attach-sub { margin: 0; font-size: 12px; }

.attach-preview {
  width: 88px;
  aspect-ratio: 9 / 16;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 12px;
  background: #000;
}

.attach-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.attach-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.attach-label { font-size: 11px; color: var(--text-dim); }

.attach-type-tabs,
.attach-target-mode {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.attach-target-mode {
  gap: 12px;
  font-size: 12px;
}

.attach-type-tab {
  flex: 1;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  font-size: 12px;
  cursor: pointer;
}

.attach-type-tab.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-text);
}

.attach-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
}

.attach-create-form {
  margin-bottom: 12px;
}

.attach-entity-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  max-height: 180px;
  overflow: auto;
  margin-bottom: 12px;
}

.attach-entity-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 6px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  cursor: pointer;
}

.attach-entity-item.selected {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.attach-entity-item :deep(.grid-media-image),
.attach-entity-thumb-empty {
  width: 56px;
  height: 56px;
  border-radius: 10px;
}

.attach-entity-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-2);
  font-size: 18px;
  font-weight: 600;
}

.attach-entity-name {
  font-size: 11px;
  text-align: center;
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-group-panel {
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  margin-bottom: 12px;
}

.attach-group-head {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
}

.attach-group-mode {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
}

.attach-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.attach-group-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow: auto;
}

.attach-group-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.attach-group-item.selected {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.attach-group-item img {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}

.attach-group-count {
  margin-left: auto;
  font-size: 10px;
}

.attach-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}

.attach-hint {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.4;
}

.attach-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.attach-foot .dim {
  font-size: 11px;
  line-height: 1.4;
  flex: 1;
}

.attach-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
</style>
