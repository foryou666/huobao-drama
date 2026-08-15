<template>
  <div class="studio-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">视频生成(官)</h1>
        <StudioGuideButton
          title="官方通道使用说明"
          text="关联项目后选择角色/场景并用 @ 写入提示词。直连火山方舟官方 API（通道2 · 按秒计费）。Seedance 2.5：4–30 秒、130 积分/秒、参考图≤30/音视频各≤10（合计≤50）；2.0 Fast：4–15 秒、51 积分/秒。排队中可取消并退款，生成中不可取消。"
        />
      </div>
      <div class="studio-header-actions">
        <div class="studio-scope-toggle">
          <button
            type="button"
            class="studio-scope-btn"
            :class="{ active: viewScope === 'mine' }"
            @click="setViewScope('mine')"
          >
            只看本人
          </button>
          <button
            type="button"
            class="studio-scope-btn"
            :class="{ active: viewScope === 'all' }"
            @click="setViewScope('all')"
          >
            查看全部
          </button>
        </div>
        <select
          v-if="userOptions.length"
          v-model.number="filterUserId"
          class="studio-filter-select studio-member-select"
          :class="{ active: viewScope === 'user' }"
          title="查看指定用户"
          @change="onUserFilterChange"
        >
          <option :value="null">指定用户</option>
          <option
            v-for="u in userOptions"
            :key="u.id"
            :value="u.id"
          >
            {{ u.display_name || u.username }}
          </option>
        </select>
        <select v-model="filterDramaId" class="studio-filter-select" @focus="ensureDramasLoaded" @change="reload">
          <option value="">全部项目</option>
          <option v-for="d in dramas" :key="d.id" :value="String(d.id)">{{ d.title }}</option>
        </select>
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="studio-tabs">
      <button
        v-for="tab in statusTabs"
        :key="tab.id"
        type="button"
        class="studio-tab"
        :class="{ active: filterStatus === tab.id }"
        @click="setStatus(tab.id)"
      >
        {{ tab.label }}
        <span class="mono">{{ statsForTab(tab.id) }}</span>
      </button>
    </div>

    <div ref="feedRef" class="studio-feed">
      <div v-if="loading && !items.length" class="studio-grid studio-grid-skeleton">
        <article v-for="n in 8" :key="`sk-${n}`" class="studio-card studio-card-skeleton">
          <div class="studio-card-media ratio-portrait studio-skeleton-block" />
          <div class="studio-card-body">
            <div class="studio-skeleton-line studio-skeleton-line-wide" />
            <div class="studio-skeleton-line studio-skeleton-line-narrow" />
          </div>
        </article>
      </div>
      <div v-else-if="!items.length" class="studio-empty card">
        <p>还没有官方 S 视频，在底部输入描述并点击「生成视频」</p>
      </div>

      <div v-else class="studio-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="studio-card"
          @click="openDetail(item)"
        >
          <div class="studio-card-media-wrap">
            <StudioVideoCardMedia
              :poster-src="videoPosterDisplayUrl(item)"
              :ratio-hint-src="cardRatioHintSrc(item)"
              :playable="!!playableUrl(item)"
              :processing="isProcessing(item)"
              :ratio-class="cardRatioClass(item)"
              :status-label="statusLabel(item.status)"
              :status-class="statusTagClass(item.status)"
              :processing-label="statusLabel(item.status)"
              :fallback-label="statusLabel(item.status)"
              :error-msg="item.error_msg"
              :ref-count="item.reference_images?.length || 0"
              :cancellable="canCancel(item)"
              :cancelling="cancellingId === item.id"
              @download="downloadItem(item)"
              @cancel="cancelItem(item)"
            />
            <span
              v-if="isUpscaleDone(item)"
              class="studio-card-upscale-ribbon"
              aria-label="已超分"
            >已超分</span>
          </div>

          <div class="studio-card-body">
            <p class="studio-card-prompt">{{ previewPrompt(item.prompt) }}</p>
            <div class="studio-card-meta">
              <span class="mono dim">#{{ item.id }}</span>
              <span v-if="item.model" class="tag tag-accent">{{ modelTagLabel(item) }}</span>
              <span v-if="item.is_manual" class="tag">手动</span>
              <span v-if="item.drama_title" class="dim">{{ item.drama_title }}</span>
              <span
                v-if="upscaleStatusLabel(item)"
                class="studio-upscale-chip"
                :class="upscaleStatusClass(item)"
              >{{ upscaleStatusLabel(item) }}</span>
              <button
                v-if="playableUrl(item)"
                type="button"
                class="studio-card-download-link"
                @click.stop="downloadItem(item)"
              >
                下载
              </button>
              <button
                v-if="canCancel(item)"
                type="button"
                class="studio-card-retry-link"
                :disabled="cancellingId === item.id"
                @click.stop="cancelItem(item)"
              >
                {{ cancellingId === item.id ? '取消中…' : '取消' }}
              </button>
              <button
                v-if="isFailed(item) || isCancelled(item) || isExpired(item)"
                type="button"
                class="studio-card-retry-link"
                @click.stop="retryItem(item)"
              >
                重新生成
              </button>
            </div>
            <button
              v-if="playableUrl(item) && !isProcessing(item)"
              type="button"
              class="studio-card-upscale-btn"
              :class="upscaleStatusClass(item)"
              @click.stop="openDetail(item)"
            >
              {{ upscaleCardButtonLabel(item) }}
            </button>
            <p v-if="operatorLabel(item)" class="studio-card-operator">操作人 {{ operatorLabel(item) }}</p>
          </div>
        </article>
      </div>

      <div v-if="hasMore" class="studio-more">
        <button type="button" class="btn" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中…' : `加载更多（${items.length}/${ledgerTotal}）` }}
        </button>
      </div>

      <div class="studio-feed-spacer" />
    </div>

    <div class="studio-composer-wrap">
      <VideoStudioComposer
        ref="composerRef"
        official-mode
        :generating="generating"
        :dramas="dramas"
        :default-drama-id="filterDramaId"
        :official-models="displayModels"
        :official-resolution-choices="officialResolutionChoices"
        :fixed-config-id="officialConfigId"
        :fixed-model="selectedModel"
        force-adaptive-aspect
        :duration-min="officialDurationMin"
        :duration-max="officialDurationMax"
        :credit-cost-per-second="selectedCreditCostPerSecond"
        :ref-limits-override="selectedRefLimits"
        drama-preference-scope="video-official"
        @update:fixed-model="onSelectedModelChange"
        @generate="onGenerate"
      />
    </div>

    <div v-if="detailItem" class="studio-detail-overlay" @click.self="detailItem = null">
      <div class="studio-detail card">
        <div class="studio-detail-head">
          <div>
            <h3>视频详情 #{{ detailItem.id }}</h3>
            <p class="dim">{{ formatTime(detailItem.created_at) }} · {{ modelTagLabel(detailItem) }}</p>
            <p v-if="operatorLabel(detailItem)" class="studio-detail-operator">操作人 {{ operatorLabel(detailItem) }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="detailItem = null">关闭</button>
        </div>

        <div class="studio-detail-body">
          <div class="studio-detail-media-col">
            <div class="studio-detail-media-block" :class="detailRatioClass">
              <div class="studio-detail-media-label">原片</div>
              <div class="studio-detail-media">
                <video
                  v-if="playableUrl(detailItem)"
                  :src="displayUrl(playableUrl(detailItem))"
                  controls
                  playsinline
                  autoplay
                  class="studio-detail-player"
                  @loadedmetadata="onDetailVideoMeta"
                />
                <div v-else class="studio-detail-empty">
                  {{ detailItem.error_msg || statusLabel(detailItem.status) }}
                </div>
              </div>
            </div>
            <div
              v-if="detailUpscalePlayUrl"
              class="studio-detail-media-block"
              :class="detailRatioClass"
            >
              <div class="studio-detail-media-label is-upscale">超分</div>
              <div class="studio-detail-media">
                <video
                  :src="detailUpscalePlayUrl"
                  controls
                  playsinline
                  class="studio-detail-player"
                />
              </div>
            </div>
          </div>

          <div class="studio-detail-side">
            <div v-if="detailItem.reference_images?.length" class="studio-detail-refs">
              <img
                v-for="(ref, idx) in detailItem.reference_images"
                :key="ref.path + idx"
                :src="ref.display_url || displayUrl(ref.path)"
                alt=""
              />
            </div>
            <div class="studio-detail-actions">
              <button
                v-if="playableUrl(detailItem)"
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="detailDownloading"
                @click="downloadDetail"
              >
                {{ detailDownloading ? '下载中…' : '下载原片' }}
              </button>
              <button type="button" class="btn btn-sm" @click="reuseDetail">复用到输入框</button>
              <button
                v-if="canCancel(detailItem)"
                type="button"
                class="btn btn-sm"
                :disabled="cancellingId === detailItem.id"
                @click="cancelItem(detailItem)"
              >
                {{ cancellingId === detailItem.id ? '取消中…' : '取消任务' }}
              </button>
              <button
                v-if="isFailed(detailItem) || isCancelled(detailItem) || isExpired(detailItem)"
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="generating"
                @click="retryItem(detailItem)"
              >
                {{ generating ? '提交中…' : '重新生成' }}
              </button>
              <button type="button" class="btn btn-sm" @click="copyPrompt(detailItem.prompt)">复制提示词</button>
            </div>
            <!-- 超分入口放提示词上方，避免被长文案挤出可视区 -->
            <StudioChannel2Upscale
              v-if="playableUrl(detailItem) && !isProcessing(detailItem)"
              :video-id="detailItem.id"
              :duration-sec="detailItem.duration"
              :source-url="playableUrl(detailItem)"
              :initial-job="upscaleJobsByVideoId[detailItem.id] || null"
              @updated="onUpscaleUpdated"
            />
            <pre class="studio-detail-prompt">{{ detailItem.prompt || '—' }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { copyText } from '~/utils/copy-text.js'
import { videoAPI, videoUpscaleAPI } from '~/composables/useApi'
import StudioVideoCardMedia from '~/components/StudioVideoCardMedia.vue'
import StudioChannel2Upscale from '~/components/StudioChannel2Upscale.vue'
import { mediaDisplayUrl, videoPosterDisplayUrl } from '~/utils/media-url.js'
import { buildVideoDownloadFilename, downloadMediaFile } from '~/utils/download-media.js'
import VideoStudioComposer from '~/components/VideoStudioComposer.vue'
import { formatVideoGenerationError } from '~/utils/image-generation-error.js'
import { sanitizeUserFacingProviderError } from '~/utils/provider-error-sanitize.js'
import { toSeedanceDisplayLabel } from '~/utils/seedance-display.js'
import { modelTagWithResolution } from '~/utils/video-resolution-label.js'
import { VIDEO_CHANNEL_REF_LIMITS, OFFICIAL_SEEDANCE_25_REF_LIMITS, isSeedance25ModelId } from '~/constants/video-channels.js'
import {
  buildVideoLedgerCacheKey,
  restoreVideoLedgerCache,
  persistVideoLedgerCache,
  loadVideoDramasLite,
  finalizeVideoLedgerItems,
} from '~/utils/video-studio-page.js'
import {
  loadImageStudioCapabilities,
  getCachedImageStudioCapabilities,
} from '~/composables/useImageStudioCapabilities'

const VIDEO_LEDGER_CACHE_PREFIX = 'studio-video-ledger-official-v1'
const channelRefLimits = VIDEO_CHANNEL_REF_LIMITS['/videos/official']

const OFFICIAL_MODEL_IDS = [
  'doubao-seedance-2-5-260628',
  'doubao-seedance-2-0-mini-260615',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-260128',
]

const DEFAULT_OFFICIAL_MODEL = OFFICIAL_MODEL_IDS[0]

const DEFAULT_RESOLUTION_CHOICES = [
  { id: '480p', label: '480p' },
  { id: '720p', label: '720p' },
]

const DEFAULT_OFFICIAL_MODELS = [
  {
    id: OFFICIAL_MODEL_IDS[0],
    label: 'Seedance 2.5',
    billing_unit: 'duration_resolution',
    credit_cost_per_second: null,
    billing_seconds_min: 4,
    billing_seconds_max: 30,
    duration_default: 10,
    config_id: null,
    resolutions: ['480p', '720p'],
    resolution_choices: DEFAULT_RESOLUTION_CHOICES,
    ref_limits: OFFICIAL_SEEDANCE_25_REF_LIMITS,
  },
  {
    id: OFFICIAL_MODEL_IDS[1],
    label: 'Seedance 2.0 Mini',
    billing_unit: 'duration_resolution',
    credit_cost_per_second: null,
    billing_seconds_min: 4,
    billing_seconds_max: 15,
    duration_default: 5,
    config_id: null,
    resolutions: ['480p', '720p'],
    resolution_choices: DEFAULT_RESOLUTION_CHOICES,
    ref_limits: channelRefLimits,
  },
  {
    id: OFFICIAL_MODEL_IDS[2],
    label: 'Seedance 2.0 Fast',
    billing_unit: 'duration_resolution',
    credit_cost_per_second: null,
    billing_seconds_min: 4,
    billing_seconds_max: 15,
    duration_default: 5,
    config_id: null,
    resolutions: ['480p', '720p'],
    resolution_choices: DEFAULT_RESOLUTION_CHOICES,
    ref_limits: channelRefLimits,
  },
  {
    id: OFFICIAL_MODEL_IDS[3],
    label: 'Seedance 2.0',
    billing_unit: 'duration_resolution',
    credit_cost_per_second: null,
    billing_seconds_min: 4,
    billing_seconds_max: 15,
    duration_default: 5,
    config_id: null,
    resolutions: ['480p', '720p'],
    resolution_choices: DEFAULT_RESOLUTION_CHOICES,
    ref_limits: channelRefLimits,
  },
]

const route = useRoute()

const loading = ref(false)
const loadingMore = ref(false)
const generating = ref(false)
const officialModels = ref([])
const officialResolutionChoices = ref([...DEFAULT_RESOLUTION_CHOICES])
const officialApiKeyConfigured = ref(true)
const officialDurationMin = ref(4)
const officialDurationMax = ref(30)
const selectedModel = ref(DEFAULT_OFFICIAL_MODEL)
const items = ref([])
const dramas = ref([])
const stats = ref({ total: 0, completed: 0, processing: 0, failed: 0, cancelled: 0, expired: 0 })
const pagination = ref({ limit: 30, offset: 0, total: 0, has_more: false })
const PAGE_SIZE = 30
const REFRESH_VISIBLE_CAP = 300
const filterDramaId = ref(String(route.query.drama_id || ''))
const filterStatus = ref('all')
const viewScope = ref('mine')
const filterUserId = ref(null)
const userOptions = ref([])
const detailItem = ref(null)
const detailDownloading = ref(false)
const cancellingId = ref(null)
const composerRef = ref(null)
const feedRef = ref(null)
/** video_generation_id → 最新超分任务 */
const upscaleJobsByVideoId = ref({})
let pollTimer = null

const ledgerTotal = computed(() =>
  Number(pagination.value.total || stats.value.total || 0),
)
const noMorePages = ref(false)
/** 以已加载数量对比总数；遇到重复页时 noMorePages 强制停止 */
const hasMore = computed(() =>
  !noMorePages.value && items.value.length < ledgerTotal.value,
)

function videoLedgerCacheKey() {
  return buildVideoLedgerCacheKey(VIDEO_LEDGER_CACHE_PREFIX, [
    viewScope.value,
    filterUserId.value || 'all',
    filterDramaId.value || 'all',
    filterStatus.value,
  ])
}

function ensureDramasLoaded() {
  if (!dramas.value.length) void loadVideoDramasLite(dramas)
}

const statusTabs = [
  { id: 'all', label: '全部' },
  { id: 'completed', label: '已完成' },
  { id: 'processing', label: '进行中' },
  { id: 'failed', label: '失败' },
  { id: 'cancelled', label: '已取消' },
  { id: 'expired', label: '已过期' },
]

const hasActiveTasks = computed(() =>
  items.value.some(item => item.status === 'processing' || item.status === 'pending'),
)

const selectedRefLimits = computed(() => {
  const modelId = String(selectedModel.value || '')
  if (isSeedance25ModelId(modelId)) {
    return OFFICIAL_SEEDANCE_25_REF_LIMITS
  }
  const model = displayModels.value.find(item => item.id === selectedModel.value)
  const fromApi = model?.ref_limits || model?.refLimits
  if (fromApi && typeof fromApi === 'object') {
    return {
      images: Number(fromApi.images) || channelRefLimits.images,
      audios: Number(fromApi.audios) || channelRefLimits.audios,
      videos: Number(fromApi.videos) || channelRefLimits.videos,
      max_total: fromApi.max_total ?? fromApi.maxTotal ?? null,
    }
  }
  return channelRefLimits
})

const selectedCreditCostPerSecond = computed(() => {
  const model = displayModels.value.find(item => item.id === selectedModel.value)
  const rate = model?.credit_cost_per_second
  return rate != null && Number.isFinite(Number(rate)) ? Number(rate) : null
})

const displayModels = computed(() =>
  officialModels.value.length ? officialModels.value : DEFAULT_OFFICIAL_MODELS,
)

const officialConfigId = computed(() => {
  const model = displayModels.value.find(item => item.id === selectedModel.value)
  return model?.config_id ?? null
})

function modelLabel(modelId) {
  const id = String(modelId || '')
  const label = displayModels.value.find(item => item.id === modelId)?.label
    || (id.includes('2-5') || id.includes('2.5')
      ? 'Seedance 2.5'
      : (id.includes('fast') ? 'Seedance 2.0 Fast' : 'Seedance 2.0'))
  return toSeedanceDisplayLabel(label)
}

function modelTagLabel(item) {
  return modelTagWithResolution(item, modelLabel)
}

function statsForTab(id) {
  if (id === 'all') return stats.value.total
  if (id === 'completed') return stats.value.completed
  if (id === 'processing') return stats.value.processing
  if (id === 'failed') return stats.value.failed
  if (id === 'cancelled') return stats.value.cancelled || 0
  if (id === 'expired') return stats.value.expired || 0
  return 0
}

function applyModelBounds(modelId) {
  const model = displayModels.value.find(item => item.id === modelId)
  officialDurationMin.value = Number(model?.billing_seconds_min) || 4
  officialDurationMax.value = Number(model?.billing_seconds_max)
    || ((String(modelId || '').includes('2-5') || String(modelId || '').includes('2.5')) ? 30 : 15)
  officialResolutionChoices.value = normalizeOfficialResolutionChoices(
    model?.resolution_choices || DEFAULT_RESOLUTION_CHOICES,
  )
}

function onSelectedModelChange(modelId) {
  selectedModel.value = modelId
  applyModelBounds(modelId)
}

function normalizeItem(row) {
  return {
    id: row.id,
    storyboard_id: row.storyboard_id,
    drama_id: row.drama_id,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt || '',
    status: row.status || 'pending',
    error_msg: sanitizeUserFacingProviderError(row.error_msg || row.errorMsg || ''),
    duration: row.duration,
    resolution: row.resolution || '',
    width: row.width ?? null,
    height: row.height ?? null,
    aspect_ratio: row.aspect_ratio || row.aspectRatio || '16:9',
    reference_mode: row.reference_mode || row.referenceMode || '',
    reference_images: row.reference_images || [],
    reference_videos: row.reference_videos || [],
    reference_audios: row.reference_audios || [],
    is_manual: !!row.is_manual,
    created_at: row.created_at || row.createdAt || '',
    display_video_url: row.display_video_url || '',
    display_poster_url: row.display_poster_url || '',
    poster_path: row.poster_path || row.posterPath || '',
    video_url: row.video_url || row.videoUrl || '',
    local_path: row.local_path || row.localPath || '',
    drama_title: row.drama_title || '',
    operator_id: row.operator_id ?? null,
    operator_name: row.operator_name || '',
    username: row.username || '',
    display_name: row.display_name || '',
  }
}

function operatorLabel(item) {
  if (!item) return ''
  return item.operator_name || item.display_name || item.username || ''
}

function playableUrl(item) {
  return item?.display_video_url || item?.local_path || item?.video_url || ''
}

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
}

function isProcessing(item) {
  const s = item?.status
  return s === 'processing' || s === 'pending' || s === 'queued' || s === 'running'
}

function isFailed(item) {
  return item?.status === 'failed'
}

function isCancelled(item) {
  const s = item?.status
  return s === 'cancelled' || s === 'canceled'
}

function isExpired(item) {
  return item?.status === 'expired'
}

/** 排队中可取消；生成中也会显示按钮（上游若已 running 会返回不可取消） */
function canCancel(item) {
  if (!item?.id) return false
  const s = item.status
  return s === 'pending' || s === 'queued' || s === 'processing' || s === 'running'
}

async function cancelItem(item) {
  if (!canCancel(item) || cancellingId.value === item.id) return
  if (!confirm('确定取消该任务？排队中取消将退还积分。')) return
  cancellingId.value = item.id
  try {
    const res = await videoAPI.cancel(item.id)
    const next = res?.item
    if (next) {
      const idx = items.value.findIndex(row => row.id === item.id)
      if (idx >= 0) items.value[idx] = { ...items.value[idx], ...normalizeItem(next) }
      if (detailItem.value?.id === item.id) {
        detailItem.value = { ...detailItem.value, ...normalizeItem(next) }
      }
    } else {
      await refreshLedger()
    }
    toast.success('已取消并退款')
  } catch (e) {
    toast.error(e?.message || '取消失败（生成中通常不可取消）')
  } finally {
    cancellingId.value = null
  }
}

function buildPayloadFromItem(item) {
  let refs = []
  const payloadRaw = item?.reference_payload || item?.referencePayload
  if (payloadRaw) {
    try {
      refs = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw
      if (!Array.isArray(refs)) refs = []
    } catch {
      refs = []
    }
  }
  if (!refs.length) {
    refs = (item?.reference_images || []).map((ref, idx) => ({
      type: 'image',
      url: ref.path,
      label: ref.label || `参考图${idx + 1}`,
    })).filter(ref => ref.url)
    const videoRefs = (item?.reference_videos || []).map((ref, idx) => ({
      type: 'video',
      url: ref.path,
      label: ref.label || `参考视频${idx + 1}`,
    })).filter(ref => ref.url)
    refs = [...refs, ...videoRefs]
  }

  const payload = {
    prompt: item?.prompt || '',
    duration: Number(item?.duration || 15),
    aspect_ratio: item?.aspect_ratio || item?.aspectRatio || '16:9',
    drama_id: item?.drama_id ? Number(item.drama_id) : undefined,
  }

  if (refs.length) {
    payload.content_refs = refs
    const imageUrls = refs
      .filter(ref => ref.type === 'image')
      .map(ref => ref.url)
      .filter(Boolean)
    if (imageUrls.length) {
      payload.reference_mode = 'multiple'
      payload.reference_image_urls = imageUrls
    } else if (refs.some(ref => ref.type === 'video' || ref.type === 'audio')) {
      payload.reference_mode = 'multiple'
    }
  }

  return payload
}

async function retryItem(item) {
  if (!item || generating.value) return
  if (item.model && OFFICIAL_MODEL_IDS.includes(item.model)) {
    selectedModel.value = item.model
  }
  await composerRef.value?.loadFromItem(item)
  detailItem.value = null
  await nextTick()
  await onGenerate(buildPayloadFromItem(item))
}

function statusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'processing') return '生成中'
  if (status === 'running') return '生成中'
  if (status === 'failed') return '失败'
  if (status === 'pending' || status === 'queued') return '排队中'
  if (status === 'cancelled' || status === 'canceled') return '已取消'
  if (status === 'expired') return '已过期'
  return status || '未知'
}

function statusTagClass(status) {
  if (status === 'completed') return 'tag-success'
  if (status === 'processing' || status === 'pending' || status === 'queued' || status === 'running') return 'tag-accent'
  if (status === 'failed' || status === 'expired') return 'tag-danger'
  if (status === 'cancelled' || status === 'canceled') return 'tag-muted'
  return ''
}

function cardRatioClass(item) {
  const w = Number(item?.width)
  const h = Number(item?.height)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return w >= h ? 'ratio-landscape' : 'ratio-portrait'
  }
  let ratio = String(item?.aspect_ratio || item?.aspectRatio || '').trim()
  // 历史任务曾入库 adaptive：用剧目画幅或默认横屏，避免生成中占位误显示竖屏
  if (!ratio || ratio === 'adaptive') {
    const dramaId = Number(item?.drama_id || item?.dramaId)
    const drama = Number.isFinite(dramaId)
      ? dramas.value.find(d => Number(d.id) === dramaId)
      : null
    ratio = String(
      drama?.image_aspect_ratio
      || drama?.imageAspectRatio
      || drama?.aspect_ratio
      || drama?.aspectRatio
      || '16:9',
    ).trim()
  }
  if (ratio === '16:9' || ratio === '21:9' || ratio === '4:3' || ratio === '3:2') return 'ratio-landscape'
  return 'ratio-portrait'
}

/** 无封面时用首张参考图推断占位比例 */
function cardRatioHintSrc(item) {
  if (videoPosterDisplayUrl(item)) return ''
  const ref = item?.reference_images?.[0]
  const raw = ref?.display_url || ref?.path || ''
  return raw ? displayUrl(raw) : ''
}

const detailDetectedRatio = ref('')
const detailRatioClass = computed(() => detailDetectedRatio.value || cardRatioClass(detailItem.value) || 'ratio-portrait')

watch(detailItem, () => {
  detailDetectedRatio.value = ''
})

function onDetailVideoMeta(event) {
  const el = event?.target
  const w = Number(el?.videoWidth) || 0
  const h = Number(el?.videoHeight) || 0
  if (w <= 0 || h <= 0) return
  detailDetectedRatio.value = w >= h ? 'ratio-landscape' : 'ratio-portrait'
}

function previewPrompt(text) {
  const value = String(text || '').trim()
  if (!value) return '无提示词'
  return value.length > 120 ? `${value.slice(0, 120)}…` : value
}

function formatTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

function openDetail(item) {
  detailItem.value = item
}

async function reuseDetail() {
  if (!detailItem.value) return
  const modelId = String(detailItem.value.model || '').trim()
  if (modelId && OFFICIAL_MODEL_IDS.includes(modelId)) {
    selectedModel.value = modelId
  }
  await composerRef.value?.loadFromItem(detailItem.value)
  detailItem.value = null
  nextTick(() => {
    feedRef.value?.scrollTo({ top: feedRef.value.scrollHeight, behavior: 'smooth' })
  })
  toast.success('已填入输入框，可修改后重新生成')
}

async function copyPrompt(text) {
  const ok = await copyText(text)
  if (ok) toast.success('已复制提示词')
  else toast.error('复制失败')
}

function videoDownloadName(item) {
  return buildVideoDownloadFilename({
    id: item?.id,
    dramaTitle: item?.drama_title,
    title: modelLabel(item?.model),
  })
}

async function downloadItem(item) {
  if (!playableUrl(item)) return
  try {
    // 与详情播放器 / 三点菜单同一地址，避免误用已过期的上游临时链
    const play = displayUrl(playableUrl(item)) || playableUrl(item)
    await downloadMediaFile(playableUrl(item), videoDownloadName(item), {
      item,
      videoGenerationId: item.id,
      playUrl: play,
    })
    toast.success('开始下载原片')
  } catch (e) {
    toast.error(e?.message || '下载失败')
  }
}

function onUpscaleUpdated(job) {
  const vid = Number(job?.video_generation_id)
  if (!Number.isFinite(vid) || vid <= 0) return
  upscaleJobsByVideoId.value = { ...upscaleJobsByVideoId.value, [vid]: job }
}

function upscaleJobFor(item) {
  return upscaleJobsByVideoId.value[item?.id] || null
}

function isUpscaleDone(item) {
  const job = upscaleJobFor(item)
  return !!(job && job.status === 'completed' && job.output_video_url)
}

function upscaleStatusLabel(item) {
  const job = upscaleJobFor(item)
  if (!job) return ''
  if (job.status === 'completed' && job.output_video_url) return '已超分'
  if (job.status === 'failed') return '超分失败'
  if (job.status === 'queued') {
    const ahead = Math.max(0, Number(job.queue_ahead) || 0)
    return ahead > 0 ? `排队中·前${ahead}` : '排队中'
  }
  if (job.status === 'uploading' || job.status === 'processing') return '超分中'
  return ''
}

function upscaleCardButtonLabel(item) {
  const job = upscaleJobFor(item)
  const label = upscaleStatusLabel(item)
  if (label === '已超分') return '查看超分'
  if (job?.status === 'queued') return label || '排队中'
  if (job?.status === 'uploading' || job?.status === 'processing') return '超分中…'
  if (label === '超分失败') return '重新超分'
  return '超分'
}

function upscaleStatusClass(item) {
  const job = upscaleJobFor(item)
  if (!job) return ''
  if (job.status === 'completed') return 'is-done'
  if (job.status === 'failed') return 'is-failed'
  if (job.status === 'queued' || job.status === 'uploading' || job.status === 'processing') return 'is-busy'
  return ''
}

const detailUpscalePlayUrl = computed(() => {
  const job = detailItem.value ? upscaleJobFor(detailItem.value) : null
  if (!job || job.status !== 'completed' || !job.output_video_url) return ''
  return displayUrl(job.output_video_url) || job.output_video_url
})

async function hydrateUpscaleJobs(list) {
  const ids = (list || [])
    .filter(item => playableUrl(item) && !isProcessing(item))
    .map(item => item.id)
    .filter(id => Number.isFinite(id) && id > 0)
  if (!ids.length) return
  try {
    const res = await videoUpscaleAPI.forGenerations(ids)
    const map = res?.items || {}
    const next = { ...upscaleJobsByVideoId.value }
    for (const [key, job] of Object.entries(map)) {
      const id = Number(key)
      if (Number.isFinite(id) && job) next[id] = job
    }
    upscaleJobsByVideoId.value = next
  } catch {
    /* ignore */
  }
}

async function downloadDetail() {
  if (!detailItem.value || detailDownloading.value) return
  detailDownloading.value = true
  try {
    await downloadItem(detailItem.value)
  } finally {
    detailDownloading.value = false
  }
}

function buildQuery(offset = 0, limit = PAGE_SIZE) {
  return {
    drama_id: filterDramaId.value ? Number(filterDramaId.value) : undefined,
    status: filterStatus.value === 'all' ? undefined : filterStatus.value,
    limit,
    offset,
    mine_only: viewScope.value === 'mine',
    user_id: viewScope.value === 'user' && filterUserId.value ? filterUserId.value : undefined,
    provider: 'volcengine',
    models: OFFICIAL_MODEL_IDS.join(','),
  }
}

function setViewScope(scope) {
  if (viewScope.value === scope) return
  viewScope.value = scope
  if (scope !== 'user') {
    filterUserId.value = null
  }
  noMorePages.value = false
  reload()
}

function onUserFilterChange() {
  if (filterUserId.value) {
    viewScope.value = 'user'
    noMorePages.value = false
    reload()
    return
  }
  if (viewScope.value === 'user') {
    setViewScope('all')
  }
}

function applyUserOptionsFromCaps(caps) {
  userOptions.value = caps?.user_filter_options || []
}

async function loadUserOptions() {
  try {
    const caps = await loadImageStudioCapabilities()
    applyUserOptionsFromCaps(caps)
  } catch {
    userOptions.value = []
  }
}

function applyLedgerPagination(res, loadedCount) {
  const total = Number(res?.pagination?.total ?? res?.stats?.total ?? pagination.value.total ?? 0)
  pagination.value = {
    limit: PAGE_SIZE,
    offset: loadedCount,
    total,
    has_more: loadedCount < total,
  }
  if (res?.stats) stats.value = res.stats
}

async function loadLedger({ append = false, offset = 0, refreshVisible = false } = {}) {
  const pageLimit = refreshVisible
    ? Math.min(Math.max(items.value.length, PAGE_SIZE), REFRESH_VISIBLE_CAP)
    : PAGE_SIZE
  const pageOffset = refreshVisible ? 0 : offset
  const res = await videoAPI.ledger(buildQuery(pageOffset, pageLimit))
  const nextItems = (res?.items || []).map(normalizeItem)

  if (refreshVisible) {
    // 轮询只合并状态，绝不能把已翻页加载的列表截回第一页
    const freshMap = new Map(nextItems.map(item => [item.id, item]))
    const merged = items.value.map(old => {
      const fresh = freshMap.get(old.id)
      return fresh ? { ...old, ...fresh } : old
    })
    const have = new Set(merged.map(item => item.id))
    const brandNew = nextItems.filter(item => !have.has(item.id))
    items.value = brandNew.length ? [...brandNew, ...merged] : merged
    applyLedgerPagination(res, items.value.length)
    finalizeVideoLedgerItems(brandNew.length ? brandNew : nextItems.slice(0, 8))
    void hydrateUpscaleJobs(nextItems)
    return
  }

  if (append) {
    const seen = new Set(items.value.map(item => item.id))
    const merged = [...items.value]
    let added = 0
    for (const item of nextItems) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
      added += 1
    }
    items.value = merged
    // 本页全是重复（排序不稳或 offset 失效）时停止继续翻页，避免死循环
    if (added === 0 && nextItems.length) {
      noMorePages.value = true
      applyLedgerPagination(res, items.value.length)
      return
    }
  } else {
    items.value = nextItems
  }

  applyLedgerPagination(res, items.value.length)

  finalizeVideoLedgerItems(nextItems)
  void hydrateUpscaleJobs(append ? nextItems : items.value)
  if (!append) {
    persistVideoLedgerCache(videoLedgerCacheKey(), {
      items: items.value,
      stats: stats.value,
      pagination: pagination.value,
    })
  }
}

async function refreshLedger() {
  if (!items.value.length) {
    await loadLedger({ offset: 0 })
    return
  }
  // 已翻过多页时，只做原地状态合并，避免列表被重置
  await loadLedger({ refreshVisible: true })
}

async function reload() {
  if (!items.value.length) loading.value = true
  noMorePages.value = false
  try {
    await loadLedger({ offset: 0 })
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  loadingMore.value = true
  const beforeCount = items.value.length
  try {
    await loadLedger({ append: true, offset: beforeCount })
    if (items.value.length <= beforeCount && items.value.length < ledgerTotal.value) {
      noMorePages.value = true
    }
  } finally {
    loadingMore.value = false
  }
}

function setStatus(status) {
  filterStatus.value = status
  noMorePages.value = false
  reload()
}

function normalizeOfficialResolutionChoices(raw) {
  const allowed = new Set(['480p', '720p'])
  const list = Array.isArray(raw)
    ? raw
      .map((item) => {
        if (item && typeof item === 'object') {
          const id = String(item.id || '').trim().toLowerCase()
          if (!allowed.has(id)) return null
          return { id, label: id }
        }
        const id = String(item || '').trim().toLowerCase()
        if (!allowed.has(id)) return null
        return { id, label: id }
      })
      .filter(Boolean)
    : []
  const ids = new Set(list.map(item => item.id))
  for (const id of ['480p', '720p']) {
    if (!ids.has(id)) list.push({ id, label: id })
  }
  return list
}

async function loadOfficialOptions() {
  try {
    const res = await videoAPI.officialOptions()
    const models = Array.isArray(res?.models) ? res.models : []
    officialModels.value = models.map((item) => ({
      ...item,
      ref_limits: isSeedance25ModelId(item?.id)
        ? OFFICIAL_SEEDANCE_25_REF_LIMITS
        : (item?.ref_limits || item?.refLimits || channelRefLimits),
      resolutions: ['480p', '720p'],
      resolution_choices: normalizeOfficialResolutionChoices(item?.resolution_choices),
    }))
    officialResolutionChoices.value = normalizeOfficialResolutionChoices(
      res?.resolution_choices
      || res?.models?.[0]?.resolution_choices
      || DEFAULT_RESOLUTION_CHOICES,
    )
    officialApiKeyConfigured.value = res?.api_key_configured !== false
    const preferred = String(res?.default_model || DEFAULT_OFFICIAL_MODEL)
    if (officialModels.value.length) {
      const currentStillValid = officialModels.value.some(item => item.id === selectedModel.value)
      if (!currentStillValid) {
        const next = officialModels.value.find(item => item.id === preferred)
          || officialModels.value.find(item => item.id === DEFAULT_OFFICIAL_MODEL)
          || officialModels.value[0]
        selectedModel.value = next.id
      }
      applyModelBounds(selectedModel.value)
    } else if (!selectedModel.value) {
      selectedModel.value = DEFAULT_OFFICIAL_MODEL
      applyModelBounds(selectedModel.value)
    }
  } catch {
    officialModels.value = []
    officialResolutionChoices.value = [...DEFAULT_RESOLUTION_CHOICES]
    officialApiKeyConfigured.value = false
  }
}

async function onGenerate(payload) {
  if (generating.value) {
    toast.warning('正在提交中，请稍候')
    return
  }
  const modelId = String(payload?.model || selectedModel.value || DEFAULT_OFFICIAL_MODEL).trim()
  if (!modelId) {
    toast.error('请选择模型')
    return
  }
  selectedModel.value = modelId

  if (!officialModels.value.length || !officialConfigId.value) {
    await loadOfficialOptions()
  }
  if (!officialConfigId.value) {
    toast.error('未配置火山官方 S 视频服务，请联系管理员')
    return
  }
  if (!officialApiKeyConfigured.value) {
    toast.error('火山官方 API Key 未配置，请管理员在「设置 → AI 配置」中填写「火山方舟 S-视频」的 API Key')
    return
  }
  generating.value = true
  try {
    const generation = await videoAPI.generate({
      ...payload,
      official: true,
      config_id: officialConfigId.value,
      model: selectedModel.value,
      resolution: payload?.resolution || '480p',
    })
    toast.success('官方视频任务已提交')
    filterStatus.value = 'all'
    await reload()
    void pollGeneration(generation?.id)
  } catch (err) {
    toast.error(formatVideoGenerationError(err?.message || '生成失败'))
    await reload()
  } finally {
    generating.value = false
  }
}

async function pollGeneration(generationId) {
  if (!generationId) return
  for (let i = 0; i < 120; i++) {
    await sleep(5000)
    try {
      const res = await videoAPI.get(generationId)
      await refreshLedger()
      if (res?.status === 'completed') {
        toast.success('视频生成完成')
        return
      }
      if (res?.status === 'failed') {
        filterStatus.value = 'failed'
        await reload()
        toast.error(formatVideoGenerationError(res?.error_msg || res?.errorMsg || '视频生成失败，可在上方列表重新生成'))
        return
      }
    } catch {
      // ignore transient poll errors
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!hasActiveTasks.value || loadingMore.value) return
    try {
      await refreshLedger()
    } catch {
      // ignore
    }
  }, 5000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(() => {
  const cachedCaps = getCachedImageStudioCapabilities()
  if (cachedCaps) applyUserOptionsFromCaps(cachedCaps)
  const cached = restoreVideoLedgerCache(videoLedgerCacheKey())
  if (cached?.items?.length) {
    items.value = cached.items.map(normalizeItem)
    stats.value = cached.stats || stats.value
    pagination.value = cached.pagination || pagination.value
    finalizeVideoLedgerItems(items.value)
  } else {
    loading.value = true
  }
  void loadUserOptions()
  void loadOfficialOptions()
  void loadVideoDramasLite(dramas)
  void loadLedger({ offset: 0 }).finally(() => {
    loading.value = false
    startPolling()
  })
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.studio-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background:
    radial-gradient(circle at top right, rgba(76, 125, 255, 0.1), transparent 42%),
    radial-gradient(circle at top left, rgba(36, 180, 126, 0.08), transparent 35%),
    var(--bg-base);
}

.studio-composer-wrap {
  flex-shrink: 0;
  position: relative;
  z-index: 20;
}

.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 24px 10px;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.studio-header-copy {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 0;
}

.studio-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  white-space: nowrap;
}

.studio-header-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: nowrap;
  justify-content: flex-end;
  min-width: 0;
  flex: 1;
}

.studio-header-actions .studio-filter-select {
  min-width: 0;
  max-width: 160px;
}

.studio-scope-toggle {
  display: inline-flex;
  padding: 2px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
}

.studio-scope-btn {
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.studio-scope-btn.active {
  background: var(--accent-bg);
  color: var(--accent-text);
}

.studio-member-select.active {
  border-color: var(--accent);
  color: var(--accent-text);
}

.studio-filter-select {
  min-width: 140px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-1);
  font-size: 12px;
}

.studio-tabs {
  display: flex;
  gap: 8px;
  padding: 0 24px 12px;
  flex-shrink: 0;
}

.studio-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.studio-tab.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-text);
}

.studio-feed {
  flex: 1;
  overflow: auto;
  min-height: 0;
  padding: 0 24px;
}

.studio-feed-spacer {
  height: 220px;
}

.studio-empty {
  padding: 64px 24px;
  text-align: center;
  color: var(--text-3);
}

.studio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}

.studio-card {
  border-radius: 16px;
  overflow: hidden;
  background: var(--bg-1);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.studio-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.studio-card-media-wrap {
  position: relative;
}

.studio-card-upscale-ribbon {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  background: linear-gradient(90deg, #ff6a00 0%, #ee0935 50%, #c4008c 100%);
  box-shadow: 0 -6px 18px rgba(238, 9, 53, 0.35);
  pointer-events: none;
}

.studio-card-upscale-ribbon::before {
  content: '★';
  font-size: 12px;
}

.studio-upscale-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.4;
}

.studio-upscale-chip.is-done {
  color: #fff;
  background: linear-gradient(135deg, #ff6a00 0%, #ee0935 55%, #c4008c 100%);
  box-shadow: 0 2px 8px rgba(238, 9, 53, 0.35);
}

.studio-upscale-chip.is-busy {
  color: #9a3412;
  background: #ffedd5;
  border: 1px solid #fdba74;
}

.studio-upscale-chip.is-failed {
  color: #991b1b;
  background: #fee2e2;
  border: 1px solid #fca5a5;
}

.studio-card-media {
  position: relative;
  background: #000;
  overflow: hidden;
}

.ratio-portrait { aspect-ratio: 9 / 16; }
.ratio-landscape { aspect-ratio: 16 / 9; }

.studio-card-media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.studio-card-loading,
.studio-card-fallback {
  width: 100%;
  height: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

.studio-spinner {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.studio-card-error {
  margin: 0;
  font-size: 11px;
  color: #ef5350;
  line-height: 1.4;
}

.studio-card-ref-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}

.studio-card-status {
  position: absolute;
  top: 8px;
  right: 8px;
}

.studio-card-download {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 2;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: rgba(15, 20, 28, 0.72);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.studio-card-body {
  padding: 10px 12px 12px;
}

.studio-card-prompt {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-1);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.studio-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}

.studio-card-operator {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-3);
}

.studio-detail-operator {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-3);
}

.studio-card-download-link,
.studio-card-retry-link {
  padding: 0;
  border: none;
  background: none;
  font-size: 11px;
  cursor: pointer;
}

.studio-card-download-link {
  margin-left: auto;
  color: var(--accent);
}

.studio-card-retry-link {
  color: var(--danger, #e5484d);
}

.studio-card-upscale-btn {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(255, 138, 61, 0.45);
  border-radius: 8px;
  background: rgba(255, 138, 61, 0.12);
  color: #ff9a4d;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, filter 0.15s ease;
}

.studio-card-upscale-btn:hover {
  background: rgba(255, 138, 61, 0.22);
  border-color: rgba(255, 138, 61, 0.7);
  filter: brightness(1.05);
}

.studio-card-upscale-btn.is-done {
  border-color: rgba(255, 138, 61, 0.55);
  background: linear-gradient(135deg, rgba(255, 106, 0, 0.28), rgba(238, 9, 53, 0.18));
  color: #ffb070;
}

.studio-card-upscale-btn.is-busy {
  border-color: rgba(59, 130, 246, 0.45);
  background: rgba(59, 130, 246, 0.14);
  color: #93c5fd;
}

.studio-card-upscale-btn.is-failed {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}

.studio-more {
  display: flex;
  justify-content: center;
  margin: 20px 0;
}

.studio-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.studio-detail {
  width: min(960px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 16px;
}

.studio-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.studio-detail-head h3 {
  margin: 0 0 4px;
  font-size: 18px;
}

.studio-detail-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 16px;
}

.studio-detail-media-col {
  display: grid;
  gap: 12px;
  align-content: start;
}

.studio-detail-media-block {
  display: grid;
  gap: 6px;
}

.studio-detail-media-label {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-2);
}

.studio-detail-media-label.is-upscale {
  color: #1d4ed8;
}

.studio-detail-media {
  border-radius: 14px;
  overflow: hidden;
  background: #000;
}

.studio-detail-player {
  width: 100%;
  display: block;
}

.studio-detail-empty {
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--text-3);
  text-align: center;
}

.studio-detail-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.studio-detail-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.studio-detail-refs img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.studio-detail-prompt {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}

.studio-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 860px) {
  .studio-header,
  .studio-tabs,
  .studio-feed { padding-left: 16px; padding-right: 16px; }
  .studio-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .studio-detail-body { grid-template-columns: 1fr; }
}
</style>
