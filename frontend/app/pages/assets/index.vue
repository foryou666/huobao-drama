<template>
  <div class="page">
    <div class="page-head">
      <div class="head-left">
        <h1 class="page-title">资产库</h1>
        <p class="page-desc">角色、场景、服装、道具、参考图与音色库统一归档；虚拟人像在造型分组内对单张图认证，通道2选用时自动走 asset://</p>
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

    <div v-if="initialLoading && !assets.length" class="asset-grid asset-grid-skeleton">
      <div v-for="n in 12" :key="`sk-${n}`" class="card asset-card skeleton-card">
        <div class="skeleton-cover" />
        <div class="skeleton-line" />
        <div class="skeleton-line short" />
      </div>
    </div>
    <div v-else-if="refreshing && !assets.length" class="dim library-empty">加载中…</div>
    <div v-else-if="!filteredAssets.length" class="library-empty card">
      <p class="dim">暂无{{ assetCategoryLabel(activeType) }}</p>
      <p class="dim" style="font-size:12px;margin-top:8px">{{ activeType === 'voice' ? '上传 MP3 音色参考（3~10 秒），绑定项目后可在视频生成中使用' : '各剧角色/场景会自动同步；也可手动添加或上传图片' }}</p>
    </div>
    <div v-else class="asset-grid">
      <div v-for="item in visibleAssets" :key="item.id" class="card asset-card">
        <div class="asset-cover" :class="{ voice: activeType === 'voice' }">
          <template v-if="activeType === 'voice'">
            <div v-if="item.url || item.local_path || item.localPath" class="asset-voice-preview">
              <audio :src="'/' + normalizePath(item.url || item.local_path || item.localPath)" controls preload="none" />
              <span v-if="item.duration" class="asset-voice-duration">{{ item.duration }}s</span>
            </div>
            <div v-else class="asset-cover-empty">待上传</div>
          </template>
          <template v-else>
          <button
            v-if="resolveAssetCoverPath(item)"
            type="button"
            class="asset-cover-btn"
            @click="openAssetPreview(item)"
          >
            <GridMediaImage
              :src="resolveAssetCoverPath(item)"
              :thumb="item.thumbnail_url || item.thumbnailUrl"
              :alt="item.name"
            />
          </button>
          <div v-else class="asset-cover-empty">待上传</div>
          </template>
          <span class="asset-cover-badge" :class="resolveAssetCoverPath(item) ? 'is-ready' : ''">
            {{ item.source_type === 'manual' ? '手动' : item.source_type === 'import' ? '导入' : '同步' }}
          </span>
        </div>
        <div class="asset-body">
          <div class="asset-name-row">
            <div class="asset-name">{{ item.name }}</div>
            <span
              v-if="activeType === 'character' && resolveLinkedCharacterId(item)"
              class="tag asset-portrait-tag"
              :class="portraitStatusClass(item)"
              :title="portraitStatusTitle(item)"
            >{{ portraitStatusLabel(item) }}</span>
          </div>
          <div class="asset-meta dim">{{ dramaTitle(item.drama_id || item.dramaId) }}</div>
          <CharacterMediaStrip
            v-if="activeType === 'character' && resolveCharacterMedia(item)"
            :char="portraitCharFromAsset(item)"
            :media="resolveCharacterMedia(item)"
            layout="outfits"
            compact
            landscape
            expandable
            :max-visible="12"
            :clickable="!!(resolveCharacterMedia(item)?.preview_images?.length || resolveCharacterMedia(item)?.outfit_previews?.length)"
            @preview="(img) => openCharacterMediaPreview(item, img)"
          />
          <div v-if="activeType === 'character' && resolveLinkedCharacterId(item)" class="asset-outfit-section">
            <div class="asset-outfit-section-head">
              <span class="asset-outfit-label">造型分组</span>
              <div class="asset-outfit-head-actions">
                <label
                  class="btn btn-sm asset-outfit-upload-btn"
                  :class="{ 'is-disabled': isPendingNewOutfitUpload(resolveLinkedCharacterId(item)) || !assetHasPrimaryImage(item) }"
                >
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    :disabled="isPendingNewOutfitUpload(resolveLinkedCharacterId(item)) || !assetHasPrimaryImage(item)"
                    @change="uploadNewOutfit(item, $event)"
                  />
                  {{ isPendingNewOutfitUpload(resolveLinkedCharacterId(item)) ? '上传中' : '本地上传建组' }}
                </label>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="!assetHasPrimaryImage(item) || !resolveLinkedCharacterId(item)"
                  @click="openOutfitImageModal(item, null, 'ai', true)"
                >
                  AI 建组
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="!assetHasPrimaryImage(item) || !resolveLinkedCharacterId(item)"
                  @click="openOutfitImageModal(item, null, 'fusion', true)"
                >
                  溶图建组
                </button>
              </div>
            </div>
            <p v-if="!assetHasPrimaryImage(item)" class="dim asset-outfit-hint">请先上传或生成角色基准图</p>
            <p v-else class="dim asset-outfit-hint">
              每张图可独立「认证人像」；通道2选用已认证图时自动走 asset://
            </p>
            <!-- 角色主图：无造型分组时也是唯一可认证图 -->
            <div
              v-if="assetHasPrimaryImage(item)"
              class="asset-outfit-row asset-primary-portrait-row"
            >
              <div class="asset-outfit-row-main">
                <span class="asset-outfit-name">角色主图</span>
                <span class="tag asset-portrait-tag" :class="primaryPortraitStatusClass(item)">{{ primaryPortraitStatusLabel(item) }}</span>
              </div>
              <div class="asset-outfit-candidates">
                <div
                  class="asset-outfit-candidate"
                  :class="{ 'is-certified': isPortraitActive(item) }"
                >
                  <button
                    type="button"
                    class="asset-outfit-candidate-thumb"
                    title="角色主图"
                    @click="openPrimaryImagePreview(item)"
                  >
                    <GridMediaImage :src="resolveCharacterPrimaryPath(item)" :alt="item.name || '主图'" />
                    <span
                      v-if="isPortraitActive(item)"
                      class="asset-outfit-candidate-badge"
                    >已认证</span>
                    <span
                      v-else-if="isPortraitProcessing(item)"
                      class="asset-outfit-candidate-badge is-processing"
                    >审核中</span>
                  </button>
                  <button
                    v-if="!isPortraitActive(item)"
                    type="button"
                    class="btn btn-sm btn-primary asset-outfit-set-default"
                    :disabled="isPortraitBusy(item)"
                    @click="certifyPortrait(item)"
                  >
                    {{ isPortraitBusy(item) ? '认证中…' : (isPortraitFailed(item) || isPortraitPending(item) ? '重新认证' : '认证人像') }}
                  </button>
                  <template v-else>
                    <button
                      type="button"
                      class="btn btn-sm asset-outfit-set-default"
                      :disabled="isPortraitBusy(item)"
                      @click="recertifyPortrait(item)"
                    >
                      {{ isPortraitBusy(item) ? '认证中…' : '更新认证' }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost asset-outfit-set-default"
                      :disabled="isPortraitBusy(item)"
                      @click="cancelPortrait(item)"
                    >
                      取消认证
                    </button>
                  </template>
                  <button
                    v-if="isPortraitProcessing(item)"
                    type="button"
                    class="btn btn-sm btn-ghost asset-outfit-set-default"
                    :disabled="isPortraitBusy(item)"
                    @click="refreshPortraitStatus(item)"
                  >
                    刷新状态
                  </button>
                </div>
              </div>
            </div>
            <p
              v-if="assetHasPrimaryImage(item) && !resolveCharacterOutfits(item).length"
              class="dim asset-outfit-hint"
            >
              也可再建造型分组，对组内其它图分别认证
            </p>
            <div v-if="resolveCharacterOutfits(item).length" class="asset-outfit-list">
              <div
                v-for="outfit in resolveCharacterOutfits(item)"
                :key="`${item.id}:${outfit.outfit_id}`"
                class="asset-outfit-row"
              >
                <div class="asset-outfit-row-main">
                  <span class="asset-outfit-name">{{ outfit.label }}</span>
                  <span
                    class="tag asset-portrait-tag"
                    :class="outfitPortraitStatusClassLocal(outfit)"
                  >{{ outfitPortraitStatusLabelLocal(outfit, item) }}</span>
                  <span class="dim asset-outfit-count">{{ outfit.candidate_count || 0 }} 张</span>
                </div>
                <div class="asset-outfit-row-actions">
                  <label
                    class="btn btn-sm asset-outfit-upload-btn"
                    :class="{ 'is-disabled': isPendingOutfitUpload(resolveLinkedCharacterId(item), outfit.outfit_id) }"
                  >
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      :disabled="isPendingOutfitUpload(resolveLinkedCharacterId(item), outfit.outfit_id)"
                      @change="uploadOutfitCandidate(item, outfit, $event)"
                    />
                    {{ isPendingOutfitUpload(resolveLinkedCharacterId(item), outfit.outfit_id) ? '上传中' : '本地上传' }}
                  </label>
                  <button
                    type="button"
                    class="btn btn-sm"
                    @click="openOutfitImageModal(item, outfit, 'ai', false)"
                  >
                    AI 生图
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm"
                    @click="openOutfitImageModal(item, outfit, 'fusion', false)"
                  >
                    溶图
                  </button>
                </div>
                <div
                  v-if="outfitCandidates(outfit).length"
                  class="asset-outfit-candidates"
                >
                  <div
                    v-for="candidate in outfitCandidates(outfit)"
                    :key="`${outfit.outfit_id}:${candidate.id}`"
                    class="asset-outfit-candidate"
                    :class="{ 'is-certified': isCandidatePortraitActiveLocal(candidate) }"
                  >
                    <button
                      type="button"
                      class="asset-outfit-candidate-thumb"
                      :title="candidate.label || '备选'"
                      @click="openOutfitCandidatePreview(item, outfit, candidate)"
                    >
                      <GridMediaImage :src="candidate.url" :alt="candidate.label || outfit.label" />
                      <span
                        v-if="isCandidatePortraitActiveLocal(candidate)"
                        class="asset-outfit-candidate-badge"
                      >已认证</span>
                      <span
                        v-else-if="candidatePortraitStatusOf(candidate) === 'processing'"
                        class="asset-outfit-candidate-badge is-processing"
                      >审核中</span>
                    </button>
                    <button
                      v-if="!isCandidatePortraitActiveLocal(candidate)"
                      type="button"
                      class="btn btn-sm btn-primary asset-outfit-set-default"
                      :disabled="!candidate.url || isPortraitBusy(item, outfit.outfit_id, candidate.id)"
                      @click="certifyPortrait(item, { outfitId: outfit.outfit_id, candidateId: candidate.id })"
                    >
                      {{ isPortraitBusy(item, outfit.outfit_id, candidate.id) ? '认证中…' : (isCandidatePortraitFailed(candidate) || isCandidatePortraitPending(candidate) ? '重新认证' : '认证人像') }}
                    </button>
                    <template v-else>
                      <button
                        type="button"
                        class="btn btn-sm asset-outfit-set-default"
                        :disabled="isPortraitBusy(item, outfit.outfit_id, candidate.id)"
                        @click="recertifyPortrait(item, outfit.outfit_id, candidate.id)"
                      >
                        {{ isPortraitBusy(item, outfit.outfit_id, candidate.id) ? '认证中…' : '更新认证' }}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost asset-outfit-set-default"
                        :disabled="isPortraitBusy(item, outfit.outfit_id, candidate.id)"
                        @click="cancelPortrait(item, outfit.outfit_id, candidate.id)"
                      >
                        取消认证
                      </button>
                    </template>
                    <button
                      v-if="candidatePortraitStatusOf(candidate) === 'processing'"
                      type="button"
                      class="btn btn-sm btn-ghost asset-outfit-set-default"
                      @click="refreshPortraitStatus(item, outfit.outfit_id, candidate.id)"
                    >
                      刷新状态
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p v-else-if="activeType === 'character'" class="dim asset-outfit-unlinked">未关联项目角色，无法管理造型分组</p>
          <EntityViewMediaStrip
            v-if="activeType === 'scene' && resolveSceneMedia(item)"
            :media="resolveSceneMedia(item)"
            theme="scene"
            compact
            landscape
            :max-visible="12"
            :clickable="!!resolveSceneMedia(item)?.preview_images?.length"
            @preview="(img) => openEntityMediaPreview(item, img)"
          />
          <EntityViewMediaStrip
            v-if="activeType === 'prop' && resolvePropMedia(item)"
            :media="resolvePropMedia(item)"
            theme="prop"
            compact
            landscape
            :max-visible="12"
            :clickable="!!resolvePropMedia(item)?.preview_images?.length"
            @preview="(img) => openEntityMediaPreview(item, img)"
          />
          <div v-if="item.description" class="asset-meta dim truncate">{{ item.description }}</div>
        </div>
        <div class="asset-foot">
          <button v-if="activeType !== 'voice'" type="button" class="btn btn-sm" @click="openAssetPreview(item)">预览</button>
          <button type="button" class="btn btn-sm" @click="openEdit(item)">编辑</button>
          <button type="button" class="btn btn-sm danger ml-auto" @click="removeAsset(item)">删除</button>
        </div>
      </div>
    </div>

    <div v-if="!initialLoading && hasMoreAssets" class="library-more">
      <button type="button" class="btn btn-sm" @click="loadMoreAssets">
        加载更多（{{ visibleAssets.length }}/{{ filteredAssets.length }}）
      </button>
    </div>

    <div v-if="imageViewer.open" class="image-viewer-overlay" @click="closeImageViewer">
      <div class="image-viewer-panel" @click.stop>
        <img :src="imageViewer.src" :alt="imageViewer.title" />
        <div class="image-viewer-bar">
          <span class="image-viewer-title">{{ imageViewer.title }}</span>
          <button
            v-if="isAdmin && imageViewer.canDelete"
            type="button"
            class="btn btn-sm danger"
            :disabled="deletingImage"
            @click="deleteViewerImage"
          >
            {{ deletingImage ? '删除中…' : '删除图片' }}
          </button>
        </div>
      </div>
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
          <span>所属项目{{ createForm.type === 'character' ? '' : '（可选）' }}</span>
          <select v-model="createForm.drama_id" class="input">
            <option :value="null">不绑定项目</option>
            <option v-for="d in dramas" :key="d.id" :value="d.id">{{ d.title }}</option>
          </select>
          <span v-if="createForm.type === 'character'" class="dim asset-create-hint">视频/图片页「选择角色」只显示已绑定项目的角色，建议必选项目</span>
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

    <CharacterOutfitImageModal
      :open="outfitImageModal.open"
      :char-id="outfitImageModal.charId"
      :outfit-id="outfitImageModal.outfitId"
      :outfit-label="outfitImageModal.outfitLabel"
      :is-new-outfit="outfitImageModal.isNewOutfit"
      :drama-id="outfitImageModal.dramaId"
      :character-path="outfitImageModal.characterPath"
      :character-name="outfitImageModal.characterName"
      :initial-mode="outfitImageModal.initialMode"
      @close="closeOutfitImageModal"
      @done="onOutfitImageDone"
    />
  </div>
</template>

<script setup>
import { dramaAPI, assetAPI, characterAPI, portraitAPI } from '~/composables/useApi'
import { ASSET_CATEGORIES, assetCategoryLabel } from '~/utils/asset-categories.js'
import { mediaDisplayUrl, normalizeMediaPath, prefetchMediaUrlsInBackground, collectMediaPrefetchPaths } from '~/utils/media-url.js'
import GridMediaImage from '~/components/GridMediaImage.vue'
import CharacterMediaStrip from '~/components/CharacterMediaStrip.vue'
import EntityViewMediaStrip from '~/components/EntityViewMediaStrip.vue'
import CharacterOutfitImageModal from '~/components/CharacterOutfitImageModal.vue'
import {
  characterImageTagLabel,
  resolveCharacterCoverUrl,
  resolveOutfitPreviewsFromMedia,
  slugifyOutfitId,
} from '~/utils/character-image-variants.js'
import { resolveViewPreviewsFromMedia } from '~/utils/entity-view-media.js'
import { toast } from 'vue-sonner'

const { isAdmin } = useAuth()

const GRID_PAGE_SIZE = 48
const ASSETS_CACHE_PREFIX = 'assets-library-v1'
const DRAMA_CACHE_KEY = 'assets-library-dramas-lite-v1'

const dramas = ref([])
const assets = ref([])
const assetTypeCounts = ref({})
const initialLoading = ref(true)
const refreshing = ref(false)
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
const imageViewer = ref({
  open: false,
  src: '',
  title: '',
  rawPath: '',
  item: null,
  canDelete: false,
})
const deletingImage = ref(false)
const visibleCount = ref(GRID_PAGE_SIZE)
const pendingCharOutfitUploadKeys = ref([])
const pendingNewOutfitUploadIds = ref([])
const pendingPortraitIds = ref([])
const portraitPollTimers = new Map()
const outfitImageModal = ref({
  open: false,
  charId: null,
  outfitId: '',
  outfitLabel: '',
  isNewOutfit: false,
  dramaId: null,
  characterPath: '',
  characterName: '',
  initialMode: 'upload',
})

function assetsCacheKey() {
  const dramaId = parseDramaFilter(selectedDramaId.value) || 'all'
  const q = keyword.value.trim() || ''
  return `${ASSETS_CACHE_PREFIX}:${activeType.value}:${dramaId}:${q}`
}

function restoreAssetsCache() {
  try {
    const raw = sessionStorage.getItem(assetsCacheKey())
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items)) return false
    assets.value = parsed.items
    assetTypeCounts.value = parsed.counts || {}
    return true
  } catch {
    return false
  }
}

function persistAssetsCache() {
  try {
    sessionStorage.setItem(assetsCacheKey(), JSON.stringify({
      items: assets.value,
      counts: assetTypeCounts.value,
      savedAt: Date.now(),
    }))
  } catch {
    // ignore quota / private mode
  }
}

function restoreDramaCache() {
  try {
    const raw = sessionStorage.getItem(DRAMA_CACHE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items) || !parsed.items.length) return false
    dramas.value = parsed.items
    return true
  } catch {
    return false
  }
}

function persistDramaCache() {
  try {
    sessionStorage.setItem(DRAMA_CACHE_KEY, JSON.stringify({
      items: dramas.value,
      savedAt: Date.now(),
    }))
  } catch {
    // ignore
  }
}

function prefetchVisibleAssetMedia() {
  const paths = visibleAssets.value.flatMap(item => collectMediaPrefetchPaths(
    resolveAssetCoverPath(item),
    item.thumbnail_url,
    item.thumbnailUrl,
  ))
  prefetchMediaUrlsInBackground(paths)
}
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
      if (itemDramaId !== dramaId) return false
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
  if (assetTypeCounts.value[type] != null) return assetTypeCounts.value[type]
  const dramaId = parseDramaFilter(selectedDramaId.value)
  return assets.value.filter(item => {
    if (item.type !== type) return false
    if (!dramaId) return true
    const itemDramaId = item.drama_id ?? item.dramaId ?? null
    return itemDramaId === dramaId
  }).length
}

function enrichEntityMedia(media, primaryTag) {
  if (!media?.preview_images?.length) return null
  return {
    ...media,
    view_previews: resolveViewPreviewsFromMedia(media),
  }
}

function resolveLinkedCharacterId(item) {
  const linked = Number(item?.linked_character_id ?? item?.linkedCharacterId)
  if (Number.isFinite(linked) && linked > 0) return linked
  const fromSource = Number(item?.source_id ?? item?.sourceId)
  if ((item?.source_type === 'character' || item?.sourceType === 'character') && Number.isFinite(fromSource) && fromSource > 0) {
    return fromSource
  }
  return null
}

function portraitStatusOf(item) {
  return String(item?.seedance_asset_status ?? item?.seedanceAssetStatus ?? '').toLowerCase()
}

function hasPortraitAsset(item) {
  return !!(item?.seedance_asset_id || item?.seedanceAssetId)
}

function isPortraitActive(item) {
  return portraitStatusOf(item) === 'active' && hasPortraitAsset(item)
}

function isPortraitProcessing(item) {
  return portraitStatusOf(item) === 'processing'
}

function isPortraitFailed(item) {
  return portraitStatusOf(item) === 'failed'
}

function isPortraitPending(item) {
  const s = portraitStatusOf(item)
  return s === 'pending' || (hasPortraitAsset(item) && !s)
}

function primaryPortraitStatusLabel(item) {
  if (isPortraitBusy(item) && isPortraitProcessing(item)) return '认证中'
  if (isPortraitActive(item)) return '已认证'
  if (isPortraitProcessing(item)) return '审核中'
  if (isPortraitFailed(item)) return '认证失败'
  if (isPortraitPending(item)) return '需重新认证'
  return '未认证'
}

function primaryPortraitStatusClass(item) {
  if (isPortraitActive(item)) return 'tag-success'
  if (isPortraitProcessing(item) || isPortraitBusy(item)) return 'tag-accent'
  if (isPortraitFailed(item)) return 'tag-error'
  return ''
}

/** 卡片角标：任一造型定稿或主图已认证即显示已认证 */
function portraitStatusLabel(item) {
  const outfits = resolveCharacterOutfits(item)
  if (outfits.some(o => isOutfitPortraitActiveLocal(o))) return '已认证'
  if (outfits.some(o => isOutfitPortraitProcessing(o)) || isPortraitProcessing(item)) return '审核中'
  if (isPortraitBusy(item) || outfits.some(o => isPortraitBusy(item, o.outfit_id))) return '认证中'
  if (outfits.some(o => isOutfitPortraitFailed(o)) || isPortraitFailed(item)) return '认证失败'
  if (outfits.some(o => isOutfitPortraitPending(o)) || isPortraitPending(item)) return '需重新认证'
  if (isPortraitActive(item)) return '已认证'
  return '未认证'
}

function portraitStatusClass(item) {
  const label = portraitStatusLabel(item)
  if (label === '已认证') return 'tag-success'
  if (label === '审核中' || label === '认证中') return 'tag-accent'
  if (label === '认证失败') return 'tag-error'
  return ''
}

function portraitStatusTitle(item) {
  const outfits = resolveCharacterOutfits(item)
  const activeOutfit = outfits.find(o => isOutfitPortraitActiveLocal(o))
  if (activeOutfit?.seedance_asset_id || activeOutfit?.seedanceAssetId) {
    return `${activeOutfit.label} 定稿已认证：asset://${activeOutfit.seedance_asset_id || activeOutfit.seedanceAssetId}`
  }
  const id = item?.seedance_asset_id || item?.seedanceAssetId
  if (isPortraitActive(item) && id) return `角色主图已认证：asset://${id}`
  if (isPortraitPending(item)) return '主图已变更，请重新认证或取消以腾出配额'
  return '对造型分组内每张图独立认证；通道2选用已认证图时走 asset://'
}

function outfitCandidates(outfit) {
  const list = Array.isArray(outfit?.candidates) ? outfit.candidates : []
  if (list.length) return list
  const url = normalizeMediaPath(outfit?.url || '')
  if (!url) return []
  return [{ id: 'default', url, label: '备选', is_default: true }]
}

function openOutfitCandidatePreview(item, outfit, candidate) {
  const raw = normalizeMediaPath(candidate?.url || '')
  if (!raw) return
  openImageViewer({
    src: mediaDisplayUrl(raw),
    title: `${item.name} · ${outfit.label} · ${candidate.label || '图片'}`,
    rawPath: raw,
    item,
    canDelete: false,
  })
}

function openPrimaryImagePreview(item) {
  const raw = resolveCharacterPrimaryPath(item)
  if (!raw) return
  openImageViewer({
    src: mediaDisplayUrl(raw),
    title: `${item.name} · 角色主图`,
    rawPath: raw,
    item,
    canDelete: false,
  })
}

function isPortraitBusy(item, outfitId = null, candidateId = null) {
  const charId = resolveLinkedCharacterId(item)
  if (!charId) return false
  const key = portraitPendingKey(charId, outfitId, candidateId)
  return pendingPortraitIds.value.includes(key)
}

function portraitPendingKey(charId, outfitId = null, candidateId = null) {
  if (outfitId && candidateId) return `${charId}:outfit:${outfitId}:cand:${candidateId}`
  if (outfitId) return `${charId}:outfit:${outfitId}`
  return String(charId)
}

function portraitCharFromAsset(item) {
  const media = resolveCharacterMedia(item)
  return {
    id: resolveLinkedCharacterId(item),
    name: item?.name,
    image_url: media?.primary_url || item?.url,
    imageUrl: media?.primary_url || item?.url,
    local_path: item?.local_path || item?.localPath,
    localPath: item?.local_path || item?.localPath,
    seedance_asset_id: item?.seedance_asset_id || item?.seedanceAssetId,
    seedance_asset_status: item?.seedance_asset_status || item?.seedanceAssetStatus,
    seedanceAssetId: item?.seedance_asset_id || item?.seedanceAssetId,
    seedanceAssetStatus: item?.seedance_asset_status || item?.seedanceAssetStatus,
    character_media: media,
    characterMedia: media,
  }
}

function hasOutfitPortraitAsset(outfit) {
  return !!(outfit?.seedance_asset_id || outfit?.seedanceAssetId)
}

function outfitPortraitStatusOf(outfit) {
  return String(outfit?.seedance_asset_status ?? outfit?.seedanceAssetStatus ?? '').toLowerCase()
}

function isOutfitPortraitActiveLocal(outfit) {
  if ((outfit?.candidates || []).some(isCandidatePortraitActiveLocal)) return true
  const status = outfitPortraitStatusOf(outfit)
  return status === 'active' && hasOutfitPortraitAsset(outfit)
}

function isOutfitPortraitProcessing(outfit) {
  if ((outfit?.candidates || []).some(c => candidatePortraitStatusOf(c) === 'processing')) return true
  return outfitPortraitStatusOf(outfit) === 'processing'
}

function isOutfitPortraitFailed(outfit) {
  if ((outfit?.candidates || []).some(isCandidatePortraitFailed)) return true
  return outfitPortraitStatusOf(outfit) === 'failed'
}

function isOutfitPortraitPending(outfit) {
  if ((outfit?.candidates || []).some(isCandidatePortraitPending)) return true
  const s = outfitPortraitStatusOf(outfit)
  return s === 'pending' || (hasOutfitPortraitAsset(outfit) && !s)
}

function candidatePortraitStatusOf(candidate) {
  return String(candidate?.seedance_asset_status ?? candidate?.seedanceAssetStatus ?? '').toLowerCase()
}

function isCandidatePortraitActiveLocal(candidate) {
  const status = candidatePortraitStatusOf(candidate)
  const assetId = candidate?.seedance_asset_id || candidate?.seedanceAssetId
  return status === 'active' && !!assetId
}

function isCandidatePortraitFailed(candidate) {
  return candidatePortraitStatusOf(candidate) === 'failed'
}

function isCandidatePortraitPending(candidate) {
  const s = candidatePortraitStatusOf(candidate)
  const assetId = candidate?.seedance_asset_id || candidate?.seedanceAssetId
  return s === 'pending' || (!!assetId && !s)
}

function outfitPortraitStatusLabelLocal(outfit, item) {
  if (isOutfitPortraitProcessing(outfit) && outfitCandidates(outfit).some(c => isPortraitBusy(item, outfit?.outfit_id, c.id))) {
    return '认证中'
  }
  if (isOutfitPortraitActiveLocal(outfit)) return '已认证'
  if (isOutfitPortraitProcessing(outfit)) return '审核中'
  if (isOutfitPortraitFailed(outfit)) return '认证失败'
  if (isOutfitPortraitPending(outfit)) return '需重新认证'
  return '未认证'
}

function outfitPortraitStatusClassLocal(outfit) {
  if (isOutfitPortraitActiveLocal(outfit)) return 'tag-success'
  if (isOutfitPortraitProcessing(outfit)) return 'tag-accent'
  if (isOutfitPortraitFailed(outfit)) return 'tag-error'
  return ''
}

function patchAssetPortraitFields(item, patch, outfitId = null, candidateId = null) {
  if (!item) return
  if (!outfitId) {
    Object.assign(item, patch)
    if (patch.seedance_asset_id !== undefined) item.seedanceAssetId = patch.seedance_asset_id
    if (patch.seedance_asset_group_id !== undefined) item.seedanceAssetGroupId = patch.seedance_asset_group_id
    if (patch.seedance_asset_status !== undefined) item.seedanceAssetStatus = patch.seedance_asset_status
    return
  }
  const media = item.character_media || item.characterMedia
  if (!media) return
  const outfits = media.outfit_previews || media.outfitPreviews || []
  const target = outfits.find(o => o.outfit_id === outfitId || o.outfitId === outfitId)
  if (!target) return
  if (candidateId) {
    const candidates = target.candidates || []
    const cand = candidates.find(c => c.id === candidateId)
    if (cand) {
      if (patch.seedance_asset_id !== undefined) {
        cand.seedance_asset_id = patch.seedance_asset_id
        cand.seedanceAssetId = patch.seedance_asset_id
      }
      if (patch.seedance_asset_status !== undefined) {
        cand.seedance_asset_status = patch.seedance_asset_status
        cand.seedanceAssetStatus = patch.seedance_asset_status
      }
      if (patch.seedance_certified_url !== undefined) {
        cand.seedance_certified_url = patch.seedance_certified_url
      }
    }
  }
  if (patch.seedance_asset_id !== undefined) {
    target.seedance_asset_id = patch.seedance_asset_id
    target.seedanceAssetId = patch.seedance_asset_id
  }
  if (patch.seedance_asset_status !== undefined) {
    target.seedance_asset_status = patch.seedance_asset_status
    target.seedanceAssetStatus = patch.seedance_asset_status
  }
  if (patch.seedance_asset_group_id !== undefined) {
    item.seedance_asset_group_id = patch.seedance_asset_group_id
    item.seedanceAssetGroupId = patch.seedance_asset_group_id
  }
}

function applyOutfitListFromResponse(item, outfits) {
  if (!item || !Array.isArray(outfits) || !outfits.length) return
  const media = item.character_media || item.characterMedia
  if (!media) return
  const mapped = outfits.map(o => ({
    outfit_id: o.outfit_id || o.outfitId,
    label: o.label,
    url: o.url,
    candidate_count: Array.isArray(o.candidates) ? o.candidates.length : (o.candidate_count || 0),
    seedance_asset_id: o.seedance_asset_id ?? o.seedanceAssetId ?? null,
    seedance_asset_status: o.seedance_asset_status ?? o.seedanceAssetStatus ?? null,
    seedance_certified_url: o.seedance_certified_url ?? o.seedanceCertifiedUrl ?? null,
    candidates: (o.candidates || []).map(c => ({
      id: c.id,
      url: c.url,
      label: c.label || '备选',
      is_default: !!(c.is_default || c.isDefault)
        || normalizeMediaPath(c.url) === normalizeMediaPath(o.url),
      seedance_asset_id: c.seedance_asset_id ?? c.seedanceAssetId ?? null,
      seedance_asset_status: c.seedance_asset_status ?? c.seedanceAssetStatus ?? null,
      seedance_certified_url: c.seedance_certified_url ?? c.seedanceCertifiedUrl ?? null,
    })),
  }))
  media.outfit_previews = mapped
  media.outfitPreviews = mapped
}

async function certifyPortrait(item, {
  force = false,
  outfitId = null,
  candidateId = null,
  skipConfirm = false,
} = {}) {
  if (!skipConfirm) {
    const tip = outfitId
      ? '将提交该图到方舟虚拟人像审核，占用素材资产配额。确认？'
      : '将提交角色主图到方舟审核，占用素材资产配额。确认？'
    if (!confirm(tip)) return
  }
  const charId = resolveLinkedCharacterId(item)
  if (!charId) {
    toast.warning('未关联项目角色')
    return
  }
  if (!outfitId && !assetHasPrimaryImage(item)) {
    toast.warning('请先上传或生成角色基准图')
    return
  }
  if (outfitId) {
    const outfit = resolveCharacterOutfits(item).find(o => o.outfit_id === outfitId)
    const candidate = candidateId
      ? outfitCandidates(outfit).find(c => c.id === candidateId)
      : null
    if (candidateId && !candidate?.url) {
      toast.warning('图片不存在')
      return
    }
    if (!candidateId && !outfit?.url) {
      toast.warning('请先上传造型图片')
      return
    }
  }
  const busyKey = portraitPendingKey(charId, outfitId, candidateId)
  if (pendingPortraitIds.value.includes(busyKey)) return
  pendingPortraitIds.value = [...pendingPortraitIds.value, busyKey]
  patchAssetPortraitFields(item, { seedance_asset_status: 'processing' }, outfitId, candidateId)
  try {
    const res = await portraitAPI.syncAsset(charId, {
      force,
      ...(outfitId ? { outfit_id: outfitId } : {}),
      ...(candidateId ? { candidate_id: candidateId } : {}),
    })
    patchAssetPortraitFields(item, {
      seedance_asset_id: res?.seedance_asset_id || null,
      seedance_asset_group_id: res?.seedance_asset_group_id || null,
      seedance_asset_status: res?.seedance_asset_status || 'processing',
    }, outfitId, candidateId || res?.candidate_id)
    applyOutfitListFromResponse(item, res?.outfits)
    if (res?.skipped) {
      toast.success('已在方舟素材库（跳过重复提交）')
    } else if (res?.seedance_asset_status === 'active') {
      toast.success('人像认证成功')
    } else {
      toast.success('已提交认证，审核中…')
      startPortraitPoll(item, charId, outfitId, candidateId || res?.candidate_id)
    }
  } catch (e) {
    patchAssetPortraitFields(item, { seedance_asset_status: 'failed' }, outfitId, candidateId)
    toast.error(e?.message || '认证失败')
  } finally {
    pendingPortraitIds.value = pendingPortraitIds.value.filter(id => id !== busyKey)
  }
}

async function recertifyPortrait(item, outfitId = null, candidateId = null) {
  if (!confirm('将重新提交该图到方舟素材库（可能占用新的素材资产配额）。继续？')) return
  await certifyPortrait(item, { force: true, outfitId, candidateId, skipConfirm: true })
}

async function cancelPortrait(item, outfitId = null, candidateId = null) {
  const charId = resolveLinkedCharacterId(item)
  if (!charId) return
  if (!confirm('取消认证会删除方舟侧素材并腾出权益包配额。确定？')) return
  const busyKey = portraitPendingKey(charId, outfitId, candidateId)
  if (pendingPortraitIds.value.includes(busyKey)) return
  pendingPortraitIds.value = [...pendingPortraitIds.value, busyKey]
  try {
    const res = await portraitAPI.cancelAsset(charId, {
      ...(outfitId ? { outfit_id: outfitId } : {}),
      ...(candidateId ? { candidate_id: candidateId } : {}),
    })
    patchAssetPortraitFields(item, {
      seedance_asset_id: null,
      seedance_asset_group_id: res?.seedance_asset_group_id ?? null,
      seedance_asset_status: null,
    }, outfitId, candidateId)
    applyOutfitListFromResponse(item, res?.outfits)
    toast.success('已取消认证并释放配额')
  } catch (e) {
    toast.error(e?.message || '取消失败')
  } finally {
    pendingPortraitIds.value = pendingPortraitIds.value.filter(id => id !== busyKey)
  }
}

async function refreshPortraitStatus(item, outfitId = null, candidateId = null) {
  const charId = resolveLinkedCharacterId(item)
  if (!charId) return
  try {
    const res = await portraitAPI.assetStatus(charId, {
      ...(outfitId ? { outfit_id: outfitId } : {}),
      ...(candidateId ? { candidate_id: candidateId } : {}),
    })
    patchAssetPortraitFields(item, {
      seedance_asset_id: res?.seedance_asset_id || null,
      seedance_asset_status: res?.seedance_asset_status || null,
    }, outfitId, candidateId)
    applyOutfitListFromResponse(item, res?.outfits)
    if (res?.seedance_asset_status === 'active') toast.success('认证已通过')
    else if (res?.seedance_asset_status === 'failed') toast.error(res?.failed_reason || '认证未通过')
    else toast.message('仍在审核中')
  } catch (e) {
    toast.error(e?.message || '刷新失败')
  }
}

function startPortraitPoll(item, charId, outfitId = null, candidateId = null) {
  const key = portraitPendingKey(charId, outfitId, candidateId)
  if (portraitPollTimers.has(key)) return
  let tries = 0
  const timer = setInterval(async () => {
    tries += 1
    try {
      const res = await portraitAPI.assetStatus(charId, {
        ...(outfitId ? { outfit_id: outfitId } : {}),
        ...(candidateId ? { candidate_id: candidateId } : {}),
      })
      patchAssetPortraitFields(item, {
        seedance_asset_id: res?.seedance_asset_id || null,
        seedance_asset_status: res?.seedance_asset_status || null,
      }, outfitId, candidateId)
      applyOutfitListFromResponse(item, res?.outfits)
      if (res?.seedance_asset_status === 'active') {
        clearInterval(timer)
        portraitPollTimers.delete(key)
        toast.success('人像认证成功')
      } else if (res?.seedance_asset_status === 'failed' || tries >= 40) {
        clearInterval(timer)
        portraitPollTimers.delete(key)
        if (res?.seedance_asset_status === 'failed') {
          toast.error(res?.failed_reason || '人像认证失败')
        }
      }
    } catch {
      if (tries >= 40) {
        clearInterval(timer)
        portraitPollTimers.delete(key)
      }
    }
  }, 4000)
  portraitPollTimers.set(key, timer)
}

function resolveCharacterPrimaryPath(item) {
  const media = item?.character_media || item?.characterMedia
  const fromMedia = resolveCharacterCoverUrl(media)
  return normalizeMediaPath(fromMedia || item?.url || item?.local_path || item?.localPath)
}

function resolveAssetCoverPath(item) {
  if (item?.type === 'character') return resolveCharacterPrimaryPath(item)
  if (item?.type === 'scene') {
    const media = resolveSceneMedia(item)
    return normalizeMediaPath(media?.primary_url || media?.preview_images?.[0]?.url || item?.url || item?.local_path || item?.localPath)
  }
  if (item?.type === 'prop' || item?.type === 'costume') {
    const media = resolvePropMedia(item)
    return normalizeMediaPath(media?.primary_url || media?.preview_images?.[0]?.url || item?.url || item?.local_path || item?.localPath)
  }
  return normalizeMediaPath(item?.url || item?.local_path || item?.localPath)
}

function assetHasPrimaryImage(item) {
  return !!resolveAssetCoverPath(item)
}

function openOutfitImageModal(item, outfit, initialMode, isNewOutfit) {
  const charId = resolveLinkedCharacterId(item)
  if (!charId) {
    toast.warning('未关联项目角色，无法添加造型图')
    return
  }
  if (!assetHasPrimaryImage(item)) {
    toast.warning('请先上传或生成角色基准图')
    return
  }
  outfitImageModal.value = {
    open: true,
    charId,
    outfitId: outfit?.outfit_id || '',
    outfitLabel: outfit?.label || '',
    isNewOutfit: !!isNewOutfit,
    dramaId: Number(item?.drama_id || item?.dramaId) || null,
    characterPath: resolveCharacterPrimaryPath(item),
    characterName: item?.name || '',
    initialMode: initialMode || 'upload',
  }
}

function closeOutfitImageModal() {
  outfitImageModal.value = { ...outfitImageModal.value, open: false }
}

async function onOutfitImageDone() {
  await loadAssets()
}

function resolveCharacterOutfits(item) {
  const media = resolveCharacterMedia(item)
  if (!media) return []
  return resolveOutfitPreviewsFromMedia(media)
}

function outfitUploadKey(charId, outfitId) {
  return `${charId}:outfit:${outfitId}`
}

function isPendingOutfitUpload(charId, outfitId) {
  return pendingCharOutfitUploadKeys.value.includes(outfitUploadKey(charId, outfitId))
}

function isPendingNewOutfitUpload(charId) {
  return pendingNewOutfitUploadIds.value.includes(charId)
}

async function uploadOutfitCandidate(item, outfit, event) {
  const charId = resolveLinkedCharacterId(item)
  if (!charId) {
    toast.warning('未关联项目角色，无法上传造型')
    return
  }
  const file = event?.target?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  const uploadKey = outfitUploadKey(charId, outfit.outfit_id)
  if (isPendingOutfitUpload(charId, outfit.outfit_id)) return
  pendingCharOutfitUploadKeys.value.push(uploadKey)
  try {
    await characterAPI.uploadOutfitCandidate(charId, outfit.outfit_id, file, {
      label: outfit.label,
      set_as_default: false,
    })
    toast.success('已追加上传备选图')
    await loadAssets()
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    pendingCharOutfitUploadKeys.value = pendingCharOutfitUploadKeys.value.filter(key => key !== uploadKey)
    if (event?.target) event.target.value = ''
  }
}

async function uploadNewOutfit(item, event) {
  const charId = resolveLinkedCharacterId(item)
  if (!charId) {
    toast.warning('未关联项目角色，无法新建造型分组')
    return
  }
  if (!assetHasPrimaryImage(item)) {
    toast.warning('请先上传或生成角色基准图')
    return
  }
  const file = event?.target?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  const name = window.prompt('请输入造型分组名称（如：日常、宫装、战场）', '日常')?.trim()
  if (!name) {
    if (event?.target) event.target.value = ''
    return
  }
  const outfitId = slugifyOutfitId(name)
  if (isPendingNewOutfitUpload(charId)) return
  pendingNewOutfitUploadIds.value.push(charId)
  try {
    await characterAPI.uploadOutfitCandidate(charId, outfitId, file, {
      label: name,
      candidate_label: '定稿',
      set_as_default: true,
    })
    toast.success(`「${name}」造型分组已创建`)
    await loadAssets()
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    pendingNewOutfitUploadIds.value = pendingNewOutfitUploadIds.value.filter(id => id !== charId)
    if (event?.target) event.target.value = ''
  }
}

function resolveCharacterMedia(item) {
  const media = item?.character_media || item?.characterMedia
  if (media?.preview_images?.length || media?.outfit_previews?.length || media?.primary_url) {
    const previewImages = media.preview_images?.length
      ? media.preview_images
      : (media.primary_url
        ? [{
            url: media.primary_url,
            label: '角色图',
            tag: '角色图',
            tag_type: 'primary',
            source: 'primary',
          }]
        : [])
    return {
      ...media,
      preview_images: previewImages,
      outfit_previews: resolveOutfitPreviewsFromMedia(media),
      seedance_asset_id: item?.seedance_asset_id || item?.seedanceAssetId || media.seedance_asset_id,
      seedance_asset_status: item?.seedance_asset_status || item?.seedanceAssetStatus || media.seedance_asset_status,
    }
  }
  const url = item?.url || item?.local_path || item?.localPath
  if (!url) return null
  return {
    outfit_count: 0,
    candidate_count: 0,
    transform_count: 0,
    image_count: 1,
    primary_url: url,
    outfit_previews: [],
    preview_images: [{
      url,
      label: '角色图',
      tag: '角色图',
      tag_type: 'primary',
      source: 'primary',
    }],
  }
}

function resolveSceneMedia(item) {
  const media = enrichEntityMedia(item?.scene_media || item?.sceneMedia)
  if (media) return media
  const url = item?.url || item?.local_path || item?.localPath
  if (!url) return null
  return {
    view_count: 1,
    image_count: 1,
    primary_url: url,
    view_previews: [{ view_id: 'hero', label: '主视角', url }],
    preview_images: [{ url, label: '主视角', tag: '主视角', view_id: 'hero', is_primary: true }],
  }
}

function resolvePropMedia(item) {
  const media = enrichEntityMedia(item?.prop_media || item?.propMedia)
  if (media) return media
  const url = item?.url || item?.local_path || item?.localPath
  if (!url) return null
  return {
    view_count: 1,
    image_count: 1,
    primary_url: url,
    view_previews: [{ view_id: 'hero', label: '主图', url }],
    preview_images: [{ url, label: '主图', tag: '主图', view_id: 'hero', is_primary: true }],
  }
}

function openAssetPreview(item) {
  const raw = resolveAssetCoverPath(item)
  if (!raw) return
  openImageViewer({
    src: mediaDisplayUrl(raw),
    title: item.name,
    rawPath: raw,
    item,
    canDelete: activeType.value !== 'voice',
  })
}

function openCharacterMediaPreview(item, img) {
  const raw = normalizeMediaPath(img?.url || item?.url || item?.local_path || item?.localPath)
  if (!raw) return
  const title = `${item.name} · ${img?.tag || characterImageTagLabel(img, { short: true }) || '角色图'}`
  openImageViewer({
    src: mediaDisplayUrl(raw),
    title,
    rawPath: raw,
    item,
    canDelete: true,
  })
}

function openEntityMediaPreview(item, img) {
  const raw = normalizeMediaPath(img?.url || item?.url || item?.local_path || item?.localPath)
  if (!raw) return
  const title = `${item.name} · ${img?.label || img?.tag || '图片'}`
  openImageViewer({
    src: mediaDisplayUrl(raw),
    title,
    rawPath: raw,
    item,
    canDelete: true,
  })
}

function openImageViewer(payload) {
  if (!payload?.src) return
  imageViewer.value = {
    open: true,
    src: payload.src,
    title: payload.title || '',
    rawPath: payload.rawPath || '',
    item: payload.item || null,
    canDelete: !!payload.canDelete,
  }
}

function closeImageViewer() {
  imageViewer.value = {
    open: false,
    src: '',
    title: '',
    rawPath: '',
    item: null,
    canDelete: false,
  }
}

async function deleteViewerImage() {
  if (!isAdmin.value) return
  const ctx = imageViewer.value
  const assetId = ctx.item?.id
  const rawPath = ctx.rawPath
  if (!assetId || !rawPath) return
  if (!confirm(`确定删除这张图片？\n${ctx.title || ''}`)) return
  deletingImage.value = true
  try {
    await assetAPI.deleteImage(assetId, rawPath)
    toast.success('图片已删除')
    closeImageViewer()
    await loadAssets()
  } catch (e) {
    toast.error(e?.message || '删除失败')
  } finally {
    deletingImage.value = false
  }
}

async function loadDramas() {
  if (!dramas.value.length) restoreDramaCache()
  try {
    const dramaRes = await dramaAPI.listLite({ pageSize: 200 })
    dramas.value = dramaRes?.items ?? (Array.isArray(dramaRes) ? dramaRes : [])
    persistDramaCache()
  } catch (e) {
    if (!dramas.value.length) throw e
  }
}

async function loadAssets({ silent = false } = {}) {
  const hadCache = restoreAssetsCache()
  if (!silent && !hadCache) initialLoading.value = true
  refreshing.value = true
  try {
    const dramaId = parseDramaFilter(selectedDramaId.value)
    const { items, counts } = await assetAPI.listWithCounts({
      drama_id: dramaId || undefined,
      type: activeType.value,
      q: keyword.value.trim() || undefined,
    })
    assets.value = items || []
    assetTypeCounts.value = counts || {}
    resetVisibleCount()
    persistAssetsCache()
    prefetchVisibleAssetMedia()
  } catch (e) {
    if (!assets.value.length) toast.error(e?.message || '加载资产失败')
  } finally {
    initialLoading.value = false
    refreshing.value = false
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
  loadAssets()
})

watch(visibleAssets, () => {
  prefetchVisibleAssetMedia()
})

watch(() => route.path, (path) => {
  if (path === '/assets' || path.startsWith('/assets/')) {
    loadAssets({ silent: true })
  }
})

onMounted(() => {
  const query = useRoute().query
  if (query.drama_id) selectedDramaId.value = String(query.drama_id)
  if (query.type && ASSET_CATEGORIES.some(item => item.id === query.type)) {
    activeType.value = String(query.type)
  }
  keyword.value = ''
  restoreAssetsCache()
  restoreDramaCache()
  if (assets.value.length) initialLoading.value = false
  void Promise.all([
    loadDramas(),
    loadAssets({ silent: assets.value.length > 0 }),
  ])
})

onBeforeUnmount(() => {
  for (const timer of portraitPollTimers.values()) clearInterval(timer)
  portraitPollTimers.clear()
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
.asset-grid-skeleton .skeleton-card {
  overflow: hidden;
  pointer-events: none;
}
.skeleton-cover {
  aspect-ratio: 16 / 9;
  background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-1) 50%, var(--bg-2) 75%);
  background-size: 200% 100%;
  animation: asset-skeleton-shimmer 1.2s ease-in-out infinite;
}
.skeleton-line {
  height: 10px;
  margin: 10px 12px 0;
  border-radius: 4px;
  background: var(--bg-2);
}
.skeleton-line.short {
  width: 55%;
  margin-bottom: 12px;
}
@keyframes asset-skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.asset-card { overflow: hidden; }
.asset-body :deep(.char-media-strip-root) { margin-top: 6px; }
.asset-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--bg-2);
  overflow: hidden;
}
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
.asset-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.asset-name { font-size: 13px; font-weight: 600; }
.asset-portrait-tag { font-size: 10px; padding: 1px 6px; }
.asset-meta { font-size: 11px; margin-top: 2px; }
.asset-outfit-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.asset-primary-portrait-row {
  margin-bottom: 6px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border);
  opacity: 0.92;
}
.asset-outfit-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.asset-outfit-head-actions,
.asset-outfit-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.asset-outfit-label { font-size: 11px; font-weight: 600; color: var(--text-dim); }
.asset-outfit-hint,
.asset-create-hint {
  font-size: 11px;
  margin: 0;
  line-height: 1.4;
}
.asset-outfit-unlinked { font-size: 11px; margin: 6px 0 0; line-height: 1.4; }
.asset-outfit-list { display: flex; flex-direction: column; gap: 4px; }
.asset-outfit-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  font-size: 11px;
  padding: 6px 0;
  border-top: 1px solid var(--border);
}
.asset-outfit-row-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.asset-outfit-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-outfit-count { flex-shrink: 0; font-size: 10px; }
.asset-outfit-candidates {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 2px;
}
.asset-outfit-candidate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 72px;
}
.asset-outfit-candidate-thumb {
  position: relative;
  width: 72px;
  height: 72px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated, #111);
  cursor: pointer;
}
.asset-outfit-candidate.is-certified .asset-outfit-candidate-thumb {
  border-color: #0f766e;
  box-shadow: 0 0 0 1px rgba(15, 118, 110, 0.35);
}
.asset-outfit-candidate-badge.is-processing {
  background: rgba(180, 120, 20, 0.92);
}
.asset-outfit-default-label {
  display: none;
}
.asset-outfit-candidate-thumb :deep(.grid-media-image),
.asset-outfit-candidate-thumb :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.asset-outfit-candidate-badge {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(15, 118, 110, 0.92);
  color: #fff;
  font-size: 10px;
  line-height: 1.3;
}
.asset-outfit-set-default {
  width: 100%;
  padding: 2px 4px;
  font-size: 10px;
}
.asset-outfit-default-label {
  font-size: 10px;
  line-height: 1.3;
  text-align: center;
}
.asset-outfit-upload-btn {
  flex-shrink: 0;
  cursor: pointer;
  margin: 0;
}
.asset-outfit-upload-btn.is-disabled { opacity: 0.55; pointer-events: none; }
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
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.image-viewer-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: min(92vw, 960px);
  width: 100%;
}
.image-viewer-panel img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
}
.image-viewer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  margin-top: 12px;
}
.image-viewer-title { color: #fff; font-size: 13px; flex: 1; min-width: 0; }
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
