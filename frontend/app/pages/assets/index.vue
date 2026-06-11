<template>
  <div class="page">
    <div class="page-head">
      <div class="head-left">
        <h1 class="page-title">资产库</h1>
        <p class="page-desc">角色、场景、服装、道具、参考图与音色库统一归档；结构化资产与项目双向同步</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-sm" :disabled="!selectedDramaId || syncing" @click="syncDrama">
          {{ syncing ? '同步中' : '同步当前项目' }}
        </button>
        <button class="btn btn-primary btn-sm" @click="openCreate = true">添加资产</button>
      </div>
    </div>

    <div class="library-toolbar card">
      <label class="toolbar-field">
        <span class="toolbar-label">项目筛选</span>
        <select v-model="selectedDramaId" class="input">
          <option value="">全部项目</option>
          <option v-for="d in dramas" :key="d.id" :value="String(d.id)">{{ d.title }}</option>
        </select>
      </label>
      <label class="toolbar-field grow">
        <span class="toolbar-label">搜索</span>
        <input v-model="keyword" class="input" placeholder="按名称搜索资产…" />
      </label>
    </div>

    <div class="library-tabs">
      <button
        v-for="tab in ASSET_CATEGORIES"
        :key="tab.id"
        type="button"
        class="library-tab"
        :class="{ active: activeType === tab.id }"
        @click="activeType = tab.id"
      >
        {{ tab.label }}
        <span class="library-tab-count">{{ countByType(tab.id) }}</span>
      </button>
    </div>

    <div v-if="loading" class="dim library-empty">加载中…</div>
    <div v-else-if="!filteredAssets.length" class="library-empty card">
      <p class="dim">暂无{{ assetCategoryLabel(activeType) }}</p>
      <p class="dim" style="font-size:12px;margin-top:8px">{{ activeType === 'voice' ? '上传 MP3 音色参考（3~10 秒），绑定项目后可在视频生成中使用' : '各剧角色/场景会自动同步；也可手动添加或上传图片' }}</p>
    </div>
    <div v-else class="asset-grid">
      <div v-for="item in visibleAssets" :key="item.id" class="card asset-card">
        <div class="asset-cover" :class="{ wide: activeType === 'scene', voice: activeType === 'voice' }">
          <template v-if="activeType === 'voice'">
            <div v-if="item.url || item.local_path || item.localPath" class="asset-voice-preview">
              <audio :src="'/' + normalizePath(item.url || item.local_path || item.localPath)" controls preload="none" />
              <span v-if="item.duration" class="asset-voice-duration">{{ item.duration }}s</span>
            </div>
            <div v-else class="asset-cover-empty">待上传</div>
          </template>
          <template v-else>
          <button
            v-if="item.url || item.local_path || item.localPath"
            type="button"
            class="asset-cover-btn"
            @click="openAssetPreview(item)"
          >
            <GridMediaImage
              :src="item.url || item.local_path || item.localPath"
              :thumb="item.thumbnail_url || item.thumbnailUrl"
              :alt="item.name"
            />
          </button>
          <div v-else class="asset-cover-empty">待上传</div>
          </template>
          <span class="asset-cover-badge" :class="(item.url || item.local_path) ? 'is-ready' : ''">
            {{ item.source_type === 'manual' ? '手动' : item.source_type === 'import' ? '导入' : '同步' }}
          </span>
        </div>
        <div class="asset-body">
          <div class="asset-name">{{ item.name }}</div>
          <div class="asset-meta dim">{{ dramaTitle(item.drama_id || item.dramaId) }}</div>
          <div v-if="item.description" class="asset-meta dim truncate">{{ item.description }}</div>
        </div>
        <div class="asset-foot">
          <button v-if="activeType !== 'voice'" type="button" class="btn btn-sm" @click="openAssetPreview(item)">预览</button>
          <button type="button" class="btn btn-sm" @click="openEdit(item)">编辑</button>
          <button type="button" class="btn btn-sm danger ml-auto" @click="removeAsset(item)">删除</button>
        </div>
      </div>
    </div>

    <div v-if="!loading && hasMoreAssets" class="library-more">
      <button type="button" class="btn btn-sm" @click="loadMoreAssets">
        加载更多（{{ visibleAssets.length }}/{{ filteredAssets.length }}）
      </button>
    </div>

    <div v-if="imageViewer.open" class="image-viewer-overlay" @click="closeImageViewer">
      <img :src="imageViewer.src" :alt="imageViewer.title" @click.stop />
      <div class="image-viewer-title">{{ imageViewer.title }}</div>
    </div>

    <div v-if="openEditModal" class="modal-overlay" @click.self="closeEdit">
      <div class="card modal-card">
        <h3 class="modal-title">编辑资产</h3>
        <label class="modal-field">
          <span>名称</span>
          <input v-model="editForm.name" class="input" placeholder="资产名称" />
          <span v-if="editForm.type === 'scene'" class="dim" style="font-size:11px;margin-top:4px;display:block">场景建议格式：养心殿（日）</span>
        </label>
        <label class="modal-field">
          <span>描述</span>
          <textarea v-model="editForm.description" class="textarea" rows="2" />
        </label>
        <label class="modal-field">
          <span>{{ editForm.type === 'voice' ? '重新上传 MP3' : '重新上传图片' }}</span>
          <input
            type="file"
            :accept="editForm.type === 'voice' ? '.mp3,audio/mpeg,audio/mp3' : 'image/*'"
            @change="onEditFile"
          />
          <span v-if="editForm.type === 'voice'" class="dim" style="font-size:11px;margin-top:4px;display:block">时长须 3~10 秒；不选文件则保留原音频</span>
          <span v-else class="dim" style="font-size:11px;margin-top:4px;display:block">不选文件则保留原图片</span>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-sm" @click="closeEdit">取消</button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="savingEdit" @click="submitEdit">
            {{ savingEdit ? '保存中' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="openCreate" class="modal-overlay" @click.self="openCreate = false">
      <div class="card modal-card">
        <h3 class="modal-title">添加资产</h3>
        <label class="modal-field">
          <span>分类</span>
          <select v-model="createForm.type" class="input">
            <option v-for="tab in ASSET_CATEGORIES" :key="tab.id" :value="tab.id">{{ tab.label }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>名称</span>
          <input v-model="createForm.name" class="input" placeholder="资产名称" />
        </label>
        <label class="modal-field">
          <span>所属项目（可选）</span>
          <select v-model="createForm.drama_id" class="input">
            <option :value="null">不绑定项目</option>
            <option v-for="d in dramas" :key="d.id" :value="d.id">{{ d.title }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>描述</span>
          <textarea v-model="createForm.description" class="textarea" rows="2" />
        </label>
        <label class="modal-field">
          <span>{{ createForm.type === 'voice' ? 'MP3 文件' : '图片' }}</span>
          <input type="file" :accept="createForm.type === 'voice' ? '.mp3,audio/mpeg,audio/mp3' : 'image/*'" @change="onCreateFile" />
          <span v-if="createForm.type === 'voice'" class="dim" style="font-size:11px;margin-top:4px;display:block">时长须 3~10 秒</span>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-sm" @click="openCreate = false">取消</button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="creating" @click="submitCreate">
            {{ creating ? '保存中' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { dramaAPI, assetAPI } from '~/composables/useApi'
import { ASSET_CATEGORIES, assetCategoryLabel } from '~/utils/asset-categories.js'
import { mediaDisplayUrl, normalizeMediaPath } from '~/utils/media-url.js'
import GridMediaImage from '~/components/GridMediaImage.vue'
import { toast } from 'vue-sonner'

const GRID_PAGE_SIZE = 48

const dramas = ref([])
const assets = ref([])
const loading = ref(true)
const syncing = ref(false)
const creating = ref(false)
const savingEdit = ref(false)
const openCreate = ref(false)
const openEditModal = ref(false)
const route = useRoute()
const selectedDramaId = ref('')
const activeType = ref('character')
const keyword = ref('')
const createForm = ref({
  type: 'character',
  name: '',
  description: '',
  drama_id: null,
  file: null,
})
const editForm = ref({
  id: null,
  type: 'character',
  name: '',
  description: '',
  file: null,
})
const imageViewer = ref({ open: false, src: '', title: '' })
const visibleCount = ref(GRID_PAGE_SIZE)

function parseDramaFilter(raw) {
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

const filteredAssets = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const dramaId = parseDramaFilter(selectedDramaId.value)
  return assets.value.filter(item => {
    if (item.type !== activeType.value) return false
    if (dramaId) {
      const itemDramaId = item.drama_id ?? item.dramaId ?? null
      if (itemDramaId != null && itemDramaId !== dramaId) return false
    }
    if (!q) return true
    return String(item.name || '').toLowerCase().includes(q)
  })
})

const visibleAssets = computed(() => filteredAssets.value.slice(0, visibleCount.value))

const hasMoreAssets = computed(() => visibleCount.value < filteredAssets.value.length)

function resetVisibleCount() {
  visibleCount.value = GRID_PAGE_SIZE
}

function loadMoreAssets() {
  visibleCount.value = Math.min(visibleCount.value + GRID_PAGE_SIZE, filteredAssets.value.length)
}

function normalizePath(raw) {
  return String(raw || '').replace(/^\/+/, '')
}

function dramaTitle(id) {
  if (!id) return '跨项目资产'
  return dramas.value.find(d => d.id === id)?.title || `项目 #${id}`
}

function countByType(type) {
  const dramaId = parseDramaFilter(selectedDramaId.value)
  return assets.value.filter(item => {
    if (item.type !== type) return false
    if (!dramaId) return true
    const itemDramaId = item.drama_id ?? item.dramaId ?? null
    return itemDramaId == null || itemDramaId === dramaId
  }).length
}

function openAssetPreview(item) {
  const raw = item?.url || item?.local_path || item?.localPath
  if (!raw) return
  openImageViewer(mediaDisplayUrl(raw), item.name)
}

function openImageViewer(src, title = '') {
  if (!src) return
  imageViewer.value = { open: true, src, title }
}

function closeImageViewer() {
  imageViewer.value = { open: false, src: '', title: '' }
}

async function loadDramas() {
  const res = await dramaAPI.list()
  dramas.value = res?.items ?? (Array.isArray(res) ? res : [])
}

async function loadAssets() {
  loading.value = true
  try {
    const dramaId = parseDramaFilter(selectedDramaId.value)
    assets.value = await assetAPI.list({
      drama_id: dramaId || undefined,
      q: keyword.value.trim() || undefined,
    }) || []
    resetVisibleCount()
  } catch (e) {
    toast.error(e?.message || '加载资产失败')
  } finally {
    loading.value = false
  }
}

async function syncDrama() {
  const dramaId = parseDramaFilter(selectedDramaId.value)
  if (!dramaId) {
    toast.warning('请先选择要同步的项目')
    return
  }
  syncing.value = true
  try {
    const res = await assetAPI.sync(dramaId)
    toast.success(`已同步 ${res?.synced || 0} 条资产`)
    await loadAssets()
  } catch (e) {
    toast.error(e?.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

function onCreateFile(event) {
  createForm.value.file = event?.target?.files?.[0] || null
}

function onEditFile(event) {
  editForm.value.file = event?.target?.files?.[0] || null
}

function openEdit(item) {
  editForm.value = {
    id: item.id,
    type: item.type,
    name: item.name || '',
    description: item.description || '',
    file: null,
  }
  openEditModal.value = true
}

function closeEdit() {
  openEditModal.value = false
  editForm.value = { id: null, type: 'character', name: '', description: '', file: null }
}

async function submitEdit() {
  if (!editForm.value.name.trim()) {
    toast.warning('请填写资产名称')
    return
  }
  if (!editForm.value.id) return
  savingEdit.value = true
  try {
    let assetId = editForm.value.id
    const original = assets.value.find(item => item.id === assetId)
    const nameChanged = editForm.value.name.trim() !== String(original?.name || '').trim()
    const descChanged = editForm.value.description.trim() !== String(original?.description || '').trim()
    if (nameChanged || descChanged) {
      const updated = await assetAPI.update(assetId, {
        name: editForm.value.name.trim(),
        description: editForm.value.description.trim() || null,
      })
      if (updated?.id) assetId = updated.id
    }
    if (editForm.value.file) {
      const form = new FormData()
      form.append('file', editForm.value.file)
      const res = await assetAPI.uploadToAsset(assetId, form)
      if (res?.oss_warning) {
        toast.warning(`图片已保存，云端同步失败：${res.oss_warning}`)
      }
    }
    toast.success('资产已更新')
    closeEdit()
    await loadAssets()
  } catch (e) {
    toast.error(e?.message || '保存失败')
  } finally {
    savingEdit.value = false
  }
}

async function submitCreate() {
  if (!createForm.value.name.trim()) {
    toast.warning('请填写资产名称')
    return
  }
  if (createForm.value.type === 'voice' && !createForm.value.file) {
    toast.warning('请上传 MP3 文件')
    return
  }
  creating.value = true
  try {
    if (createForm.value.file) {
      const form = new FormData()
      form.append('file', createForm.value.file)
      form.append('type', createForm.value.type)
      form.append('name', createForm.value.name.trim())
      if (createForm.value.description) form.append('description', createForm.value.description.trim())
      if (createForm.value.drama_id) form.append('drama_id', String(createForm.value.drama_id))
      await assetAPI.upload(form)
    } else {
      await assetAPI.create({
        type: createForm.value.type,
        name: createForm.value.name.trim(),
        description: createForm.value.description.trim() || undefined,
        drama_id: createForm.value.drama_id || undefined,
      })
    }
    toast.success('资产已添加')
    openCreate.value = false
    createForm.value = { type: activeType.value, name: '', description: '', drama_id: selectedDramaId.value, file: null }
    await loadAssets()
  } catch (e) {
    toast.error(e?.message || '添加失败')
  } finally {
    creating.value = false
  }
}

async function removeAsset(item) {
  if (!confirm(`删除资产「${item.name}」？`)) return
  try {
    await assetAPI.del(item.id)
    toast.success('已删除')
    await loadAssets()
  } catch (e) {
    toast.error(e?.message || '删除失败')
  }
}

watch([selectedDramaId, keyword], () => {
  resetVisibleCount()
  loadAssets()
})

watch(activeType, () => {
  resetVisibleCount()
})

watch(() => route.path, (path) => {
  if (path === '/assets' || path.startsWith('/assets/')) {
    loadAssets()
  }
})

onMounted(async () => {
  const query = useRoute().query
  if (query.drama_id) selectedDramaId.value = String(query.drama_id)
  if (query.type && ASSET_CATEGORIES.some(item => item.id === query.type)) {
    activeType.value = String(query.type)
  }
  keyword.value = ''
  await loadDramas()
  await loadAssets()
})
</script>

<style scoped>
.page { padding: 24px; overflow: auto; height: 100%; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.head-actions { display: flex; gap: 8px; }
.library-toolbar {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
}
.toolbar-field { display: flex; flex-direction: column; gap: 4px; min-width: 180px; }
.toolbar-field.grow { flex: 1; }
.toolbar-label { font-size: 11px; color: var(--text-dim); }
.library-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.library-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  cursor: pointer;
  font-size: 12px;
}
.library-tab.active { border-color: var(--accent); color: var(--accent-text); background: var(--accent-bg); }
.library-tab-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-2);
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.library-empty { padding: 40px; text-align: center; }
.library-more {
  display: flex;
  justify-content: center;
  padding: 16px 0 8px;
}
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.asset-card { overflow: hidden; }
.asset-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  background: var(--bg-2);
  overflow: hidden;
}
.asset-cover.wide { aspect-ratio: 16 / 9; }
.asset-cover-btn {
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
  display: block;
}
.asset-cover :deep(.grid-media-image),
.asset-cover :deep(.grid-media-empty) {
  width: 100%;
  height: 100%;
}
.asset-cover-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 12px;
}
.asset-cover-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(0,0,0,0.55);
  color: #fff;
}
.asset-body { padding: 10px; }
.asset-name { font-size: 13px; font-weight: 600; }
.asset-meta { font-size: 11px; margin-top: 2px; }
.asset-foot {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 12, 20, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.modal-card { width: min(420px, 100%); padding: 16px; }
.modal-title { margin: 0 0 12px; font-size: 16px; }
.modal-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.image-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0,0,0,0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.image-viewer-overlay img { max-width: min(92vw, 960px); max-height: 80vh; object-fit: contain; }
.image-viewer-title { color: #fff; margin-top: 12px; font-size: 13px; }
.asset-voice-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  width: 100%;
  min-height: 88px;
  justify-content: center;
}
.asset-voice-preview audio { width: 100%; height: 32px; }
.asset-voice-duration { font-size: 11px; color: var(--text-3); text-align: center; }
.asset-cover.voice { aspect-ratio: auto; min-height: 108px; }
</style>
