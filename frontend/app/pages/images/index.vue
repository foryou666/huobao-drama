<template>
  <div class="studio-page">
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
        <select v-model="filterDramaId" class="studio-filter-select" @change="reload">
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
      <div v-if="loading && !items.length" class="studio-empty dim">加载中…</div>
      <div v-else-if="!items.length" class="studio-empty card">
        <p>还没有图片，在底部输入描述并点击「生成图片」</p>
      </div>

      <div v-else class="studio-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="studio-card"
          @click="openDetail(item)"
        >
          <div class="studio-card-media" :class="cardRatioClass(item)">
            <img
              v-if="playableUrl(item)"
              :src="displayUrl(playableUrl(item))"
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
            <div class="studio-card-status">
              <span class="tag" :class="statusTagClass(item.status)">{{ statusLabel(item.status) }}</span>
            </div>
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
    />

    <div v-if="detailItem" class="studio-detail-overlay" @click.self="detailItem = null">
      <div class="studio-detail card">
        <div class="studio-detail-head">
          <div>
            <h3>图片详情 #{{ detailItem.id }}</h3>
            <p class="dim">{{ formatTime(detailItem.created_at) }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="detailItem = null">关闭</button>
        </div>

        <div class="studio-detail-body">
          <div class="studio-detail-media" :class="cardRatioClass(detailItem)">
            <img
              v-if="playableUrl(detailItem)"
              :src="displayUrl(playableUrl(detailItem))"
              alt=""
              class="studio-detail-image"
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
                {{ detailDownloading ? '下载中…' : '下载图片' }}
              </button>
              <button type="button" class="btn btn-sm" @click="reuseDetail">复用到输入框</button>
              <button
                v-if="canAttachToEntity(detailItem)"
                type="button"
                class="btn btn-sm btn-primary"
                @click="openAttachModal(detailItem)"
              >
                添加到资产
              </button>
              <button type="button" class="btn btn-sm" @click="copyPrompt(detailItem.prompt)">复制提示词</button>
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
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { dramaAPI, imageAPI } from '~/composables/useApi'
import { mediaDisplayUrl, prefetchMediaUrls } from '~/utils/media-url.js'
import { downloadMediaFile } from '~/utils/download-media.js'
import ImageStudioComposer from '~/components/ImageStudioComposer.vue'
import AddGeneratedImageToEntityModal from '~/components/AddGeneratedImageToEntityModal.vue'
import { formatImageGenerationError } from '~/utils/image-generation-error.js'
import { sanitizeUserFacingProviderError } from '~/utils/provider-error-sanitize.js'

const route = useRoute()

const loading = ref(false)
const loadingMore = ref(false)
const generating = ref(false)
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
const attachModalOpen = ref(false)
const attachImageItem = ref(null)
let pollTimer = null

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
    aspect_ratio: row.aspect_ratio || row.aspectRatio || '9:16',
    reference_images: row.reference_images || [],
    is_manual: !!row.is_manual,
    created_at: row.created_at || row.createdAt || '',
    display_image_url: row.display_image_url || '',
    image_url: row.image_url || row.imageUrl || '',
    local_path: row.local_path || row.localPath || '',
    drama_title: row.drama_title || '',
    episode_id: row.episode_id,
    episode_number: row.episode_number,
    storyboard_title: row.storyboard_title || '',
    storyboard_number: row.storyboard_number,
    storyboard_exists: row.storyboard_exists !== false,
  }
}

function playableUrl(item) {
  return item?.display_image_url || item?.local_path || item?.image_url || ''
}

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
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
  const ratio = item?.aspect_ratio || '9:16'
  return ratio === '16:9' ? 'ratio-landscape' : 'ratio-portrait'
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

async function copyPrompt(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''))
    toast.success('已复制提示词')
  } catch {
    toast.error('复制失败')
  }
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

function buildQuery(offset = 0, limit = pagination.value.limit) {
  return {
    drama_id: filterDramaId.value ? Number(filterDramaId.value) : undefined,
    status: filterStatus.value === 'all' ? undefined : filterStatus.value,
    limit,
    offset,
    mine_only: viewScope.value === 'mine',
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

  const mediaPaths = nextItems.flatMap(item => [
    item.local_path,
    ...(item.reference_images || []).map(ref => ref.path),
  ]).filter(Boolean)
  await prefetchMediaUrls(mediaPaths)
}

async function refreshLedger() {
  if (!items.value.length) {
    await loadLedger({ offset: 0 })
    return
  }
  await loadLedger({ refreshVisible: true })
}

async function reload() {
  loading.value = true
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
  reload()
}

async function onGenerate(payload) {
  generating.value = true
  const startedAt = Date.now()
  try {
    const generation = await imageAPI.generate(payload)
    toast.success('图片任务已提交')
    filterStatus.value = 'all'
    await reload()
    void pollGeneration(generation?.id)
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

onMounted(async () => {
  const dramaRes = await dramaAPI.list()
  dramas.value = dramaRes?.items || dramaRes || []
  await reload()
  startPolling()
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
    radial-gradient(circle at top right, rgba(124, 77, 255, 0.08), transparent 40%),
    radial-gradient(circle at top left, rgba(76, 125, 255, 0.08), transparent 35%),
    var(--bg-base);
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

.studio-detail-image {
  width: 100%;
  display: block;
  object-fit: contain;
  max-height: 70vh;
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
