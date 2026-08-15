<template>
  <div class="director-page">
    <header class="director-head">
      <button type="button" class="back-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        返回
      </button>
      <div class="director-head-copy">
        <h1 class="director-title">3D 导演台</h1>
        <p v-if="contextLabel" class="director-desc">{{ contextLabel }}</p>
        <p v-if="storyboardId" class="director-hint">
          在机位面板点击「发送到画布」后，截图将自动同步为该镜头的站位图
        </p>
      </div>
      <div class="director-head-actions">
        <span v-if="!deskReady && !loadError" class="dim director-sync-tag">加载 3D 场景…</span>
        <span v-else-if="syncing" class="dim director-sync-tag">同步中…</span>
        <span v-else-if="savingScene" class="dim director-sync-tag">云端保存中…</span>
        <button
          v-if="blockingContext?.characters?.length"
          type="button"
          class="btn btn-sm"
          :disabled="!deskReady"
          @click="syncBlockingLayout(true)"
        >
          导入站位
        </button>
        <button type="button" class="btn btn-sm" :disabled="syncing" @click="reloadDesk">重新加载</button>
      </div>
    </header>

    <div v-if="loadError" class="director-error card">
      <p>3D 导演台资源未就绪，请稍后重试或联系管理员。</p>
      <button type="button" class="btn btn-primary btn-sm" @click="reloadDesk">重试</button>
    </div>

    <iframe
      v-else
      ref="deskFrame"
      class="director-frame"
      :src="iframeSrc"
      title="3D 导演台"
      allow="fullscreen"
      @load="onFrameLoad"
      @error="loadError = true"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { directorDeskAPI, episodeAPI, storyboardAPI, uploadAPI } from '~/composables/useApi'
import {
  bindDirectorDeskHostListener,
  buildDirectorDeskInstanceId,
  directorDeskIframeSrc,
  postDirectorDeskBlockingLayout,
  postDirectorDeskLoadState,
  postDirectorDeskPanorama,
  postDirectorDeskSession,
} from '~/composables/useDirectorDeskHost'
import { dataUrlToFile } from '~/utils/data-url-file'
import { buildDirectorBlockingLayoutPayload } from '~/utils/director-blocking-layout.js'
import { resolveBlockingLayout } from '~/utils/blocking-layout.js'
import { resolveDirectorPanoramaObjectUrl } from '~/utils/director-panorama-url.js'
import { normalizeMediaPath } from '~/utils/media-url.js'

definePageMeta({ layout: 'studio' })

const route = useRoute()
const deskFrame = ref(null)
const loadError = ref(false)
const deskKey = ref(0)
const deskReady = ref(false)
const syncing = ref(false)
const savingScene = ref(false)
const blockingContext = ref(null)
const characterNameById = ref({})

const dramaId = computed(() => route.query.drama_id || route.query.dramaId || '')
const episodeId = computed(() => route.query.episode_id || route.query.episodeId || '')
const storyboardId = computed(() => route.query.storyboard_id || route.query.storyboardId || '')
const sceneImage = computed(() => String(route.query.scene_image || ''))
const blockingImage = computed(() => String(route.query.blocking_image || ''))

const instanceId = computed(() => buildDirectorDeskInstanceId({
  dramaId: dramaId.value,
  episodeId: episodeId.value,
  storyboardId: storyboardId.value,
}))

const contextLabel = computed(() => {
  const parts = []
  if (dramaId.value) parts.push(`项目 #${dramaId.value}`)
  if (episodeId.value) parts.push(`集 #${episodeId.value}`)
  if (storyboardId.value) parts.push(`镜头 #${storyboardId.value}`)
  return parts.length ? parts.join(' · ') : '独立预演场景（云端自动保存）'
})

const iframeSrc = computed(() => `${directorDeskIframeSrc('dark')}&_=${deskKey.value}`)

/** 已发给 iframe 的全景 blob，换图时释放，避免泄漏 */
let panoramaObjectUrl = ''
let panoramaSyncToken = 0
/** 用户在导演台内手动导入后，停止宿主自动覆盖 */
let skipHostPanoramaSync = false
/** 服务端 hydrate 完成前不写库，避免用本地缓存覆盖云端 */
let acceptStateSaves = false
let pendingStateForSave = null
let saveTimer = null
let saveToken = 0

function syncSession() {
  postDirectorDeskSession(deskFrame.value, {
    instanceId: instanceId.value,
    theme: 'dark',
  })
}

function optionalPositiveInt(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function scheduleSaveScene(state) {
  if (!state || typeof state !== 'object') return
  if (!acceptStateSaves) {
    pendingStateForSave = state
    return
  }
  pendingStateForSave = state
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void flushSaveScene()
  }, 800)
}

async function flushSaveScene() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const state = pendingStateForSave
  if (!state || !acceptStateSaves) return
  const token = ++saveToken
  savingScene.value = true
  try {
    await directorDeskAPI.saveScene(instanceId.value, {
      state,
      drama_id: optionalPositiveInt(dramaId.value),
      episode_id: optionalPositiveInt(episodeId.value),
      storyboard_id: optionalPositiveInt(storyboardId.value),
    })
  } catch (e) {
    if (token !== saveToken) return
    console.warn('[director] save scene failed', e)
  } finally {
    if (token === saveToken) savingScene.value = false
  }
}

async function hydrateFromServer() {
  acceptStateSaves = false
  pendingStateForSave = null
  try {
    const res = await directorDeskAPI.getScene(instanceId.value)
    const state = res?.scene?.state
    if (state && typeof state === 'object') {
      postDirectorDeskLoadState(deskFrame.value, state)
      pendingStateForSave = null
      return true
    }
  } catch (e) {
    console.warn('[director] load scene failed', e)
  }
  return false
}

function revokePanoramaObjectUrl() {
  if (!panoramaObjectUrl) return
  try { URL.revokeObjectURL(panoramaObjectUrl) } catch { /* ignore */ }
  panoramaObjectUrl = ''
}

async function syncPanorama({ force = false } = {}) {
  if (skipHostPanoramaSync && !force) return
  const sceneUrl = sceneImage.value.trim()
  const blockingUrl = blockingImage.value.trim()
  const url = sceneUrl || blockingUrl
  if (!url) return

  const token = ++panoramaSyncToken
  try {
    const objectUrl = await resolveDirectorPanoramaObjectUrl(url)
    if (token !== panoramaSyncToken || (skipHostPanoramaSync && !force)) {
      if (objectUrl.startsWith('blob:') && objectUrl !== url) {
        try { URL.revokeObjectURL(objectUrl) } catch { /* ignore */ }
      }
      return
    }
    if (objectUrl.startsWith('blob:') && objectUrl !== panoramaObjectUrl) {
      revokePanoramaObjectUrl()
      panoramaObjectUrl = objectUrl
    }
    postDirectorDeskPanorama(deskFrame.value, {
      edgeId: sceneUrl ? 'hg-scene-backdrop' : 'hg-blocking-backdrop',
      sourceNodeId: storyboardId.value ? `storyboard:${storyboardId.value}` : 'hg-scene',
      imageUrl: objectUrl,
      fileName: sceneUrl ? '场景全景.png' : '站位图.png',
    })
  } catch (e) {
    if (token !== panoramaSyncToken) return
    console.warn('[director] panorama sync failed', e)
    toast.error(e?.message || '全景图同步失败，主视口可能无法显示')
  }
}

function syncBlockingLayout(force = false) {
  if (!blockingContext.value?.characters?.length) return
  const payload = buildDirectorBlockingLayoutPayload(
    blockingContext.value,
    id => characterNameById.value[id] || characterNameById.value[String(id)] || `角色 #${id}`,
  )
  postDirectorDeskBlockingLayout(deskFrame.value, {
    ...payload,
    force,
  })
  if (force) {
    toast.success(`已导入 ${payload.characters.length} 个角色站位`)
  }
}

async function loadBlockingContext() {
  blockingContext.value = null
  characterNameById.value = {}

  const sbId = Number(storyboardId.value)
  const epId = Number(episodeId.value)
  if (!sbId || !epId) return

  try {
    const [storyboardsRes, charactersRes] = await Promise.all([
      episodeAPI.storyboards(epId),
      episodeAPI.characters(epId),
    ])
    const storyboardList = Array.isArray(storyboardsRes)
      ? storyboardsRes
      : (storyboardsRes?.items || [])
    const storyboard = storyboardList.find(item => Number(item.id) === sbId)
    if (!storyboard) return

    const charIds = storyboard.character_ids || storyboard.characterIds || []
    const names = {}
    const characterList = Array.isArray(charactersRes)
      ? charactersRes
      : (charactersRes?.items || [])
    for (const ch of characterList) {
      if (ch?.id) names[ch.id] = ch.name || ch.title || `角色 #${ch.id}`
    }
    for (const ch of storyboard.characters || []) {
      if (ch?.id) names[ch.id] = ch.name || ch.title || names[ch.id] || `角色 #${ch.id}`
    }
    characterNameById.value = names

    blockingContext.value = resolveBlockingLayout(
      storyboard.blocking_layout || storyboard.blockingLayout,
      charIds,
    )
  } catch (e) {
    console.warn('[director] load blocking context failed', e)
  }
}

function onFrameLoad() {
  loadError.value = false
  deskReady.value = false
  acceptStateSaves = false
  syncSession()
}

function reloadDesk() {
  loadError.value = false
  deskReady.value = false
  acceptStateSaves = false
  pendingStateForSave = null
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  skipHostPanoramaSync = false
  panoramaSyncToken += 1
  revokePanoramaObjectUrl()
  deskKey.value += 1
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  if (dramaId.value && episodeId.value) {
    navigateTo(`/drama/${dramaId.value}/episode/${episodeId.value}`)
    return
  }
  if (dramaId.value) {
    navigateTo(`/drama/${dramaId.value}`)
    return
  }
  navigateTo('/')
}

async function applyCaptureToStoryboard(captures) {
  const sbId = Number(storyboardId.value)
  if (!sbId || !captures?.length) {
    toast.success(`已收到 ${captures.length} 张导演台截图`)
    return
  }
  const capture = captures[captures.length - 1]
  if (!capture?.dataUrl) return

  syncing.value = true
  try {
    const file = dataUrlToFile(capture.dataUrl, capture.fileName || 'director-desk-blocking.png')
    const dId = Number(dramaId.value)
    const uploadRes = await uploadAPI.image(file, Number.isFinite(dId) && dId > 0 ? dId : null)
    const path = normalizeMediaPath(uploadRes?.path || uploadRes?.url || uploadRes?.local_path || uploadRes?.localPath)
    if (!path) throw new Error('上传失败')
    await storyboardAPI.update(sbId, { blocking_image: path })
    toast.success('导演台截图已同步为镜头站位图')
  } catch (e) {
    toast.error(e?.message || '同步站位图失败')
  } finally {
    syncing.value = false
  }
}

async function bootstrapDesk() {
  deskReady.value = true
  syncSession()
  const loaded = await hydrateFromServer()
  acceptStateSaves = true
  if (!loaded && pendingStateForSave) {
    scheduleSaveScene(pendingStateForSave)
  }
  await syncPanorama()
  syncBlockingLayout(false)
}

let unbindHost = null

onMounted(() => {
  void loadBlockingContext()
  unbindHost = bindDirectorDeskHostListener({
    onReady: () => {
      void bootstrapDesk()
    },
    onClose: () => {
      goBack()
    },
    onStateChanged: (state) => {
      scheduleSaveScene(state)
    },
    onCaptures: (captures) => {
      void applyCaptureToStoryboard(captures)
    },
    onPanoramaUserImported: () => {
      skipHostPanoramaSync = true
      panoramaSyncToken += 1
      revokePanoramaObjectUrl()
      toast.success('全景图已导入到主视口')
    },
    onToast: ({ level, message }) => {
      if (level === 'error') toast.error(message)
      else toast.message(message)
    },
  })
})

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  void flushSaveScene()
  acceptStateSaves = false
  unbindHost?.()
  panoramaSyncToken += 1
  revokePanoramaObjectUrl()
})

watch(instanceId, () => {
  if (!deskFrame.value?.contentWindow) return
  acceptStateSaves = false
  pendingStateForSave = null
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  void (async () => {
    syncSession()
    const loaded = await hydrateFromServer()
    acceptStateSaves = true
    if (!loaded && pendingStateForSave) {
      scheduleSaveScene(pendingStateForSave)
    }
    await syncPanorama()
    syncBlockingLayout(false)
  })()
})

watch([storyboardId, episodeId], () => {
  void loadBlockingContext()
})

watch(sceneImage, () => {
  skipHostPanoramaSync = false
  if (deskFrame.value?.contentWindow) void syncPanorama({ force: true })
})

watch(blockingImage, () => {
  if (deskFrame.value?.contentWindow && !sceneImage.value.trim()) {
    skipHostPanoramaSync = false
    void syncPanorama({ force: true })
  }
})
</script>

<style scoped>
.director-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  background: var(--bg-base);
}

.director-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-1);
  flex-shrink: 0;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius);
}
.back-btn:hover { background: var(--bg-hover); color: var(--text-0); }

.director-head-copy { flex: 1; min-width: 0; }
.director-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-0);
}
.director-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.director-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--accent-text);
  line-height: 1.4;
}
.director-sync-tag {
  font-size: 12px;
  margin-right: 4px;
}

.director-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: none;
  background: #0a0a0a;
}

.director-error {
  margin: 24px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.director-error code {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-2);
}
</style>
