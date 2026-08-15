<template>
  <div class="settings-scroll admin-image-records">
    <div class="settings-head">
      <h2 class="settings-title">生图记录</h2>
      <p class="settings-desc">
        管理员专属：查看图片生成流水及 dream5.0 pro 实际使用的即梦通道4账号。
        请勿在此页面对外截图。
      </p>
    </div>

    <section class="setup-panel card">
      <div class="records-filters">
        <select v-model="filterModel" class="input" @change="reload">
          <option value="">全部通道</option>
          <option value="dream5.0-pro">dream5.0 pro</option>
          <option value="gpt-image-2">Image 2</option>
        </select>
        <select v-model="filterStatus" class="input" @change="reload">
          <option value="">全部状态</option>
          <option value="completed">已完成</option>
          <option value="processing">生成中</option>
          <option value="failed">失败</option>
        </select>
        <input
          v-model="keyword"
          class="input records-keyword"
          type="search"
          placeholder="搜索提示词…"
          @keydown.enter="reload"
        />
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reload">
          {{ loading ? '加载中…' : '查询' }}
        </button>
      </div>

      <div v-if="loading && !items.length" class="dim records-empty">加载中…</div>
      <div v-else-if="!items.length" class="dim records-empty">暂无记录</div>
      <div v-else class="records-table-wrap">
        <table class="records-table">
          <thead>
            <tr>
              <th>预览</th>
              <th>ID</th>
              <th>时间</th>
              <th>通道</th>
              <th>即梦账号</th>
              <th>操作人</th>
              <th>状态</th>
              <th>提示词</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <button
                  v-if="thumbUrl(item)"
                  type="button"
                  class="records-thumb-btn"
                  title="点击查看大图"
                  @click="openViewer(item)"
                >
                  <img :src="thumbUrl(item)" alt="" class="records-thumb" loading="lazy" />
                </button>
                <div v-else class="records-thumb-empty dim">
                  {{ item.status === 'failed' ? '失败' : (item.status === 'completed' ? '无图' : '…') }}
                </div>
              </td>
              <td class="mono">#{{ item.id }}</td>
              <td class="dim">{{ formatTime(item.created_at) }}</td>
              <td>
                <span class="tag tag-accent">{{ channelLabel(item) }}</span>
              </td>
              <td>
                <span v-if="jimengAccountLabel(item)" class="mono">{{ jimengAccountLabel(item) }}</span>
                <span v-else class="dim">—</span>
              </td>
              <td>{{ operatorLabel(item) || '—' }}</td>
              <td>
                <span class="tag" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
              </td>
              <td class="records-prompt" :title="item.prompt">{{ previewPrompt(item.prompt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pagination.has_more" class="records-more">
        <button type="button" class="btn btn-sm" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>
      <p class="dim records-stats">共 {{ pagination.total || 0 }} 条</p>
    </section>

    <div
      v-if="viewer.open && viewer.src"
      class="records-viewer-overlay"
      @click.self="closeViewer"
    >
      <div class="records-viewer card">
        <div class="records-viewer-head">
          <span>{{ viewer.title }}</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="closeViewer">关闭</button>
        </div>
        <img :src="viewer.src" alt="" class="records-viewer-img" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { imageAPI } from '~/composables/useApi'
import { mediaDisplayUrl, mediaGridUrl } from '~/utils/media-url.js'
import { studioImageModelLabel } from '~/utils/studio-image-model-preference.js'

const loading = ref(false)
const loadingMore = ref(false)
const items = ref([])
const filterModel = ref('dream5.0-pro')
const filterStatus = ref('')
const keyword = ref('')
const pagination = ref({ limit: 40, offset: 0, total: 0, has_more: false })
const viewer = ref({ open: false, src: '', title: '' })

function rawImagePath(item) {
  return item?.local_path || item?.image_url || item?.display_image_url || ''
}

function thumbUrl(item) {
  const raw = rawImagePath(item)
  if (!raw && !item?.display_thumbnail_url && !item?.thumb_path) return ''
  const grid = mediaGridUrl(raw, item?.thumb_path)
  if (grid) return grid
  if (item?.display_thumbnail_url) return item.display_thumbnail_url
  if (!raw) return ''
  return mediaDisplayUrl(raw)
}

function fullImageUrl(item) {
  const raw = rawImagePath(item)
  if (!raw) return thumbUrl(item)
  return mediaDisplayUrl(raw) || thumbUrl(item)
}

function openViewer(item) {
  const src = fullImageUrl(item)
  if (!src) return
  viewer.value = {
    open: true,
    src,
    title: `生成结果 #${item.id}`,
  }
}

function closeViewer() {
  viewer.value = { open: false, src: '', title: '' }
}

function channelLabel(item) {
  return studioImageModelLabel(item?.model, item?.provider) || item?.model || '—'
}

function jimengAccountLabel(item) {
  const label = String(item?.jimeng_session_label || '').trim()
  const masked = String(item?.jimeng_session_masked || '').trim()
  if (label && masked) return `${label}（${masked}）`
  return label || masked || ''
}

function operatorLabel(item) {
  return item?.operator_name || item?.display_name || item?.username || ''
}

function statusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'processing' || status === 'pending') return '生成中'
  if (status === 'failed') return '失败'
  return status || '—'
}

function statusClass(status) {
  if (status === 'completed') return 'tag-success'
  if (status === 'processing' || status === 'pending') return 'tag-accent'
  if (status === 'failed') return 'tag-danger'
  return ''
}

function previewPrompt(text) {
  const value = String(text || '').trim()
  if (!value) return '—'
  return value.length > 80 ? `${value.slice(0, 80)}…` : value
}

function formatTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function fetchPage(offset = 0, append = false) {
  const res = await imageAPI.adminRecords({
    model: filterModel.value || undefined,
    status: filterStatus.value || undefined,
    keyword: keyword.value.trim() || undefined,
    limit: 40,
    offset,
    studio_only: true,
  })
  const list = Array.isArray(res?.items) ? res.items : []
  items.value = append ? [...items.value, ...list] : list
  pagination.value = {
    limit: res?.pagination?.limit ?? 40,
    offset: res?.pagination?.offset ?? offset,
    total: res?.pagination?.total ?? list.length,
    has_more: !!res?.pagination?.has_more,
  }
}

async function reload() {
  loading.value = true
  try {
    await fetchPage(0, false)
  } catch (err) {
    toast.error(err?.message || '加载生图记录失败')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!pagination.value.has_more || loadingMore.value) return
  loadingMore.value = true
  try {
    const next = (pagination.value.offset || 0) + (pagination.value.limit || 40)
    await fetchPage(next, true)
  } catch (err) {
    toast.error(err?.message || '加载更多失败')
  } finally {
    loadingMore.value = false
  }
}

onMounted(() => {
  void reload()
})

defineExpose({ reload })
</script>

<style scoped>
.records-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
}
.records-keyword {
  min-width: 180px;
  flex: 1;
}
.records-empty {
  padding: 24px 0;
}
.records-table-wrap {
  overflow-x: auto;
}
.records-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.records-table th,
.records-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  vertical-align: top;
}
.records-table th {
  color: var(--text-dim, #888);
  font-weight: 500;
  white-space: nowrap;
}
.records-prompt {
  max-width: 280px;
  line-height: 1.4;
  word-break: break-word;
}
.records-thumb-btn {
  display: block;
  padding: 0;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
  cursor: pointer;
  width: 64px;
  height: 64px;
}
.records-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.records-thumb-empty {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.15);
  font-size: 12px;
}
.records-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.records-viewer {
  max-width: min(920px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 12px 14px 16px;
}
.records-viewer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.records-viewer-img {
  display: block;
  max-width: 100%;
  max-height: calc(90vh - 64px);
  margin: 0 auto;
  border-radius: 8px;
}
.records-more {
  margin-top: 16px;
}
.records-stats {
  margin-top: 12px;
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
</style>
