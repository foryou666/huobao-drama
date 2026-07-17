<template>
  <div v-if="open" class="mask" @click.self="close">
    <div class="dialog card">
      <div class="dialog-head">
        <div>
          <h3 class="dialog-title">{{ dialogTitle }}</h3>
          <p class="dialog-sub dim">{{ dialogSub }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="close">关闭</button>
      </div>

      <template v-if="step === 'view'">
        <div class="view-grid">
          <div v-for="ratio in ratioOptions" :key="ratio" class="view-card">
            <div class="view-card-head">
              <strong>{{ ratio }}</strong>
              <span v-if="savedCoverSrc(ratio)" class="ok">已保存</span>
              <span v-else class="dim">未上传</span>
            </div>
            <img
              v-if="savedCoverSrc(ratio)"
              :src="savedCoverSrc(ratio)"
              :alt="`${ratio} 封面`"
              class="view-img"
              :class="ratio === '4:3' ? 'is-landscape' : 'is-portrait'"
            />
            <div v-else class="view-empty" :class="ratio === '4:3' ? 'is-landscape' : 'is-portrait'">
              暂无 {{ ratio }} 封面
            </div>
            <label class="upload-btn" :class="{ disabled: busy }">
              <input
                type="file"
                accept="image/*"
                hidden
                :disabled="busy"
                @change="onUploadRatio(ratio, $event)"
              />
              {{ savedCoverSrc(ratio) ? '重新上传' : '上传封面' }}
            </label>
          </div>
        </div>
        <section v-if="completedCandidates.length || candidatesLoading" class="section">
          <div class="section-head">
            <span class="section-title">已生成候选</span>
            <span class="dim">3:4 / 4:3 可分别选不同图</span>
            <div class="section-actions">
              <button type="button" class="btn btn-sm" :disabled="busy || candidatesLoading" @click="loadCandidates">
                {{ candidatesLoading ? '加载中…' : '刷新' }}
              </button>
            </div>
          </div>
          <div v-if="candidatesLoading && !completedCandidates.length" class="dim empty-hint">加载已生成封面…</div>
          <div v-else class="candidate-grid">
            <div
              v-for="item in visibleCandidates"
              :key="`view-cand-${item.id}`"
              class="candidate-card"
              :class="{ selected: isCandidateAssigned(item) }"
            >
              <GridMediaImage
                class="candidate-thumb"
                :src="candidateDisplaySrc(item)"
                :alt="`候选 #${item.id}`"
                placeholder="无图"
              />
              <span class="candidate-meta">
                #{{ item.id }}
                <span v-if="item.aspect_ratio" class="dim"> · {{ item.aspect_ratio }}</span>
              </span>
              <div class="candidate-actions">
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'is-on': assignedGenerationId('3:4') === item.id }"
                  :disabled="busy"
                  @click="assignCandidateToRatio(item, '3:4')"
                >
                  →3:4
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'is-on': assignedGenerationId('4:3') === item.id }"
                  :disabled="busy"
                  @click="assignCandidateToRatio(item, '4:3')"
                >
                  →4:3
                </button>
              </div>
            </div>
          </div>
        </section>
        <div class="dialog-foot">
          <span class="dim">每次生成 1 张；3:4 与 4:3 可各选一张再裁切</span>
          <div class="foot-actions">
            <button
              v-if="completedCandidates.length"
              type="button"
              class="btn"
              :disabled="busy"
              @click="goGallery"
            >
              全部已生成 {{ completedCandidates.length }}
            </button>
            <button
              v-if="hasCropSource"
              type="button"
              class="btn btn-primary"
              :disabled="busy"
              @click="goCropFromGallery"
            >
              进入裁切
            </button>
            <button type="button" class="btn" :class="{ 'btn-primary': !hasCropSource }" :disabled="busy" @click="goSelect">
              {{ hasSavedCover ? 'AI 再生成' : 'AI 生成封面' }}
            </button>
          </div>
        </div>
      </template>

      <template v-else-if="step === 'select'">
        <div v-if="loadingAssets" class="dim loading-line">加载角色与场景…</div>
        <template v-else>
          <section class="section">
            <div class="section-head">
              <span class="section-title">角色</span>
              <span class="dim">点击选择，再选服装/造型图（默认不选）</span>
              <div class="section-actions">
                <button type="button" class="btn btn-sm" @click="selectAllChars">全选</button>
                <button type="button" class="btn btn-sm" @click="clearChars">清空</button>
              </div>
            </div>
            <div v-if="!characters.length" class="dim empty-hint">暂无角色</div>
            <div v-else class="pick-grid">
              <button
                v-for="ch in characters"
                :key="ch.id"
                type="button"
                class="pick-item"
                :class="{
                  selected: selectedCharIds.includes(ch.id),
                  active: focusedCharId === ch.id,
                }"
                @click="toggleChar(ch.id)"
              >
                <GridMediaImage
                  class="pick-thumb"
                  :src="charThumbPath(ch)"
                  :alt="ch.name"
                  :placeholder="(ch.name || '?').slice(0, 1)"
                />
                <span class="pick-name">{{ ch.name }}</span>
              </button>
            </div>
            <div v-if="focusedSelectedChar" class="media-picker">
              <div class="media-picker-head">
                <span class="media-picker-title">选择角色参考图 · {{ focusedSelectedChar.name }}</span>
                <span class="dim">仅展示当前点选角色，避免一次加载过多图片</span>
              </div>
              <div class="media-segment focused">
                <CharacterMediaStrip
                  :char="focusedSelectedChar"
                  layout="outfits"
                  compact
                  :show-summary="false"
                  :max-visible="8"
                  expandable
                  pick-default-on-click
                  clickable
                  :is-active="(url) => isCharImageActive(focusedSelectedChar.id, url)"
                  @preview="(img) => onCharImagePick(focusedSelectedChar.id, img.url)"
                />
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section-head">
              <span class="section-title">场景</span>
              <span class="dim">点击选择，再选视角图（可选）</span>
              <div class="section-actions">
                <button type="button" class="btn btn-sm" @click="selectAllScenes">全选</button>
                <button type="button" class="btn btn-sm" @click="clearScenes">清空</button>
              </div>
            </div>
            <div v-if="!scenes.length" class="dim empty-hint">暂无场景</div>
            <div v-else class="pick-grid">
              <button
                v-for="sc in scenes"
                :key="sc.id"
                type="button"
                class="pick-item"
                :class="{
                  selected: selectedSceneIds.includes(sc.id),
                  active: focusedSceneId === sc.id,
                }"
                @click="toggleScene(sc.id)"
              >
                <GridMediaImage
                  class="pick-thumb"
                  :src="sceneThumbPath(sc)"
                  :alt="sceneLabel(sc)"
                  placeholder="景"
                />
                <span class="pick-name">{{ sceneLabel(sc) }}</span>
              </button>
            </div>
            <div v-if="focusedSelectedScene" class="media-picker">
              <div class="media-picker-head">
                <span class="media-picker-title">选择场景参考图 · {{ sceneLabel(focusedSelectedScene) }}</span>
                <span class="dim">仅展示当前点选场景</span>
              </div>
              <div class="media-segment focused">
                <EntityViewMediaStrip
                  v-if="getSceneMedia(focusedSelectedScene)"
                  :media="getSceneMedia(focusedSelectedScene)"
                  theme="scene"
                  compact
                  :show-summary="false"
                  :max-visible="8"
                  clickable
                  :is-view-active="(view) => isSceneImageActive(focusedSelectedScene.id, view.url)"
                  @preview="(img) => onSceneImagePick(focusedSelectedScene.id, img.url)"
                />
                <div v-else class="dim empty-hint">该场景暂无可选图片</div>
              </div>
            </div>
          </section>

          <section class="section config-row">
            <div class="field">
              <span class="field-label">模型</span>
              <span class="model-pill">Image 2</span>
              <span class="field-hint">与图片工作台同一通道 · 每次生成 1 张，再裁切为 3:4 / 4:3 封面</span>
            </div>
          </section>

          <section class="section">
            <div class="section-head">
              <span class="section-title">提示词</span>
              <span class="dim">默认会写出剧名；可改，生成时按所选比例补构图约束</span>
              <div class="section-actions">
                <button type="button" class="btn btn-sm" :disabled="busy" @click="resetCoverPrompt">
                  恢复默认
                </button>
              </div>
            </div>
            <textarea
              v-model="coverPrompt"
              class="prompt-input"
              rows="5"
              :disabled="busy"
              placeholder="输入短剧海报生成提示词…"
              @input="onPromptInput"
            />
          </section>

          <section class="section">
            <div class="section-head">
              <span class="section-title">已生成 {{ completedCandidates.length }}</span>
              <span class="dim">3:4 / 4:3 分别点选</span>
              <div class="section-actions">
                <button type="button" class="btn btn-sm" :disabled="busy || candidatesLoading" @click="loadCandidates">
                  {{ candidatesLoading ? '加载中…' : '刷新' }}
                </button>
              </div>
            </div>
            <div v-if="candidatesLoading && !completedCandidates.length" class="dim empty-hint">加载已生成封面…</div>
            <div v-else-if="!completedCandidates.length && !generatingCandidate" class="dim empty-hint">
              暂无已生成封面，点下方竖版 / 横版生成后会出现在这里
            </div>
            <div v-else class="candidate-grid">
              <div
                v-for="ratio in generatingRatios"
                :key="`gen-${ratio}`"
                class="candidate-card is-processing"
              >
                <div class="candidate-thumb">
                  <Loader2 :size="22" class="animate-spin" />
                </div>
                <span class="candidate-meta dim">生成中… {{ ratio === '16:9' ? '横版 16:9' : '竖版 9:16' }}</span>
              </div>
              <div
                v-for="item in visibleCandidates"
                :key="item.id"
                class="candidate-card"
                :class="{ selected: isCandidateAssigned(item) }"
              >
                <GridMediaImage
                  class="candidate-thumb"
                  :src="candidateDisplaySrc(item)"
                  :alt="`候选 #${item.id}`"
                  placeholder="无图"
                />
                <span class="candidate-meta">
                  #{{ item.id }}
                  <span v-if="item.aspect_ratio" class="dim"> · {{ item.aspect_ratio }}</span>
                </span>
                <div class="candidate-actions">
                  <button
                    type="button"
                    class="btn btn-sm"
                    :class="{ 'is-on': assignedGenerationId('3:4') === item.id }"
                    :disabled="busy"
                    @click="assignCandidateToRatio(item, '3:4')"
                  >
                    →3:4
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm"
                    :class="{ 'is-on': assignedGenerationId('4:3') === item.id }"
                    :disabled="busy"
                    @click="assignCandidateToRatio(item, '4:3')"
                  >
                    →4:3
                  </button>
                </div>
              </div>
            </div>
            <button
              v-if="completedCandidates.length > candidateVisibleCount"
              type="button"
              class="btn btn-sm candidate-more"
              :disabled="busy"
              @click="candidateVisibleCount += 24"
            >
              显示更多（还有 {{ completedCandidates.length - candidateVisibleCount }}）
            </button>
          </section>
        </template>

        <div class="dialog-foot">
          <span class="dim">{{ footHint }}</span>
          <div class="foot-actions">
            <button type="button" class="btn" :disabled="busy" @click="goUploadBoth">
              上传封面
            </button>
            <button
              v-if="hasCropSource"
              type="button"
              class="btn"
              :disabled="busy"
              @click="goCropFromGallery"
            >
              进入裁切
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="!canGenerate || generatingByRatio['9:16']"
              @click="startGenerate('9:16')"
            >
              {{ generatingByRatio['9:16'] ? '生成中…' : '生成竖版 9:16' }}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="!canGenerate || generatingByRatio['16:9']"
              @click="startGenerate('16:9')"
            >
              {{ generatingByRatio['16:9'] ? '生成中…' : '生成横版 16:9' }}
            </button>
          </div>
        </div>
      </template>

      <template v-else-if="step === 'gallery'">
        <div v-if="galleryReturnToCrop && assignRatioTarget" class="assign-banner">
          正在为 <strong>{{ assignRatioTarget }}</strong> 选择图片，点下方按钮即可
        </div>
        <div v-else class="assign-banner">
          <span>当前选用：</span>
          <span>3:4 {{ assignedLabel('3:4') }}</span>
          <span class="dim">·</span>
          <span>4:3 {{ assignedLabel('4:3') }}</span>
        </div>
        <div v-if="!completedCandidates.length" class="dim empty-hint">暂无已生成封面，请先生成</div>
        <div v-else class="candidate-grid gallery">
          <div
            v-for="item in visibleCandidates"
            :key="item.id"
            class="candidate-card"
            :class="{ selected: isCandidateAssigned(item) }"
          >
            <button
              type="button"
              class="candidate-main"
              :disabled="busy"
              @click="onGalleryCardClick(item)"
            >
              <GridMediaImage
                class="candidate-thumb"
                :src="candidateDisplaySrc(item)"
                :alt="`候选 #${item.id}`"
                placeholder="无图"
              />
              <span class="candidate-meta">
                #{{ item.id }}
                <span v-if="item.aspect_ratio" class="dim"> · {{ item.aspect_ratio }}</span>
              </span>
            </button>
            <div class="candidate-actions">
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'is-on': assignedGenerationId('3:4') === item.id }"
                :disabled="busy || (galleryReturnToCrop && assignRatioTarget !== '3:4')"
                @click="assignCandidateToRatio(item, '3:4')"
              >
                →3:4
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'is-on': assignedGenerationId('4:3') === item.id }"
                :disabled="busy || (galleryReturnToCrop && assignRatioTarget !== '4:3')"
                @click="assignCandidateToRatio(item, '4:3')"
              >
                →4:3
              </button>
            </div>
          </div>
        </div>
        <button
          v-if="completedCandidates.length > candidateVisibleCount"
          type="button"
          class="btn btn-sm candidate-more"
          :disabled="busy"
          @click="candidateVisibleCount += 24"
        >
          显示更多（还有 {{ completedCandidates.length - candidateVisibleCount }}）
        </button>
        <div class="dialog-foot">
          <span class="dim">3:4 与 4:3 可各选不同图，再进入裁切</span>
          <div class="foot-actions">
            <button
              type="button"
              class="btn"
              :disabled="busy"
              @click="cancelGalleryPick"
            >
              {{ galleryReturnToCrop ? '取消换图' : (hasSavedCover ? '返回查看' : '返回') }}
            </button>
            <button
              v-if="!galleryReturnToCrop"
              type="button"
              class="btn"
              :disabled="busy"
              @click="goSelect"
            >
              继续生成
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="busy || !hasCropSource"
              @click="goCropFromGallery"
            >
              {{ galleryReturnToCrop ? '完成换图' : '进入裁切' }}
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="crop-grid">
          <div v-for="item in cropItems" :key="item.aspect_ratio" class="crop-card">
            <div class="crop-card-head">
              <strong>{{ item.aspect_ratio }}</strong>
              <span v-if="item.status === 'processing'" class="dim">生成中…</span>
              <span v-else-if="item.status === 'failed'" class="err">失败</span>
              <span v-else-if="item.status === 'empty'" class="dim">可上传</span>
              <span v-else class="ok">可裁切</span>
              <button
                v-if="item.status !== 'processing' && completedCandidates.length"
                type="button"
                class="upload-btn inline"
                :disabled="busy"
                @click="pickCandidateForRatio(item.aspect_ratio)"
              >
                从已生成选
              </button>
              <label
                v-if="item.status !== 'processing'"
                class="upload-btn inline"
                :class="{ disabled: busy }"
              >
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  :disabled="busy"
                  @change="onUploadRatio(item.aspect_ratio, $event)"
                />
                {{ item.src ? '上传换图' : '上传' }}
              </label>
            </div>
            <div
              v-if="item.status === 'processing'"
              class="crop-loading"
              :class="item.aspect_ratio === '4:3' ? 'is-landscape' : 'is-portrait'"
            >
              <Loader2 :size="22" class="animate-spin" />
            </div>
            <div
              v-else-if="item.status === 'failed'"
              class="crop-loading err"
              :class="item.aspect_ratio === '4:3' ? 'is-landscape' : 'is-portrait'"
            >
              <span>{{ item.error || '生成失败' }}</span>
              <label class="upload-btn" :class="{ disabled: busy }">
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  :disabled="busy"
                  @change="onUploadRatio(item.aspect_ratio, $event)"
                />
                改为上传
              </label>
            </div>
            <div
              v-else-if="item.status === 'empty' || !item.src"
              class="crop-loading"
              :class="item.aspect_ratio === '4:3' ? 'is-landscape' : 'is-portrait'"
            >
              <label class="upload-btn large" :class="{ disabled: busy }">
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  :disabled="busy"
                  @change="onUploadRatio(item.aspect_ratio, $event)"
                />
                上传 {{ item.aspect_ratio }} 封面
              </label>
            </div>
            <ImageAspectCropper
              v-else
              :ref="(el) => setCropperRef(item.aspect_ratio, el)"
              :src="item.src"
              :source-path="item.path"
              :aspect="item.aspect_ratio === '4:3' ? 4 / 3 : 3 / 4"
            />
          </div>
        </div>
        <div class="dialog-foot">
          <button
            type="button"
            class="btn"
            :disabled="busy"
            @click="step = completedCandidates.length ? 'gallery' : (hasSavedCover ? 'view' : 'select')"
          >
            {{ completedCandidates.length ? '返回已生成' : (hasSavedCover ? '返回查看' : '返回重选') }}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!canApply || busy"
            @click="applyCovers"
          >
            {{ busy ? '保存中…' : '裁切并保存封面' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { dramaAPI, imageAPI, uploadAPI } from '~/composables/useApi'
import { mediaDisplayUrl, normalizeMediaPath, prefetchMediaUrls } from '~/utils/media-url.js'
import { resolveCharacterImageUrl } from '~/utils/character-image-variants.js'
import { listSceneImages } from '~/utils/scene-image-variants.js'
import { buildSceneMediaFromImages } from '~/utils/entity-view-media.js'
import CharacterMediaStrip from '~/components/CharacterMediaStrip.vue'
import EntityViewMediaStrip from '~/components/EntityViewMediaStrip.vue'
import GridMediaImage from '~/components/GridMediaImage.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  dramaId: { type: Number, required: true },
  dramaTitle: { type: String, default: '' },
  initialCovers: {
    type: Object,
    default: () => ({ '3:4': null, '4:3': null }),
  },
})

const emit = defineEmits(['update:open', 'applied'])

const step = ref('select')
const busy = ref(false)
const loadingAssets = ref(false)
const characters = ref([])
const scenes = ref([])
const selectedCharIds = ref([])
const selectedSceneIds = ref([])
const characterImageRefs = ref({})
const sceneImageRefs = ref({})
const focusedCharId = ref(null)
const focusedSceneId = ref(null)
const dramaMeta = ref({ title: '', genre: '', style: '', description: '' })
const coverPrompt = ref('')
const promptTouched = ref(false)
/** 生成用短剧比例；裁切保存仍为 3:4 / 4:3。竖/横可并行生成 */
const generateAspectRatio = ref('9:16')
const ratioOptions = ['3:4', '4:3']
const generatingByRatio = reactive({ '9:16': false, '16:9': false })
const generatingRatios = computed(() =>
  (['9:16', '16:9']).filter(r => generatingByRatio[r]),
)
const generatingCandidate = computed(() => generatingRatios.value.length > 0)
const candidates = ref([])
const selectedCandidateId = ref(null)
const candidatesLoading = ref(false)
const candidateVisibleCount = ref(24)
/** 从裁切页回来为某一比例单独换图 */
const assignRatioTarget = ref(null)
const galleryReturnToCrop = ref(false)
const cropItems = ref([])
const cropperRefs = reactive({})
const savedCovers = ref({ '3:4': null, '4:3': null })

const hasSavedCover = computed(() => !!(savedCovers.value['3:4'] || savedCovers.value['4:3']))

const selectedCharacters = computed(() =>
  characters.value.filter(ch => selectedCharIds.value.includes(ch.id)),
)
const selectedScenes = computed(() =>
  scenes.value.filter(sc => selectedSceneIds.value.includes(sc.id)),
)

const focusedSelectedChar = computed(() => {
  if (!focusedCharId.value) return selectedCharacters.value[0] || null
  return selectedCharacters.value.find(ch => ch.id === focusedCharId.value) || selectedCharacters.value[0] || null
})
const focusedSelectedScene = computed(() => {
  if (!focusedSceneId.value) return selectedScenes.value[0] || null
  return selectedScenes.value.find(sc => sc.id === focusedSceneId.value) || selectedScenes.value[0] || null
})

const completedCandidates = computed(() =>
  candidates.value.filter(item => {
    if (item.status !== 'completed') return false
    return !!(candidatePath(item) || candidateDisplaySrc(item))
  }),
)
const visibleCandidates = computed(() =>
  completedCandidates.value.slice(0, candidateVisibleCount.value),
)

const dialogTitle = computed(() => {
  if (step.value === 'view') return '封面查看'
  if (step.value === 'gallery') return '已生成封面'
  if (step.value === 'crop') return '裁切封面'
  return hasSavedCover.value ? '重新生成封面' : '生成封面'
})

const dialogSub = computed(() => {
  if (step.value === 'view') return '查看已保存封面，或生成/挑选候选图裁切'
  if (step.value === 'gallery') {
    if (galleryReturnToCrop.value && assignRatioTarget.value) {
      return `为 ${assignRatioTarget.value} 选择一张图`
    }
    return '3:4 与 4:3 可分别选不同图，再进入裁切'
  }
  if (step.value === 'crop') return '两个比例可来自不同原图；可分别裁切后保存'
  return '每次生成 1 张短剧海报；3:4 / 4:3 可各选一张裁切'
})

function buildDefaultCoverPrompt() {
  const title = dramaMeta.value.title || props.dramaTitle || '未命名'
  const genre = dramaMeta.value.genre || '短剧'
  const style = dramaMeta.value.style || 'cinematic'
  const desc = String(dramaMeta.value.description || '').trim()
  const characterNames = selectedCharacters.value.map(ch => ch.name).filter(Boolean).slice(0, 8)
  const sceneNames = selectedScenes.value
    .map(sc => [sc.location, sc.time].filter(Boolean).join('·'))
    .filter(Boolean)
    .slice(0, 6)
  const bits = [
    '短剧海报封面',
    `必须在画面中清晰写出剧名《${title}》，标题醒目、完整可读，排版美观（可位于画面上方或主视觉旁）`,
    '电影级光影与人物/场景主视觉，构图饱满，适合作为项目封面与短剧海报',
    genre ? `题材：${genre}` : '',
    style ? `画风：${style}` : '',
    desc ? `故事氛围：${desc.slice(0, 200)}` : '',
    characterNames.length ? `主要角色：${characterNames.join('、')}` : '',
    sceneNames.length ? `场景元素：${sceneNames.join('、')}` : '',
    '参考图中的角色与场景需保持一致性',
    '禁止平台水印、字幕条、边框与 UI 控件；剧名文字必须保留',
  ].filter(Boolean)
  return bits.join('。')
}

function syncCoverPrompt(force = false) {
  if (!force && promptTouched.value) return
  coverPrompt.value = buildDefaultCoverPrompt()
}

function resetCoverPrompt() {
  promptTouched.value = false
  syncCoverPrompt(true)
}

function onPromptInput() {
  promptTouched.value = true
}

const canGenerate = computed(() => !loadingAssets.value)

const canApply = computed(() =>
  cropItems.value.some(item => item.status === 'completed' && item.src),
)

const hasCropSource = computed(() =>
  cropItems.value.some(item => item.status === 'completed' && item.src),
)

const footHint = computed(() => {
  const chars = selectedCharIds.value.length
  const scs = selectedSceneIds.value.length
  return `角色 ${chars} · 场景 ${scs} · 已生成 ${completedCandidates.value.length}`
})

function assignedGenerationId(ratio) {
  const item = cropItems.value.find(i => i.aspect_ratio === ratio)
  return item?.generation_id || null
}

function assignedLabel(ratio) {
  const item = cropItems.value.find(i => i.aspect_ratio === ratio)
  if (item?.generation_id) return `#${item.generation_id}`
  if (item?.status === 'completed' && item.src) return '已选'
  return '未选'
}

function isCandidateAssigned(item) {
  const id = item?.id
  if (!id) return false
  return assignedGenerationId('3:4') === id || assignedGenerationId('4:3') === id
}

function savedCoverSrc(ratio) {
  return mediaDisplayUrl(savedCovers.value?.[ratio] || '') || ''
}

function revokeObjectUrl(url) {
  if (url && String(url).startsWith('blob:')) {
    try { URL.revokeObjectURL(url) } catch { /* ignore */ }
  }
}

function emptyCropItem(ratio) {
  return {
    aspect_ratio: ratio,
    generation_id: null,
    status: 'empty',
    src: '',
    path: '',
    error: '',
    objectUrl: '',
  }
}

function seedCropItems(preferSaved = true) {
  return ratioOptions.map((ratio) => {
    const existing = cropItems.value.find(i => i.aspect_ratio === ratio)
    if (existing?.status === 'completed' && existing.src) return { ...existing }
    if (preferSaved) {
      const saved = savedCoverSrc(ratio)
      if (saved) {
        return {
          aspect_ratio: ratio,
          generation_id: null,
          status: 'completed',
          src: saved,
          path: savedCovers.value[ratio] || '',
          error: '',
          objectUrl: '',
        }
      }
    }
    return emptyCropItem(ratio)
  })
}

function close() {
  if (busy.value) return
  for (const item of cropItems.value) revokeObjectUrl(item.objectUrl)
  emit('update:open', false)
}

function goSelect() {
  step.value = 'select'
}

function goGallery() {
  assignRatioTarget.value = null
  galleryReturnToCrop.value = false
  if (!cropItems.value.length) cropItems.value = ratioOptions.map(emptyCropItem)
  step.value = 'gallery'
}

function pickCandidateForRatio(ratio) {
  assignRatioTarget.value = ratio === '4:3' ? '4:3' : '3:4'
  galleryReturnToCrop.value = true
  if (!cropItems.value.length) cropItems.value = seedCropItems(true)
  step.value = 'gallery'
}

function cancelGalleryPick() {
  if (galleryReturnToCrop.value) {
    assignRatioTarget.value = null
    galleryReturnToCrop.value = false
    step.value = 'crop'
    return
  }
  assignRatioTarget.value = null
  step.value = hasSavedCover.value ? 'view' : 'select'
}

function goCropFromGallery() {
  if (!hasCropSource.value) {
    toast.error('请先为 3:4 或 4:3 选择图片')
    return
  }
  cropItems.value = seedCropItems(false)
  assignRatioTarget.value = null
  galleryReturnToCrop.value = false
  step.value = 'crop'
}

function onGalleryCardClick(item) {
  if (galleryReturnToCrop.value && assignRatioTarget.value) {
    assignCandidateToRatio(item, assignRatioTarget.value)
    return
  }
  const empty = ratioOptions.find((r) => {
    const cur = cropItems.value.find(i => i.aspect_ratio === r)
    return !(cur?.status === 'completed' && cur.src)
  })
  if (empty) {
    assignCandidateToRatio(item, empty)
    return
  }
  toast.info('两个比例都已有图，请点 →3:4 / →4:3 更换')
}

/** 本地 static 路径（裁切/保存用） */
function candidatePath(item) {
  return normalizeMediaPath(item?.path || item?.local_path || item?.localPath || '')
}

/** 展示用：优先 https 远程图，避免等 OSS resolve 时一直「无图」 */
function candidateDisplaySrc(item) {
  const remote = String(item?.image_url || item?.imageUrl || '').trim()
  if (remote.startsWith('http://') || remote.startsWith('https://')) return remote
  const local = candidatePath(item)
  return mediaDisplayUrl(local) || local || remote
}

function candidateSrc(item) {
  return candidateDisplaySrc(item) || ''
}

async function loadCandidates() {
  if (!props.dramaId) return
  candidatesLoading.value = true
  try {
    const res = await dramaAPI.listCoverCandidates(props.dramaId)
    const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : [])
    candidates.value = items
    candidateVisibleCount.value = Math.max(24, candidateVisibleCount.value)
    const paths = items.map(candidatePath).filter(Boolean)
    if (paths.length) void prefetchMediaUrls(paths)
  } catch (err) {
    toast.error(err?.message || '加载已生成封面失败')
  } finally {
    candidatesLoading.value = false
  }
}

function assignCandidateToRatio(item, ratio) {
  const target = ratio === '4:3' ? '4:3' : '3:4'
  const path = candidatePath(item)
  const displaySrc = candidateDisplaySrc(item)
  if (!path && !displaySrc) {
    toast.error('该候选图不可用')
    return
  }
  const src = displaySrc || (path ? `/${path.replace(/^\/+/, '')}` : '')
  selectedCandidateId.value = item.id
  if (!cropItems.value.length) cropItems.value = ratioOptions.map(emptyCropItem)
  else cropItems.value = seedCropItems(false)

  cropItems.value = cropItems.value.map((cur) => {
    if (cur.aspect_ratio !== target) return cur
    revokeObjectUrl(cur.objectUrl)
    return {
      aspect_ratio: target,
      generation_id: item.id,
      status: 'completed',
      src,
      path: path || '',
      error: '',
      objectUrl: '',
    }
  })

  if (galleryReturnToCrop.value) {
    assignRatioTarget.value = null
    galleryReturnToCrop.value = false
    step.value = 'crop'
    toast.success(`已更换 ${target} 原图，可继续裁切`)
    return
  }

  toast.success(`已指定为 ${target} 原图`)
  // 另一比例还空时，留在列表方便接着选
  const other = target === '3:4' ? '4:3' : '3:4'
  const otherItem = cropItems.value.find(i => i.aspect_ratio === other)
  if (!(otherItem?.status === 'completed' && otherItem.src)) {
    if (step.value !== 'gallery') step.value = 'gallery'
  }
}

function goUploadBoth() {
  for (const item of cropItems.value) revokeObjectUrl(item.objectUrl)
  cropItems.value = ratioOptions.map(emptyCropItem)
  selectedCandidateId.value = null
  step.value = 'crop'
}

function onUploadRatio(ratio, event) {
  const file = event?.target?.files?.[0]
  if (event?.target) event.target.value = ''
  if (!file || busy.value) return
  if (!String(file.type || '').startsWith('image/')) {
    toast.error('请选择图片文件')
    return
  }

  const objectUrl = URL.createObjectURL(file)
  const next = seedCropItems(true).map((item) => {
    if (item.aspect_ratio !== ratio) return item
    revokeObjectUrl(item.objectUrl)
    return {
      aspect_ratio: ratio,
      generation_id: null,
      status: 'completed',
      src: objectUrl,
      path: '',
      error: '',
      objectUrl,
    }
  })
  // 若当前还不在裁切页，用已保存封面填充另一比例，便于一次保存两张
  cropItems.value = next
  step.value = 'crop'
  toast.success(`已载入 ${ratio}，裁切后可保存`)
}

function charThumbPath(ch) {
  return normalizeMediaPath(
    resolveCharacterImageUrl(ch, characterImageRefs.value)
      || ch.local_path || ch.localPath || ch.image_url || ch.imageUrl || '',
  )
}

function scenePrimaryPath(sc) {
  return normalizeMediaPath(sc?.local_path || sc?.localPath || sc?.image_url || sc?.imageUrl || '')
}

function sceneThumbPath(sc) {
  return normalizeMediaPath(sceneImageRefs.value[sc.id] || scenePrimaryPath(sc))
}

function sceneLabel(sc) {
  const loc = sc.location || `场景#${sc.id}`
  return sc.time ? `${loc} · ${sc.time}` : loc
}

function getSceneMedia(scene) {
  const images = listSceneImages(scene)
  if (!images.length) return null
  return buildSceneMediaFromImages(images)
}

function isCharImageActive(charId, url) {
  const char = characters.value.find(item => item.id === charId)
  const normalized = normalizeMediaPath(url)
  const selected = characterImageRefs.value[charId]
  if (selected) return normalizeMediaPath(selected) === normalized
  return normalizeMediaPath(resolveCharacterImageUrl(char, {})) === normalized
}

function isSceneImageActive(sceneId, url) {
  const scene = scenes.value.find(item => item.id === sceneId)
  const normalized = normalizeMediaPath(url)
  const selected = sceneImageRefs.value[sceneId]
  if (selected) return normalizeMediaPath(selected) === normalized
  return scenePrimaryPath(scene) === normalized
}

function onCharImagePick(charId, url) {
  const char = characters.value.find(item => item.id === charId)
  const normalized = normalizeMediaPath(url)
  const primary = normalizeMediaPath(resolveCharacterImageUrl(char, {}))
  const next = { ...characterImageRefs.value }
  if (!normalized || primary === normalized) delete next[charId]
  else next[charId] = normalized
  characterImageRefs.value = next
  focusedCharId.value = charId
}

function onSceneImagePick(sceneId, url) {
  const scene = scenes.value.find(item => item.id === sceneId)
  const normalized = normalizeMediaPath(url)
  const primary = scenePrimaryPath(scene)
  const next = { ...sceneImageRefs.value }
  if (!normalized || primary === normalized) delete next[sceneId]
  else next[sceneId] = normalized
  sceneImageRefs.value = next
  focusedSceneId.value = sceneId
}

function toggleChar(id) {
  const set = new Set(selectedCharIds.value)
  if (set.has(id)) {
    set.delete(id)
    const next = { ...characterImageRefs.value }
    delete next[id]
    characterImageRefs.value = next
    focusedCharId.value = set.size ? [...set].at(-1) : null
  } else {
    set.add(id)
    focusedCharId.value = id
  }
  selectedCharIds.value = [...set]
}

function toggleScene(id) {
  const set = new Set(selectedSceneIds.value)
  if (set.has(id)) {
    set.delete(id)
    const next = { ...sceneImageRefs.value }
    delete next[id]
    sceneImageRefs.value = next
    focusedSceneId.value = set.size ? [...set].at(-1) : null
  } else {
    set.add(id)
    focusedSceneId.value = id
  }
  selectedSceneIds.value = [...set]
}

function selectAllChars() {
  selectedCharIds.value = characters.value.map(ch => ch.id)
  focusedCharId.value = selectedCharIds.value[0] || null
}

function selectAllScenes() {
  selectedSceneIds.value = scenes.value.map(sc => sc.id)
  focusedSceneId.value = selectedSceneIds.value[0] || null
}

function clearChars() {
  selectedCharIds.value = []
  characterImageRefs.value = {}
  focusedCharId.value = null
}

function clearScenes() {
  selectedSceneIds.value = []
  sceneImageRefs.value = {}
  focusedSceneId.value = null
}

function setCropperRef(ratio, el) {
  if (el) cropperRefs[ratio] = el
  else delete cropperRefs[ratio]
}

function normalizeCovers(raw) {
  const covers = raw && typeof raw === 'object' ? raw : {}
  return {
    '3:4': covers['3:4'] || covers.cover_3_4 || null,
    '4:3': covers['4:3'] || covers.cover_4_3 || null,
  }
}

async function loadData() {
  if (!props.open || !props.dramaId) return
  loadingAssets.value = true
  try {
    for (const item of cropItems.value) revokeObjectUrl(item.objectUrl)
    savedCovers.value = normalizeCovers(props.initialCovers)
    selectedCharIds.value = []
    selectedSceneIds.value = []
    characterImageRefs.value = {}
    sceneImageRefs.value = {}
    focusedCharId.value = null
    focusedSceneId.value = null
    promptTouched.value = false
    generateAspectRatio.value = '9:16'
    selectedCandidateId.value = null
    generatingByRatio['9:16'] = false
    generatingByRatio['16:9'] = false
    candidateVisibleCount.value = 24
    assignRatioTarget.value = null
    galleryReturnToCrop.value = false
    cropItems.value = ratioOptions.map(emptyCropItem)

    // 先拉候选图，避免被项目详情接口拖慢后「看不到已生成」
    await loadCandidates()

    // workbench=1：跳过全集删除评估/摘要扫描
    const drama = await dramaAPI.get(props.dramaId, { workbench: true })
    characters.value = (drama?.characters || []).filter(ch => !ch.deleted_at && !ch.deletedAt)
    scenes.value = (drama?.scenes || []).filter(sc => !sc.deleted_at && !sc.deletedAt)
    dramaMeta.value = {
      title: drama?.title || props.dramaTitle || '',
      genre: drama?.genre || '',
      style: drama?.style || '',
      description: drama?.description || drama?.desc || '',
    }
    syncCoverPrompt(true)

    const fromDrama = normalizeCovers({
      '3:4': drama?.cover_3_4 || drama?.covers?.['3:4'] || drama?.thumbnail,
      '4:3': drama?.cover_4_3 || drama?.covers?.['4:3'],
    })
    savedCovers.value = {
      '3:4': fromDrama['3:4'] || savedCovers.value['3:4'],
      '4:3': fromDrama['4:3'] || savedCovers.value['4:3'],
    }

    // 有已生成候选时优先展示列表（含神仙室友等历史双张），便于点选裁切
    if (completedCandidates.value.length) step.value = 'gallery'
    else if (hasSavedCover.value) step.value = 'view'
    else step.value = 'select'
  } catch (err) {
    toast.error(err?.message || '加载失败')
  } finally {
    loadingAssets.value = false
  }
}

async function pollOne(generationId) {
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const row = await imageAPI.get(generationId)
    const status = row?.status
    if (status === 'completed') {
      const path = row.local_path || row.localPath || row.image_url || row.imageUrl
      return { path, src: mediaDisplayUrl(path) || '' }
    }
    if (status === 'failed') {
      throw new Error(row?.error_message || row?.errorMessage || '封面生成失败')
    }
  }
  throw new Error('封面生成超时')
}

async function startGenerate(ratioInput = '9:16') {
  if (!canGenerate.value) return
  const ratio = ratioInput === '16:9' ? '16:9' : '9:16'
  if (generatingByRatio[ratio]) return
  // 竖版默认指定给 3:4 封面槽，横版给 4:3；另一侧仍可另选
  const cropSlot = ratio === '16:9' ? '4:3' : '3:4'
  const label = ratio === '16:9' ? '横版 16:9' : '竖版 9:16'
  generateAspectRatio.value = ratio
  generatingByRatio[ratio] = true
  try {
    const res = await dramaAPI.generateCover(props.dramaId, {
      character_ids: selectedCharIds.value,
      scene_ids: selectedSceneIds.value,
      character_image_refs: characterImageRefs.value,
      scene_image_refs: sceneImageRefs.value,
      aspect_ratios: [ratio],
      prompt: String(coverPrompt.value || '').trim() || undefined,
    })
    const generationId = res?.items?.[0]?.image_generation_id || res?.image_generation_id
    if (!generationId) throw new Error('未返回生成任务')

    toast.info(`正在生成${label}封面…`)
    await pollOne(generationId)
    await loadCandidates()
    selectedCandidateId.value = generationId
    const justDone = completedCandidates.value.find(c => c.id === generationId)
    if (justDone) assignCandidateToRatio(justDone, cropSlot)
    if (step.value === 'select' || step.value === 'gallery') {
      step.value = completedCandidates.value.length ? 'gallery' : 'select'
    }
    toast.success(`${label}生成完成，可点选裁切`)
  } catch (err) {
    toast.error(err?.message || `${label}生成失败`)
  } finally {
    generatingByRatio[ratio] = false
  }
}

async function applyCovers() {
  if (!canApply.value || busy.value) return
  busy.value = true
  try {
    const covers = {}
    for (const item of cropItems.value) {
      if (item.status !== 'completed' || !item.src) continue
      const cropper = cropperRefs[item.aspect_ratio]
      let file
      if (cropper?.exportBlob) {
        const blob = await cropper.exportBlob()
        file = new File([blob], `cover-${item.aspect_ratio.replace(':', 'x')}.jpg`, { type: 'image/jpeg' })
      } else {
        throw new Error(`${item.aspect_ratio} 裁切器未就绪`)
      }
      const uploaded = await uploadAPI.image(file, props.dramaId)
      let path = uploaded?.path || uploaded?.local_path || uploaded?.url || ''
      path = String(path).replace(/^\/+/, '')
      if (!path) throw new Error('上传封面失败')
      covers[item.aspect_ratio] = path
    }
    if (!Object.keys(covers).length) throw new Error('没有可保存的封面')

    const applied = await dramaAPI.applyCover(props.dramaId, {
      covers,
      primary_aspect_ratio: covers['3:4'] ? '3:4' : '4:3',
    })
    // 服务端会与已有封面合并，两张都会保留
    const nextCovers = {
      '3:4': applied?.covers?.['3:4'] || applied?.cover_3_4 || covers['3:4'] || savedCovers.value['3:4'] || null,
      '4:3': applied?.covers?.['4:3'] || applied?.cover_4_3 || covers['4:3'] || savedCovers.value['4:3'] || null,
    }
    savedCovers.value = nextCovers
    toast.success(
      nextCovers['3:4'] && nextCovers['4:3']
        ? '已保存 3:4 与 4:3 两张封面'
        : '封面已保存',
    )
    emit('applied', {
      cover_url: applied?.cover_url || applied?.thumbnail || nextCovers['3:4'] || nextCovers['4:3'],
      cover_3_4: nextCovers['3:4'],
      cover_4_3: nextCovers['4:3'],
      covers: nextCovers,
    })
    for (const item of cropItems.value) revokeObjectUrl(item.objectUrl)
    step.value = 'view'
    cropItems.value = []
  } catch (err) {
    toast.error(err?.message || '保存封面失败')
  } finally {
    busy.value = false
  }
}

watch(
  () => [props.open, props.dramaId],
  ([visible, dramaId]) => {
    if (!visible || !dramaId) return
    void loadData()
  },
  { immediate: true },
)

watch([selectedCharIds, selectedSceneIds], () => {
  syncCoverPrompt(false)
})
</script>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(8, 10, 16, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.dialog {
  width: min(920px, 100%);
  max-height: min(92vh, 920px);
  overflow: auto;
  padding: 20px;
  background: #12151c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e8ecf4;
}
.dialog-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.dialog-title { margin: 0; font-size: 1.15rem; }
.dialog-sub { margin: 4px 0 0; font-size: 0.85rem; }
.section { margin-bottom: 18px; }
.section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.section-title { font-weight: 700; }
.section-actions { margin-left: auto; display: flex; gap: 6px; }
.pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 8px;
}
.pick-item {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 6px;
  cursor: pointer;
  color: inherit;
  text-align: left;
}
.pick-item.selected {
  border-color: rgba(96, 140, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(96, 140, 255, 0.35);
}
.pick-item.active {
  border-color: rgba(125, 222, 160, 0.9);
}
.pick-item.no-image { opacity: 0.75; }
.media-picker {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.media-picker-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.media-picker-title {
  font-size: 13px;
  font-weight: 700;
}
.media-segment {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: rgba(0, 0, 0, 0.12);
}
.media-segment.focused {
  border-color: rgba(125, 222, 160, 0.35);
}
.media-segment-name {
  font-size: 12px;
  font-weight: 650;
  color: rgba(255, 255, 255, 0.78);
}
.prompt-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 110px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.22);
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.prompt-input:focus {
  outline: none;
  border-color: rgba(96, 140, 255, 0.75);
}
.candidate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.candidate-grid.gallery {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}
.candidate-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 8px;
  color: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.candidate-card.selected {
  border-color: rgba(96, 140, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(96, 140, 255, 0.35);
}
.candidate-card.is-processing {
  cursor: default;
  opacity: 0.85;
}
.candidate-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.candidate-actions {
  display: flex;
  gap: 6px;
}
.candidate-actions .btn {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  font-size: 12px;
}
.candidate-actions .btn.is-on {
  border-color: rgba(96, 140, 255, 0.9);
  background: rgba(96, 140, 255, 0.22);
  color: #dce6ff;
}
.assign-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  font-size: 13px;
}
.candidate-thumb {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 8px;
  display: block;
  background: #1a1f2b;
  overflow: hidden;
}
.candidate-card.is-processing .candidate-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
}
:deep(.candidate-thumb.grid-media-image),
:deep(.candidate-thumb .grid-media-image) {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
:deep(.candidate-thumb.grid-media-empty),
:deep(.candidate-thumb .grid-media-empty) {
  width: 100%;
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  background: #1a1f2b;
  border-radius: 8px;
}
.candidate-meta {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.3;
}
.candidate-more {
  margin-top: 10px;
  width: 100%;
}
.pick-thumb {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 8px;
  display: block;
  background: #1a1f2b;
  overflow: hidden;
}
:deep(.pick-thumb.grid-media-image),
:deep(.pick-thumb .grid-media-image) {
  width: 100%;
  height: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
:deep(.pick-thumb.grid-media-empty),
:deep(.pick-thumb .grid-media-empty) {
  width: 100%;
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.45);
  background: #1a1f2b;
  border-radius: 8px;
}
.pick-name {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.config-row {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 16px;
}
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 650; color: rgba(255, 255, 255, 0.7); }
.field-hint { font-size: 11px; color: rgba(255, 255, 255, 0.4); }
.model-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 650;
  color: #0b0d12;
  background: #fff;
}
.ratio-pills { display: flex; gap: 8px; }
.ratio-pill {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.ratio-pill.active {
  background: #fff;
  color: #0b0d12;
  border-color: #fff;
}
.dialog-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.foot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 10px;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.upload-btn.inline {
  width: auto;
  margin-top: 0;
  margin-left: auto;
  padding: 4px 10px;
  font-size: 12px;
}
.upload-btn.large {
  width: auto;
  margin-top: 0;
  padding: 14px 20px;
  border-style: dashed;
}
.upload-btn.disabled,
.upload-btn:has(input:disabled) {
  opacity: 0.5;
  pointer-events: none;
}
.upload-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.loading-line, .empty-hint { padding: 8px 0; }
.view-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.view-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
}
.view-card-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
}
.view-img {
  width: 100%;
  object-fit: cover;
  border-radius: 10px;
  display: block;
  background: #1a1f2b;
}
.view-img.is-portrait,
.view-empty.is-portrait { aspect-ratio: 3 / 4; }
.view-img.is-landscape,
.view-empty.is-landscape { aspect-ratio: 4 / 3; }
.view-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
  background: linear-gradient(165deg, #2a3144 0%, #141820 48%, #0a0d14 100%);
}
.crop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  align-items: start;
}
.crop-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
}
.crop-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}
.crop-loading {
  width: min(100%, 270px);
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.65);
  border-radius: 12px;
  background: #12151c;
  border: 1px dashed rgba(255, 255, 255, 0.16);
}
.crop-loading.is-portrait {
  width: min(100%, 270px);
  aspect-ratio: 3 / 4;
}
.crop-loading.is-landscape {
  width: min(100%, 480px);
  aspect-ratio: 4 / 3;
}
.ok { color: #7ddea0; }
.err { color: #ff8f8f; }
.dim { color: rgba(255, 255, 255, 0.48); }
@media (max-width: 720px) {
  .config-row { grid-template-columns: 1fr; }
}
</style>
