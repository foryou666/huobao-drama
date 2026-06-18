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
            <button v-if="showVoicePicker" type="button" class="btn btn-sm composer-pick-btn" @click="openVoicePicker">
              选择音色
              <span v-if="boundVoiceCount" class="composer-pick-count">{{ boundVoiceCount }}</span>
            </button>
            <button v-if="showVoicePicker" type="button" class="btn btn-sm composer-pick-btn" @click="voiceLibraryOpen = true">
              音色库
            </button>
          </div>
          <div v-if="boundCharacterCount || boundSceneCount || boundPropCount || boundVoiceCount" class="composer-bound-summary">
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
        <span class="dim composer-project-hint">在弹窗中按分组选择参考图；上方图片可左右拖动调整顺序，输入框会自动更新「图片1是…」「音频1是…的声音」；可用 <kbd>@</kbd> 关联</span>
      </div>

      <div class="composer-main">
        <div
          class="composer-input-wrap"
          :class="{ 'is-prompt-expanded': isPromptComposerExpanded }"
        >
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
                'is-dragging': refDragIndex === index,
                'is-drag-over': refDropIndex === index && refDragIndex !== index,
                'is-draggable': canDragRefStrip,
              }"
              :style="{ '--ref-index': index }"
              :draggable="canDragRefStrip"
              @dragstart="onRefDragStart(index, $event)"
              @dragend="onRefDragEnd"
              @dragover="onRefDragOver(index, $event)"
              @dragleave="onRefDragLeave(index)"
              @drop="onRefDrop(index, $event)"
            >
              <button
                type="button"
                class="composer-ref-card-thumb"
                :disabled="!item.preview && item.missing"
                :title="item.tagLabel"
                @click.stop="openVisualRefPreview(item)"
                @mousedown.stop
                @dragstart.stop
              >
                <img v-if="item.preview" :src="item.preview" alt="" />
                <div v-else class="composer-ref-card-empty">缺图</div>
              </button>
              <button
                type="button"
                class="composer-ref-card-remove"
                title="移除"
                @click.stop="removeVisualRef(item)"
                @mousedown.stop
                @dragstart.stop
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

          <div
            v-if="videoRefUploadEnabled && uploadedVideoRefs.length"
            class="composer-video-ref-row"
          >
            <div
              v-for="(video, vIndex) in uploadedVideoRefs"
              :key="video.path"
              class="composer-video-ref-chip"
            >
              <span class="composer-video-ref-icon" aria-hidden="true">▶</span>
              <span class="composer-video-ref-label">{{ video.label || (videoRefLabelKind === 'material' ? `参考素材${vIndex + 1}` : `参考视频${vIndex + 1}`) }}</span>
              <button
                type="button"
                class="composer-video-ref-remove"
                title="移除"
                @click="removeVideoRef(vIndex)"
              >
                ×
              </button>
            </div>
          </div>

          <textarea
            ref="promptEl"
            v-model="prompt"
            class="composer-input"
            :class="{ 'composer-input--with-refs': showRefStrip }"
            :rows="isPromptComposerExpanded ? 6 : 2"
            :placeholder="mentionableRefItems.length ? '描述视频内容；输入 @ 可关联参考图…' : (dramaLinked ? '描述视频内容…' : '描述你想生成的视频画面、动作与镜头…')"
            @focus="onPromptFocus"
            @blur="onPromptBlur"
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
            <div v-if="jimengMode && jimengModels.length" class="composer-pills composer-pills-official">
              <span class="composer-option-label">即梦模型</span>
              <button
                v-for="model in jimengModels"
                :key="model.id"
                type="button"
                class="composer-pill composer-pill-model"
                :class="{ active: fixedModel === model.id }"
                @click="selectOfficialModel(model.id)"
              >
                {{ model.label }}
              </button>
            </div>

            <div v-if="grokMode && grokModels.length" class="composer-pills composer-pills-official">
              <span class="composer-option-label">Grok 模型</span>
              <button
                v-for="model in grokModels"
                :key="model.id"
                type="button"
                class="composer-pill composer-pill-model"
                :class="{ active: fixedModel === model.id }"
                @click="selectOfficialModel(model.id)"
              >
                {{ model.label }}
              </button>
            </div>

            <div v-if="officialMode && officialModels.length" class="composer-pills composer-pills-official">
              <span class="composer-option-label">官方模型</span>
              <button
                v-for="model in officialModels"
                :key="model.id"
                type="button"
                class="composer-pill composer-pill-model"
                :class="{ active: fixedModel === model.id }"
                @click="selectOfficialModel(model.id)"
              >
                {{ model.label }}
              </button>
            </div>

            <div v-if="!officialMode && chengmengModels.length" class="composer-pills composer-pills-official">
              <span class="composer-option-label">模型</span>
              <button
                v-for="model in chengmengModels"
                :key="model.id"
                type="button"
                class="composer-pill composer-pill-model"
                :class="{ active: fixedModel === model.id }"
                @click="selectOfficialModel(model.id)"
              >
                {{ model.label }}
              </button>
            </div>

            <label class="composer-option">
              <span class="composer-option-label">项目</span>
              <select v-model="dramaId" class="composer-select" @change="onDramaChange">
                <option value="">不关联项目</option>
                <option v-for="d in dramas" :key="d.id" :value="String(d.id)">{{ d.title }}</option>
              </select>
            </label>

            <div v-if="showRefModeToggle && !grokMode && !jimengMode" class="composer-pills">
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
                v-for="ratio in effectiveAspectRatios"
                :key="ratio"
                type="button"
                class="composer-pill"
                :class="{ active: aspectRatio === ratio }"
                @click="aspectRatio = ratio"
              >
                {{ ratio }}
              </button>
            </div>

            <div v-if="(grokMode && grokDurationRangeEnabled) || (jimengMode && jimengDurationRangeEnabled)" class="composer-duration-range">
              <select
                class="composer-select composer-duration-select"
                :value="duration"
                @change="onDurationSelect"
              >
                <option v-for="sec in durationSelectOptions" :key="sec" :value="sec">
                  {{ sec }}s
                </option>
              </select>
            </div>
            <div v-else-if="durationRangeEnabled" class="composer-duration-range">
              <select
                class="composer-select composer-duration-select"
                :value="duration"
                @change="onDurationSelect"
              >
                <option v-for="sec in durationSelectOptions" :key="sec" :value="sec">
                  {{ sec }}s
                </option>
              </select>
            </div>
            <div v-else class="composer-pills">
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

            <label
              v-if="videoRefUploadEnabled && uploadedVideoRefs.length < maxVideoRefs"
              class="composer-upload-btn"
            >
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                hidden
                @change="onVideoUpload"
              />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              上传参考视频
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
            :disabled="generating || !prompt.trim() || ((officialMode || grokMode || jimengMode || aistarslabMode) && !fixedModel)"
            @click="submit"
          >
            <span>{{ generating ? '生成中…' : (jimengMode ? '即梦生成' : (grokMode ? 'Grok 生成' : (aistarslabMode ? '生成视频' : (officialMode ? '官方生成' : '生成视频')))) }}</span>
            <span v-if="displayCreditHint && !generating" class="composer-submit-cost">{{ displayCreditHint }}</span>
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
  bindProp,
  applyStudioPromptMediaHeader,
  applyRefStripOrderToBinding,
  buildMentionOptions,
  buildStudioContentRefs,
  buildStudioRefStripItems,
  canUnlinkStudioRef,
  collectPreservedMediaLabels,
  createStudioBindingState,
  ensureRefStripOrderKeys,
  formatPromptImageRefIssues,
  getBindingSceneIds,
  nextPromptImageIndex,
  removePromptImageLabel,
  replaceMentionWithImageLabel,
  restoreStudioBindingsFromVideoItem,
  sceneDisplayLabel,
  toggleCharacterBinding,
  unbindCharacter,
  unbindScene,
  unbindProp,
  validateStudioPrompt,
} from '~/utils/studio-video-refs.js'
import { parseVoiceRefs, MAX_VOICE_REFS } from '~/utils/voice-refs.js'
import { resolveStudioDramaId, setLastStudioDramaId } from '~/utils/studio-drama-preference.js'
import VoiceAssetPickerModal from '~/components/VoiceAssetPickerModal.vue'
import VoiceLibraryPanel from '~/components/VoiceLibraryPanel.vue'

const props = defineProps({
  generating: { type: Boolean, default: false },
  dramas: { type: Array, default: () => [] },
  defaultDramaId: { type: String, default: '' },
  /** 官方 Seedance 页：走火山方舟 API */
  officialMode: { type: Boolean, default: false },
  /** Grok 视频页：走 GeekNow Grok API */
  grokMode: { type: Boolean, default: false },
  /** 即梦视频页（管理员）：走 jimeng.jianying.com Cookie API */
  jimengMode: { type: Boolean, default: false },
  /** AIStartLab 视频页：走 OpenAPI Seedance 2.0 */
  aistarslabMode: { type: Boolean, default: false },
  /** 官方页可选模型列表 */
  officialModels: { type: Array, default: () => [] },
  /** Grok 页可选模型列表 */
  grokModels: { type: Array, default: () => [] },
  /** 即梦页可选模型列表 */
  jimengModels: { type: Array, default: () => [] },
  /** 橙盟视频页可选模型列表 */
  chengmengModels: { type: Array, default: () => [] },
  /** AIStartLab 页可选模型列表 */
  aistarslabModels: { type: Array, default: () => [] },
  /** 固定官方 Seedance 配置 ID（视频生成官页面） */
  fixedConfigId: { type: [Number, null], default: null },
  /** 固定 Seedance 模型 ID */
  fixedModel: { type: String, default: '' },
  /** 有参考图时强制 adaptive 比例（官方 Seedance 2.0） */
  forceAdaptiveAspect: { type: Boolean, default: false },
  /** 生成按钮旁展示的积分提示 */
  creditCostHint: { type: String, default: '' },
  /** 按秒计费单价（官方 Seedance 页） */
  creditCostPerSecond: { type: Number, default: null },
  /** 按次计费单价（Grok 视频页） */
  creditCostFlat: { type: Number, default: null },
  /** 含参考视频时的积分倍率（如 1.5） */
  referenceVideoMultiplier: { type: Number, default: null },
  /** 可选时长下限（秒），官方页默认 4 */
  durationMin: { type: Number, default: null },
  /** 可选时长上限（秒），官方页默认 15 */
  durationMax: { type: Number, default: null },
  /** 记住当前账号上次选择的项目 */
  rememberDramaId: { type: Boolean, default: true },
  /** localStorage 作用域键（区分视频/官方等页面） */
  dramaPreferenceScope: { type: String, default: 'video' },
  /** 是否显示参考图/首尾帧切换（橙盟通道不支持首尾帧） */
  showRefModeToggle: { type: Boolean, default: true },
  /** 是否显示音色选择（Grok 不支持音色） */
  showVoicePicker: { type: Boolean, default: true },
})

const emit = defineEmits(['generate', 'update:fixedModel'])

const maxImages = computed(() => (props.grokMode ? 6 : props.jimengMode ? 2 : 9))
const MAX_VIDEO_REFS = 3
const isChengmengStudio = computed(() =>
  props.chengmengModels.length > 0
  && !props.officialMode
  && !props.grokMode
  && !props.jimengMode
  && !props.aistarslabMode,
)
const videoRefUploadEnabled = computed(() => props.aistarslabMode || isChengmengStudio.value)
const videoRefLabelKind = computed(() => (isChengmengStudio.value ? 'material' : 'video'))
const maxVideoRefs = computed(() => (videoRefUploadEnabled.value ? MAX_VIDEO_REFS : 0))
const defaultAspectRatios = ['9:16', '16:9']
const grokAspectRatios = ['2:3', '3:2', '1:1']
const jimengAspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']
const durations = [10, 15]

const prompt = ref('')
const uploadedRefs = ref([])
const uploadedVideoRefs = ref([])
const binding = reactive(createStudioBindingState())
const projectChars = ref([])
const projectScenes = ref([])
const projectProps = ref([])
const voiceAssets = ref([])
const voicePickerOpen = ref(false)
const voiceLibraryOpen = ref(false)
const refMode = ref('reference')

watch(
  () => props.showRefModeToggle,
  (enabled) => {
    if (!enabled) refMode.value = 'reference'
  },
  { immediate: true },
)
const aspectRatio = ref('9:16')
const duration = ref(15)

const effectiveAspectRatios = computed(() => {
  if (props.grokMode) return grokAspectRatios
  if (props.jimengMode) return jimengAspectRatios
  return defaultAspectRatios
})

const selectedGrokModel = computed(() => {
  if (!props.grokMode || !props.fixedModel) return null
  return props.grokModels.find(item => item.id === props.fixedModel) || null
})

const selectedJimengModel = computed(() => {
  if (!props.jimengMode || !props.fixedModel) return null
  return props.jimengModels.find(item => item.id === props.fixedModel) || null
})

watch(
  () => props.jimengMode,
  (enabled) => {
    if (!enabled) return
    if (!jimengAspectRatios.includes(aspectRatio.value)) aspectRatio.value = '16:9'
    refMode.value = 'reference'
  },
  { immediate: true },
)

watch(
  () => props.grokMode,
  (enabled) => {
    if (!enabled) return
    if (!grokAspectRatios.includes(aspectRatio.value)) aspectRatio.value = '2:3'
    refMode.value = 'reference'
  },
  { immediate: true },
)

const effectiveDurationMin = computed(() => {
  if (props.jimengMode) {
    const model = selectedJimengModel.value
    if (model?.duration_min != null) return Number(model.duration_min)
    return 5
  }
  if (props.grokMode) {
    const model = selectedGrokModel.value
    if (model?.duration_min != null) return Number(model.duration_min)
    return 4
  }
  if (props.durationMin != null) return props.durationMin
  if (props.officialMode) return 4
  return null
})

const effectiveDurationMax = computed(() => {
  if (props.jimengMode) {
    const model = selectedJimengModel.value
    if (model?.duration_max != null) return Number(model.duration_max)
    return 10
  }
  if (props.grokMode) {
    const model = selectedGrokModel.value
    if (model?.duration_max != null) return Number(model.duration_max)
    return String(props.fixedModel || '').toLowerCase().endsWith('-pro') ? 10 : 15
  }
  if (props.durationMax != null) return props.durationMax
  if (props.officialMode) return 15
  return null
})

const durationRangeEnabled = computed(() => {
  const min = effectiveDurationMin.value
  const max = effectiveDurationMax.value
  return min != null && max != null && max >= min
})

const durationSelectOptions = computed(() => {
  const min = effectiveDurationMin.value
  const max = effectiveDurationMax.value
  if (min == null || max == null || max < min) return []
  const options = []
  for (let sec = min; sec <= max; sec += 1) options.push(sec)
  return options
})

function clampDuration(value) {
  const min = effectiveDurationMin.value
  const max = effectiveDurationMax.value
  if (min != null && max != null && max >= min) {
    const parsed = Math.round(Number(value ?? max))
    if (!Number.isFinite(parsed)) return max
    return Math.min(max, Math.max(min, parsed))
  }
  return value
}

watch(
  () => [props.fixedModel, selectedJimengModel.value],
  () => {
    if (!props.jimengMode) return
    const model = selectedJimengModel.value
    const defaultSec = Number(model?.duration_default) || 5
    duration.value = clampDuration(duration.value ?? defaultSec)
    if (!durationSelectOptions.value.includes(duration.value)) {
      duration.value = defaultSec
    }
  },
  { immediate: true },
)

watch(
  () => [props.fixedModel, selectedGrokModel.value],
  () => {
    if (!props.grokMode) return
    const model = selectedGrokModel.value
    const fallbackMax = String(props.fixedModel || '').toLowerCase().endsWith('-pro') ? 10 : 15
    const defaultSec = Number(model?.duration_default) || fallbackMax
    duration.value = clampDuration(duration.value ?? defaultSec)
    if (!durationSelectOptions.value.includes(duration.value)) {
      duration.value = defaultSec
    }
  },
  { immediate: true },
)

const grokDurationRangeEnabled = computed(() => props.grokMode && durationRangeEnabled.value)
const jimengDurationRangeEnabled = computed(() => props.jimengMode && durationRangeEnabled.value)

function onDurationSelect(event) {
  duration.value = clampDuration(event?.target?.value)
}

const displayCreditHint = computed(() => {
  const flat = props.creditCostFlat
  if (flat != null && Number.isFinite(Number(flat))) {
    let cost = Number(flat)
    const mult = Number(props.referenceVideoMultiplier)
    if (props.aistarslabMode && uploadedVideoRefs.value.length > 0 && Number.isFinite(mult) && mult > 1) {
      cost = Math.max(1, Math.round(cost * mult))
    }
    return `${cost} 积分/次`
  }
  const perSecond = props.creditCostPerSecond
  if (perSecond != null && Number.isFinite(Number(perSecond))) {
    return `${Number(perSecond)} 积分/s`
  }
  return props.creditCostHint
})
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
const refDragIndex = ref(-1)
const refDropIndex = ref(-1)
const promptFocused = ref(false)

const dramaLinked = computed(() => !!dramaId.value)

const isPromptComposerExpanded = computed(() =>
  promptFocused.value || !!prompt.value.trim() || mentionOpen.value,
)

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

const boundVoices = computed(() => parseVoiceRefs(binding.voice_refs))

const boundVoiceCount = computed(() => boundVoices.value.length)

const visualRefItems = computed(() =>
  buildStudioRefStripItems(
    binding,
    projectChars.value,
    projectScenes.value,
    projectProps.value,
    uploadedRefs.value,
    gridUrl,
  ),
)

const showRefStrip = computed(() =>
  dramaLinked.value || visualRefItems.value.length > 0 || (videoRefUploadEnabled.value && uploadedVideoRefs.value.length > 0),
)

const canDragRefStrip = computed(() => visualRefItems.value.length > 1)

const mentionableRefItems = computed(() =>
  visualRefItems.value.filter(item => item.path && !item.missing),
)

const mentionOptions = computed(() => buildMentionOptions(
  mentionableRefItems.value,
  mentionQuery.value,
))

function persistDramaPreference(id = dramaId.value) {
  if (!props.rememberDramaId) return
  setLastStudioDramaId(props.dramaPreferenceScope, id)
}

function applyComposerDramaId(nextId) {
  const normalized = String(nextId || '').trim()
  if (normalized === dramaId.value) {
    if (normalized) loadProjectAssets(normalized)
    return
  }
  if (!normalized) {
    dramaId.value = ''
    resetBinding()
    mentionOpen.value = false
    projectChars.value = []
    projectScenes.value = []
    projectProps.value = []
    voiceAssets.value = []
    return
  }
  dramaId.value = normalized
  resetBinding()
  mentionOpen.value = false
  loadProjectAssets(normalized)
}

function syncComposerDramaFromProps() {
  const next = resolveStudioDramaId({
    scope: props.dramaPreferenceScope,
    defaultDramaId: props.defaultDramaId,
    dramas: props.dramas,
    remember: props.rememberDramaId,
  })
  applyComposerDramaId(next)
}

watch(
  () => [props.defaultDramaId, props.dramas, props.rememberDramaId, props.dramaPreferenceScope],
  () => {
    syncComposerDramaFromProps()
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
    projectProps.value = []
    resetBinding()
    return
  }
  try {
    const drama = await dramaAPI.get(parsed)
    projectChars.value = drama?.characters || []
    projectScenes.value = drama?.scenes || []
    projectProps.value = drama?.props || []
    await loadVoiceAssets()
  } catch (err) {
    projectChars.value = []
    projectScenes.value = []
    projectProps.value = []
    voiceAssets.value = []
    toast.error(err?.message || '加载项目素材失败')
  }
}

function onDramaChange() {
  persistDramaPreference()
  resetBinding()
  mentionOpen.value = false
  if (dramaId.value) loadProjectAssets(dramaId.value)
  else {
    projectChars.value = []
    projectScenes.value = []
    projectProps.value = []
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
  syncPromptMediaHeader()
}

function unbindVoiceByIndex(index) {
  const next = [...boundVoices.value]
  next.splice(index, 1)
  binding.voice_refs = next
  syncPromptMediaHeader()
}

function openScenePicker() {
  if (!projectScenes.value.length) {
    toast.warning('该项目暂无场景')
    return
  }
  entityPickerMode.value = 'scene'
  entityPickerOpen.value = true
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

function ensureRefStripOrder() {
  const defaultItems = buildStudioRefStripItems(
    { ...binding, ref_strip_order: [] },
    projectChars.value,
    projectScenes.value,
    projectProps.value,
    uploadedRefs.value,
    gridUrl,
  )
  ensureRefStripOrderKeys(binding, defaultItems)
}

function syncPromptMediaHeader() {
  ensureRefStripOrder()
  const preserved = collectPreservedMediaLabels(prompt.value)
  prompt.value = applyStudioPromptMediaHeader(
    prompt.value,
    binding,
    projectChars.value,
    projectScenes.value,
    projectProps.value,
    uploadedRefs.value,
    {
      ...preserved,
      uploadedVideoRefs: uploadedVideoRefs.value,
      videoRefLabel: videoRefLabelKind.value,
    },
  )
}

function syncPromptImageHeader() {
  syncPromptMediaHeader()
}

function reorderVisualRefs(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
  const items = [...visualRefItems.value]
  if (fromIndex >= items.length || toIndex >= items.length) return
  const [moved] = items.splice(fromIndex, 1)
  items.splice(toIndex, 0, moved)
  const reorderedUploads = applyRefStripOrderToBinding(binding, items, uploadedRefs.value)
  uploadedRefs.value = reorderedUploads
  syncUploadPaths()
  syncPromptImageHeader()
}

function onRefDragStart(index, event) {
  if (!canDragRefStrip.value) {
    event.preventDefault()
    return
  }
  refDragIndex.value = index
  refDropIndex.value = index
  refStackExpanded.value = true
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onRefDragEnd() {
  refDragIndex.value = -1
  refDropIndex.value = -1
}

function onRefDragOver(index, event) {
  if (refDragIndex.value < 0) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  refDropIndex.value = index
}

function onRefDragLeave(index) {
  if (refDropIndex.value === index) refDropIndex.value = -1
}

function onRefDrop(index, event) {
  event.preventDefault()
  const fromIndex = refDragIndex.value
  onRefDragEnd()
  reorderVisualRefs(fromIndex, index)
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
  } else if (result.mode === 'scene') {
    const prevIds = new Set(getBindingSceneIds(binding))
    const nextIds = new Set(result.sceneIds || [])
    for (const scene of projectScenes.value) {
      const wasBound = prevIds.has(scene.id)
      const isBound = nextIds.has(scene.id)
      if (isBound && !wasBound) {
        bindScene(binding, scene.id, projectScenes.value)
      } else if (!isBound && wasBound) {
        unbindScene(binding, scene.id)
      }
    }
    binding.scene_image_refs = { ...(result.sceneImageRefs || {}) }
  } else if (result.mode === 'prop') {
    const prevIds = new Set(binding.prop_ids || [])
    const nextIds = new Set(result.propIds || [])
    for (const prop of projectProps.value) {
      const wasBound = prevIds.has(prop.id)
      const isBound = nextIds.has(prop.id)
      if (isBound && !wasBound) {
        bindProp(binding, prop.id, projectProps.value)
      } else if (!isBound && wasBound) {
        unbindProp(binding, prop.id)
      }
    }
    binding.prop_image_refs = { ...(result.propImageRefs || {}) }
  }
  syncPromptImageHeader()
}

function unbindCharacterById(charId, name) {
  unbindCharacter(binding, charId)
  syncPromptImageHeader()
}

function isCharacterBound(charId) {
  return (binding.character_ids || []).includes(charId)
}

function onToggleCharacter(char) {
  const wasBound = isCharacterBound(char.id)
  const added = toggleCharacterBinding(binding, char.id, projectChars.value)
  if (!added && wasBound) {
    syncPromptImageHeader()
  } else if (added) {
    syncPromptImageHeader()
  }
}

function unbindSceneById(sceneId) {
  unbindScene(binding, sceneId)
  syncPromptImageHeader()
}

function unbindPropById(propId) {
  unbindProp(binding, propId)
  syncPromptImageHeader()
}

function canUnlinkRef(ref) {
  return canUnlinkStudioRef(ref)
}

function unlinkRef(ref) {
  if (ref.source === 'character' && ref.charId) {
    unbindCharacter(binding, ref.charId)
  } else if (ref.source === 'scene' || ref.sceneId) {
    unbindScene(binding, ref.sceneId)
  } else if (ref.source === 'prop' && ref.propId) {
    unbindProp(binding, ref.propId)
  } else if (ref.source === 'reference' && ref.url) {
    const path = normalizeMediaPath(ref.url)
    uploadedRefs.value = uploadedRefs.value.filter(item => normalizeMediaPath(item.path) !== path)
    syncUploadPaths()
  }
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
  syncPromptImageHeader()
  return true
}

async function onUpload(event) {
  const files = Array.from(event?.target?.files || [])
  if (!files.length) return
  const remain = maxImages.value - uploadedRefs.value.length
  if (remain <= 0) {
    toast.warning(`最多上传 ${maxImages.value} 张参考图`)
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
  syncPromptImageHeader()
}

function addVideoPath(path, meta = {}) {
  const normalized = normalizeMediaPath(path)
  if (!normalized) return false
  if (uploadedVideoRefs.value.length >= maxVideoRefs.value) {
    toast.warning(`最多 ${maxVideoRefs.value} 个参考视频`)
    return false
  }
  if (uploadedVideoRefs.value.some(item => normalizeMediaPath(item.path) === normalized)) {
    return true
  }
  uploadedVideoRefs.value.push({
    path: normalized,
    label: meta.label || null,
    ossUrl: meta.ossUrl || null,
  })
  syncPromptMediaHeader()
  return true
}

async function onVideoUpload(event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  if (uploadedVideoRefs.value.length >= maxVideoRefs.value) {
    toast.warning(`最多上传 ${maxVideoRefs.value} 个参考视频`)
    if (event?.target) event.target.value = ''
    return
  }
  try {
    const res = await uploadAPI.video(file, dramaId.value ? Number(dramaId.value) : null)
    const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
    if (!path) throw new Error('上传失败')
    const defaultName = videoRefLabelKind.value === 'material' ? '参考素材' : '参考视频'
    const label = res?.name || file.name?.replace(/\.[^.]+$/, '') || `${defaultName}${uploadedVideoRefs.value.length + 1}`
    addVideoPath(path, { label, ossUrl: res?.oss_url || res?.ossUrl || null })
    if (!res?.oss_url && !res?.ossUrl) {
      toast.warning('视频已添加，但未同步 OSS（生成前请配置 OSS）')
    } else {
      toast.success('参考视频已上传')
    }
  } catch (err) {
    toast.error(err?.message || '视频上传失败')
  }
  if (event?.target) event.target.value = ''
}

function removeVideoRef(index) {
  uploadedVideoRefs.value = uploadedVideoRefs.value.filter((_, i) => i !== index)
  syncPromptMediaHeader()
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
  syncPromptImageHeader()
}

function removeUpload(index) {
  uploadedRefs.value = uploadedRefs.value.filter((_, i) => i !== index)
  syncUploadPaths()
  syncPromptImageHeader()
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

function onPromptFocus() {
  promptFocused.value = true
}

function onPromptBlur() {
  promptFocused.value = false
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

function applyFixedOfficialPayload(payload) {
  if (props.jimengMode) {
    payload.jimeng = true
    payload.provider = 'jimeng_web'
    if (props.fixedModel) payload.model = props.fixedModel
    return payload
  }
  if (props.grokMode) {
    payload.grok = true
    if (props.fixedConfigId) payload.config_id = props.fixedConfigId
    if (props.fixedModel) payload.model = props.fixedModel
    return payload
  }
  if (props.aistarslabMode) {
    payload.aistarslab = true
    if (props.fixedConfigId) payload.config_id = props.fixedConfigId
    if (props.fixedModel) payload.model = props.fixedModel
    return payload
  }
  if (!props.officialMode && !props.fixedConfigId && !props.fixedModel) return payload
  if (props.officialMode) payload.official = true
  if (props.fixedConfigId) payload.config_id = props.fixedConfigId
  if (props.fixedModel) payload.model = props.fixedModel
  const hasRefs = !!(payload.content_refs?.length || payload.reference_image_urls?.length || payload.image_url || payload.first_frame_url)
  if ((props.officialMode || props.forceAdaptiveAspect) && hasRefs) {
    payload.aspect_ratio = 'adaptive'
  }
  return payload
}

function selectOfficialModel(modelId) {
  emit('update:fixedModel', modelId)
}

function submit() {
  const text = prompt.value.trim()
  if (!text) {
    toast.warning('请输入视频描述')
    return
  }

  syncUploadPaths()

  const payload = {
    duration: clampDuration(duration.value),
    aspect_ratio: aspectRatio.value,
    drama_id: dramaId.value ? Number(dramaId.value) : undefined,
  }

  const hasStudioRefs = uploadedRefs.value.length > 0
    || uploadedVideoRefs.value.length > 0
    || (binding.voice_refs?.length > 0)

  if ((dramaLinked.value && refMode.value === 'reference') || (videoRefUploadEnabled.value && hasStudioRefs)) {
    syncPromptImageHeader()
    const textForSubmit = prompt.value.trim()
    const issues = validateStudioPrompt(textForSubmit, binding, projectChars.value, projectScenes.value, projectProps.value, uploadedRefs.value)
    if (issues.length) {
      toast.error(formatPromptImageRefIssues(issues))
      return
    }
    const { prompt: finalPrompt, contentRefs } = buildStudioContentRefs(
      binding,
      textForSubmit,
      projectChars.value,
      projectScenes.value,
      projectProps.value,
      uploadedRefs.value,
      uploadedVideoRefs.value,
      { videoRefLabel: videoRefLabelKind.value },
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
      } else if (contentRefs.some(ref => ref.type === 'video' || ref.type === 'audio')) {
        payload.reference_mode = 'multiple'
      }
    }
    emit('generate', applyFixedOfficialPayload(payload))
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

  emit('generate', applyFixedOfficialPayload(payload))
}

function normalizeLoadedAspectRatio(value) {
  const ratio = String(value || '').trim()
  if (props.jimengMode) {
    if (jimengAspectRatios.includes(ratio)) return ratio
    if (ratio === '9:16' || ratio === 'portrait' || ratio === '2:3') return '9:16'
    if (ratio === '16:9' || ratio === 'landscape' || ratio === '3:2') return '16:9'
    return '16:9'
  }
  if (props.grokMode) {
    if (ratio === '9:16' || ratio === 'portrait' || ratio === '2:3') return '2:3'
    if (ratio === '16:9' || ratio === 'landscape' || ratio === '3:2') return '3:2'
    if (ratio === '1:1') return '1:1'
    return '2:3'
  }
  if (ratio === '2:3') return '9:16'
  if (ratio === '3:2') return '16:9'
  return ratio || '9:16'
}

async function loadFromItem(item) {
  resetBinding()
  uploadedRefs.value = []
  uploadedVideoRefs.value = []

  aspectRatio.value = normalizeLoadedAspectRatio(item?.aspect_ratio || item?.aspectRatio || '9:16')
  duration.value = clampDuration(Number(
    item?.duration
    || (props.jimengMode ? (selectedJimengModel.value?.duration_default || 5) : (props.grokMode ? (selectedGrokModel.value?.duration_default || 10) : 15)),
  ))

  const mode = item?.reference_mode || item?.referenceMode
  refMode.value = props.showRefModeToggle && mode === 'first_last' ? 'first_last' : 'reference'

  if (item?.drama_id) {
    dramaId.value = String(item.drama_id)
    persistDramaPreference(dramaId.value)
    await loadProjectAssets(dramaId.value)
  }

  prompt.value = String(item?.prompt || '')

  const {
    preservedLabels,
    preservedAudioLabels,
    preservedVideoLabels,
  } = collectPreservedMediaLabels(String(item?.prompt || ''))

  restoreStudioBindingsFromVideoItem(
    item,
    binding,
    projectChars.value,
    projectScenes.value,
    projectProps.value,
    {
      normalizePath: normalizeMediaPath,
      addUpload: (path, meta = {}) => {
        const normalized = normalizeMediaPath(path)
        if (!normalized) return false
        if (uploadedRefs.value.some(entry => normalizeMediaPath(entry.path) === normalized)) {
          return true
        }
        uploadedRefs.value.push({
          path: normalized,
          preview: meta.preview || gridUrl(normalized),
          label: meta.label || null,
        })
        return true
      },
    },
  )

  const payloadRaw = item?.reference_payload || item?.referencePayload
  if (payloadRaw) {
    try {
      const refs = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          if (ref?.type !== 'video') continue
          const path = normalizeMediaPath(ref.url || ref.path)
          if (!path) continue
          addVideoPath(path, { label: ref.label || null })
        }
      }
    } catch { /* ignore */ }
  } else if (Array.isArray(item?.reference_videos)) {
    for (const ref of item.reference_videos) {
      const path = normalizeMediaPath(ref.path || ref.url)
      if (!path) continue
      addVideoPath(path, { label: ref.label || null })
    }
  }

  syncUploadPaths()
  prompt.value = applyStudioPromptMediaHeader(
    prompt.value,
    binding,
    projectChars.value,
    projectScenes.value,
    projectProps.value,
    uploadedRefs.value,
    { preservedLabels, preservedAudioLabels, preservedVideoLabels, uploadedVideoRefs: uploadedVideoRefs.value, videoRefLabel: videoRefLabelKind.value },
  )
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
  min-height: 0;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  padding: 0;
  overflow: visible;
  transition: min-height 0.22s ease;
}

.composer-input-wrap.is-prompt-expanded {
  min-height: 280px;
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

.composer-ref-card.is-draggable {
  cursor: grab;
}

.composer-ref-card.is-draggable:active {
  cursor: grabbing;
}

.composer-ref-card.is-dragging {
  opacity: 0.45;
  transform: scale(0.96);
  z-index: 40;
}

.composer-ref-card.is-drag-over {
  transform: translateY(-6px) scale(1.08);
  box-shadow: 0 0 0 2px rgba(76, 125, 255, 0.55), 0 10px 24px rgba(15, 23, 42, 0.2);
  z-index: 35;
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

.composer-video-ref-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 14px 10px;
}

.composer-video-ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 6px 8px 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  font-size: 12px;
}

.composer-video-ref-icon {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--accent);
}

.composer-video-ref-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-video-ref-remove {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  line-height: 1;
}

.composer-video-ref-remove:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.composer-input {
  width: 100%;
  flex: 1;
  min-height: 68px;
  max-height: 480px;
  resize: vertical;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-0);
  font-size: 14px;
  line-height: 1.6;
  padding: 12px 14px 14px;
  transition: min-height 0.22s ease;
}

.composer-input-wrap.is-prompt-expanded .composer-input {
  min-height: 168px;
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

.composer-pills-official {
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 6px;
}

.composer-pills-official .composer-option-label {
  font-size: 11px;
  color: var(--text-3);
  padding: 0 2px;
  white-space: nowrap;
}

.composer-pill-model {
  font-weight: 600;
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

.composer-duration-range {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: transparent;
}

.composer-duration-select {
  min-width: 72px;
  padding: 4px 24px 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
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
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
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

.composer-submit-cost {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.88;
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
  .composer-input-wrap.is-prompt-expanded {
    min-height: 240px;
  }
  .composer-input {
    min-height: 60px;
  }
  .composer-input-wrap.is-prompt-expanded .composer-input {
    min-height: 140px;
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
