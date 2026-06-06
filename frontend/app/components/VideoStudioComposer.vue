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
            <button type="button" class="btn btn-sm composer-pick-btn" @click="openVoicePicker">
              选择音色
              <span v-if="boundVoiceCount" class="composer-pick-count">{{ boundVoiceCount }}</span>
            </button>
            <button type="button" class="btn btn-sm composer-pick-btn" @click="voiceLibraryOpen = true">
              音色库
            </button>
          </div>
          <div v-if="boundCharacterCount || boundSceneCount || boundVoiceCount" class="composer-bound-summary">
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
              v-for="(voice, vIdx) in boundVoices"
              :key="voice.path || vIdx"
              type="button"
              class="composer-bound-chip composer-bound-chip-voice"
              @click="unbindVoiceByIndex(vIdx)"
            >
              {{ voice.name }} ×
            </button>
          </div>
        </div>
        <span class="dim composer-project-hint">选择角色/场景/音色或上传图片；参考图栏出现图片后可在提示词输入 <kbd>@</kbd> 关联</span>
      </div>

      <div class="composer-main">
        <div class="composer-input-wrap">
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
              :class="{
                missing: item.missing,
                'is-first': refMode === 'first_last' && item.uploadIndex === 0,
                'is-last': refMode === 'first_last' && item.uploadIndex === 1,
              }"
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
            <label
              v-if="uploadedRefs.length < maxImages"
              class="composer-ref-add-card"
              title="上传参考图"
              @click.stop
            >
              <input type="file" accept="image/*" multiple hidden @change="onUpload" />
              <span class="composer-ref-add-icon">+</span>
              <span class="composer-ref-add-label">参考内容</span>
            </label>
          </div>

          <textarea
            ref="promptEl"
            v-model="prompt"
            class="composer-input"
            :class="{ 'composer-input--with-refs': showRefStrip }"
            rows="6"
            :placeholder="mentionableRefItems.length ? '描述视频内容；输入 @ 可关联参考图…' : (dramaLinked ? '描述视频内容…' : '描述你想生成的视频画面、动作与镜头…')"
            @input="onPromptInput"
            @keydown="onPromptKeydown"
            @click="onPromptInput"
            @keyup="onPromptInput"
          />

          <div
            v-if="mentionOpen && mentionOptions.length"
            class="composer-mention-menu"
          >
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
                type="button"
                class="composer-pill"
                :class="{ active: refMode === 'reference' }"
                @click="refMode = 'reference'"
              >
                参考图
              </button>
              <button
                type="button"
                class="composer-pill"
                :class="{ active: refMode === 'first_last' }"
                @click="refMode = 'first_last'"
              >
                首尾帧
              </button>
            </div>

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

            <div class="composer-pills">
              <button
                v-for="sec in durations"
                :key="sec"
                type="button"
                class="composer-pill"
                :class="{ active: duration === sec }"
                @click="duration = sec"
              >
                {{ sec }}s
              </button>
            </div>

            <label class="composer-upload-btn">
              <input type="file" accept="image/*" multiple hidden @change="onUpload" />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
              上传图片
            </label>

            <button type="button" class="composer-upload-btn" @click="openReferencePicker">
              参考图库
            </button>

            <button
              v-if="mentionableRefItems.length"
              type="button"
              class="composer-upload-btn"
              @click="openMentionMenu"
            >
              @ 关联
            </button>
          </div>

          <button
            type="button"
            class="composer-submit"
            :disabled="generating || !prompt.trim()"
            @click="submit"
          >
            {{ generating ? '生成中…' : '生成视频' }}
          </button>
        </div>
      </div>
    </div>

    <ProjectEntityPickerModal
      :open="entityPickerOpen"
      :mode="entityPickerMode"
      :characters="projectChars"
      :scenes="projectScenes"
      :selected-character-ids="binding.character_ids"
      :selected-scene-ids="getBindingSceneIds(binding)"
      @close="entityPickerOpen = false"
      @confirm="onEntityPickerConfirm"
    />

    <VoiceAssetPickerModal
      :open="voicePickerOpen"
      :voices="voiceAssets"
      :selected="binding.voice_refs"
      @close="voicePickerOpen = false"
      @confirm="onVoicePickerConfirm"
    />

    <div v-if="voiceLibraryOpen" class="composer-voice-library-overlay" @click.self="voiceLibraryOpen = false">
      <div class="composer-voice-library-dialog card">
        <div class="composer-voice-library-head">
          <h3>项目音色库</h3>
          <button type="button" class="btn btn-ghost btn-sm" @click="voiceLibraryOpen = false">关闭</button>
        </div>
        <VoiceLibraryPanel v-if="dramaId" :drama-id="dramaId" @change="voiceAssets = $event" />
        <p v-else class="dim">请先选择项目</p>
      </div>
    </div>

    <AssetPickerModal
      :key="referencePickerKey"
      :open="referencePickerOpen"
      type="reference"
      :extra-items="sessionReferenceAssets"
      title="从参考图库选择"
      @close="referencePickerOpen = false"
      @select="onReferencePicked"
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
import { dramaAPI, uploadAPI, assetAPI } from '~/composables/useApi'
import { mediaDisplayUrl, mediaGridUrl, normalizeMediaPath, prefetchMediaUrls } from '~/utils/media-url.js'
import {
  bindCharacter,
  bindScene,
  buildMentionOptions,
  buildStudioContentRefs,
  buildStudioRefStripItems,
  canUnlinkStudioRef,
  createStudioBindingState,
  formatPromptImageRefIssues,
  getBindingSceneIds,
  nextPromptImageIndex,
  removePromptImageLabel,
  replaceMentionWithImageLabel,
  sceneDisplayLabel,
  toggleCharacterBinding,
  unbindCharacter,
  unbindScene,
  validateStudioPrompt,
} from '~/utils/studio-video-refs.js'
import { parseVoiceRefs, MAX_VOICE_REFS } from '~/utils/voice-refs.js'
import VoiceAssetPickerModal from '~/components/VoiceAssetPickerModal.vue'
import VoiceLibraryPanel from '~/components/VoiceLibraryPanel.vue'

const props = defineProps({
  generating: { type: Boolean, default: false },
  dramas: { type: Array, default: () => [] },
  defaultDramaId: { type: String, default: '' },
})

const emit = defineEmits(['generate'])

const maxImages = 9
const aspectRatios = ['9:16', '16:9']
const durations = [10, 15]

const prompt = ref('')
const uploadedRefs = ref([])
const binding = reactive(createStudioBindingState())
const projectChars = ref([])
const projectScenes = ref([])
const voiceAssets = ref([])
const voicePickerOpen = ref(false)
const voiceLibraryOpen = ref(false)
const refMode = ref('reference')
const aspectRatio = ref('9:16')
const duration = ref(15)
const dramaId = ref('')
const promptEl = ref(null)
const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionStart = ref(0)
const imagePreview = ref({ open: false, src: '', title: '' })
const entityPickerOpen = ref(false)
const entityPickerMode = ref('character')
const referencePickerOpen = ref(false)
const referencePickerKey = ref(0)
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

const boundVoices = computed(() => parseVoiceRefs(binding.voice_refs))

const boundVoiceCount = computed(() => boundVoices.value.length)

const visualRefItems = computed(() =>
  buildStudioRefStripItems(
    binding,
    projectChars.value,
    projectScenes.value,
    uploadedRefs.value,
    gridUrl,
  ),
)

const showRefStrip = computed(() =>
  dramaLinked.value || visualRefItems.value.length > 0,
)

const mentionableRefItems = computed(() =>
  visualRefItems.value.filter(item => item.path && !item.missing),
)

const mentionOptions = computed(() => buildMentionOptions(
  mentionableRefItems.value,
  mentionQuery.value,
))

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
    const prevByPath = new Map(
      uploadedRefs.value.map(item => [normalizeMediaPath(item.path), item]),
    )
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

function openVisualRefPreview(item) {
  const raw = item.ossUrl || item.path || item.ref?.url
  if (!raw || item.missing) return
  openImagePreview(raw, item.label || item.tagLabel || '参考图')
}

function removeVisualRef(item) {
  if (item.kind === 'linked' && item.ref) {
    unlinkRef(item.ref)
    return
  }
  if (item.kind === 'upload' && item.uploadIndex != null) {
    removeUpload(item.uploadIndex)
  }
}

function previewRefTitle(ref) {
  if (ref.imageIndex) return `图${ref.imageIndex} · ${ref.label}`
  return ref.label || '参考图'
}

function openImagePreview(raw, title = '') {
  const src = displayUrl(raw)
  if (!src) return
  imagePreview.value = { open: true, src, title }
}

function closeImagePreview() {
  imagePreview.value = { open: false, src: '', title: '' }
}

function onPreviewKeydown(event) {
  if (event.key === 'Escape' && imagePreview.value.open) closeImagePreview()
}

onMounted(() => {
  window.addEventListener('keydown', onPreviewKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onPreviewKeydown)
})

function resetBinding() {
  Object.assign(binding, createStudioBindingState())
}

async function loadVoiceAssets() {
  const parsed = Number(dramaId.value)
  if (!Number.isFinite(parsed)) {
    voiceAssets.value = []
    return
  }
  try {
    const rows = await assetAPI.list({ drama_id: parsed, type: 'voice' })
    voiceAssets.value = Array.isArray(rows) ? rows : []
  } catch {
    voiceAssets.value = []
  }
}

async function loadProjectAssets(id) {
  const parsed = Number(id)
  if (!Number.isFinite(parsed)) {
    projectChars.value = []
    projectScenes.value = []
    resetBinding()
    return
  }
  try {
    const drama = await dramaAPI.get(parsed)
    projectChars.value = drama?.characters || []
    projectScenes.value = drama?.scenes || []
    await loadVoiceAssets()
  } catch (err) {
    projectChars.value = []
    projectScenes.value = []
    voiceAssets.value = []
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
  }
}

function openCharacterPicker() {
  if (!projectChars.value.length) {
    toast.warning('该项目暂无角色')
    return
  }
  entityPickerMode.value = 'character'
  entityPickerOpen.value = true
}

function openVoicePicker() {
  if (!dramaId.value) {
    toast.warning('请先选择项目')
    return
  }
  if (!voiceAssets.value.length) {
    toast.warning('该项目暂无音色，请先打开音色库上传')
    voiceLibraryOpen.value = true
    return
  }
  voicePickerOpen.value = true
}

function onVoicePickerConfirm(refs) {
  binding.voice_refs = (refs || []).slice(0, MAX_VOICE_REFS)
}

function unbindVoiceByIndex(index) {
  const next = [...boundVoices.value]
  next.splice(index, 1)
  binding.voice_refs = next
}

function openScenePicker() {
  if (!projectScenes.value.length) {
    toast.warning('该项目暂无场景')
    return
  }
  entityPickerMode.value = 'scene'
  entityPickerOpen.value = true
}

function onEntityPickerConfirm(result) {
  if (result.mode === 'character') {
    const prevIds = new Set(binding.character_ids || [])
    const nextIds = new Set(result.characterIds || [])
    for (const char of projectChars.value) {
      const wasBound = prevIds.has(char.id)
      const isBound = nextIds.has(char.id)
      if (isBound && !wasBound) {
        bindCharacter(binding, char.id, projectChars.value)
      } else if (!isBound && wasBound) {
        unbindCharacter(binding, char.id)
        prompt.value = removePromptImageLabel(prompt.value, null, char.name)
      }
    }
    return
  }

  if (result.mode === 'scene') {
    const prevIds = new Set(getBindingSceneIds(binding))
    const nextIds = new Set(result.sceneIds || [])
    for (const scene of projectScenes.value) {
      const wasBound = prevIds.has(scene.id)
      const isBound = nextIds.has(scene.id)
      if (isBound && !wasBound) {
        bindScene(binding, scene.id)
      } else if (!isBound && wasBound) {
        unbindScene(binding, scene.id)
        prompt.value = removePromptImageLabel(prompt.value, null, sceneDisplayLabel(scene))
        if (scene.location) {
          prompt.value = removePromptImageLabel(prompt.value, null, scene.location)
        }
      }
    }
  }
}

function unbindCharacterById(charId, name) {
  unbindCharacter(binding, charId)
  prompt.value = removePromptImageLabel(prompt.value, null, name)
}

function isCharacterBound(charId) {
  return (binding.character_ids || []).includes(charId)
}

function onToggleCharacter(char) {
  const wasBound = isCharacterBound(char.id)
  const added = toggleCharacterBinding(binding, char.id, projectChars.value)
  if (!added && wasBound) {
    prompt.value = removePromptImageLabel(prompt.value, null, char.name)
  }
}

function unbindSceneById(sceneId) {
  const scene = projectScenes.value.find(item => item.id === sceneId)
  unbindScene(binding, sceneId)
  if (scene) {
    prompt.value = removePromptImageLabel(prompt.value, null, sceneDisplayLabel(scene))
    if (scene.location) {
      prompt.value = removePromptImageLabel(prompt.value, null, scene.location)
    }
  }
  prompt.value = removePromptImageLabel(prompt.value, null, '场景')
}

function canUnlinkRef(ref) {
  return canUnlinkStudioRef(ref)
}

function unlinkRef(ref) {
  const label = ref.promptLabel || ref.label
  if (ref.source === 'character' && ref.charId) {
    unbindCharacter(binding, ref.charId)
  } else if (ref.source === 'scene' || ref.sceneId) {
    unbindScene(binding, ref.sceneId)
  } else if (ref.source === 'reference' && ref.url) {
    const path = normalizeMediaPath(ref.url)
    uploadedRefs.value = uploadedRefs.value.filter(item => normalizeMediaPath(item.path) !== path)
    syncUploadPaths()
  }
  prompt.value = removePromptImageLabel(prompt.value, ref.imageIndex, label)
}

function syncUploadPaths() {
  binding.reference_images = uploadedRefs.value.map(item => item.path)
}

function addReferencePath(path, meta = {}) {
  const normalized = normalizeMediaPath(path)
  if (!normalized) return false
  if (uploadedRefs.value.length >= maxImages) {
    toast.warning(`最多 ${maxImages} 张参考图`)
    return false
  }
  if (uploadedRefs.value.some(item => normalizeMediaPath(item.path) === normalized)) {
    return true
  }
  uploadedRefs.value.push({
    path: normalized,
    preview: gridUrl(normalized),
    ossUrl: meta.ossUrl || null,
    label: meta.label || null,
    assetId: meta.assetId || null,
  })
  syncUploadPaths()
  return true
}

async function onUpload(event) {
  const files = Array.from(event?.target?.files || [])
  if (!files.length) return
  const remain = maxImages - uploadedRefs.value.length
  if (remain <= 0) {
    toast.warning(`最多上传 ${maxImages} 张参考图`)
    return
  }
  for (const file of files.slice(0, remain)) {
    try {
      const res = await uploadAPI.image(file, dramaId.value ? Number(dramaId.value) : null)
      const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
      if (!path) throw new Error('上传失败')
      const ossUrl = res?.oss_url || res?.ossUrl || null
      const label = res?.name || file.name?.replace(/\.[^.]+$/, '') || `参考图${uploadedRefs.value.length + 1}`
      const assetId = res?.asset_id || res?.assetId || null
      addReferencePath(path, { ossUrl, label, assetId })
      pushSessionReferenceAsset({ path, label, assetId })
      if (!ossUrl) await prefetchMediaUrls([path])
      if (assetId) toast.success('已上传并入库参考图')
      else toast.warning('图片已添加，但未入库（请重启后端后重试上传）')
    } catch (err) {
      toast.error(err?.message || '上传失败')
    }
  }
  if (event?.target) event.target.value = ''
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

function openReferencePicker() {
  referencePickerKey.value += 1
  referencePickerOpen.value = true
}

function onReferencePicked(item) {
  const asset = item?.asset || item
  const path = normalizeMediaPath(asset?.url || asset?.local_path || asset?.localPath)
  if (!path) {
    toast.error('参考图无效')
    return
  }
  const label = asset?.name || '参考图'
  if (!addReferencePath(path, { label, assetId: asset?.id || null })) return
  referencePickerOpen.value = false
  prefetchMediaUrls([path]).catch(() => {})
}

function removeUpload(index) {
  const removed = uploadedRefs.value[index]
  uploadedRefs.value = uploadedRefs.value.filter((_, i) => i !== index)
  syncUploadPaths()
  if (removed) {
    prompt.value = removePromptImageLabel(prompt.value, null, `参考图${index + 1}`)
  }
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
  if (event.key === 'Escape') {
    mentionOpen.value = false
  }
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

  const result = replaceMentionWithImageLabel(
    prompt.value,
    mentionStart.value,
    cursor,
    index,
    label,
  )
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

function submit() {
  const text = prompt.value.trim()
  if (!text) {
    toast.warning('请输入视频描述')
    return
  }

  syncUploadPaths()

  const payload = {
    duration: duration.value,
    aspect_ratio: aspectRatio.value,
    drama_id: dramaId.value ? Number(dramaId.value) : undefined,
  }

  if (dramaLinked.value && refMode.value === 'reference') {
    const issues = validateStudioPrompt(text, binding, projectChars.value, projectScenes.value)
    if (issues.length) {
      toast.error(formatPromptImageRefIssues(issues))
      return
    }
    const { prompt: finalPrompt, contentRefs } = buildStudioContentRefs(
      binding,
      text,
      projectChars.value,
      projectScenes.value,
    )
    payload.prompt = finalPrompt
    if (contentRefs.length) {
      payload.content_refs = contentRefs
      const imageUrls = contentRefs
        .filter(ref => ref.type === 'image' && ref.role !== 'first_frame' && ref.role !== 'last_frame')
        .map(ref => ref.url)
        .filter(Boolean)
      if (imageUrls.length) {
        payload.reference_mode = 'multiple'
        payload.reference_image_urls = imageUrls
      }
    }
    emit('generate', payload)
    return
  }

  const images = uploadedRefs.value.map(item => item.path)
  let finalPrompt = text
  payload.prompt = finalPrompt

  if (images.length === 1 && refMode.value === 'reference') {
    Object.assign(payload, {
      reference_mode: 'single',
      image_url: images[0],
      content_refs: [{ type: 'image', url: images[0], label: '参考图1' }],
    })
    payload.prompt = buildSimplePromptHeader(text, 1)
  } else if (images.length >= 2 && refMode.value === 'first_last') {
    Object.assign(payload, {
      reference_mode: 'first_last',
      first_frame_url: images[0],
      last_frame_url: images[1],
      content_refs: [
        { type: 'image', url: images[0], role: 'first_frame', label: '首帧' },
        { type: 'image', url: images[1], role: 'last_frame', label: '尾帧' },
      ],
    })
  } else if (images.length > 0) {
    Object.assign(payload, {
      reference_mode: 'multiple',
      reference_image_urls: images,
      content_refs: images.map((url, idx) => ({
        type: 'image',
        url,
        label: `参考图${idx + 1}`,
      })),
    })
    payload.prompt = buildSimplePromptHeader(text, images.length)
  }

  emit('generate', payload)
}

function loadFromItem(item) {
  prompt.value = String(item?.prompt || '')
  aspectRatio.value = item?.aspect_ratio || item?.aspectRatio || '9:16'
  duration.value = Number(item?.duration || 15)
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

  const mode = item?.reference_mode || item?.referenceMode
  refMode.value = mode === 'first_last' ? 'first_last' : 'reference'
}

function clearPrompt() {
  prompt.value = ''
}

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

.composer-main {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.composer-input-wrap {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 310px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  padding: 0;
  overflow: visible;
}

.composer-ref-stack {
  display: flex;
  align-items: flex-end;
  flex-wrap: nowrap;
  gap: 0;
  padding: 12px 14px 0;
  min-height: 78px;
  overflow: visible;
  cursor: default;
}

.composer-ref-card {
  --ref-overlap: -34px;
  position: relative;
  flex-shrink: 0;
  width: 58px;
  height: 58px;
  margin-left: var(--ref-overlap);
  border-radius: 12px;
  border: 2px solid var(--bg-surface);
  background: var(--bg-2);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
  transition:
    margin-left 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.28s ease,
    z-index 0s;
  z-index: calc(var(--ref-index, 0) + 1);
}

.composer-ref-card:first-child {
  margin-left: 0;
}

.composer-ref-stack.is-expanded .composer-ref-card,
.composer-ref-stack:hover .composer-ref-card {
  margin-left: 8px;
}

.composer-ref-stack.is-expanded .composer-ref-card:first-child,
.composer-ref-stack:hover .composer-ref-card:first-child {
  margin-left: 0;
}

.composer-ref-card:hover {
  z-index: 30;
  transform: translateY(-6px) scale(1.06);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.2);
}

.composer-ref-card-thumb {
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  border-radius: 10px;
  overflow: hidden;
  background: transparent;
  cursor: zoom-in;
  display: block;
}

.composer-ref-card-thumb:disabled {
  cursor: not-allowed;
}

.composer-ref-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.composer-ref-card-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-3);
  background: var(--bg-3);
}

.composer-ref-card.missing {
  border-color: rgba(239, 83, 80, 0.55);
}

.composer-ref-card.is-first {
  box-shadow: 0 0 0 2px #4c7dff, 0 4px 14px rgba(15, 23, 42, 0.12);
}

.composer-ref-card.is-last {
  box-shadow: 0 0 0 2px #7c4dff, 0 4px 14px rgba(15, 23, 42, 0.12);
}

.composer-ref-card-tag {
  position: absolute;
  left: 4px;
  bottom: 4px;
  max-width: calc(100% - 8px);
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 9px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(0, 0, 0, 0.68);
  color: #fff;
  pointer-events: none;
}

.composer-ref-card-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  z-index: 2;
  width: 18px;
  height: 18px;
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  font-size: 13px;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.composer-ref-stack.is-expanded .composer-ref-card-remove,
.composer-ref-stack:hover .composer-ref-card-remove,
.composer-ref-card:hover .composer-ref-card-remove {
  opacity: 1;
  transform: scale(1);
}

.composer-ref-add-card {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 58px;
  height: 58px;
  margin-left: 8px;
  border-radius: 12px;
  border: 1px dashed var(--border);
  background: var(--bg-2);
  color: var(--text-3);
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}

.composer-ref-add-card:hover {
  border-color: rgba(76, 125, 255, 0.55);
  color: var(--accent-text);
  background: var(--accent-bg);
}

.composer-ref-add-icon {
  font-size: 20px;
  line-height: 1;
}

.composer-ref-add-label {
  font-size: 9px;
  line-height: 1.1;
  text-align: center;
  padding: 0 4px;
}

.composer-input {
  width: 100%;
  flex: 1;
  min-height: 220px;
  max-height: 480px;
  resize: vertical;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-0);
  font-size: 14px;
  line-height: 1.6;
  padding: 12px 14px 14px;
}

.composer-input--with-refs {
  padding-top: 8px;
}

.composer-input-wrap:focus-within {
  border-color: rgba(76, 125, 255, 0.45);
  box-shadow: 0 0 0 3px rgba(76, 125, 255, 0.12);
}

.composer-project-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.composer-project-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-1);
  white-space: nowrap;
}

.composer-project-hint {
  font-size: 11px;
  line-height: 1.4;
}

.composer-project-hint kbd {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  font-size: 10px;
}

.composer-bind-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 0;
}

.composer-pick-btn {
  position: relative;
}

.composer-pick-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
}

.composer-bound-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 0;
}

.composer-bound-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}

.composer-bound-chip:hover {
  border-color: rgba(239, 83, 80, 0.45);
  color: var(--text-1);
}

.composer-bind-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.composer-bind-label {
  width: 36px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-dim);
}

.composer-bind-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.composer-bind-pill {
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}

.composer-bind-pill.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-text);
}

.composer-pill-x {
  margin-left: 2px;
  opacity: 0.75;
  font-weight: 700;
}

.composer-scene-select {
  min-width: 180px;
}

.composer-linked-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.composer-linked-ref {
  position: relative;
  width: 64px;
}

.composer-linked-ref.clickable {
  cursor: zoom-in;
}

.composer-linked-ref.clickable:hover img {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(76, 125, 255, 0.18);
}

.composer-linked-ref img,
.composer-linked-ref-empty {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--border);
  display: block;
}

.composer-linked-ref-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-2);
}

.composer-linked-ref.missing .composer-linked-ref-empty,
.composer-linked-ref.missing img {
  border-color: rgba(239, 83, 80, 0.45);
}

.composer-linked-ref-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-2);
  line-height: 1.2;
}

.composer-linked-ref-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 2;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  font-size: 14px;
}

.composer-input::placeholder { color: var(--text-3); }

.composer-mention-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  max-height: 240px;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  padding: 6px;
  z-index: 30;
}

.composer-mention-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.composer-mention-item:hover {
  background: var(--bg-hover);
}

.composer-mention-item img,
.composer-mention-thumb-empty {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
}

.composer-mention-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-2);
  color: var(--text-3);
  font-size: 12px;
}

.composer-mention-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.composer-mention-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-0);
}

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
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.composer-option {
  display: flex;
  align-items: center;
  gap: 6px;
}

.composer-option-label {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}

.composer-select {
  max-width: 140px;
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 11px;
}

.composer-pills {
  display: inline-flex;
  gap: 4px;
  padding: 2px;
  border-radius: 999px;
  background: var(--bg-2);
  border: 1px solid var(--border);
}

.composer-pill {
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
}

.composer-pill.active {
  background: var(--accent-bg);
  color: var(--accent-text);
}

.composer-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}

.composer-submit {
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  padding: 10px 22px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(135deg, #4c7dff 0%, #7c4dff 100%);
  box-shadow: 0 8px 24px rgba(76, 125, 255, 0.35);
}

.composer-submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

@media (max-width: 760px) {
  .studio-composer { padding: 0 12px 12px; }
  .composer-ref-stack {
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 4px;
  }
  .composer-ref-card {
    --ref-overlap: -28px;
  }
  .composer-ref-stack.is-expanded .composer-ref-card,
  .composer-ref-stack:hover .composer-ref-card {
    margin-left: 6px;
  }
  .composer-toolbar { flex-direction: column; align-items: stretch; }
  .composer-submit { width: 100%; }
  .composer-input {
    min-height: 220px;
  }
}

.composer-image-preview {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(18, 24, 34, 0.68);
  backdrop-filter: blur(10px);
}

.composer-image-preview-dialog {
  width: min(960px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.composer-image-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.composer-image-preview-title {
  font-size: 14px;
  font-weight: 700;
}

.composer-image-preview-body {
  padding: 16px;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-2);
}

.composer-image-preview-body img {
  max-width: 100%;
  max-height: calc(100vh - 160px);
  object-fit: contain;
  border-radius: 8px;
}

.composer-voice-library-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.composer-voice-library-dialog {
  width: min(720px, 100%);
  max-height: min(80vh, 720px);
  overflow: auto;
  padding: 16px;
}

.composer-voice-library-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.composer-voice-library-head h3 {
  margin: 0;
  font-size: 16px;
}

.composer-bound-chip-voice {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
