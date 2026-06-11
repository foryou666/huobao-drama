<template>
  <div
    v-if="open"
    class="video-history-overlay"
    @mousedown="onOverlayMouseDown"
    @click="onOverlayClick"
  >
    <div class="video-history-dialog card">
      <div class="video-history-head">
        <div>
          <h3 class="video-history-title">{{ title }}</h3>
          <p class="dim video-history-sub">共 {{ items.length }} 条生成记录，可预览并切换当前使用的视频</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div v-if="loading" class="dim video-history-empty">加载中…</div>
      <div v-else-if="!items.length" class="dim video-history-empty">暂无视频生成记录</div>
      <div v-else class="video-history-body">
        <div class="video-history-list">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            :class="['video-history-item', { active: selectedId === item.id, current: isCurrent(item) }]"
            @click="selectedId = item.id"
          >
            <div class="video-history-thumb">
              <video
                v-if="playableUrl(item)"
                :src="displayUrl(playableUrl(item))"
                muted
                playsinline
                preload="metadata"
              />
              <div v-else class="video-history-thumb-empty">{{ statusLabel(item.status) }}</div>
            </div>
            <div class="video-history-copy">
              <div class="video-history-tags">
                <span class="tag mono">#{{ item.id }}</span>
                <span class="tag" :class="statusTagClass(item.status)">{{ statusLabel(item.status) }}</span>
                <span v-if="isCurrent(item)" class="tag tag-success">当前</span>
              </div>
              <div class="video-history-meta">{{ formatTime(item.createdAt) }}</div>
              <div v-if="item.errorMsg" class="video-history-error">{{ item.errorMsg }}</div>
            </div>
          </button>
        </div>

        <div class="video-history-preview">
          <template v-if="selectedItem && playableUrl(selectedItem)">
            <video
              :key="selectedItem.id"
              :src="displayUrl(playableUrl(selectedItem))"
              controls
              playsinline
              preload="metadata"
              class="video-history-player"
            />
            <div class="video-history-preview-meta">
              <span class="tag mono">#{{ selectedItem.id }}</span>
              <span class="dim">{{ formatTime(selectedItem.createdAt) }}</span>
            </div>
            <div class="video-history-preview-actions">
              <button
                v-if="!isCurrent(selectedItem)"
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="selecting"
                @click="selectCurrent"
              >
                {{ selecting ? '设置中…' : '设为当前视频' }}
              </button>
              <span v-else class="tag tag-success">已是当前镜头视频</span>
              <button
                v-if="playableUrl(selectedItem)"
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="downloading"
                @click="downloadSelected"
              >
                {{ downloading ? '下载中…' : '下载视频' }}
              </button>
            </div>
          </template>
          <div v-else-if="selectedItem" class="dim video-history-preview-empty">
            {{ selectedItem.errorMsg || '该记录暂无可播放视频' }}
          </div>
          <div v-else class="dim video-history-preview-empty">请选择左侧记录</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { videoAPI } from '~/composables/useApi'
import { useOverlayDismiss } from '~/composables/useOverlayDismiss'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { buildVideoDownloadFilename, downloadMediaFile } from '~/utils/download-media.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  storyboardId: { type: Number, default: null },
  storyboardTitle: { type: String, default: '' },
  currentVideoUrl: { type: String, default: '' },
})

const emit = defineEmits(['close', 'selected'])

const loading = ref(false)
const selecting = ref(false)
const downloading = ref(false)
const items = ref([])
const selectedId = ref(null)

const title = computed(() => props.storyboardTitle || '镜头视频历史')

const selectedItem = computed(() => items.value.find(item => item.id === selectedId.value) || null)

function normalizeRow(row) {
  return {
    id: row?.id,
    status: row?.status || 'pending',
    videoUrl: row?.video_url || row?.videoUrl || '',
    localPath: row?.local_path || row?.localPath || '',
    errorMsg: row?.error_msg || row?.errorMsg || '',
    createdAt: row?.created_at || row?.createdAt || '',
  }
}

function playableUrl(item) {
  return item?.localPath || item?.videoUrl || ''
}

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
}

function normalizePath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function isCurrent(item) {
  const current = normalizePath(props.currentVideoUrl)
  if (!current) return false
  const candidates = [item.localPath, item.videoUrl].map(normalizePath).filter(Boolean)
  return candidates.some(url => url === current || current.endsWith(url) || url.endsWith(current))
}

function statusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'processing') return '生成中'
  if (status === 'failed') return '失败'
  return '等待中'
}

function statusTagClass(status) {
  if (status === 'completed') return 'tag-success'
  if (status === 'processing') return 'tag-warning'
  if (status === 'failed') return 'tag-error'
  return ''
}

function formatTime(raw) {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN', { hour12: false })
}

async function loadItems() {
  if (!props.storyboardId) {
    items.value = []
    selectedId.value = null
    return
  }
  loading.value = true
  try {
    const rows = await videoAPI.list({ storyboard_id: props.storyboardId })
    items.value = (rows || []).map(normalizeRow)
    const current = items.value.find(item => isCurrent(item))
    const firstPlayable = items.value.find(item => playableUrl(item))
    selectedId.value = current?.id || firstPlayable?.id || items.value[0]?.id || null
  } catch {
    items.value = []
    selectedId.value = null
  } finally {
    loading.value = false
  }
}

async function selectCurrent() {
  const item = selectedItem.value
  const url = playableUrl(item)
  if (!item || !url || !props.storyboardId) return
  selecting.value = true
  try {
    emit('selected', { storyboardId: props.storyboardId, videoUrl: url, generationId: item.id })
  } finally {
    selecting.value = false
  }
}

async function downloadSelected() {
  const item = selectedItem.value
  const url = playableUrl(item)
  if (!item || !url || downloading.value) return
  downloading.value = true
  try {
    await downloadMediaFile(url, buildVideoDownloadFilename({ id: item.id, title: props.storyboardTitle }))
    toast.success('开始下载')
  } catch (e) {
    toast.error(e?.message || '下载失败')
  } finally {
    downloading.value = false
  }
}

function close() {
  emit('close')
}

const { onOverlayMouseDown, onOverlayClick } = useOverlayDismiss(close)

watch(() => [props.open, props.storyboardId], ([open]) => {
  if (open) loadItems()
}, { immediate: true })
</script>

<style scoped>
.video-history-overlay {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(18, 24, 34, 0.68);
  backdrop-filter: blur(10px);
}
.video-history-dialog {
  width: min(1080px, calc(100vw - 56px));
  max-height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 24px;
}
.video-history-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
}
.video-history-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  font-family: var(--font-display);
}
.video-history-sub {
  margin: 4px 0 0;
  font-size: 12px;
}
.video-history-empty {
  padding: 48px 20px;
  text-align: center;
}
.video-history-body {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  gap: 0;
  min-height: 0;
  flex: 1;
}
.video-history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  overflow: auto;
  border-right: 1px solid rgba(27, 41, 64, 0.08);
  max-height: calc(100vh - 180px);
}
.video-history-item {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: 1px solid rgba(27, 41, 64, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.video-history-item:hover {
  border-color: rgba(59, 130, 246, 0.28);
}
.video-history-item.active {
  border-color: rgba(59, 130, 246, 0.45);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}
.video-history-item.current {
  background: rgba(34, 197, 94, 0.06);
}
.video-history-thumb {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(15, 23, 42, 0.06);
}
.video-history-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.video-history-thumb-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-3);
  padding: 6px;
  text-align: center;
}
.video-history-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.video-history-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.video-history-meta {
  font-size: 11px;
  color: var(--text-3);
}
.video-history-error {
  font-size: 11px;
  color: #dc2626;
  line-height: 1.4;
}
.video-history-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  min-height: 320px;
}
.video-history-player {
  width: 100%;
  max-height: calc(100vh - 280px);
  border-radius: 16px;
  background: #000;
  box-shadow: 0 18px 48px rgba(8, 14, 24, 0.18);
}
.video-history-preview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.video-history-preview-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.video-history-preview-empty {
  font-size: 13px;
  text-align: center;
  padding: 24px;
}
@media (max-width: 820px) {
  .video-history-body {
    grid-template-columns: 1fr;
  }
  .video-history-list {
    border-right: none;
    border-bottom: 1px solid rgba(27, 41, 64, 0.08);
    max-height: 220px;
  }
}
</style>
