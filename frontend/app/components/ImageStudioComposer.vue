<template>
  <div class="studio-composer">
    <div class="composer-shell card">
      <div v-if="dramaLinked" class="composer-top-bar">
        <div class="composer-top-main">
          <span class="composer-project-title">项目素材</span>
          <div class="composer-bind-actions">
            <button type="button" class="btn btn-sm composer-pick-btn" @click="openCharacterPicker">
              选择角色
              <span v-if="boundCharacterCount" class="composer-pick-count">{{ boundCharacterCount }}</span>
            </button>
            <button type="button" class="btn btn-sm composer-pick-btn" @click="openScenePicker">
              选择场景
              <span v-if="boundSceneCount" class="composer-pick-count">{{ boundSceneCount }}</span>
            </button>
            <button type="button" class="btn btn-sm composer-pick-btn" @click="openPropPicker">
              选择道具
              <span v-if="boundPropCount" class="composer-pick-count">{{ boundPropCount }}</span>
            </button>
          </div>
          <div v-if="boundCharacterCount || boundSceneCount || boundPropCount" class="composer-bound-summary">
            <button
              v-for="char in boundCharacters"
              :key="char.id"
              type="button"
              class="composer-bound-chip"
              @click="unbindCharacterById(char.id, char.name)"
            >
              {{ char.name }} ×
            </button>
            <button
              v-for="scene in boundScenes"
              :key="scene.id"
              type="button"
              class="composer-bound-chip"
              @click="unbindSceneById(scene.id)"
            >
              {{ sceneDisplayLabel(scene) }} ×
            </button>
            <button
              v-for="prop in boundProps"
              :key="prop.id"
              type="button"
              class="composer-bound-chip"
              @click="unbindPropById(prop.id)"
            >
              {{ prop.name || `道具#${prop.id}` }} ×
            </button>
          </div>
        </div>
        <span class="dim composer-project-hint">选择角色/场景/道具（角色可选服装造型）或上传/资产库选图；参考图栏出现图片后可用 <kbd>@</kbd> 关联</span>
      </div>

      <div class="composer-main">
        <div class="composer-input-wrap" @paste="onPaste">
          <div
            v-if="showRefStrip"
            class="composer-ref-stack"
            :class="{ 'is-expanded': refStackExpanded }"
            @mouseenter="refStackExpanded = true"
            @mouseleave="refStackExpanded = false"
            @click.self="refStackExpanded = !refStackExpanded"
          >
            <div
              v-for="(item, index) in visualRefItems"
              :key="item.key"
              class="composer-ref-card"
              :class="{ missing: item.missing }"
              :style="{ '--ref-index': index }"
            >
              <button
                type="button"
                class="composer-ref-card-thumb"
                :disabled="!item.preview && item.missing"
                :title="item.tagLabel"
                @click.stop="openVisualRefPreview(item)"
              >
                <img v-if="item.preview" :src="item.preview" alt="" />
                <div v-else class="composer-ref-card-empty">缺图</div>
              </button>
              <button
                type="button"
                class="composer-ref-card-remove"
                title="移除"
                @click.stop="removeVisualRef(item)"
              >
                ×
              </button>
              <span class="composer-ref-card-tag">{{ item.tagLabel }}</span>
            </div>
            <div
              v-for="item in pendingUploads"
              :key="item.id"
              class="composer-ref-card composer-ref-card-pending"
              aria-busy="true"
            >
              <div class="composer-ref-card-thumb composer-ref-card-thumb-pending">
                <img v-if="item.preview" :src="item.preview" alt="" class="composer-ref-pending-preview" />
                <span class="composer-ref-upload-spinner" aria-hidden="true" />
              </div>
              <span class="composer-ref-card-tag">上传中</span>
            </div>
            <label
              v-if="uploadedRefs.length + pendingUploads.length < maxImages"
              class="composer-ref-add-card"
              title="上传参考图"
              @click.stop
            >
              <input type="file" accept="image/*" multiple hidden @change="onUpload" />
              <span class="composer-ref-add-icon">+</span>
              <span class="composer-ref-add-label">参考图</span>
            </label>
          </div>

          <textarea
            ref="promptEl"
            v-model="prompt"
            class="composer-input"
            :class="{ 'composer-input--with-refs': showRefStrip }"
            rows="5"
            :placeholder="mentionableRefItems.length ? '描述你想生成的画面；输入 @ 可关联参考图…' : (dramaLinked ? '描述你想生成的画面…' : '描述你想生成的画面，可上传参考图进行图生图…')"
            @input="onPromptInput"
            @keydown="onPromptKeydown"
            @click="onPromptInput"
            @keyup="onPromptInput"
          />

          <div v-if="mentionOpen && mentionOptions.length" class="composer-mention-menu">
            <button
              v-for="option in mentionOptions"
              :key="option.key || option.path"
              type="button"
              class="composer-mention-item"
              @mousedown.prevent="pickMention(option)"
            >
              <img v-if="option.thumb" :src="gridUrl(option.thumb)" alt="" loading="lazy" decoding="async" />
              <div v-else class="composer-mention-thumb-empty">{{ option.sub.slice(0, 1) }}</div>
              <div class="composer-mention-copy">
                <span class="composer-mention-label">@{{ option.label }}</span>
                <span class="dim">{{ option.sub }}</span>
              </div>
            </button>
          </div>
        </div>

        <div class="composer-toolbar">
          <div class="composer-options">
            <label class="composer-option">
              <span class="composer-option-label">项目</span>
              <select v-model="dramaId" class="composer-select" @change="onDramaChange">
                <option value="">不关联项目</option>
                <option v-for="d in dramas" :key="d.id" :value="String(d.id)">{{ d.title }}</option>
              </select>
            </label>

            <div class="composer-pills">
              <button
                v-for="ratio in aspectRatios"
                :key="ratio"
                type="button"
                class="composer-pill"
                :class="{ active: aspectRatio === ratio }"
                @click="aspectRatio = ratio"
              >
                {{ ratio }}
              </button>
            </div>

            <div v-if="modelOptions.length" class="composer-pills composer-pills-models">
              <button
                v-for="model in modelOptions"
                :key="model"
                type="button"
                class="composer-pill"
                :class="{ active: selectedModel === model }"
                @click="selectModel(model)"
              >
                {{ modelLabel(model) }}
              </button>
            </div>

            <label class="composer-upload-btn">
              <input type="file" accept="image/*" multiple hidden @change="onUpload" />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
              上传图片
            </label>

            <button type="button" class="composer-upload-btn" @click="openAssetLibrary">
              资产库
            </button>

            <button
              v-if="mentionableRefItems.length"
              type="button"
              class="composer-upload-btn"
              @click="openMentionMenu"
            >
              @ 关联
            </button>

            <span v-if="maxImagesHint" class="composer-ref-hint dim">{{ maxImagesHint }}</span>
          </div>

          <button
            type="button"
            class="composer-submit"
            :disabled="generating || !prompt.trim()"
            @click="submit"
          >
            {{ generating ? '生成中…' : '生成图片' }}
          </button>
        </div>
      </div>
    </div>

    <ProjectEntityPickerModal
      :open="entityPickerOpen"
      :mode="entityPickerMode"
      :characters="projectChars"
      :scenes="projectScenes"
      :drama-props="projectProps"
      :selected-character-ids="binding.character_ids"
      :selected-scene-ids="getBindingSceneIds(binding)"
      :selected-prop-ids="binding.prop_ids"
      :selected-character-image-refs="binding.character_image_refs"
      :selected-scene-image-refs="binding.scene_image_refs"
      :selected-prop-image-refs="binding.prop_image_refs"
      @close="entityPickerOpen = false"
      @confirm="onEntityPickerConfirm"
    />

    <AssetPickerModal
      :key="assetLibraryKey"
      :open="assetLibraryOpen"
      type="all"
      :drama-id="dramaId ? Number(dramaId) : null"
      title="从资产库选择"
      @close="assetLibraryOpen = false"
      @select="onAssetLibraryPicked"
    />

    <div
      v-if="imagePreview.open && imagePreview.src"
      class="composer-image-preview"
      @click.self="closeImagePreview"
    >
      <div class="composer-image-preview-dialog card">
        <div class="composer-image-preview-head">
          <span class="composer-image-preview-title">{{ imagePreview.title || '图片预览' }}</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="closeImagePreview">关闭</button>
        </div>
        <div class="composer-image-preview-body">
          <img :src="imagePreview.src" :alt="imagePreview.title || '图片预览'" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { dramaAPI, imageAPI, uploadAPI } from '~/composables/useApi'
import { mediaDisplayUrl, mediaGridUrl, normalizeMediaPath, prefetchMediaUrls } from '~/utils/media-url.js'
import { handlePasteImageUpload } from '~/utils/clipboard-image.js'
import { startReferenceImageUpload } from '~/utils/reference-image-upload.js'
import { assetCategoryLabel } from '~/utils/asset-categories.js'
import {
  applyStudioPromptImageHeader,
  bindCharacter,
  bindProp,
  bindScene,
  buildMentionOptions,
  buildStudioContentRefs,
  buildStudioRefStripItems,
  createStudioBindingState,
  formatPromptImageRefIssues,
  getBindingSceneIds,
  nextPromptImageIndex,
  removePromptImageLabel,
  replaceMentionWithImageLabel,
  sceneDisplayLabel,
  unbindCharacter,
  unbindProp,
  unbindScene,
  validateStudioPrompt,
} from '~/utils/studio-video-refs.js'
import {
  resolveStudioImageModel,
  setLastStudioImageModel,
  STUDIO_IMAGE_MODEL_DEFAULT,
  STUDIO_IMAGE_MODEL_OPTIONS,
} from '~/utils/studio-image-model-preference.js'

const props = defineProps({
  generating: { type: Boolean, default: false },
  dramas: { type: Array, default: () => [] },
  defaultDramaId: { type: String, default: '' },
})

const emit = defineEmits(['generate'])

const maxImages = ref(6)
const supportsReference = ref(true)
const aspectRatios = ['9:16', '16:9']
const modelOptions = ref([...STUDIO_IMAGE_MODEL_OPTIONS])
const selectedModel = ref(STUDIO_IMAGE_MODEL_DEFAULT)

const MODEL_LABELS = {
  'gpt-image-2': 'GPT Image 2',
  'nano-banana-2': 'Nano Banana 2',
}

function modelLabel(model) {
  return MODEL_LABELS[model] || model
}

function selectModel(model) {
  selectedModel.value = model
  setLastStudioImageModel(model)
}

function modelSupportsReference(model) {
  return /gpt-image|chatgpt-image/i.test(String(model || ''))
}

const prompt = ref('')
const uploadedRefs = ref([])
const pendingUploads = ref([])
const binding = reactive(createStudioBindingState())
const projectChars = ref([])
const projectScenes = ref([])
const projectProps = ref([])
const aspectRatio = ref('9:16')
const dramaId = ref('')
const promptEl = ref(null)
const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionStart = ref(0)
const imagePreview = ref({ open: false, src: '', title: '' })
const entityPickerOpen = ref(false)
const entityPickerMode = ref('character')
const assetLibraryOpen = ref(false)
const assetLibraryKey = ref(0)
const sessionReferenceAssets = ref([])
const refStackExpanded = ref(false)

const dramaLinked = computed(() => !!dramaId.value)

const boundCharacters = computed(() =>
  projectChars.value.filter(char => (binding.character_ids || []).includes(char.id)),
)
const boundCharacterCount = computed(() => boundCharacters.value.length)
const boundScenes = computed(() => {
  const ids = getBindingSceneIds(binding)
  return projectScenes.value.filter(scene => ids.includes(scene.id))
})
const boundSceneCount = computed(() => boundScenes.value.length)
const boundProps = computed(() =>
  projectProps.value.filter(prop => (binding.prop_ids || []).includes(prop.id)),
)
const boundPropCount = computed(() => boundProps.value.length)

const visualRefItems = computed(() =>
  buildStudioRefStripItems(binding, projectChars.value, projectScenes.value, projectProps.value, uploadedRefs.value, gridUrl),
)

const showRefStrip = computed(() => dramaLinked.value || visualRefItems.value.length > 0 || pendingUploads.value.length > 0)

const mentionableRefItems = computed(() =>
  visualRefItems.value.filter(item => item.path && !item.missing),
)

const mentionOptions = computed(() => buildMentionOptions(mentionableRefItems.value, mentionQuery.value))

const maxImagesHint = computed(() => {
  if (!modelSupportsReference(selectedModel.value)) return '当前模型不支持参考图'
  if (!supportsReference.value) return '当前模型不支持参考图'
  return `最多 ${maxImages.value} 张参考图`
})

watch(
  () => props.defaultDramaId,
  (id) => {
    if (!dramaId.value && id) {
      dramaId.value = id
      loadProjectAssets(id)
    }
  },
  { immediate: true },
)

watch(
  () => binding.reference_images,
  (paths) => {
    const prevByPath = new Map(uploadedRefs.value.map(item => [normalizeMediaPath(item.path), item]))
    uploadedRefs.value = (paths || []).map(path => {
      const normalized = normalizeMediaPath(path)
      const prev = prevByPath.get(normalized)
      return {
        path: normalized,
        preview: prev?.preview || gridUrl(normalized),
        ossUrl: prev?.ossUrl || null,
        label: prev?.label || null,
        assetId: prev?.assetId || null,
      }
    })
  },
  { deep: true },
)

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
}

function gridUrl(raw) {
  return mediaGridUrl(raw)
}

function resetBinding() {
  Object.assign(binding, createStudioBindingState())
}

async function loadCapabilities() {
  try {
    const caps = await imageAPI.capabilities()
    if (caps?.max_reference_images) maxImages.value = Number(caps.max_reference_images)
    supportsReference.value = caps?.supports_reference !== false
    const models = Array.isArray(caps?.models) && caps.models.length
      ? caps.models.map(String)
      : [...STUDIO_IMAGE_MODEL_OPTIONS]
    modelOptions.value = models
    selectedModel.value = resolveStudioImageModel(models)
  } catch {
    selectedModel.value = resolveStudioImageModel(modelOptions.value)
  }
}

async function loadProjectAssets(id) {
  const parsed = Number(id)
  if (!Number.isFinite(parsed)) {
    projectChars.value = []
    projectScenes.value = []
    projectProps.value = []
    resetBinding()
    return
  }
  try {
    const drama = await dramaAPI.get(parsed)
    const sortByRecent = (a, b) => String(b?.updated_at || b?.updatedAt || '').localeCompare(String(a?.updated_at || a?.updatedAt || ''))
    projectChars.value = [...(drama?.characters || [])].sort(sortByRecent)
    projectScenes.value = [...(drama?.scenes || [])].sort(sortByRecent)
    projectProps.value = [...(drama?.props || [])].sort(sortByRecent)
  } catch (err) {
    projectChars.value = []
    projectScenes.value = []
    projectProps.value = []
    toast.error(err?.message || '加载项目素材失败')
  }
}

function onDramaChange() {
  resetBinding()
  mentionOpen.value = false
  if (dramaId.value) loadProjectAssets(dramaId.value)
  else {
    projectChars.value = []
    projectScenes.value = []
    projectProps.value = []
  }
}

function syncPromptImageHeader() {
  prompt.value = applyStudioPromptImageHeader(
    prompt.value,
    binding,
    projectChars.value,
    projectScenes.value,
    projectProps.value,
    uploadedRefs.value,
  )
}

async function openPropPicker() {
  if (!dramaId.value) {
    toast.warning('请先选择项目')
    return
  }
  await loadProjectAssets(dramaId.value)
  if (!projectProps.value.length) {
    toast.warning('该项目暂无道具')
    return
  }
  entityPickerMode.value = 'prop'
  entityPickerOpen.value = true
}

async function openCharacterPicker() {
  if (!dramaId.value) {
    toast.warning('请先选择项目')
    return
  }
  await loadProjectAssets(dramaId.value)
  if (!projectChars.value.length) {
    toast.warning('该项目暂无角色')
    return
  }
  entityPickerMode.value = 'character'
  entityPickerOpen.value = true
}

async function openScenePicker() {
  if (!dramaId.value) {
    toast.warning('请先选择项目')
    return
  }
  await loadProjectAssets(dramaId.value)
  if (!projectScenes.value.length) {
    toast.warning('该项目暂无场景')
    return
  }
  entityPickerMode.value = 'scene'
  entityPickerOpen.value = true
}

function onEntityPickerConfirm(result) {
  if (result.mode === 'character') {
    for (const charId of result.characterIds || []) {
      bindCharacter(binding, charId, projectChars.value)
    }
    binding.character_image_refs = {
      ...(binding.character_image_refs || {}),
      ...(result.characterImageRefs || {}),
    }
    syncPromptImageHeader()
    return
  }
  if (result.mode === 'scene') {
    const prevIds = new Set(getBindingSceneIds(binding))
    const nextIds = new Set(result.sceneIds || [])
    for (const scene of projectScenes.value) {
      const wasBound = prevIds.has(scene.id)
      const isBound = nextIds.has(scene.id)
      if (isBound && !wasBound) bindScene(binding, scene.id)
      else if (!isBound && wasBound) {
        unbindScene(binding, scene.id)
        prompt.value = removePromptImageLabel(prompt.value, null, sceneDisplayLabel(scene))
        if (scene.location) prompt.value = removePromptImageLabel(prompt.value, null, scene.location)
      }
    }
    binding.scene_image_refs = { ...(result.sceneImageRefs || {}) }
    syncPromptImageHeader()
    return
  }
  if (result.mode === 'prop') {
    const prevIds = new Set(binding.prop_ids || [])
    const nextIds = new Set(result.propIds || [])
    for (const prop of projectProps.value) {
      const wasBound = prevIds.has(prop.id)
      const isBound = nextIds.has(prop.id)
      if (isBound && !wasBound) bindProp(binding, prop.id, projectProps.value)
      else if (!isBound && wasBound) unbindProp(binding, prop.id)
    }
    binding.prop_image_refs = { ...(result.propImageRefs || {}) }
    syncPromptImageHeader()
  }
}

function unbindCharacterById(charId, name) {
  unbindCharacter(binding, charId)
  prompt.value = removePromptImageLabel(prompt.value, null, name)
  syncPromptImageHeader()
}

function unbindSceneById(sceneId) {
  const scene = projectScenes.value.find(item => item.id === sceneId)
  unbindScene(binding, sceneId)
  if (scene) {
    prompt.value = removePromptImageLabel(prompt.value, null, sceneDisplayLabel(scene))
    if (scene.location) prompt.value = removePromptImageLabel(prompt.value, null, scene.location)
  }
  syncPromptImageHeader()
}

function unbindPropById(propId) {
  const prop = projectProps.value.find(item => item.id === propId)
  unbindProp(binding, propId)
  if (prop?.name) prompt.value = removePromptImageLabel(prompt.value, null, prop.name)
  syncPromptImageHeader()
}

function openVisualRefPreview(item) {
  const raw = item.ossUrl || item.path || item.ref?.url
  if (!raw || item.missing) return
  imagePreview.value = { open: true, src: displayUrl(raw), title: item.label || item.tagLabel || '参考图' }
}

function closeImagePreview() {
  imagePreview.value = { open: false, src: '', title: '' }
}

function removeVisualRef(item) {
  if (item.kind === 'linked' && item.ref) {
    unlinkRef(item.ref)
    return
  }
  if (item.kind === 'upload' && item.uploadIndex != null) removeUpload(item.uploadIndex)
}

function unlinkRef(ref) {
  const label = ref.promptLabel || ref.label
  if (ref.source === 'character' && ref.charId) unbindCharacter(binding, ref.charId)
  else if (ref.source === 'scene' || ref.sceneId) unbindScene(binding, ref.sceneId)
  else if (ref.source === 'prop' && ref.propId) unbindProp(binding, ref.propId)
  else if (ref.source === 'reference' && ref.url) {
    const path = normalizeMediaPath(ref.url)
    uploadedRefs.value = uploadedRefs.value.filter(item => normalizeMediaPath(item.path) !== path)
    syncUploadPaths()
  }
  prompt.value = removePromptImageLabel(prompt.value, ref.imageIndex, label)
  syncPromptImageHeader()
}

function syncUploadPaths() {
  binding.reference_images = uploadedRefs.value.map(item => item.path)
}

function addReferencePath(path, meta = {}) {
  const normalized = normalizeMediaPath(path)
  if (!normalized) return false
  if (uploadedRefs.value.length >= maxImages.value) {
    toast.warning(`最多 ${maxImages.value} 张参考图`)
    return false
  }
  if (uploadedRefs.value.some(item => normalizeMediaPath(item.path) === normalized)) return true
  uploadedRefs.value.push({
    path: normalized,
    preview: gridUrl(normalized),
    ossUrl: meta.ossUrl || null,
    label: meta.label || null,
    assetId: meta.assetId || null,
  })
  syncUploadPaths()
  syncPromptImageHeader()
  return true
}

function uploadImageFiles(files, { source = 'pick' } = {}) {
  startReferenceImageUpload({
    files,
    maxRemain: maxImages.value - uploadedRefs.value.length - pendingUploads.value.length,
    pendingUploadsRef: pendingUploads,
    feedback: {
      source,
      limitMessage: `最多上传 ${maxImages.value} 张参考图`,
    },
    uploadOne: (file) => uploadAPI.image(file, dramaId.value ? Number(dramaId.value) : null),
    onSuccess: async ({ file, res }) => {
      const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
      if (!path) throw new Error('上传失败')
      const label = res?.name || file.name?.replace(/\.[^.]+$/, '') || `参考图${uploadedRefs.value.length + 1}`
      addReferencePath(path, { ossUrl: res?.oss_url || res?.ossUrl || null, label, assetId: res?.asset_id || res?.assetId || null })
      pushSessionReferenceAsset({ path, label, assetId: res?.asset_id || res?.assetId || null })
      if (!res?.oss_url && !res?.ossUrl) await prefetchMediaUrls([path])
      syncPromptImageHeader()
    },
  })
}

function onUpload(event) {
  uploadImageFiles(event?.target?.files || [], { source: 'pick' })
  if (event?.target) event.target.value = ''
}

function onPaste(event) {
  handlePasteImageUpload(event, uploadImageFiles)
}

function pushSessionReferenceAsset({ path, label, assetId }) {
  const normalized = normalizeMediaPath(path)
  if (!normalized) return
  const entry = {
    id: assetId || `session:${normalized}`,
    name: label || '参考图',
    type: 'reference',
    url: normalized,
    local_path: normalized,
  }
  sessionReferenceAssets.value = [
    entry,
    ...sessionReferenceAssets.value.filter(item =>
      normalizeMediaPath(item.url || item.local_path || item.localPath) !== normalized,
    ),
  ]
}

function openAssetLibrary() {
  assetLibraryKey.value += 1
  assetLibraryOpen.value = true
}

function onAssetLibraryPicked(item) {
  const asset = item?.asset || item
  const path = normalizeMediaPath(asset?.url || asset?.local_path || asset?.localPath)
  if (!path) {
    toast.error('资产图片无效')
    return
  }
  const label = asset?.name || assetCategoryLabel(asset?.type) || '参考图'
  if (!addReferencePath(path, { label, assetId: asset?.id || null })) return
  assetLibraryOpen.value = false
  prefetchMediaUrls([path]).catch(() => {})
}

function removeUpload(index) {
  uploadedRefs.value = uploadedRefs.value.filter((_, i) => i !== index)
  syncUploadPaths()
}

function detectMention() {
  const el = promptEl.value
  if (!el || !mentionableRefItems.value.length) {
    mentionOpen.value = false
    return
  }
  const pos = el.selectionStart ?? 0
  const head = prompt.value.slice(0, pos)
  const match = head.match(/@([^\s@]*)$/)
  if (!match) {
    mentionOpen.value = false
    return
  }
  mentionOpen.value = true
  mentionQuery.value = match[1]
  mentionStart.value = pos - match[0].length
}

function onPromptInput() {
  detectMention()
}

function onPromptKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    submit()
    return
  }
  if (event.key === 'Escape') mentionOpen.value = false
}

function openMentionMenu() {
  if (!mentionableRefItems.value.length) {
    toast.warning('请先在上方参考图栏添加图片')
    return
  }
  const el = promptEl.value
  if (!el) return
  const cursor = el.selectionStart ?? prompt.value.length
  prompt.value = `${prompt.value.slice(0, cursor)}@${prompt.value.slice(cursor)}`
  nextTick(() => {
    el.focus()
    el.setSelectionRange(cursor + 1, cursor + 1)
    detectMention()
  })
}

function pickMention(option) {
  if (!option.path) return
  const el = promptEl.value
  const cursor = el?.selectionEnd ?? prompt.value.length
  const index = nextPromptImageIndex(prompt.value)
  const label = option.promptLabel || option.label
  const result = replaceMentionWithImageLabel(prompt.value, mentionStart.value, cursor, index, label)
  prompt.value = result.text
  mentionOpen.value = false
  nextTick(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(result.cursor, result.cursor)
  })
}

function buildSimplePromptHeader(text, count) {
  const body = String(text || '').trim()
  if (!count || /图片\s*1/.test(body)) return body
  const header = Array.from({ length: count }, (_, i) => `图片${i + 1}是参考图${i + 1}`).join('，')
  return `${header}。${body}`
}

function collectReferencePaths(contentRefs = []) {
  const paths = contentRefs
    .filter(ref => ref.type === 'image' && ref.url)
    .map(ref => normalizeMediaPath(ref.url))
    .filter(Boolean)
  for (const item of uploadedRefs.value) {
    const path = normalizeMediaPath(item.path)
    if (path && !paths.includes(path)) paths.push(path)
  }
  return paths.slice(0, maxImages.value)
}

function submit() {
  const text = prompt.value.trim()
  if (!text) {
    toast.warning('请输入图片描述')
    return
  }

  syncUploadPaths()

  const payload = {
    aspect_ratio: aspectRatio.value,
    image_type: 'studio',
    model: selectedModel.value,
    drama_id: dramaId.value ? Number(dramaId.value) : undefined,
  }

  if (dramaLinked.value) {
    const issues = validateStudioPrompt(
      text,
      binding,
      projectChars.value,
      projectScenes.value,
      projectProps.value,
      uploadedRefs.value,
    )
    if (issues.length) {
      toast.error(formatPromptImageRefIssues(issues))
      return
    }
    const { prompt: finalPrompt, contentRefs } = buildStudioContentRefs(
      binding,
      text,
      projectChars.value,
      projectScenes.value,
      projectProps.value,
      uploadedRefs.value,
    )
    payload.prompt = finalPrompt
    const refs = collectReferencePaths(contentRefs)
    if (refs.length) payload.reference_images = refs
    emit('generate', payload)
    return
  }

  const images = uploadedRefs.value.map(item => normalizeMediaPath(item.path)).filter(Boolean)
  payload.prompt = images.length ? buildSimplePromptHeader(text, images.length) : text
  if (images.length) payload.reference_images = images
  emit('generate', payload)
}

function loadFromItem(item) {
  prompt.value = String(item?.prompt || '')
  aspectRatio.value = item?.aspect_ratio || item?.aspectRatio || '9:16'
  const itemModel = String(item?.model || '').trim()
  if (itemModel && modelOptions.value.includes(itemModel)) {
    selectedModel.value = itemModel
    setLastStudioImageModel(itemModel)
  }
  if (item?.drama_id) {
    dramaId.value = String(item.drama_id)
    loadProjectAssets(dramaId.value)
  }
  resetBinding()
  const refs = item?.reference_images || []
  uploadedRefs.value = refs.map(ref => ({
    path: ref.path || ref.display_url,
    preview: gridUrl(ref.path) || ref.display_url,
  })).filter(ref => ref.path)
  syncUploadPaths()
}

function clearPrompt() {
  prompt.value = ''
}

function onPreviewKeydown(event) {
  if (event.key === 'Escape' && imagePreview.value.open) closeImagePreview()
}

onMounted(() => {
  loadCapabilities()
  window.addEventListener('keydown', onPreviewKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onPreviewKeydown)
})

defineExpose({ loadFromItem, clearPrompt })
</script>

<style scoped>
.studio-composer {
  position: sticky;
  bottom: 0;
  z-index: 20;
  padding: 0 20px 20px;
  background: linear-gradient(to top, var(--bg-base) 70%, transparent);
}

.composer-shell {
  max-width: 1080px;
  margin: 0 auto;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-card);
}

.composer-top-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.composer-top-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.composer-project-title { font-size: 12px; font-weight: 600; color: var(--text-2); }
.composer-bind-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.composer-pick-btn { position: relative; }
.composer-pick-count {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 10px;
}
.composer-bound-summary { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
.composer-bound-chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  font-size: 11px;
  cursor: pointer;
}
.composer-project-hint { font-size: 11px; }

.composer-main { display: flex; flex-direction: column; gap: 10px; }
.composer-input-wrap { position: relative; }

.composer-ref-stack {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  padding: 8px 0 10px;
  margin-bottom: 4px;
}

.composer-ref-card {
  position: relative;
  flex: 0 0 auto;
  width: 72px;
}

.composer-ref-card-thumb {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  padding: 0;
  background: var(--bg-1);
  cursor: pointer;
}

.composer-ref-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.composer-ref-card-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-3);
}

.composer-ref-card-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.composer-ref-card-tag {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-3);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-ref-card-pending .composer-ref-card-thumb {
  cursor: default;
  pointer-events: none;
}

.composer-ref-card-thumb-pending {
  position: relative;
}

.composer-ref-pending-preview {
  opacity: 0.55;
  filter: saturate(0.85);
}

.composer-ref-upload-spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.35);
}

.composer-ref-upload-spinner::after {
  content: '';
  width: 22px;
  height: 22px;
  border: 2px solid rgba(76, 125, 255, 0.25);
  border-top-color: var(--accent, #4c7dff);
  border-radius: 50%;
  animation: composer-ref-spin 0.75s linear infinite;
}

@keyframes composer-ref-spin {
  to { transform: rotate(360deg); }
}

.composer-ref-add-card {
  flex: 0 0 auto;
  width: 72px;
  height: 72px;
  border-radius: 12px;
  border: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  color: var(--text-3);
  font-size: 10px;
}

.composer-ref-add-icon { font-size: 20px; line-height: 1; }

.composer-input {
  width: 100%;
  min-height: 96px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-1);
  font-size: 14px;
  line-height: 1.55;
  resize: vertical;
}

.composer-input--with-refs { min-height: 80px; }

.composer-mention-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  max-height: 220px;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  box-shadow: var(--shadow-card);
  z-index: 30;
}

.composer-mention-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.composer-mention-item:hover { background: var(--bg-1); }
.composer-mention-item img,
.composer-mention-thumb-empty {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}
.composer-mention-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-1);
  color: var(--text-3);
}
.composer-mention-label { display: block; font-size: 13px; font-weight: 500; }

.composer-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.composer-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.composer-option { display: inline-flex; align-items: center; gap: 6px; }
.composer-option-label { font-size: 11px; color: var(--text-3); white-space: nowrap; }
.composer-select {
  min-width: 120px;
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  font-size: 12px;
  color: var(--text-1);
}

.composer-pills { display: inline-flex; gap: 4px; flex-wrap: wrap; }

.composer-pills-models {
  max-width: 100%;
}

.composer-pill {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}

.composer-pill.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-text);
}

.composer-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}

.composer-ref-hint { font-size: 11px; white-space: nowrap; }

.composer-submit {
  padding: 10px 22px;
  border-radius: 999px;
  border: none;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.composer-submit:disabled { opacity: 0.5; cursor: not-allowed; }

.composer-image-preview {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.composer-image-preview-dialog {
  max-width: min(920px, 96vw);
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.composer-image-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.composer-image-preview-body {
  padding: 12px;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.composer-image-preview-body img {
  max-width: 100%;
  max-height: 78vh;
  object-fit: contain;
  border-radius: 8px;
}

@media (max-width: 720px) {
  .composer-toolbar { flex-direction: column; align-items: stretch; }
  .composer-submit { width: 100%; }
}
</style>
