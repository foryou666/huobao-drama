<template>
  <div class="studio-composer">
    <div class="composer-shell card">
      <div v-if="dramaLinked" class="composer-project-panel">
        <div class="composer-project-head">
          <span class="composer-project-title">项目素材</span>
          <span class="dim composer-project-hint">输入 <kbd>@</kbd> 关联角色/场景，或点击下方选择</span>
        </div>

        <div class="composer-bind-row">
          <span class="composer-bind-label">角色</span>
          <div class="composer-bind-pills">
            <button
              v-for="char in projectChars"
              :key="char.id"
              type="button"
              class="composer-bind-pill"
              :class="{ active: isCharacterBound(char.id) }"
              @click="onToggleCharacter(char)"
            >
              {{ char.name }}<span v-if="isCharacterBound(char.id)" class="composer-pill-x"> ×</span>
            </button>
            <span v-if="!projectChars.length" class="dim">该项目暂无角色</span>
          </div>
        </div>

        <div class="composer-bind-row">
          <span class="composer-bind-label">场景</span>
          <select
            :value="binding.scene_id || ''"
            class="composer-select composer-scene-select"
            @change="onSceneSelect"
          >
            <option value="">未绑定场景</option>
            <option v-for="scene in projectScenes" :key="scene.id" :value="scene.id">
              {{ scene.location }} · {{ scene.time || '未设时间' }}
            </option>
          </select>
          <button
            v-if="binding.scene_id"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="clearSceneBinding"
          >
            取消场景
          </button>
          <button
            v-if="binding.scene_id"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="insertSceneMention"
          >
            写入 @场景
          </button>
        </div>

        <div v-if="linkedDisplayItems.length" class="composer-linked-refs">
          <div
            v-for="ref in linkedDisplayItems"
            :key="ref.key"
            class="composer-linked-ref"
            :class="{ missing: ref.missing, clickable: !!ref.url }"
            @click="ref.url && openImagePreview(ref.url, previewRefTitle(ref))"
          >
            <button
              v-if="canUnlinkRef(ref)"
              type="button"
              class="composer-linked-ref-remove"
              title="取消关联"
              @click.stop="unlinkRef(ref)"
            >
              ×
            </button>
            <img v-if="ref.url" :src="displayUrl(ref.url)" alt="" />
            <div v-else class="composer-linked-ref-empty">缺图</div>
            <div class="composer-linked-ref-meta">
              <span v-if="ref.imageIndex" class="mono">图{{ ref.imageIndex }}</span>
              <span>{{ ref.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="uploadedRefs.length" class="composer-refs">
        <div
          v-for="(img, index) in uploadedRefs"
          :key="img.path + index"
          class="composer-ref"
          :class="{ 'is-first': refMode === 'first_last' && index === 0, 'is-last': refMode === 'first_last' && index === 1 }"
        >
          <button
            type="button"
            class="composer-ref-thumb"
            @click="openImagePreview(img.path, `上传参考图 ${index + 1}`)"
          >
            <img :src="img.preview" alt="" />
          </button>
          <button type="button" class="composer-ref-remove" @click.stop="removeUpload(index)">×</button>
          <span v-if="refMode === 'first_last' && index === 0" class="composer-ref-tag">首帧</span>
          <span v-else-if="refMode === 'first_last' && index === 1" class="composer-ref-tag">尾帧</span>
          <span v-else class="composer-ref-tag">上传{{ index + 1 }}</span>
        </div>
        <label v-if="uploadedRefs.length < maxImages" class="composer-ref-add">
          <input type="file" accept="image/*" hidden @change="onUpload" />
          <span>+</span>
        </label>
      </div>

      <div class="composer-main">
        <div class="composer-input-wrap">
          <textarea
            ref="promptEl"
            v-model="prompt"
            class="composer-input"
            rows="3"
            :placeholder="dramaLinked ? '描述视频内容；输入 @ 可关联角色、场景或上传图…' : '描述你想生成的视频画面、动作与镜头…'"
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
              :key="`${option.type}:${option.id || option.path}`"
              type="button"
              class="composer-mention-item"
              @mousedown.prevent="pickMention(option)"
            >
              <img v-if="option.thumb" :src="displayUrl(option.thumb)" alt="" />
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

            <button
              v-if="dramaLinked"
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
import { dramaAPI, uploadAPI } from '~/composables/useApi'
import { mediaDisplayUrl, normalizeMediaPath } from '~/utils/media-url.js'
import {
  bindCharacter,
  bindScene,
  buildMentionOptions,
  buildStudioContentRefs,
  buildStudioDisplayItems,
  canUnlinkStudioRef,
  createStudioBindingState,
  formatPromptImageRefIssues,
  insertPromptImageLabel,
  nextPromptImageIndex,
  removePromptImageLabel,
  replaceMentionWithImageLabel,
  toggleCharacterBinding,
  unbindCharacter,
  validateStudioPrompt,
} from '~/utils/studio-video-refs.js'

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
const refMode = ref('reference')
const aspectRatio = ref('9:16')
const duration = ref(15)
const dramaId = ref('')
const promptEl = ref(null)
const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionStart = ref(0)
const imagePreview = ref({ open: false, src: '', title: '' })

const dramaLinked = computed(() => !!dramaId.value)

const linkedDisplayItems = computed(() => {
  if (!dramaLinked.value) return []
  return buildStudioDisplayItems(binding, prompt.value, projectChars.value, projectScenes.value)
})

const mentionOptions = computed(() => buildMentionOptions(
  projectChars.value,
  projectScenes.value,
  uploadedRefs.value.map((item, index) => ({ ...item, index: index + 1, label: `参考图${index + 1}` })),
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
    uploadedRefs.value = (paths || []).map(path => ({
      path,
      preview: mediaDisplayUrl(path),
    }))
  },
  { deep: true },
)

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
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
  } catch (err) {
    projectChars.value = []
    projectScenes.value = []
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

function isCharacterBound(charId) {
  return (binding.character_ids || []).includes(charId)
}

function onToggleCharacter(char) {
  const wasBound = isCharacterBound(char.id)
  const added = toggleCharacterBinding(binding, char.id, projectChars.value)
  if (added) {
    appendImageLabel(nextPromptImageIndex(prompt.value), char.name)
  } else if (wasBound) {
    prompt.value = removePromptImageLabel(prompt.value, null, char.name)
  }
}

function clearSceneBinding() {
  const scene = projectScenes.value.find(item => item.id === binding.scene_id)
  binding.scene_id = null
  bindScene(binding, null)
  if (scene?.location) {
    prompt.value = removePromptImageLabel(prompt.value, null, scene.location)
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
    binding.scene_id = null
    bindScene(binding, null)
  } else if (ref.source === 'reference' && ref.url) {
    const path = normalizeMediaPath(ref.url)
    uploadedRefs.value = uploadedRefs.value.filter(item => normalizeMediaPath(item.path) !== path)
    syncUploadPaths()
  }
  prompt.value = removePromptImageLabel(prompt.value, ref.imageIndex, label)
}

function onSceneSelect(event) {
  const value = event.target.value
  if (!value && binding.scene_id) {
    clearSceneBinding()
    return
  }
  binding.scene_id = value ? Number(value) : null
  bindScene(binding, binding.scene_id)
}

function insertSceneMention(scene = null) {
  const target = scene || projectScenes.value.find(item => item.id === binding.scene_id)
  if (!target) return
  const index = nextPromptImageIndex(prompt.value)
  appendImageLabel(index, target.location || '场景')
}

function appendImageLabel(index, label) {
  const el = promptEl.value
  const cursor = el?.selectionStart ?? prompt.value.length
  const result = insertPromptImageLabel(prompt.value, cursor, cursor, index, label)
  prompt.value = result.text
  nextTick(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(result.cursor, result.cursor)
  })
}

function syncUploadPaths() {
  binding.reference_images = uploadedRefs.value.map(item => item.path)
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
      const res = await uploadAPI.image(file)
      const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
      if (!path) throw new Error('上传失败')
      uploadedRefs.value.push({ path, preview: mediaDisplayUrl(path) })
    } catch (err) {
      toast.error(err?.message || '上传失败')
    }
  }
  syncUploadPaths()
  if (event?.target) event.target.value = ''
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
  if (!el || !dramaLinked.value) {
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
  if (!dramaLinked.value) return
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
  const el = promptEl.value
  const cursor = el?.selectionEnd ?? prompt.value.length
  const index = nextPromptImageIndex(prompt.value)

  if (option.type === 'character') {
    bindCharacter(binding, option.id, projectChars.value)
  } else if (option.type === 'scene') {
    binding.scene_id = option.id
    bindScene(binding, option.id)
  }

  const result = replaceMentionWithImageLabel(
    prompt.value,
    mentionStart.value,
    cursor,
    index,
    option.label,
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
    preview: ref.display_url || mediaDisplayUrl(ref.path),
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
  max-width: 920px;
  margin: 0 auto;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-card);
}

.composer-input-wrap {
  position: relative;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  padding: 10px 12px;
}

.composer-input {
  width: 100%;
  min-height: 72px;
  max-height: 180px;
  resize: vertical;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-0);
  font-size: 14px;
  line-height: 1.55;
}

.composer-project-panel {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
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
}

.composer-project-hint {
  font-size: 11px;
}

.composer-project-hint kbd {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  font-size: 10px;
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

.composer-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.composer-ref,
.composer-ref-add {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-2);
}

.composer-ref img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.composer-ref-thumb {
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
  display: block;
}

.composer-ref.is-first { box-shadow: 0 0 0 2px #4c7dff; }
.composer-ref.is-last { box-shadow: 0 0 0 2px #7c4dff; }

.composer-ref-tag {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 9px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
}

.composer-ref-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
  line-height: 1;
}

.composer-ref-add {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-3);
  font-size: 22px;
}

.composer-main { display: flex; flex-direction: column; gap: 10px; }

.composer-input-wrap:focus-within {
  border-color: rgba(76, 125, 255, 0.45);
  box-shadow: 0 0 0 3px rgba(76, 125, 255, 0.12);
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
  .composer-toolbar { flex-direction: column; align-items: stretch; }
  .composer-submit { width: 100%; }
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
</style>
