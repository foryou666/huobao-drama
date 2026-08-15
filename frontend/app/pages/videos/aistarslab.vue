<template>
  <div class="studio-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">通道三</h1>
        <StudioGuideButton title="S VIP 使用说明">
          <p class="studio-guide-line">
            S 2.0 VIP 通道：支持参考图/视频/音频（@图片N @视频N @音频N），素材需公网 URL；含参考视频时积分 ×{{ referenceVideoMultiplier }}。
          </p>
          <p class="studio-guide-line">
            <button type="button" class="studio-spec-link" @click="materialSpecOpen = true">查看官方素材规范</button>
          </p>
        </StudioGuideButton>
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
        <select v-model="filterDramaId" class="studio-filter-select" @focus="ensureDramasLoaded" @change="reload">
          <option value="">全部项目</option>
          <option v-for="d in dramas" :key="d.id" :value="String(d.id)">{{ d.title }}</option>
        </select>
        <button type="button" class="btn btn-sm btn-ghost" @click="materialSpecOpen = true">
          素材规范
        </button>
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
        <p>还没有视频，在底部输入描述并点击「生成视频」</p>
      </div>

      <div v-else class="studio-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="studio-card"
          @click="openDetail(item)"
        >
          <StudioVideoCardMedia
            :poster-src="videoPosterDisplayUrl(item)"
            :playable="!!playableUrl(item)"
            :processing="isProcessing(item)"
            :ratio-class="cardRatioClass(item)"
            :status-label="statusLabel(item.status)"
            :status-class="statusTagClass(item.status)"
            :processing-label="statusLabel(item.status)"
            :fallback-label="statusLabel(item.status)"
            :error-msg="item.error_msg"
            :ref-count="item.reference_images?.length || 0"
            @download="downloadItem(item)"
          />

          <div class="studio-card-body">
            <p class="studio-card-prompt">{{ previewPrompt(item.prompt) }}</p>
            <div class="studio-card-meta">
              <span class="mono dim">#{{ item.id }}</span>
              <span v-if="item.model" class="tag tag-accent">{{ modelLabel(item.model) }}</span>
              <span v-if="item.is_manual" class="tag">手动</span>
              <span v-if="item.drama_title" class="dim">{{ item.drama_title }}</span>
              <button
                v-if="playableUrl(item)"
                type="button"
                class="studio-card-download-link"
                @click.stop="downloadItem(item)"
              >
                下载
              </button>
              <button
                v-if="isFailed(item)"
                type="button"
                class="studio-card-retry-link"
                @click.stop="retryItem(item)"
              >
                重新生成
              </button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="pagination.has_more" class="studio-more">
        <button type="button" class="btn" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>

      <div class="studio-feed-spacer" />
    </div>

    <div class="studio-composer-wrap">
      <div v-if="channelOptions.length" class="studio-channel-bar studio-channel-bar-composer">
        <div class="studio-channel-bar-row">
          <label class="studio-select-field">
            <span class="studio-select-label">线路</span>
            <select v-model="selectedChannel" class="studio-model-select" @change="onChannelChange">
              <option v-for="ch in channelOptions" :key="ch.channel" :value="String(ch.channel)">
                {{ toAistarslabChannelDisplayTitle(ch.title) || `线路 ${ch.channel}` }}
              </option>
            </select>
          </label>
          <label class="studio-select-field">
            <span class="studio-select-label">模型</span>
            <select v-model="selectedModel" class="studio-model-select">
              <option
                v-for="m in modelsForSelectedChannel"
                :key="m.option_key || m.id"
                :value="m.model || m.id"
              >
                {{ toSeedanceDisplayLabel(m.label) }} · {{ modelPriceLabel(m) }}
              </option>
            </select>
          </label>
          <span class="studio-channel-tip">如多次失败，请尝试切换线路</span>
          <span class="dim studio-channel-tip-limits">
            参考上限 {{ channelRefLimits.images }}图 / {{ channelRefLimits.videos }}视频 / {{ channelRefLimits.audios }}音频
          </span>
        </div>
        <p v-if="activeChannelMeta?.description" class="studio-channel-hint dim">
          {{ toAistarslabChannelDisplayTitle(activeChannelMeta.description) }}
        </p>
      </div>
      <VideoStudioComposer
        ref="composerRef"
        aistarslab-mode
        :generating="generating"
        :dramas="dramas"
        :default-drama-id="filterDramaId"
        :fixed-config-id="aistarslabConfigId"
        :fixed-model="selectedModel"
        :duration-min="durationMin"
        :duration-max="durationMax"
        :credit-cost-flat="isPerSecondBilling ? null : selectedCreditCostFlat"
        :credit-cost-per-second="isPerSecondBilling ? selectedCreditCostPerSecond : null"
        :reference-video-multiplier="referenceVideoMultiplier"
        :ref-limits-override="channelRefLimits"
        drama-preference-scope="video-aistarslab"
        @generate="onGenerate"
      />
    </div>

    <SeedanceMaterialSpecModal :open="materialSpecOpen" @update:open="materialSpecOpen = $event" />

    <div v-if="detailItem" class="studio-detail-overlay" @click.self="detailItem = null">
      <div class="studio-detail card">
        <div class="studio-detail-head">
          <div>
            <h3>视频详情 #{{ detailItem.id }}</h3>
            <p class="dim">{{ formatTime(detailItem.created_at) }} · {{ modelLabel(detailItem.model) }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="detailItem = null">关闭</button>
        </div>

        <div class="studio-detail-body">
          <div class="studio-detail-media" :class="cardRatioClass(detailItem)">
            <video
              v-if="playableUrl(detailItem)"
              :src="displayUrl(playableUrl(detailItem))"
              controls
              playsinline
              autoplay
              class="studio-detail-player"
            />
            <div v-else class="studio-detail-empty">
              {{ detailItem.error_msg || statusLabel(detailItem.status) }}
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
            <pre class="studio-detail-prompt">{{ detailItem.prompt || '—' }}</pre>
            <div class="studio-detail-actions">
              <button
                v-if="playableUrl(detailItem)"
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="detailDownloading"
                @click="downloadDetail"
              >
                {{ detailDownloading ? '下载中…' : '下载视频' }}
              </button>
              <button type="button" class="btn btn-sm" @click="reuseDetail">复用到输入框</button>
              <button
                v-if="isFailed(detailItem)"
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="generating"
                @click="retryItem(detailItem)"
              >
                {{ generating ? '提交中…' : '重新生成' }}
              </button>
              <button type="button" class="btn btn-sm" @click="copyPrompt(detailItem.prompt)">复制提示词</button>
            </div>
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
import { videoAPI } from '~/composables/useApi'
import StudioVideoCardMedia from '~/components/StudioVideoCardMedia.vue'
import { mediaDisplayUrl, videoPosterDisplayUrl } from '~/utils/media-url.js'
import { buildVideoDownloadFilename, downloadMediaFile } from '~/utils/download-media.js'
import VideoStudioComposer from '~/components/VideoStudioComposer.vue'
import SeedanceMaterialSpecModal from '~/components/SeedanceMaterialSpecModal.vue'
import { toAistarslabChannelDisplayTitle, toSeedanceDisplayLabel } from '~/utils/seedance-display.js'
import { formatVideoGenerationError } from '~/utils/image-generation-error.js'
import { sanitizeUserFacingProviderError } from '~/utils/provider-error-sanitize.js'
import {
  resolveAistarslabSelection,
  setSavedAistarslabSelection,
} from '~/utils/studio-aistarslab-preference.js'
import {
  buildVideoLedgerCacheKey,
  restoreVideoLedgerCache,
  persistVideoLedgerCache,
  loadVideoDramasLite,
  finalizeVideoLedgerItems,
} from '~/utils/video-studio-page.js'

const VIDEO_LEDGER_CACHE_PREFIX = 'studio-video-ledger-aistarslab-v1'

const DEFAULT_MODEL = 'seedance-2.0-fast'
const DEFAULT_CHANNEL = '50'

const DEFAULT_MODELS = [
  {
    id: DEFAULT_MODEL,
    channel: DEFAULT_CHANNEL,
    label: 'Seedance 2.0 Fast VIP',
    credit_cost_flat: 550,
    config_id: null,
    duration_min: 4,
    duration_max: 15,
    duration_default: 15,
  },
  {
    id: 'seedance-2.0',
    channel: DEFAULT_CHANNEL,
    label: 'Seedance 2.0 VIP',
    credit_cost_flat: 650,
    config_id: null,
    duration_min: 4,
    duration_max: 15,
    duration_default: 15,
  },
]

const route = useRoute()

const loading = ref(false)
const loadingMore = ref(false)
const generating = ref(false)
const aistarslabModels = ref([])
const channelOptions = ref([])
const aistarslabApiKeyConfigured = ref(true)
const referenceVideoMultiplier = ref(1.5)
const selectedModel = ref(DEFAULT_MODEL)
const selectedChannel = ref(DEFAULT_CHANNEL)
const items = ref([])
const dramas = ref([])
const stats = ref({ total: 0, completed: 0, processing: 0, failed: 0 })
const pagination = ref({ limit: 30, offset: 0, total: 0, has_more: false })
const filterDramaId = ref(String(route.query.drama_id || ''))
const filterStatus = ref('all')
const viewScope = ref('mine')
const detailItem = ref(null)
const detailDownloading = ref(false)
const composerRef = ref(null)
const feedRef = ref(null)
const materialSpecOpen = ref(false)
let pollTimer = null

function videoLedgerCacheKey() {
  return buildVideoLedgerCacheKey(VIDEO_LEDGER_CACHE_PREFIX, [
    viewScope.value,
    filterDramaId.value || 'all',
    filterStatus.value,
    selectedChannel.value || 'all',
  ])
}

function ensureDramasLoaded() {
  if (!dramas.value.length) void loadVideoDramasLite(dramas)
}
let selectionReady = false

const statusTabs = [
  { id: 'all', label: '全部' },
  { id: 'completed', label: '已完成' },
  { id: 'processing', label: '生成中' },
  { id: 'failed', label: '失败' },
]

const hasActiveTasks = computed(() =>
  items.value.some(item => item.status === 'processing' || item.status === 'pending'),
)

const displayModels = computed(() =>
  aistarslabModels.value.length ? aistarslabModels.value : DEFAULT_MODELS,
)

const modelsForSelectedChannel = computed(() =>
  displayModels.value.filter(item => String(item.channel || DEFAULT_CHANNEL) === String(selectedChannel.value)),
)

const activeModelOption = computed(() =>
  modelsForSelectedChannel.value.find(item => String(item.model || item.id) === String(selectedModel.value))
    || modelsForSelectedChannel.value[0]
    || null,
)

const aistarslabConfigId = computed(() =>
  activeModelOption.value?.config_id ?? displayModels.value[0]?.config_id ?? null,
)

const activeChannelMeta = computed(() =>
  channelOptions.value.find(item => item.channel === selectedChannel.value) || null,
)

const channelRefLimits = computed(() => ({
  images: Number.isFinite(Number(activeChannelMeta.value?.max_images))
    ? Number(activeChannelMeta.value.max_images)
    : 9,
  videos: Number.isFinite(Number(activeChannelMeta.value?.max_videos))
    ? Number(activeChannelMeta.value.max_videos)
    : 3,
  audios: Number.isFinite(Number(activeChannelMeta.value?.max_audios))
    ? Number(activeChannelMeta.value.max_audios)
    : 3,
}))

const durationMin = computed(() => activeChannelMeta.value?.seconds_min ?? 4)
const durationMax = computed(() => activeChannelMeta.value?.seconds_max ?? 15)

const isPerSecondBilling = computed(() => {
  const model = activeModelOption.value
  const unit = String(model?.billing_unit || '').toLowerCase()
  if (unit === 'per_second' || unit === 'second') return true
  if (unit === 'flat') return false
  return !!(model?.credit_cost_per_second || model?.credits_per_second)
    && !(model?.credit_cost_flat || model?.fixed_total_credits)
})

const selectedCreditCostFlat = computed(() => {
  if (isPerSecondBilling.value) return null
  const model = activeModelOption.value
  const cost = model?.credit_cost_flat ?? model?.credit_cost
  return cost != null && Number.isFinite(Number(cost)) ? Number(cost) : 750
})

const selectedCreditCostPerSecond = computed(() => {
  if (!isPerSecondBilling.value) return null
  const model = activeModelOption.value
  const cost = model?.credit_cost_per_second ?? model?.credit_cost
  return cost != null && Number.isFinite(Number(cost)) ? Number(cost) : null
})

function modelPriceLabel(m) {
  const unit = String(m?.billing_unit || '').toLowerCase()
  const perSec = m?.credit_cost_per_second
  if (unit === 'per_second' || unit === 'second' || (perSec != null && !(m?.credit_cost_flat || m?.fixed_total_credits))) {
    const rate = perSec ?? m?.credit_cost
    return rate != null ? `${rate} 积分/秒` : '按秒计费'
  }
  const flat = m?.credit_cost_flat ?? m?.credit_cost
  return flat != null ? `${flat} 积分` : '—'
}

function onChannelChange() {
  const models = modelsForSelectedChannel.value
  if (!models.length) return
  if (!models.some(item => String(item.model || item.id) === String(selectedModel.value))) {
    selectedModel.value = models[0]?.model || models[0]?.id || DEFAULT_MODEL
  }
}

watch(channelOptions, () => {
  if (channelOptions.value.length && !channelOptions.value.some(item => String(item.channel) === String(selectedChannel.value))) {
    selectedChannel.value = String(channelOptions.value[0]?.channel || DEFAULT_CHANNEL)
    onChannelChange()
  }
})

watch([selectedChannel, selectedModel], ([channel, model]) => {
  if (!selectionReady || !channel || !model) return
  setSavedAistarslabSelection({ channel, model })
})

function applyDefaultAistarslabSelection(res) {
  const channels = res?.channels || []
  const models = res?.models?.length ? res.models : aistarslabModels.value
  const defaultChannel = channels.find(item => item.default_option)?.channel
    || res?.default_channel
    || DEFAULT_CHANNEL
  selectedChannel.value = String(defaultChannel)

  const channelModels = models.filter(item => String(item.channel || defaultChannel) === String(defaultChannel))
  const defaultModel = channelModels.find(item => item.default_option)?.model
    || channelModels.find(item => item.model === res?.default_model)?.model
    || res?.default_model
    || channelModels[0]?.model
    || channelModels[0]?.id
    || DEFAULT_MODEL
  selectedModel.value = defaultModel
}

function applyAistarslabSelection(res) {
  const channels = res?.channels || channelOptions.value
  const models = res?.models?.length
    ? res.models
    : (aistarslabModels.value.length ? aistarslabModels.value : DEFAULT_MODELS)

  selectionReady = false
  const saved = resolveAistarslabSelection({
    channels,
    models,
    defaultChannel: DEFAULT_CHANNEL,
    defaultModel: DEFAULT_MODEL,
  })
  if (saved) {
    selectedChannel.value = saved.channel
    selectedModel.value = saved.model
  } else {
    applyDefaultAistarslabSelection(res)
  }
  selectionReady = true
}

function modelLabel(modelId) {
  const label = displayModels.value.find(item => item.model === modelId || item.id === modelId)?.label
    || String(modelId || '').replace(/^seedance-2\.0-/i, 'Seedance 2.0 ')
  return toSeedanceDisplayLabel(label)
}

function statsForTab(id) {
  if (id === 'all') return stats.value.total
  if (id === 'completed') return stats.value.completed
  if (id === 'processing') return stats.value.processing
  if (id === 'failed') return stats.value.failed
  return 0
}

function normalizeItem(row) {
  return {
    id: row.id,
    storyboard_id: row.storyboard_id,
    drama_id: row.drama_id,
    provider: row.provider,
    model: row.model,
    style: row.style || '',
    prompt: row.prompt || '',
    status: row.status || 'pending',
    error_msg: sanitizeUserFacingProviderError(row.error_msg || row.errorMsg || ''),
    duration: row.duration,
    aspect_ratio: row.aspect_ratio || row.aspectRatio || '9:16',
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
  }
}

function playableUrl(item) {
  return item?.display_video_url || item?.local_path || item?.video_url || ''
}

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
}

function isProcessing(item) {
  return item.status === 'processing' || item.status === 'pending'
}

function isFailed(item) {
  return item.status === 'failed'
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
    aspect_ratio: item?.aspect_ratio || item?.aspectRatio || '2:3',
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
  if (item.model) selectedModel.value = item.model
  if (item.style) selectedChannel.value = item.style
  await composerRef.value?.loadFromItem(item)
  detailItem.value = null
  await nextTick()
  await onGenerate(buildPayloadFromItem(item))
}

function statusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'processing') return '生成中'
  if (status === 'failed') return '失败'
  if (status === 'pending') return '排队中'
  return status || '未知'
}

function statusTagClass(status) {
  if (status === 'completed') return 'tag-success'
  if (status === 'processing' || status === 'pending') return 'tag-accent'
  if (status === 'failed') return 'tag-danger'
  return ''
}

function cardRatioClass(item) {
  const ratio = item?.aspect_ratio || '2:3'
  if (ratio === '3:2') return 'ratio-landscape'
  if (ratio === '1:1') return 'ratio-square'
  return 'ratio-portrait'
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
  if (detailItem.value.model) selectedModel.value = detailItem.value.model
  if (detailItem.value.style) selectedChannel.value = detailItem.value.style
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
    await downloadMediaFile(null, videoDownloadName(item), { item, videoGenerationId: item.id })
    toast.success('开始下载')
  } catch (e) {
    toast.error(e?.message || '下载失败')
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

function buildQuery(offset = 0, limit = pagination.value.limit) {
  return {
    drama_id: filterDramaId.value ? Number(filterDramaId.value) : undefined,
    status: filterStatus.value === 'all' ? undefined : filterStatus.value,
    limit,
    offset,
    mine_only: viewScope.value === 'mine',
    provider: 'aistarslab',
    models: [...new Set(displayModels.value.map(item => item.model || item.id).filter(Boolean))].join(','),
  }
}

function setViewScope(scope) {
  if (viewScope.value === scope) return
  viewScope.value = scope
  reload()
}

async function loadLedger({ append = false, offset = 0, refreshVisible = false } = {}) {
  const pageLimit = refreshVisible
    ? Math.min(Math.max(items.value.length, pagination.value.limit), 100)
    : pagination.value.limit
  const pageOffset = refreshVisible ? 0 : offset
  const res = await videoAPI.ledger(buildQuery(pageOffset, pageLimit))
  const nextItems = (res?.items || []).map(normalizeItem)
  items.value = append ? [...items.value, ...nextItems] : nextItems
  stats.value = res?.stats || stats.value
  pagination.value = res?.pagination || pagination.value

  finalizeVideoLedgerItems(nextItems)
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
  await loadLedger({ refreshVisible: true })
}

async function reload() {
  if (!items.value.length) loading.value = true
  try {
    await Promise.all([
      loadLedger({ offset: 0 }),
      loadAistarslabOptions(),
    ])
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!pagination.value.has_more || loadingMore.value) return
  loadingMore.value = true
  try {
    const nextOffset = pagination.value.offset + pagination.value.limit
    await loadLedger({ append: true, offset: nextOffset })
  } finally {
    loadingMore.value = false
  }
}

function setStatus(status) {
  filterStatus.value = status
  reload()
}

async function loadAistarslabOptions() {
  try {
    const res = await videoAPI.aistarslabOptions()
    aistarslabModels.value = (res?.models || []).map(item => {
      const perSecond = String(item.billing_unit || '').toLowerCase() === 'per_second'
        || String(item.billing_unit || '').toLowerCase() === 'second'
        || (item.credit_cost_per_second != null && item.credit_cost_flat == null && !item.fixed_total_credits)
      return {
        ...item,
        billing_unit: perSecond ? 'per_second' : (item.billing_unit || 'flat'),
        credit_cost_flat: perSecond ? null : (item.credit_cost_flat ?? item.credit_cost ?? 750),
        credit_cost_per_second: perSecond
          ? (item.credit_cost_per_second ?? item.credit_cost ?? null)
          : (item.credit_cost_per_second ?? null),
      }
    })
    channelOptions.value = res?.channels || []
    aistarslabApiKeyConfigured.value = res?.api_key_configured !== false
    const mult = Number(res?.reference_video_multiplier)
    referenceVideoMultiplier.value = Number.isFinite(mult) && mult > 1 ? mult : 1.5
    applyAistarslabSelection(res)
  } catch {
    aistarslabModels.value = []
    channelOptions.value = []
    aistarslabApiKeyConfigured.value = false
    applyAistarslabSelection({ channels: [], models: DEFAULT_MODELS })
  }
}

async function onGenerate(payload) {
  if (generating.value) {
    toast.warning('正在提交中，请稍候')
    return
  }
  if (!selectedModel.value) {
    toast.error('请选择模型')
    return
  }
  if (!aistarslabConfigId.value) {
    await loadAistarslabOptions()
  }
  if (!aistarslabConfigId.value) {
    toast.error('未配置 S VIP 视频服务，请联系管理员')
    return
  }
  if (!aistarslabApiKeyConfigured.value) {
    toast.error('视频 API Key 未配置，请管理员在「设置 → AI 配置」中填写 S VIP 通道的 API Key')
    return
  }
  generating.value = true
  try {
    const generation = await videoAPI.generate({
      ...payload,
      aistarslab: true,
      aistarslab_channel: selectedChannel.value,
      config_id: aistarslabConfigId.value,
      model: selectedModel.value,
    })
    toast.success('视频任务已提交')
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
  const cached = restoreVideoLedgerCache(videoLedgerCacheKey())
  if (cached?.items?.length) {
    items.value = cached.items.map(normalizeItem)
    stats.value = cached.stats || stats.value
    pagination.value = cached.pagination || pagination.value
    finalizeVideoLedgerItems(items.value)
  } else {
    loading.value = true
  }
  void loadAistarslabOptions()
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

.studio-guide-line {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-1);
}

.studio-spec-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: inherit;
  line-height: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.studio-spec-link:hover {
  opacity: 0.85;
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

.studio-channel-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 24px 12px;
  flex-shrink: 0;
}

.studio-channel-bar-composer {
  padding: 10px 24px 8px;
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
  border-top: 1px solid var(--border);
}

.studio-channel-bar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.studio-select-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-2);
}

.studio-select-label {
  white-space: nowrap;
}

.studio-model-select {
  min-width: 180px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-0);
  color: var(--text-1);
  font-size: 12px;
}

.studio-channel-tip {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #4c7dff);
  white-space: nowrap;
}

.studio-channel-hint {
  margin: 0;
  font-size: 12px;
  max-width: 100%;
  line-height: 1.45;
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
  height: 180px;
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

.studio-card-media {
  position: relative;
  background: #000;
  overflow: hidden;
}

.ratio-portrait { aspect-ratio: 2 / 3; }
.ratio-landscape { aspect-ratio: 3 / 2; }
.ratio-square { aspect-ratio: 1 / 1; }

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

.studio-card-download-link,
.studio-card-retry-link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  font-size: 11px;
  cursor: pointer;
}

.studio-card-download-link {
  color: var(--accent);
}

.studio-card-retry-link {
  color: var(--danger, #e5484d);
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
  .studio-feed,
  .studio-channel-bar { padding-left: 16px; padding-right: 16px; }
  .studio-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .studio-detail-body { grid-template-columns: 1fr; }
}
</style>
