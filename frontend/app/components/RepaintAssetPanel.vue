<template>
  <div class="repaint-asset-panel">
    <div v-if="loading" class="dim">加载资产…</div>
    <div v-else-if="loadError" class="repaint-error">{{ loadError }}</div>

    <template v-else>
      <div class="repaint-asset-toolbar">
        <span class="dim">{{ readyCount }}/{{ rows.length }} 已就绪</span>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="busy || !missingRows.length"
          @click="generateAllMissing"
        >
          {{ busy ? '生成中…' : `一键生成缺图（${missingRows.length}）` }}
        </button>
      </div>

      <div v-if="!rows.length" class="dim">暂无资产，请先确认分析步骤</div>

      <div v-else class="repaint-asset-grid">
        <article
          v-for="row in rows"
          :key="`${row.type}-${row.id}`"
          class="repaint-asset-card card"
          :class="{ ready: row.hasImage }"
        >
          <div class="repaint-asset-cover">
            <button
              v-if="row.previewUrl"
              type="button"
              class="repaint-asset-cover-btn"
              :title="`查看 ${row.name}`"
              @click="openPreview(row)"
            >
              <img
                :src="mediaDisplayUrl(row.previewUrl)"
                :alt="row.name"
                class="repaint-asset-img"
              />
            </button>
            <div v-else class="repaint-asset-placeholder">待生成</div>
            <span class="repaint-asset-type">{{ typeLabel(row.type) }}</span>
          </div>

          <div class="repaint-asset-body">
            <strong class="repaint-asset-name">{{ row.name }}</strong>
            <p class="dim repaint-asset-status">{{ row.hasImage ? '已就绪' : row.missingReason }}</p>
            <textarea
              v-model="row.promptDraft"
              class="textarea repaint-asset-prompt"
              rows="3"
              :placeholder="promptPlaceholder(row.type)"
              @change="savePrompt(row)"
            />
          </div>

          <div class="repaint-asset-actions">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="busy || isPending(row)"
              @click="generateOne(row)"
            >
              {{ isPending(row) ? '生成中…' : row.hasImage ? '重新生成' : 'AI 生图' }}
            </button>
            <label class="btn btn-sm" :class="{ 'is-disabled': busy || isPendingUpload(row) }">
              <input
                type="file"
                accept="image/*"
                hidden
                :disabled="busy || isPendingUpload(row)"
                @change="uploadOne(row, $event)"
              />
              {{ isPendingUpload(row) ? '上传中…' : '上传' }}
            </label>
          </div>
        </article>
      </div>
    </template>

    <div v-if="imageViewer.open" class="repaint-image-viewer" @click="closePreview">
      <img
        :src="imageViewer.src"
        :alt="imageViewer.title"
        class="repaint-image-viewer-img"
        @click.stop
      />
      <p class="repaint-image-viewer-title">{{ imageViewer.title }}</p>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import {
  assetAPI,
  characterAPI,
  dramaAPI,
  imageAPI,
  sceneAPI,
} from '~/composables/useApi'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import { summarizePropMedia } from '~/utils/entity-view-media.js'

const props = defineProps({
  dramaId: { type: Number, required: true },
  episodeId: { type: Number, required: true },
  analysis: { type: Object, default: null },
})

const emit = defineEmits(['updated'])

const loading = ref(true)
const loadError = ref('')
const busy = ref(false)
const rows = ref([])
const pendingKeys = ref([])
const pendingUploadKeys = ref([])
const imageViewer = ref({ open: false, src: '', title: '' })

const missingRows = computed(() => rows.value.filter(row => !row.hasImage))
const readyCount = computed(() => rows.value.filter(row => row.hasImage).length)

function typeLabel(type) {
  if (type === 'character') return '角色'
  if (type === 'scene') return '场景'
  return '道具'
}

function promptPlaceholder(type) {
  if (type === 'character') return '角色定妆 prompt（留空则用默认四视图模板）'
  if (type === 'scene') return '场景设定 prompt'
  return '道具描述 prompt'
}

function rowKey(row) {
  return `${row.type}:${row.id}`
}

function isPending(row) {
  return pendingKeys.value.includes(rowKey(row))
}

function isPendingUpload(row) {
  return pendingUploadKeys.value.includes(rowKey(row))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function openPreview(row) {
  if (!row.previewUrl) return
  imageViewer.value = {
    open: true,
    src: mediaDisplayUrl(row.previewUrl),
    title: `${typeLabel(row.type)} · ${row.name}`,
  }
}

function closePreview() {
  imageViewer.value = { open: false, src: '', title: '' }
}

function onPreviewKeydown(event) {
  if (event.key === 'Escape' && imageViewer.value.open) closePreview()
}

onMounted(() => {
  window.addEventListener('keydown', onPreviewKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPreviewKeydown)
})

function entityImagePath(entity, type) {
  if (type === 'prop') {
    const media = summarizePropMedia(entity)
    return media?.primary_url || entity.image_url || entity.imageUrl || entity.local_path || entity.localPath || ''
  }
  return entity.image_url || entity.imageUrl || entity.local_path || entity.localPath || ''
}

function buildRows(drama) {
  const analysis = props.analysis || {}
  const charIdSet = new Set((analysis.characters || []).map(item => item.character_id).filter(Boolean))
  const sceneIdSet = new Set((analysis.scenes || []).map(item => item.scene_id).filter(Boolean))
  const propIdSet = new Set((analysis.props || []).map(item => item.prop_id).filter(Boolean))

  const next = []

  for (const char of drama.characters || []) {
    if (!charIdSet.has(char.id)) continue
    const previewUrl = entityImagePath(char, 'character')
    next.push({
      type: 'character',
      id: char.id,
      name: char.name,
      promptDraft: char.image_prompt || char.imagePrompt || '',
      previewUrl,
      hasImage: !!previewUrl,
      missingReason: '缺少四视图定妆照',
    })
  }

  for (const scene of drama.scenes || []) {
    if (!sceneIdSet.has(scene.id)) continue
    const previewUrl = entityImagePath(scene, 'scene')
    next.push({
      type: 'scene',
      id: scene.id,
      name: scene.location || scene.name || `场景#${scene.id}`,
      promptDraft: scene.prompt || '',
      previewUrl,
      hasImage: !!previewUrl,
      missingReason: '缺少场景主图',
    })
  }

  for (const prop of drama.props || []) {
    if (!propIdSet.has(prop.id)) continue
    const previewUrl = entityImagePath(prop, 'prop')
    next.push({
      type: 'prop',
      id: prop.id,
      name: prop.name || `道具#${prop.id}`,
      promptDraft: prop.prompt || prop.description || '',
      previewUrl,
      hasImage: !!previewUrl,
      missingReason: '缺少道具图',
    })
  }

  rows.value = next
}

async function loadEntities() {
  loading.value = true
  loadError.value = ''
  try {
    const drama = await dramaAPI.get(props.dramaId)
    buildRows(drama)
  } catch (err) {
    loadError.value = err?.message || '加载资产失败'
  } finally {
    loading.value = false
  }
}

async function savePrompt(row) {
  try {
    if (row.type === 'character') {
      await characterAPI.update(row.id, { image_prompt: row.promptDraft.trim() })
    } else if (row.type === 'scene') {
      await sceneAPI.update(row.id, { prompt: row.promptDraft.trim() })
    } else if (row.promptDraft.trim()) {
      const assetId = await findPropAssetId(row.id)
      await assetAPI.update(assetId, { description: row.promptDraft.trim() })
    }
  } catch {
    // 保存 prompt 失败不阻断生图
  }
}

async function waitForImage(genId) {
  for (let i = 0; i < 120; i++) {
    await sleep(2500)
    const record = await imageAPI.get(genId)
    const status = String(record?.status || '').toLowerCase()
    if (status === 'completed') return record
    if (status === 'failed') throw new Error(record?.error_msg || record?.errorMsg || '生图失败')
  }
  throw new Error('生图超时，请稍后刷新查看')
}

async function findPropAssetId(propId) {
  const res = await assetAPI.list({ drama_id: props.dramaId, type: 'prop' })
  const items = Array.isArray(res) ? res : (res?.items || [])
  let asset = items.find(item => item.source_type === 'prop' && item.source_id === propId)
  if (!asset) {
    await assetAPI.sync(props.dramaId)
    const retry = await assetAPI.list({ drama_id: props.dramaId, type: 'prop' })
    const retryItems = Array.isArray(retry) ? retry : (retry?.items || [])
    asset = retryItems.find(item => item.source_type === 'prop' && item.source_id === propId)
  }
  if (!asset?.id) throw new Error('未找到道具资产条目')
  return asset.id
}

async function generateOne(row) {
  const key = rowKey(row)
  if (isPending(row)) return
  pendingKeys.value.push(key)
  try {
    if (row.promptDraft.trim()) await savePrompt(row)

    if (row.type === 'character') {
      const res = await characterAPI.generateImage(row.id, props.episodeId, row.promptDraft.trim() || undefined)
      await waitForImage(res.image_generation_id)
    } else if (row.type === 'scene') {
      const res = await sceneAPI.generateImage(row.id, props.episodeId, row.promptDraft.trim() || undefined)
      await waitForImage(res.image_generation_id)
    } else {
      const prompt = row.promptDraft.trim() || row.name
      const created = await imageAPI.generate({ prompt, drama_id: props.dramaId })
      const genId = created?.id || created?.generation_id
      if (!genId) throw new Error('未返回图片任务 ID')
      await waitForImage(genId)
      await imageAPI.attachToEntity(genId, {
        entity_type: 'prop',
        entity_id: row.id,
        drama_id: props.dramaId,
        group_id: 'hero',
        group_label: '主图',
        set_as_default: true,
      })
    }

    toast.success(`${row.name} 生图完成`)
    await loadEntities()
    emit('updated')
  } catch (err) {
    toast.error(err?.message || `${row.name} 生图失败`)
  } finally {
    pendingKeys.value = pendingKeys.value.filter(item => item !== key)
  }
}

async function uploadOne(row, event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }

  const key = rowKey(row)
  if (isPendingUpload(row)) return
  pendingUploadKeys.value.push(key)
  try {
    if (row.type === 'character') {
      await characterAPI.uploadImage(row.id, file)
    } else if (row.type === 'scene') {
      await sceneAPI.uploadImage(row.id, file)
    } else {
      const assetId = await findPropAssetId(row.id)
      const form = new FormData()
      form.append('file', file)
      await assetAPI.uploadToAsset(assetId, form)
    }
    toast.success(`${row.name} 上传成功`)
    await loadEntities()
    emit('updated')
  } catch (err) {
    toast.error(err?.message || `${row.name} 上传失败`)
  } finally {
    pendingUploadKeys.value = pendingUploadKeys.value.filter(item => item !== key)
    if (event?.target) event.target.value = ''
  }
}

async function generateAllMissing() {
  if (!missingRows.value.length || busy.value) return
  busy.value = true
  const chars = missingRows.value.filter(row => row.type === 'character')
  const others = missingRows.value.filter(row => row.type !== 'character')

  try {
    if (chars.length) {
      const ids = chars.map(row => row.id)
      for (const row of chars) pendingKeys.value.push(rowKey(row))
      try {
        const res = await characterAPI.batchImages(ids, props.episodeId)
        const tasks = res?.items || []
        for (const task of tasks) {
          if (task.image_generation_id) await waitForImage(task.image_generation_id)
        }
      } finally {
        for (const row of chars) {
          pendingKeys.value = pendingKeys.value.filter(item => item !== rowKey(row))
        }
      }
    }

    for (const row of others) {
      await generateOne(row)
    }

    toast.success('批量生图完成')
    await loadEntities()
    emit('updated')
  } catch (err) {
    toast.error(err?.message || '批量生图失败')
  } finally {
    busy.value = false
  }
}

watch(
  () => [props.dramaId, props.analysis],
  () => { loadEntities() },
  { immediate: true, deep: true },
)
</script>

<style scoped>
.repaint-asset-panel {
  margin-top: 16px;
}

.repaint-asset-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.repaint-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.repaint-asset-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.repaint-asset-card.ready {
  border-color: rgba(102, 187, 106, 0.35);
}

.repaint-asset-cover {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: var(--radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}

.repaint-asset-cover-btn {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.repaint-asset-cover-btn:hover .repaint-asset-img {
  transform: scale(1.03);
}

.repaint-asset-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.15s ease;
}

.repaint-asset-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 13px;
  color: var(--text-1);
}

.repaint-asset-type {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.55);
}

.repaint-asset-name {
  font-size: 14px;
}

.repaint-asset-status {
  margin: 4px 0 0;
  font-size: 12px;
}

.repaint-asset-prompt {
  width: 100%;
  margin-top: 8px;
  font-size: 12px;
}

.repaint-asset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}

.repaint-asset-actions .is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.repaint-error {
  color: var(--danger, #e57373);
  font-size: 13px;
}

.repaint-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
}

.repaint-image-viewer-img {
  max-width: min(92vw, 1200px);
  max-height: 82vh;
  object-fit: contain;
  border-radius: var(--radius);
  cursor: default;
}

.repaint-image-viewer-title {
  margin: 14px 0 0;
  color: #fff;
  font-size: 14px;
  text-align: center;
}
</style>
