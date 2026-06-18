<template>
  <div v-if="open" class="outfit-image-overlay" @click.self="close">
    <div class="card outfit-image-dialog">
      <div class="outfit-image-head">
        <div>
          <h3 class="outfit-image-title">{{ dialogTitle }}</h3>
          <p class="dim outfit-image-sub">{{ dialogSubtitle }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div v-if="isNewOutfit" class="outfit-image-field">
        <span class="outfit-image-label">造型分组名称</span>
        <input v-model="newOutfitName" class="input" placeholder="如：日常、宫装、战场" />
      </div>

      <div class="outfit-image-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="outfit-image-tab"
          :class="{ active: mode === tab.id }"
          @click="mode = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="!imageReferenceSupported && mode !== 'upload'" class="outfit-image-warn">
        当前图片模型不支持参考图生图，请在设置中切换支持参考图的模型
      </div>

      <div v-if="mode === 'upload'" class="outfit-image-body">
        <label class="outfit-image-upload-zone">
          <input type="file" accept="image/*" hidden @change="onUploadFile" />
          <span>{{ uploading ? '上传中…' : '点击选择图片' }}</span>
        </label>
        <label class="outfit-image-check">
          <input v-model="setAsDefault" type="checkbox" />
          设为该分组定稿
        </label>
      </div>

      <div v-else-if="mode === 'ai'" class="outfit-image-body">
        <div v-if="characterPath" class="outfit-image-char-ref">
          <img :src="displayUrl(characterPath)" alt="" />
          <span class="dim">参考角色基准图</span>
        </div>
        <label class="outfit-image-field">
          <span class="outfit-image-label">生成描述</span>
          <textarea
            v-model="aiPrompt"
            class="textarea"
            rows="4"
            placeholder="描述该造型分组下的角色形象，例如：身穿红色宫装，头戴金钗，半身肖像，写实摄影…"
          />
        </label>
        <label class="outfit-image-check">
          <input v-model="setAsDefault" type="checkbox" />
          生成完成后设为该分组定稿
        </label>
      </div>

      <div v-else class="outfit-image-body">
        <p class="dim outfit-image-hint">
          图片1固定为当前角色；再选 1–5 张场景/服装/道具等参考图进行溶图，并填写融合提示词。
        </p>
        <div class="outfit-image-fusion-grid">
          <div class="outfit-image-fusion-slot is-locked">
            <div class="outfit-image-fusion-thumb">
              <img v-if="characterPath" :src="displayUrl(characterPath)" alt="" />
              <div v-else class="outfit-image-fusion-empty">缺角色图</div>
            </div>
            <span class="dim">图片1 · 角色</span>
          </div>
          <div
            v-for="(slot, index) in extraSlots"
            :key="index"
            class="outfit-image-fusion-slot"
          >
            <button
              v-if="slot.path"
              type="button"
              class="outfit-image-fusion-thumb"
            >
              <img :src="displayUrl(slot.path)" alt="" />
            </button>
            <div v-else class="outfit-image-fusion-thumb outfit-image-fusion-empty">待选</div>
            <div class="outfit-image-fusion-actions">
              <button type="button" class="btn btn-sm" @click="openAssetPicker(index)">资产库</button>
              <label class="btn btn-sm">
                <input type="file" accept="image/*" hidden @change="onExtraUpload(index, $event)" />
                上传
              </label>
            </div>
            <span class="dim">图片{{ index + 2 }}</span>
          </div>
        </div>
        <label class="outfit-image-field">
          <span class="outfit-image-label">融合提示词</span>
          <textarea
            v-model="fusionPrompt"
            class="textarea"
            rows="4"
            placeholder="例如：图片1的角色穿上图片2的服装，站在图片3的场景中，手持图片4的道具，电影级写实…"
          />
        </label>
        <label class="outfit-image-check">
          <input v-model="setAsDefault" type="checkbox" />
          生成完成后设为该分组定稿
        </label>
      </div>

      <div class="outfit-image-foot">
        <span v-if="statusText" class="dim">{{ statusText }}</span>
        <div class="outfit-image-actions">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button
            v-if="mode !== 'upload'"
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="submitting || !canSubmitGenerate"
            @click="submitGenerate"
          >
            {{ submitting ? '生成中…' : (mode === 'ai' ? 'AI 生图' : '确定溶图') }}
          </button>
        </div>
      </div>

      <AssetPickerModal
        :open="pickerOpen"
        type="all"
        :drama-id="dramaId || null"
        title="选择溶图参考图"
        @close="pickerOpen = false"
        @select="onAssetPicked"
      />
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import AssetPickerModal from '~/components/AssetPickerModal.vue'
import { characterAPI, imageAPI, uploadAPI } from '~/composables/useApi'
import { mediaDisplayUrl, normalizeMediaPath } from '~/utils/media-url.js'
import { slugifyOutfitId } from '~/utils/character-image-variants.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  charId: { type: Number, default: null },
  outfitId: { type: String, default: '' },
  outfitLabel: { type: String, default: '' },
  isNewOutfit: { type: Boolean, default: false },
  dramaId: { type: Number, default: null },
  characterPath: { type: String, default: '' },
  characterName: { type: String, default: '' },
  initialMode: { type: String, default: 'upload' },
})

const emit = defineEmits(['close', 'done'])

const tabs = [
  { id: 'upload', label: '本地上传' },
  { id: 'ai', label: 'AI 生图' },
  { id: 'fusion', label: '溶图' },
]

const mode = ref('upload')
const newOutfitName = ref('')
const aiPrompt = ref('')
const fusionPrompt = ref('')
const setAsDefault = ref(false)
const uploading = ref(false)
const submitting = ref(false)
const statusText = ref('')
const imageReferenceSupported = ref(true)
const pickerOpen = ref(false)
const pickerSlotIndex = ref(0)
const extraSlots = reactive(Array.from({ length: 5 }, () => ({ path: '', label: '' })))

const dialogTitle = computed(() => {
  if (props.isNewOutfit) return `新建造型分组 · ${props.characterName || '角色'}`
  return `添加造型图 · ${props.outfitLabel || '造型分组'}`
})

const dialogSubtitle = computed(() => {
  if (props.isNewOutfit) return '可本地上传、AI 生图或多图溶图创建新分组'
  return `${props.characterName || '角色'} · 追加上传 / AI 生图 / 溶图`
})

const filledExtraSlots = computed(() =>
  extraSlots
    .map((slot, index) => ({ ...slot, index, path: normalizeMediaPath(slot.path) }))
    .filter(slot => slot.path),
)

const canSubmitGenerate = computed(() => {
  if (!imageReferenceSupported.value) return false
  if (mode.value === 'ai') return aiPrompt.value.trim().length > 0
  if (mode.value === 'fusion') {
    return filledExtraSlots.value.length >= 1
      && fusionPrompt.value.trim().length > 0
      && !!normalizeMediaPath(props.characterPath)
  }
  return false
})

function displayUrl(path) {
  return mediaDisplayUrl(path)
}

function resolveOutfitMeta() {
  const label = props.isNewOutfit
    ? String(newOutfitName.value || '').trim()
    : String(props.outfitLabel || '').trim()
  if (!label) throw new Error('请填写造型分组名称')
  const outfitId = props.isNewOutfit ? slugifyOutfitId(label) : String(props.outfitId || '').trim()
  if (!outfitId) throw new Error('造型分组无效')
  return { outfitId, label }
}

function resetForm() {
  mode.value = props.initialMode || 'upload'
  newOutfitName.value = props.outfitLabel || ''
  aiPrompt.value = ''
  fusionPrompt.value = ''
  setAsDefault.value = props.isNewOutfit
  statusText.value = ''
  for (let i = 0; i < extraSlots.length; i += 1) {
    extraSlots[i] = { path: '', label: '' }
  }
}

function close() {
  emit('close')
}

async function loadCapabilities() {
  try {
    const caps = await imageAPI.capabilities()
    imageReferenceSupported.value = caps?.supports_reference !== false
  } catch {
    imageReferenceSupported.value = true
  }
}

async function onUploadFile(event) {
  const file = event?.target?.files?.[0]
  if (!file || !props.charId) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  uploading.value = true
  try {
    const { outfitId, label } = resolveOutfitMeta()
    await characterAPI.uploadOutfitCandidate(props.charId, outfitId, file, {
      label,
      candidate_label: setAsDefault.value ? '定稿' : undefined,
      set_as_default: setAsDefault.value,
    })
    toast.success(setAsDefault.value ? '已上传并设为定稿' : '已追加上传备选图')
    emit('done')
    close()
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    uploading.value = false
    if (event?.target) event.target.value = ''
  }
}

function buildPromptHeader(paths, labels) {
  const parts = paths.map((path, index) => {
    const name = labels[index] ? `（${labels[index]}）` : ''
    return `图片${index + 1}${name}`
  })
  return parts.length ? `${parts.join('，')}。` : ''
}

async function pollGeneration(id) {
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    const row = await imageAPI.get(id)
    statusText.value = `状态：${row?.status || 'processing'}`
    if (row?.status === 'completed') return id
    if (row?.status === 'failed') {
      throw new Error(row?.error_msg || row?.errorMsg || '图片生成失败')
    }
  }
  throw new Error('生成超时，请稍后在图片记录中查看')
}

async function attachToOutfit(generationId) {
  const { outfitId, label } = resolveOutfitMeta()
  await imageAPI.attachToEntity(generationId, {
    entity_type: 'character',
    entity_id: props.charId,
    drama_id: props.dramaId || undefined,
    group_id: outfitId,
    group_label: label,
    set_as_default: setAsDefault.value,
  })
}

async function submitGenerate() {
  if (!props.charId) return
  if (!imageReferenceSupported.value) {
    toast.error('当前图片模型不支持参考图生图')
    return
  }
  submitting.value = true
  statusText.value = '提交生成任务…'
  try {
    const charPath = normalizeMediaPath(props.characterPath)
    if (!charPath) throw new Error('请先上传或生成角色基准图')

    let referenceImages = []
    let promptText = ''

    if (mode.value === 'ai') {
      referenceImages = [charPath]
      promptText = `${buildPromptHeader(referenceImages, [props.characterName || '角色'])}${aiPrompt.value.trim()}`
    } else {
      referenceImages = [
        charPath,
        ...filledExtraSlots.value.map(slot => slot.path),
      ]
      const labels = [
        props.characterName || '角色',
        ...filledExtraSlots.value.map(slot => slot.label || ''),
      ]
      promptText = `${buildPromptHeader(referenceImages, labels)}${fusionPrompt.value.trim()}`
    }

    const payload = {
      drama_id: props.dramaId || undefined,
      character_id: props.charId,
      prompt: promptText,
      reference_images: referenceImages,
      image_type: mode.value === 'fusion' ? 'fusion' : 'studio',
      frame_type: mode.value === 'fusion' ? 'fusion' : 'outfit',
    }
    const row = await imageAPI.generate(payload)
    const genId = row?.id || row?.image_generation_id
    if (!genId) throw new Error('未返回生成任务 ID')

    statusText.value = '生成中…'
    await pollGeneration(genId)
    await attachToOutfit(genId)

    toast.success(mode.value === 'fusion' ? '溶图完成，已加入造型分组' : 'AI 生图完成，已加入造型分组')
    emit('done')
    close()
  } catch (e) {
    statusText.value = ''
    toast.error(e?.message || '生成失败')
  } finally {
    submitting.value = false
  }
}

function openAssetPicker(index) {
  pickerSlotIndex.value = index
  pickerOpen.value = true
}

function onAssetPicked(item) {
  const asset = item?.asset || item
  const path = normalizeMediaPath(asset?.url || asset?.local_path || asset?.localPath)
  if (!path) {
    toast.error('资产无效')
    return
  }
  extraSlots[pickerSlotIndex.value] = {
    path,
    label: asset?.name || '',
  }
  pickerOpen.value = false
}

async function onExtraUpload(index, event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  try {
    const res = await uploadAPI.image(file, props.dramaId || null)
    const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
    if (!path) throw new Error('上传失败')
    extraSlots[index] = { path, label: file.name?.replace(/\.[^.]+$/, '') || '参考图' }
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    if (event?.target) event.target.value = ''
  }
}

watch(
  () => [props.open, props.initialMode, props.outfitLabel],
  ([isOpen]) => {
    if (isOpen) resetForm()
  },
)

onMounted(() => {
  loadCapabilities()
})
</script>

<style scoped>
.outfit-image-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(8, 12, 20, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.outfit-image-dialog {
  width: min(720px, 96vw);
  max-height: 92vh;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.outfit-image-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.outfit-image-title {
  margin: 0;
  font-size: 16px;
}

.outfit-image-sub {
  margin: 4px 0 0;
  font-size: 12px;
}

.outfit-image-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.outfit-image-tab {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  font-size: 12px;
  cursor: pointer;
}

.outfit-image-tab.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-text);
}

.outfit-image-warn {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 170, 0, 0.12);
  color: #b45309;
  font-size: 12px;
}

.outfit-image-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.outfit-image-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.outfit-image-label {
  font-size: 12px;
  color: var(--text-dim);
}

.outfit-image-upload-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 13px;
}

.outfit-image-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}

.outfit-image-char-ref {
  display: flex;
  align-items: center;
  gap: 10px;
}

.outfit-image-char-ref img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.outfit-image-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.outfit-image-fusion-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.outfit-image-fusion-slot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}

.outfit-image-fusion-slot.is-locked .outfit-image-fusion-thumb {
  cursor: default;
}

.outfit-image-fusion-thumb {
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  padding: 0;
  background: var(--bg-1);
  cursor: pointer;
}

.outfit-image-fusion-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.outfit-image-fusion-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 11px;
}

.outfit-image-fusion-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}

.outfit-image-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.outfit-image-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

@media (max-width: 640px) {
  .outfit-image-fusion-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
