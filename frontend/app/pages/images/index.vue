<template>
  <div
    class="studio-page"
    :class="{ 'is-dragover': pageDragOver }"
    @dragenter.prevent="onPageDragEnter"
    @dragover.prevent="onPageDragOver"
    @dragleave.prevent="onPageDragLeave"
    @drop.prevent="onPageDrop"
  >
    <header class="studio-header">
      <div class="studio-header-copy">
        <h1 class="studio-title">图片生成</h1>
        <p class="studio-desc">支持文生图与图生图，可上传多张参考图；关联项目后可用 @ 引用角色/场景素材</p>
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
        <article v-for="n in 8" :key="n" class="studio-card studio-card-skeleton">
          <div class="studio-card-media ratio-portrait studio-skeleton-block" />
          <div class="studio-card-body">
            <div class="studio-skeleton-line studio-skeleton-line-wide" />
            <div class="studio-skeleton-line studio-skeleton-line-narrow" />
          </div>
        </article>
      </div>
      <div v-else-if="!items.length" class="studio-empty card">
        <p>还没有图片，在底部输入描述并点击「生成图片」</p>
      </div>

      <div v-else class="studio-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="studio-card"
          :class="{ 'studio-card-pinned': item.is_pinned }"
          @click="openDetail(item)"
        >
          <div class="studio-card-media" :class="cardRatioClass(item)">
            <img
              v-if="cardImageUrl(item)"
              :src="cardImageUrl(item)"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <div v-else-if="isProcessing(item)" class="studio-card-loading">
              <div class="studio-spinner" />
              <span>{{ statusLabel(item.status) }}</span>
            </div>
            <div v-else class="studio-card-fallback">
              <span>{{ statusLabel(item.status) }}</span>
              <p v-if="item.error_msg" class="studio-card-error">{{ item.error_msg }}</p>
            </div>

            <div v-if="item.reference_images?.length" class="studio-card-ref-badge">
              {{ item.reference_images.length }} 图
            </div>
            <div
              v-if="item.is_pinned"
              class="studio-card-pinned-badge"
              :class="{ 'with-ref': item.reference_images?.length }"
            >
              置顶
            </div>
            <div class="studio-card-status">
              <span class="tag" :class="statusTagClass(item.status)">{{ statusLabel(item.status) }}</span>
            </div>
            <button
              v-if="isAdmin && viewScope !== 'mine'"
              type="button"
              class="studio-card-pin"
              :class="{ active: item.is_pinned }"
              :title="item.is_pinned ? '取消置顶' : '置顶图片'"
              :disabled="pinningId === item.id"
              @click.stop="togglePin(item)"
            >
              {{ item.is_pinned ? '取消' : '置顶' }}
            </button>
            <button
              v-if="playableUrl(item)"
              type="button"
              class="studio-card-download"
              title="下载图片"
              @click.stop="downloadItem(item)"
            >
              ↓
            </button>
            <button
              v-if="canAttachToEntity(item)"
              type="button"
              class="studio-card-attach"
              title="添加到角色/场景/道具"
              @click.stop="openAttachModal(item)"
            >
              +
            </button>
          </div>

          <div class="studio-card-body">
            <p class="studio-card-prompt">{{ previewPrompt(item.prompt) }}</p>
            <div class="studio-card-meta">
              <span v-if="item.is_pinned" class="tag tag-accent">置顶</span>
              <span v-if="channelLabel(item)" class="tag tag-accent">{{ channelLabel(item) }}</span>
              <span class="mono dim">#{{ item.id }}</span>
              <span v-if="item.is_manual" class="tag">手动</span>
              <span v-if="item.drama_title" class="dim">{{ item.drama_title }}</span>
              <span v-if="!item.storyboard_exists && item.storyboard_id" class="tag tag-warn">分镜已删</span>
              <button
                v-if="playableUrl(item)"
                type="button"
                class="studio-card-download-link"
                @click.stop="downloadItem(item)"
              >
                下载
              </button>
            </div>
            <p v-if="operatorLabel(item)" class="studio-card-operator">操作人 {{ operatorLabel(item) }}</p>
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

    <AddGeneratedImageToEntityModal
      :open="attachModalOpen"
      :image-item="attachImageItem"
      :dramas="dramas"
      :default-drama-id="filterDramaId"
      @close="closeAttachModal"
      @success="onAttachSuccess"
    />

    <ImageStudioComposer
      ref="composerRef"
      :generating="generating"
      :dramas="dramas"
      :default-drama-id="filterDramaId"
      @generate="onGenerate"
      @need-dramas="ensureDramasLoaded"
    />

    <div v-if="detailItem" class="studio-detail-overlay" @click.self="detailItem = null">
      <div class="studio-detail card">
        <div class="studio-detail-head">
          <div>
            <h3>图片详情 #{{ detailItem.id }}</h3>
            <p class="dim">
              {{ formatTime(detailItem.created_at) }}
              <template v-if="channelLabel(detailItem)"> · {{ channelLabel(detailItem) }}</template>
            </p>
            <p v-if="operatorLabel(detailItem)" class="studio-detail-operator">操作人 {{ operatorLabel(detailItem) }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="detailItem = null">关闭</button>
        </div>

        <div class="studio-detail-body">
          <div class="studio-detail-media" :class="cardRatioClass(detailItem)">
            <button
              v-if="playableUrl(detailItem)"
              type="button"
              class="studio-detail-image-btn"
              title="点击查看原图"
              @click="openImageViewer(displayUrl(playableUrl(detailItem)), `生成结果 #${detailItem.id}`)"
            >
              <img
                :src="displayUrl(playableUrl(detailItem))"
                alt=""
                class="studio-detail-image"
              />
            </button>
            <div v-else class="studio-detail-empty">
              {{ detailItem.error_msg || statusLabel(detailItem.status) }}
            </div>
          </div>

          <div class="studio-detail-side">
            <div v-if="detailItem.reference_images?.length" class="studio-detail-refs-wrap">
              <div class="studio-detail-refs-head">
                <span class="studio-detail-refs-title">参考图</span>
                <span class="dim studio-detail-refs-hint">点击放大查看原图</span>
              </div>
              <div class="studio-detail-refs">
                <button
                  v-for="(ref, idx) in detailItem.reference_images"
                  :key="ref.path + idx"
                  type="button"
                  class="studio-detail-ref-btn"
                  :title="`参考图 ${idx + 1}`"
                  @click="openImageViewer(refImageUrl(ref), `参考图 ${idx + 1}`)"
                >
                  <img :src="refThumbUrl(ref)" alt="" />
                </button>
              </div>
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
                {{ detailDownloading ? '下载中…' : '下载图片' }}
              </button>
              <button type="button" class="btn btn-sm" @click="reuseDetail">复用到输入框</button>
              <button
                v-if="playableUrl(detailItem)"
                type="button"
                class="btn btn-sm btn-primary"
                @click="referenceModifyDetail"
              >
                引用修改
              </button>
              <button
                v-if="canAttachToEntity(detailItem)"
                type="button"
                class="btn btn-sm btn-primary"
                @click="openAttachModal(detailItem)"
              >
                添加到资产
              </button>
              <button type="button" class="btn btn-sm" @click="copyPrompt(detailItem.prompt)">复制提示词</button>
              <button
                v-if="isAdmin && viewScope !== 'mine'"
                type="button"
                class="btn btn-sm"
                :disabled="pinningId === detailItem.id"
                @click="togglePin(detailItem)"
              >
                {{ detailItem.is_pinned ? '取消置顶' : '置顶图片' }}
              </button>
              <NuxtLink
                v-if="episodeLink(detailItem)"
                :to="episodeLink(detailItem)"
                class="btn btn-sm"
              >
                打开分镜工作台
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="pageDragOver" class="studio-drop-overlay" aria-hidden="true">
      <div class="studio-drop-overlay-card card">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
        </svg>
        <p>松开鼠标上传参考图</p>
        <span class="dim">支持 PNG / JPG / WebP 等图片格式</span>
      </div>
    </div>

    <div
      v-if="imageViewer.open && imageViewer.src"
      class="studio-image-viewer-overlay"
      @click.self="closeImageViewer"
    >
      <div class="studio-image-viewer card">
        <div class="studio-image-viewer-head">
          <span class="studio-image-viewer-title">{{ imageViewer.title || '图片预览' }}</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="closeImageViewer">关闭</button>
        </div>
        <div class="studio-image-viewer-body">
          <img :src="imageViewer.src" :alt="imageViewer.title || '图片预览'" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { extractImageFilesFromDataTransfer, isFileDragEvent } from '~/utils/clipboard-image.js'
import { toast } from 'vue-sonner'
import { dramaAPI, imageAPI } from '~/composables/useApi'
import { loadImageStudioCapabilities, getCachedImageStudioCapabilities, applyImageStudioCapabilitiesToComposer } from '~/composables/useImageStudioCapabilities'
import { useAuth } from '~/composables/useAuth'
import { cacheVersion, mediaDisplayUrl, mediaGridUrl, prefetchLedgerMedia, seedMediaUrlCacheFromImageLedgerItems } from '~/utils/media-url.js'
import { downloadMediaFile } from '~/utils/download-media.js'
import ImageStudioComposer from '~/components/ImageStudioComposer.vue'
import AddGeneratedImageToEntityModal from '~/components/AddGeneratedImageToEntityModal.vue'
import { formatImageGenerationError } from '~/utils/image-generation-error.js'
import { aspectRatioFromImageItem } from '~/utils/studio-image-aspect-preference.js'
import { studioImageModelLabel } from '~/utils/studio-image-model-preference.js'
import { sanitizeUserFacingProviderError } from '~/utils/provider-error-sanitize.js'
import { copyText } from '~/utils/copy-text.js'

const route = useRoute()
const { isAdmin } = useAuth()

const loading = ref(false)
const loadingMore = ref(false)
const generating = ref(false)
const items = ref([])
const dramas = ref([])
const dramasLoaded = ref(false)
const dramasLoading = ref(false)
const stats = ref({ total: 0, completed: 0, processing: 0, failed: 0 })
const pagination = ref({ limit: 30, offset: 0, total: 0, has_more: false })
const filterDramaId = ref(String(route.query.drama_id || ''))
const filterStatus = ref('all')
const viewScope = ref('mine')
const filterUserId = ref(null)
const userOptions = ref([])
const detailItem = ref(null)
const detailDownloading = ref(false)
const imageViewer = ref({ open: false, src: '', title: '' })
const composerRef = ref(null)
const feedRef = ref(null)
const attachModalOpen = ref(false)
const attachImageItem = ref(null)
const pinningId = ref(null)
const pageDragDepth = ref(0)
const pageDragOver = computed(() => pageDragDepth.value > 0)
let pollTimer = null
const LEDGER_CACHE_PREFIX = 'studio-image-ledger-v2'
const DRAMA_CACHE_KEY = 'studio-image-dramas-lite-v1'

function ledgerCacheKey() {
  return `${LEDGER_CACHE_PREFIX}:${viewScope.value}:${filterDramaId.value || 'all'}:${filterStatus.value}`
}

function restoreLedgerCache() {
  try {
    const raw = sessionStorage.getItem(ledgerCacheKey())
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items) || !parsed.items.length) return false
    items.value = parsed.items.map(normalizeItem)
    stats.value = parsed.stats || stats.value
    pagination.value = parsed.pagination || pagination.value
    seedMediaUrlCacheFromImageLedgerItems(items.value)
    return true
  } catch {
    return false
  }
}

function persistLedgerCache() {
  try {
    sessionStorage.setItem(ledgerCacheKey(), JSON.stringify({
      items: items.value,
      stats: stats.value,
      pagination: pagination.value,
      savedAt: Date.now(),
    }))
  } catch {
    // ignore quota / private mode
  }
}

const statusTabs = [
  { id: 'all', label: '全部' },
  { id: 'completed', label: '已完成' },
  { id: 'processing', label: '生成中' },
  { id: 'failed', label: '失败' },
]

const hasActiveTasks = computed(() =>
  items.value.some(item => item.status === 'processing' || item.status === 'pending'),
)

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
    prompt: row.prompt || '',
    status: row.status || 'pending',
    error_msg: sanitizeUserFacingProviderError(row.error_msg || row.errorMsg || ''),
    size: row.size,
    aspect_ratio: aspectRatioFromImageItem(row),
    reference_images: row.reference_images || [],
    is_manual: !!row.is_manual,
    created_at: row.created_at || row.createdAt || '',
    display_image_url: row.display_image_url || '',
    display_thumbnail_url: row.display_thumbnail_url || '',
    thumb_path: row.thumb_path || '',
    image_url: row.image_url || row.imageUrl || '',
    local_path: row.local_path || row.localPath || '',
    drama_title: row.drama_title || '',
    episode_id: row.episode_id,
    episode_number: row.episode_number,
    storyboard_title: row.storyboard_title || '',
    storyboard_number: row.storyboard_number,
    storyboard_exists: row.storyboard_exists !== false,
    is_pinned: !!(row.is_pinned ?? row.isPinned),
    pinned_at: row.pinned_at || row.pinnedAt || null,
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
  return item?.display_image_url || item?.local_path || item?.image_url || ''
}

function cardImageUrl(item) {
  void cacheVersion.value
  const raw = item?.local_path || item?.image_url || ''
  const grid = mediaGridUrl(raw, item?.thumb_path)
  if (grid) return grid
  if (item?.display_thumbnail_url) return item.display_thumbnail_url
  if (item?.display_image_url) return item.display_image_url
  return mediaDisplayUrl(raw)
}

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
}

function refImageUrl(ref) {
  const raw = ref?.path || ref?.display_url || ''
  return displayUrl(raw)
}

function refThumbUrl(ref) {
  return ref?.display_url || displayUrl(ref?.path) || ''
}

function openImageViewer(src, title = '') {
  if (!src) return
  imageViewer.value = { open: true, src, title }
}

function closeImageViewer() {
  imageViewer.value = { open: false, src: '', title: '' }
}

function handleImageViewerKeydown(event) {
  if (event.key === 'Escape' && imageViewer.value.open) closeImageViewer()
}

function isProcessing(item) {
  return item.status === 'processing' || item.status === 'pending'
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
  const ratio = item?.aspect_ratio || '16:9'
  return ratio === '16:9' ? 'ratio-landscape' : 'ratio-portrait'
}

function channelLabel(item) {
  return studioImageModelLabel(item?.model, item?.provider)
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

function episodeLink(item) {
  if (!item?.storyboard_exists || !item.drama_id || item.episode_number == null) return null
  return `/drama/${item.drama_id}/episode/${item.episode_number}`
}

function canAttachToEntity(item) {
  return item?.status === 'completed' && !!playableUrl(item)
}

function openAttachModal(item) {
  if (!canAttachToEntity(item)) return
  void ensureDramasLoaded()
  attachImageItem.value = item
  attachModalOpen.value = true
}

function closeAttachModal() {
  attachModalOpen.value = false
  attachImageItem.value = null
}

function onAttachSuccess() {
  closeAttachModal()
}

function openDetail(item) {
  detailItem.value = item
}

function reuseDetail() {
  if (!detailItem.value) return
  composerRef.value?.loadFromItem(detailItem.value)
  detailItem.value = null
  nextTick(() => {
    feedRef.value?.scrollTo({ top: feedRef.value.scrollHeight, behavior: 'smooth' })
  })
  toast.success('已填入输入框，可修改后重新生成')
}

function referenceModifyDetail() {
  if (!detailItem.value) return
  const ok = composerRef.value?.referenceModifyFromItem(detailItem.value)
  if (!ok) {
    toast.warning('当前图片不可用，无法引用')
    return
  }
  detailItem.value = null
  nextTick(() => {
    feedRef.value?.scrollTo({ top: feedRef.value.scrollHeight, behavior: 'smooth' })
  })
  toast.success('已引用到输入框，请输入修改描述后生成')
}

async function copyPrompt(text) {
  const ok = await copyText(text)
  if (ok) toast.success('已复制提示词')
  else toast.error('复制失败')
}

function imageDownloadName(item) {
  const parts = []
  if (item?.drama_title) parts.push(String(item.drama_title).slice(0, 20))
  if (item?.episode_number != null) parts.push(`第${item.episode_number}集`)
  if (item?.storyboard_number != null) parts.push(`镜头${item.storyboard_number}`)
  if (item?.id) parts.push(`#${item.id}`)
  const base = parts.join('_') || 'image'
  return `${base.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_')}.png`
}

async function downloadItem(item) {
  const raw = playableUrl(item)
  if (!raw) return
  try {
    await downloadMediaFile(raw, imageDownloadName(item).replace(/\.mp4$/i, '.png'), { item })
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

async function togglePin(item) {
  if (!item?.id || pinningId.value === item.id) return
  pinningId.value = item.id
  try {
    if (item.is_pinned) {
      await imageAPI.unpin(item.id)
      toast.success('已取消置顶')
    } else {
      await imageAPI.pin(item.id)
      toast.success('已置顶')
    }
    await reload()
    if (detailItem.value?.id === item.id) {
      const refreshed = items.value.find(row => row.id === item.id)
      if (refreshed) detailItem.value = refreshed
    }
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    pinningId.value = null
  }
}

function buildQuery(offset = 0, limit = pagination.value.limit) {
  return {
    drama_id: filterDramaId.value ? Number(filterDramaId.value) : undefined,
    status: filterStatus.value === 'all' ? undefined : filterStatus.value,
    limit,
    offset,
    mine_only: viewScope.value === 'mine',
    studio_only: true,
    user_id: viewScope.value === 'user' && filterUserId.value ? filterUserId.value : undefined,
  }
}

async function loadLedger({ append = false, offset = 0, refreshVisible = false } = {}) {
  const pageLimit = refreshVisible
    ? Math.min(Math.max(items.value.length, pagination.value.limit), 100)
    : pagination.value.limit
  const pageOffset = refreshVisible ? 0 : offset
  const res = await imageAPI.ledger(buildQuery(pageOffset, pageLimit))
  const nextItems = (res?.items || []).map(normalizeItem)
  items.value = append ? [...items.value, ...nextItems] : nextItems
  stats.value = res?.stats || stats.value
  pagination.value = res?.pagination || pagination.value

  seedMediaUrlCacheFromImageLedgerItems(nextItems)
  prefetchLedgerMedia(nextItems)
  persistLedgerCache()
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
    await loadLedger({ offset: 0 })
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

function setViewScope(scope) {
  if (viewScope.value === scope) return
  viewScope.value = scope
  if (scope !== 'user') {
    filterUserId.value = null
  }
  reload()
}

function onUserFilterChange() {
  if (filterUserId.value) {
    viewScope.value = 'user'
    reload()
    return
  }
  if (viewScope.value === 'user') {
    setViewScope('all')
  }
}

async function loadUserOptions() {
  try {
    const caps = await loadImageStudioCapabilities()
    applyUserOptionsFromCaps(caps)
  } catch {
    userOptions.value = []
  }
}

function applyUserOptionsFromCaps(caps) {
  userOptions.value = caps?.user_filter_options || []
}

function restoreDramasCache() {
  try {
    const raw = sessionStorage.getItem(DRAMA_CACHE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items) || !parsed.items.length) return false
    dramas.value = parsed.items
    dramasLoaded.value = true
    return true
  } catch {
    return false
  }
}

function persistDramasCache() {
  try {
    sessionStorage.setItem(DRAMA_CACHE_KEY, JSON.stringify({
      items: dramas.value,
      savedAt: Date.now(),
    }))
  } catch {
    // ignore
  }
}

async function refreshDramasInBackground() {
  try {
    const dramaRes = await dramaAPI.listLite({ pageSize: 200 })
    dramas.value = dramaRes?.items || []
    dramasLoaded.value = true
    persistDramasCache()
  } catch {
    // keep cached list
  }
}

async function ensureDramasLoaded() {
  if (dramasLoading.value) return
  if (dramasLoaded.value) {
    void refreshDramasInBackground()
    return
  }
  restoreDramasCache()
  if (dramasLoaded.value) {
    void refreshDramasInBackground()
    return
  }
  dramasLoading.value = true
  try {
    const dramaRes = await dramaAPI.listLite({ pageSize: 200 })
    dramas.value = dramaRes?.items || []
    dramasLoaded.value = true
    persistDramasCache()
  } catch {
    dramasLoaded.value = false
  } finally {
    dramasLoading.value = false
  }
}

function bumpStatsForStatus(status) {
  const next = { ...stats.value }
  next.total = (next.total || 0) + 1
  if (status === 'completed') next.completed = (next.completed || 0) + 1
  else if (status === 'failed') next.failed = (next.failed || 0) + 1
  else next.processing = (next.processing || 0) + 1
  stats.value = next
}

function prependSubmittedItem(generation) {
  if (!generation?.id) return
  const item = normalizeItem({
    ...generation,
    is_manual: true,
    status: generation.status || 'pending',
  })
  if (items.value.some(row => row.id === item.id)) return
  items.value = [item, ...items.value]
  bumpStatsForStatus(item.status)
  persistLedgerCache()
}

async function onGenerate(payload) {
  generating.value = true
  const startedAt = Date.now()
  try {
    const generation = await imageAPI.generate(payload)
    const items = Array.isArray(generation?.items) && generation.items.length
      ? generation.items
      : [generation]
    toast.success(items.length > 1 ? `已提交 ${items.length} 张图片任务` : '图片任务已提交')
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]) prependSubmittedItem(items[i])
    }
    await reload()
    for (const item of items) {
      void pollGeneration(item?.id)
    }
    startPolling()
  } catch (err) {
    toast.error(formatImageGenerationError(err?.message || '生成失败'))
  } finally {
    const elapsed = Date.now() - startedAt
    setTimeout(() => {
      generating.value = false
    }, Math.max(0, 1000 - elapsed))
  }
}

async function pollGeneration(generationId) {
  if (!generationId) return
  for (let i = 0; i < 120; i++) {
    await sleep(3000)
    try {
      const res = await imageAPI.get(generationId)
      await refreshLedger()
      if (res?.status === 'completed') {
        toast.success('图片生成完成')
        return
      }
      if (res?.status === 'failed') {
        toast.error(formatImageGenerationError(res?.error_msg || res?.errorMsg || '图片生成失败'))
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

function onPageDragEnter(event) {
  if (!isFileDragEvent(event)) return
  pageDragDepth.value += 1
}

function onPageDragOver(event) {
  if (!isFileDragEvent(event)) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onPageDragLeave(event) {
  if (!isFileDragEvent(event)) return
  pageDragDepth.value = Math.max(0, pageDragDepth.value - 1)
}

function onPageDrop(event) {
  pageDragDepth.value = 0
  const files = extractImageFilesFromDataTransfer(event.dataTransfer)
  if (!files.length) {
    toast.warning('请拖入图片文件')
    return
  }
  if (!composerRef.value?.uploadFiles) return
  composerRef.value.uploadFiles(files, { source: 'drop' })
  nextTick(() => {
    feedRef.value?.scrollTo({ top: feedRef.value.scrollHeight, behavior: 'smooth' })
  })
}

onMounted(() => {
  const cachedCaps = getCachedImageStudioCapabilities()
  if (cachedCaps) applyUserOptionsFromCaps(cachedCaps)
  restoreLedgerCache()
  void loadUserOptions()
  if (filterDramaId.value) void ensureDramasLoaded()
  reload().finally(() => startPolling())
  window.addEventListener('keydown', handleImageViewerKeydown)
})

onUnmounted(() => {
  stopPolling()
  window.removeEventListener('keydown', handleImageViewerKeydown)
})
</script>

<style scoped>
.studio-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background:
    radial-gradient(circle at top right, rgba(124, 77, 255, 0.08), transparent 40%),
    radial-gradient(circle at top left, rgba(76, 125, 255, 0.08), transparent 35%),
    var(--bg-base);
}

.studio-page.is-dragover {
  outline: 2px dashed rgba(76, 125, 255, 0.35);
  outline-offset: -6px;
}

.studio-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(12, 18, 28, 0.42);
  pointer-events: none;
}

.studio-drop-overlay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 36px;
  border: 1px dashed var(--accent);
  background: rgba(255, 255, 255, 0.96);
  color: var(--text-1);
  text-align: center;
}

.studio-drop-overlay-card p {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.studio-drop-overlay-card span {
  font-size: 12px;
}

.studio-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 12px;
  flex-shrink: 0;
}

.studio-title {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.studio-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-3);
}

.studio-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
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
  height: 180px;
}

.studio-empty {
  padding: 64px 24px;
  text-align: center;
  color: var(--text-3);
}

.studio-grid-skeleton {
  pointer-events: none;
}

.studio-card-skeleton {
  cursor: default;
}

.studio-card-skeleton:hover {
  transform: none;
  box-shadow: none;
}

.studio-skeleton-block {
  background: linear-gradient(
    90deg,
    var(--bg-2, rgba(255, 255, 255, 0.04)) 0%,
    var(--bg-3, rgba(255, 255, 255, 0.08)) 50%,
    var(--bg-2, rgba(255, 255, 255, 0.04)) 100%
  );
  background-size: 200% 100%;
  animation: studio-skeleton-shimmer 1.2s ease-in-out infinite;
}

.studio-skeleton-line {
  height: 10px;
  border-radius: 999px;
  margin-bottom: 8px;
  background: linear-gradient(
    90deg,
    var(--bg-2, rgba(255, 255, 255, 0.04)) 0%,
    var(--bg-3, rgba(255, 255, 255, 0.08)) 50%,
    var(--bg-2, rgba(255, 255, 255, 0.04)) 100%
  );
  background-size: 200% 100%;
  animation: studio-skeleton-shimmer 1.2s ease-in-out infinite;
}

.studio-skeleton-line-wide { width: 88%; }
.studio-skeleton-line-narrow { width: 52%; margin-bottom: 0; }

@keyframes studio-skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
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

.studio-card-pinned {
  border-color: rgba(255, 193, 7, 0.55);
  box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.2);
}

.studio-card-media {
  position: relative;
  background: #000;
  overflow: hidden;
}

.ratio-portrait { aspect-ratio: 9 / 16; }
.ratio-landscape { aspect-ratio: 16 / 9; }

.studio-card-media img {
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

.studio-card-pinned-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(255, 193, 7, 0.88);
  color: #1a1400;
  font-weight: 600;
}

.studio-card-pinned-badge.with-ref {
  top: 32px;
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
  opacity: 0.85;
}

.studio-card-pin {
  position: absolute;
  bottom: 8px;
  left: 8px;
  z-index: 2;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 999px;
  background: rgba(15, 20, 28, 0.72);
  color: #fff;
  font-size: 10px;
  line-height: 28px;
  cursor: pointer;
  opacity: 0.9;
}

.studio-card-pin.active {
  background: rgba(255, 193, 7, 0.9);
  color: #1a1400;
  font-weight: 600;
}

.studio-card-pin:disabled {
  opacity: 0.55;
  cursor: wait;
}

.studio-card-attach {
  position: absolute;
  bottom: 8px;
  right: 42px;
  z-index: 2;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: rgba(15, 20, 28, 0.72);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.85;
}

.studio-card-download-link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 11px;
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

.tag-warn {
  border-color: rgba(255, 167, 38, 0.35);
  color: #ffb74d;
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

.studio-detail-operator {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-2);
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

.studio-detail-image-btn {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
}

.studio-detail-image {
  width: 100%;
  display: block;
  object-fit: contain;
  max-height: 70vh;
}

.studio-detail-refs-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.studio-detail-refs-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.studio-detail-refs-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}

.studio-detail-refs-hint {
  font-size: 11px;
}

.studio-detail-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.studio-detail-ref-btn {
  width: 56px;
  height: 56px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-1);
  cursor: zoom-in;
  transition: border-color 0.15s, transform 0.15s;
}

.studio-detail-ref-btn:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.studio-detail-ref-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.studio-image-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.studio-image-viewer {
  width: min(960px, 100%);
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.studio-image-viewer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.studio-image-viewer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-0);
}

.studio-image-viewer-body {
  padding: 12px;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.studio-image-viewer-body img {
  max-width: 100%;
  max-height: 78vh;
  object-fit: contain;
  border-radius: 8px;
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
