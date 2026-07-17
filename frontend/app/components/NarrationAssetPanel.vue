<template>
  <div class="narration-asset-panel">
    <div class="narration-asset-toolbar">
      <span class="dim">
        {{ readiness.ready_count || 0 }}/{{ readiness.total || 0 }} 已定稿
        <span v-if="readiness.ready" class="narration-asset-ready-tag">可生成 Grok 视频</span>
      </span>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        :disabled="busy || !missingCount"
        @click="generateAllMissing"
      >
        {{ busy ? '提交中…' : `一键生成缺图（${missingCount}）` }}
      </button>
    </div>

    <p class="dim narration-asset-hint">
      角色生成<strong>三视图定妆照</strong>（gpt-image-2），场景与道具生成设定图；生成 Grok 视频时将作为参考图传入（最多 6 张/段）。
    </p>

    <div v-if="!rows.length" class="dim">暂无实体，请先完成实体抽取</div>

    <div v-else class="narration-asset-grid">
      <article
        v-for="row in rows"
        :key="`${row.type}-${row.id}`"
        class="narration-asset-card card"
        :class="{ ready: row.has_image }"
      >
        <div class="narration-asset-cover">
          <button
            v-if="row.image_url"
            type="button"
            class="narration-asset-cover-btn"
            :title="`查看 ${row.name}`"
            @click="openPreview(row)"
          >
            <img
              :src="mediaDisplayUrl(row.image_url)"
              :alt="row.name"
              class="narration-asset-img"
            />
          </button>
          <div v-else class="narration-asset-placeholder">
            {{ statusLabel(row.image_status) }}
          </div>
          <span class="narration-asset-type">{{ typeLabel(row.type) }}</span>
        </div>

        <div class="narration-asset-body">
          <strong class="narration-asset-name">{{ row.name }}</strong>
          <p class="dim narration-asset-status">{{ statusLabel(row.image_status) }}</p>
        </div>

        <div class="narration-asset-actions">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="busy || row.image_status === 'generating'"
            @click="generateOne(row)"
          >
            {{ row.image_status === 'generating' ? '生成中…' : row.has_image ? '已有定稿' : 'AI 生图' }}
          </button>
        </div>
      </article>
    </div>

    <div v-if="imageViewer.open" class="narration-image-viewer" @click="closePreview">
      <img
        :src="imageViewer.src"
        :alt="imageViewer.title"
        class="narration-image-viewer-img"
        @click.stop
      />
      <p class="narration-image-viewer-title">{{ imageViewer.title }}</p>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { narrationAPI } from '~/composables/useApi'
import { mediaDisplayUrl } from '~/utils/media-url.js'

const props = defineProps({
  jobId: { type: Number, required: true },
  readiness: { type: Object, default: () => ({ items: [], ready: false, total: 0, ready_count: 0 }) },
})

const emit = defineEmits(['updated'])

const busy = ref(false)
const imageViewer = ref({ open: false, src: '', title: '' })
let pollTimer = null

const rows = computed(() => props.readiness?.items || [])
const missingCount = computed(() => rows.value.filter(r => !r.has_image).length)
const hasGenerating = computed(() => rows.value.some(r => r.image_status === 'generating'))

function typeLabel(type) {
  if (type === 'character') return '角色三视图'
  if (type === 'scene') return '场景'
  return '道具'
}

function statusLabel(status) {
  if (status === 'completed') return '已定稿'
  if (status === 'generating') return '生成中…'
  if (status === 'failed') return '生成失败'
  return '待生成'
}

function apiType(type) {
  if (type === 'character') return 'characters'
  if (type === 'scene') return 'scenes'
  return 'props'
}

function openPreview(row) {
  imageViewer.value = {
    open: true,
    src: mediaDisplayUrl(row.image_url),
    title: row.name,
  }
}

function closePreview() {
  imageViewer.value = { open: false, src: '', title: '' }
}

async function generateOne(row) {
  if (row.has_image) return
  busy.value = true
  try {
    const res = await narrationAPI.generateAsset(props.jobId, apiType(row.type), row.id)
    emit('updated', res.job || res)
    toast.success(`${row.name} 已提交生图`)
    startPoll()
  } catch (err) {
    toast.error(err?.message || '生图失败')
  } finally {
    busy.value = false
  }
}

async function generateAllMissing() {
  busy.value = true
  try {
    const res = await narrationAPI.generateAllAssets(props.jobId)
    emit('updated', res.job || res)
    const n = res.queued?.length || 0
    toast.success(n ? `已提交 ${n} 项生图` : '没有待生成的资产')
    if (res.errors?.length) toast.warning(res.errors.join('; '))
    startPoll()
  } catch (err) {
    toast.error(err?.message || '批量生图失败')
  } finally {
    busy.value = false
  }
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(() => {
    emit('updated')
  }, 4000)
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(hasGenerating, (v) => {
  if (v) startPoll()
  else stopPoll()
}, { immediate: true })

onUnmounted(stopPoll)
</script>

<style scoped>
.narration-asset-panel {
  margin-top: 16px;
}

.narration-asset-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.narration-asset-ready-tag {
  margin-left: 8px;
  color: #66bb6a;
  font-size: 12px;
}

.narration-asset-hint {
  margin: 0 0 14px;
  font-size: 13px;
}

.narration-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.narration-asset-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.narration-asset-card.ready {
  border-color: rgba(102, 187, 106, 0.35);
}

.narration-asset-cover {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: var(--radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}

.narration-asset-cover-btn {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.narration-asset-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.narration-asset-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 13px;
  color: var(--text-1);
}

.narration-asset-type {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.55);
}

.narration-asset-name {
  font-size: 14px;
}

.narration-asset-status {
  margin: 4px 0 0;
  font-size: 12px;
}

.narration-asset-actions {
  margin-top: auto;
}

.narration-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.85);
  cursor: zoom-out;
}

.narration-image-viewer-img {
  max-width: min(92vw, 1200px);
  max-height: 80vh;
  object-fit: contain;
}

.narration-image-viewer-title {
  color: #fff;
  font-size: 14px;
}
</style>
