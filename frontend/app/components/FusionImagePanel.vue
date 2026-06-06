<template>
  <div class="fusion-panel">
    <div class="prod-section-bar">
      <span class="dim" style="font-size:12px">多图融合生图（至少 2 张、最多 6 张参考图）</span>
      <span class="tag">{{ imageConfigLabel }}</span>
      <span v-if="!imageReferenceSupported" class="tag tag-warn">当前图片模型不支持参考图生图</span>
    </div>

    <div class="fusion-hint dim">
      选择 2–6 张参考图进行溶图（角色/场景/道具可任意组合，同一类型可选多张），可从项目、资产库或本地上传。已选图片按顺序作为图片1…图片6，填写融合提示词后提交。
    </div>

    <div class="fusion-slots">
      <div v-for="(slot, index) in slots" :key="index" class="card fusion-slot">
        <div class="fusion-slot-head">
          <span class="fusion-slot-title">参考图 {{ index + 1 }}</span>
          <span class="tag">{{ slotTag(index) }}</span>
        </div>
        <div class="fusion-slot-media">
          <button
            v-if="slot.path"
            type="button"
            class="fusion-thumb"
            @click="openPreview(slot)"
          >
            <img :src="displayUrl(slot.path)" :alt="`参考图 ${index + 1}`" loading="lazy" decoding="async" />
          </button>
          <div v-else class="fusion-thumb fusion-thumb-empty">待选择</div>
        </div>
        <div v-if="slot.label" class="fusion-slot-name dim">{{ slot.label }}</div>
        <div v-if="projectOptions.length" class="fusion-pick-section">
          <span class="fusion-pick-title dim">从项目选择</span>
          <div class="fusion-pick-grid">
            <button
              v-for="item in projectOptions"
              :key="`${item.category}-${item.id}`"
              type="button"
              class="fusion-pick-item"
              :class="{ selected: isProjectSelected(index, item) }"
              :title="item.label"
              @click="selectProjectItem(index, item)"
            >
              <GridMediaImage
                :src="item.path"
                :alt="item.label"
                :placeholder="String(item.label || '?').slice(0, 1)"
              />
              <span class="fusion-pick-label">{{ item.label }}</span>
            </button>
          </div>
        </div>
        <div class="fusion-slot-actions">
          <button type="button" class="btn btn-sm" @click="openAssetPicker(index)">资产库</button>
          <label class="btn btn-sm fusion-upload-btn" :class="{ 'is-disabled': uploadingIndex === index }">
            <input type="file" accept="image/*" hidden :disabled="uploadingIndex === index" @change="onUpload(index, $event)" />
            {{ uploadingIndex === index ? '上传中' : '上传' }}
          </label>
          <button v-if="slot.path" type="button" class="btn btn-sm danger" @click="clearSlot(index)">清除</button>
        </div>
      </div>
    </div>

    <label class="fusion-prompt-field">
      <span class="fusion-prompt-label">融合提示词</span>
      <textarea
        v-model="prompt"
        class="textarea fusion-prompt"
        rows="4"
        placeholder="描述参考图如何融合，例如：图片1的角色站在图片2的场景中央，手持图片3的道具，暖色电影光，写实摄影质感…"
      />
    </label>

    <div class="fusion-submit-row">
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!canSubmit || generating || !imageReferenceSupported"
        @click="submitFusion"
      >
        {{ generating ? '融合生成中…' : '确定融合生图' }}
      </button>
      <span class="dim fusion-count">{{ filledCount }}/6 张</span>
      <span v-if="statusText" class="dim fusion-status">{{ statusText }}</span>
    </div>

    <div v-if="resultPath" class="fusion-result card">
      <div class="fusion-result-head">
        <span class="fusion-result-title">生成结果</span>
        <button type="button" class="btn btn-sm" @click="openPreview({ path: resultPath, label: '融合生图结果' })">查看大图</button>
      </div>
      <button type="button" class="fusion-result-thumb" @click="openPreview({ path: resultPath, label: '融合生图结果' })">
        <img :src="displayUrl(resultPath)" alt="融合生图结果" loading="lazy" decoding="async" />
      </button>
    </div>

    <div v-if="history.length" class="fusion-history">
      <div class="fusion-history-title dim">最近融合记录</div>
      <div class="fusion-history-grid">
        <button
          v-for="item in history"
          :key="item.id"
          type="button"
          class="fusion-history-item"
          @click="openPreview({ path: item.path, label: '融合生图' })"
        >
          <img :src="displayUrl(item.path)" alt="融合生图" loading="lazy" decoding="async" />
        </button>
      </div>
    </div>

    <AssetPickerModal
      :open="picker.open"
      type="reference"
      :drama-id="dramaId"
      :title="pickerTitle"
      @close="picker.open = false"
      @select="onAssetPicked"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import AssetPickerModal from '~/components/AssetPickerModal.vue'
import GridMediaImage from '~/components/GridMediaImage.vue'
import { imageAPI, uploadAPI } from '~/composables/useApi'
import { mediaDisplayUrl, normalizeMediaPath } from '~/utils/media-url.js'

const SLOT_COUNT = 6

const props = defineProps({
  dramaId: { type: Number, required: true },
  episodeId: { type: Number, default: null },
  imageConfigId: { type: Number, default: null },
  imageConfigLabel: { type: String, default: '' },
  imageReferenceSupported: { type: Boolean, default: true },
  chars: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  dramaProps: { type: Array, default: () => [] },
})

const emit = defineEmits(['preview'])

const slots = reactive(
  Array.from({ length: SLOT_COUNT }, () => ({ path: '', label: '' })),
)

const prompt = ref('')
const generating = ref(false)
const statusText = ref('')
const resultPath = ref('')
const history = ref([])
const uploadingIndex = ref(-1)
const picker = ref({ open: false, slotIndex: 0 })

const pickerTitle = computed(() => `选择参考图 ${picker.value.slotIndex + 1} 资产`)

const filledSlots = computed(() =>
  slots
    .map((slot, index) => ({
      index,
      path: normalizeMediaPath(slot.path),
      name: slot.label,
    }))
    .filter(slot => slot.path),
)

const filledCount = computed(() => filledSlots.value.length)

const canSubmit = computed(() =>
  filledCount.value >= 2 && filledCount.value <= SLOT_COUNT && prompt.value.trim().length > 0,
)

const projectOptions = computed(() => {
  const items = []
  for (const item of props.chars) {
    const path = item.image_url || item.imageUrl
    if (!path) continue
    items.push({ id: item.id, category: 'character', label: item.name, path })
  }
  for (const item of props.scenes) {
    const path = item.image_url || item.imageUrl
    if (!path) continue
    items.push({ id: item.id, category: 'scene', label: item.location, path })
  }
  for (const item of props.dramaProps) {
    const path = item.image_url || item.imageUrl
    if (!path) continue
    items.push({ id: item.id, category: 'prop', label: item.name, path })
  }
  return items
})

function slotTag(slotIndex) {
  const filledIndex = filledSlots.value.findIndex(slot => slot.index === slotIndex)
  if (filledIndex >= 0) return `图片${filledIndex + 1}`
  return '可选'
}

function displayUrl(path) {
  return mediaDisplayUrl(path)
}

function isProjectSelected(slotIndex, item) {
  return normalizeMediaPath(slots[slotIndex].path) === normalizeMediaPath(item.path)
}

function selectProjectItem(slotIndex, item) {
  setSlot(slotIndex, item.path, item.label)
}

function setSlot(slotIndex, path, label) {
  const normalized = normalizeMediaPath(path)
  if (!normalized) return
  slots[slotIndex] = { path: normalized, label: label || '' }
}

function clearSlot(slotIndex) {
  slots[slotIndex] = { path: '', label: '' }
}

function openAssetPicker(slotIndex) {
  picker.value = { open: true, slotIndex }
}

function onAssetPicked(item) {
  const asset = item?.asset || item
  const path = asset?.url || asset?.local_path || asset?.localPath
  if (!path) {
    toast.error('资产无效')
    return
  }
  setSlot(picker.value.slotIndex, path, asset?.name || '')
  picker.value.open = false
}

async function onUpload(slotIndex, event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  uploadingIndex.value = slotIndex
  try {
    const res = await uploadAPI.image(file, props.dramaId)
    const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
    if (!path) throw new Error('上传失败')
    setSlot(slotIndex, path, file.name)
    toast.success('图片已上传')
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    uploadingIndex.value = -1
    if (event?.target) event.target.value = ''
  }
}

function buildFusionPrompt(text) {
  const labels = filledSlots.value.map((slot, index) => {
    const name = slot.name ? `（${slot.name}）` : ''
    return `图片${index + 1}${name}`
  })
  const prefix = labels.length ? `${labels.join('，')}。` : ''
  return `${prefix}${text.trim()}`
}

async function pollGeneration(id) {
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    try {
      const row = await imageAPI.get(id)
      statusText.value = `状态：${row?.status || 'processing'}`
      if (row?.status === 'completed') {
        const path = normalizeMediaPath(row?.local_path || row?.localPath || row?.image_url || row?.imageUrl)
        if (!path) throw new Error('生成完成但未返回图片路径')
        return path
      }
      if (row?.status === 'failed') {
        throw new Error(row?.error_msg || row?.errorMsg || '融合生图失败')
      }
    } catch (e) {
      if (String(e?.message || '').includes('融合生图失败')) throw e
    }
  }
  throw new Error('融合生图超时，请稍后在资产库或图片记录中查看')
}

async function submitFusion() {
  if (!props.imageReferenceSupported) {
    toast.error('当前图片模型不支持参考图生图，请在设置中切换支持参考图的模型')
    return
  }
  if (!canSubmit.value) {
    toast.warning('请选择 2–6 张参考图并填写提示词')
    return
  }
  generating.value = true
  statusText.value = '提交融合生图…'
  resultPath.value = ''
  try {
    const referenceImages = filledSlots.value.map(slot => slot.path)
    const payload = {
      drama_id: props.dramaId,
      prompt: buildFusionPrompt(prompt.value),
      reference_images: referenceImages,
      frame_type: 'fusion',
      image_type: 'fusion',
    }
    if (props.imageConfigId) payload.config_id = props.imageConfigId
    const row = await imageAPI.generate(payload)
    const genId = row?.id || row?.image_generation_id
    if (!genId) throw new Error('未返回生成任务 ID')
    statusText.value = '生成中…'
    const path = await pollGeneration(genId)
    resultPath.value = path
    statusText.value = '融合生图完成'
    toast.success('融合生图完成')
    await loadHistory()
  } catch (e) {
    statusText.value = ''
    toast.error(e?.message || '融合生图失败')
  } finally {
    generating.value = false
  }
}

function openPreview(item) {
  emit('preview', item)
}

async function loadHistory() {
  try {
    const rows = await imageAPI.list({ drama_id: props.dramaId })
    const list = Array.isArray(rows) ? rows : []
    history.value = list
      .filter(row => {
        const frameType = String(row?.frame_type || row?.frameType || '')
        return frameType === 'fusion' && row?.status === 'completed' && (row?.local_path || row?.localPath)
      })
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
      .slice(0, 8)
      .map(row => ({
        id: row.id,
        path: normalizeMediaPath(row?.local_path || row?.localPath),
      }))
  } catch {
    history.value = []
  }
}

onMounted(() => {
  loadHistory()
})

watch(() => props.dramaId, () => loadHistory())
</script>

<style scoped>
.fusion-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fusion-hint {
  font-size: 12px;
  line-height: 1.5;
}

.fusion-slots {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.fusion-slot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.fusion-slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fusion-slot-title {
  font-size: 13px;
  font-weight: 600;
}

.fusion-slot-media {
  aspect-ratio: 1;
}

.fusion-thumb {
  display: block;
  width: 100%;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-elevated);
  padding: 0;
  cursor: pointer;
}

.fusion-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fusion-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 12px;
}

.fusion-slot-name {
  font-size: 11px;
  min-height: 16px;
}

.fusion-slot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fusion-pick-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fusion-pick-title {
  font-size: 11px;
}

.fusion-pick-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 120px;
  overflow-y: auto;
  padding-right: 2px;
}

.fusion-pick-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 72px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.fusion-pick-item:hover {
  border-color: var(--accent);
}

.fusion-pick-item.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.fusion-pick-item :deep(.grid-media-image),
.fusion-pick-item :deep(.grid-media-empty) {
  width: 64px;
  height: 64px;
  border-radius: 6px;
}

.fusion-pick-label {
  width: 100%;
  font-size: 10px;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fusion-upload-btn.is-disabled {
  opacity: 0.6;
  pointer-events: none;
}

.fusion-prompt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fusion-prompt-label {
  font-size: 12px;
  color: var(--text-dim);
}

.fusion-prompt {
  min-height: 96px;
}

.fusion-submit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.fusion-count {
  font-size: 12px;
}

.fusion-status {
  font-size: 12px;
}

.fusion-result {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fusion-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.fusion-result-title {
  font-size: 13px;
  font-weight: 600;
}

.fusion-result-thumb {
  width: min(100%, 420px);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  padding: 0;
  background: var(--bg-elevated);
  cursor: pointer;
}

.fusion-result-thumb img {
  width: 100%;
  display: block;
}

.fusion-history-title {
  font-size: 12px;
  margin-bottom: 8px;
}

.fusion-history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
}

.fusion-history-item {
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  padding: 0;
  background: var(--bg-elevated);
  cursor: pointer;
}

.fusion-history-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (max-width: 980px) {
  .fusion-slots {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .fusion-slots {
    grid-template-columns: 1fr;
  }
}
</style>
