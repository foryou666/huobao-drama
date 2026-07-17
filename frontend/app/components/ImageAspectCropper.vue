<template>
  <div ref="rootEl" class="cropper">
    <div
      ref="viewportEl"
      class="cropper-viewport"
      :style="viewportStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
    >
      <img
        v-if="displaySrc"
        ref="imgEl"
        :src="displaySrc"
        class="cropper-img"
        :style="imgStyle"
        draggable="false"
        alt=""
        @load="onImageLoad"
        @error="onImageError"
      />
      <div v-else-if="loadError" class="cropper-loading err">{{ loadError }}</div>
      <div v-else-if="loadingSrc" class="cropper-loading">加载图片…</div>
      <div class="cropper-frame" />
    </div>
    <div class="cropper-controls">
      <label class="cropper-zoom">
        <span>缩放</span>
        <input v-model.number="zoom" type="range" min="1" max="3" step="0.01" :disabled="!displaySrc" />
      </label>
      <button type="button" class="btn btn-sm" :disabled="!displaySrc" @click="reset">重置</button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getAuthToken } from '~/utils/auth-token.js'
import { getActiveTeamId } from '~/utils/team-context.js'
import { normalizeMediaPath } from '~/utils/media-url.js'

const props = defineProps({
  src: { type: String, default: '' },
  /** 本地 static 路径：优先走同源下载，避免跨域污染 canvas */
  sourcePath: { type: String, default: '' },
  /** 宽:高，如 3/4 或 4/3 */
  aspect: { type: Number, default: 3 / 4 },
})

const MAX_VIEWPORT_H = 360

const rootEl = ref(null)
const viewportEl = ref(null)
const imgEl = ref(null)
const displaySrc = ref('')
const loadingSrc = ref(false)
const loadError = ref('')
const naturalW = ref(0)
const naturalH = ref(0)
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
const lastX = ref(0)
const lastY = ref(0)
const baseScale = ref(1)
const boxW = ref(270)
const boxH = ref(360)

let localObjectUrl = ''
let prepareToken = 0

const ar = computed(() => (props.aspect > 0 ? props.aspect : 3 / 4))

const viewportStyle = computed(() => ({
  width: `${boxW.value}px`,
  height: `${boxH.value}px`,
}))

const imgStyle = computed(() => {
  const scale = baseScale.value * zoom.value
  return {
    width: `${naturalW.value * scale}px`,
    height: `${naturalH.value * scale}px`,
    transform: `translate(${offsetX.value}px, ${offsetY.value}px)`,
  }
})

function authHeaders() {
  const headers = {}
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = String(teamId)
  return headers
}

function revokeLocalObjectUrl() {
  if (localObjectUrl) {
    try { URL.revokeObjectURL(localObjectUrl) } catch { /* ignore */ }
    localObjectUrl = ''
  }
}

function isBlobOrDataUrl(url) {
  return /^blob:|^data:/i.test(String(url || ''))
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

function isCrossOriginHttp(url) {
  if (!isHttpUrl(url) || typeof window === 'undefined') return false
  try {
    return new URL(url, window.location.href).origin !== window.location.origin
  } catch {
    return true
  }
}

function staticPathFrom(raw) {
  const path = normalizeMediaPath(raw)
  return path.startsWith('static/') ? path : ''
}

async function fetchAsObjectUrl(url, withAuth = false) {
  const res = await fetch(url, {
    headers: withAuth ? authHeaders() : undefined,
    mode: 'cors',
    credentials: withAuth ? 'same-origin' : 'omit',
  })
  if (!res.ok) throw new Error(`加载失败 (${res.status})`)
  const blob = await res.blob()
  if (!blob || !String(blob.type || '').startsWith('image/')) {
    // 部分上游不带 content-type，仍尝试按图片用
    if (!blob?.size) throw new Error('图片为空')
  }
  const objectUrl = URL.createObjectURL(blob)
  return objectUrl
}

async function resolveDisplaySrc(rawSrc, rawPath) {
  const src = String(rawSrc || '').trim()
  const path = staticPathFrom(rawPath) || staticPathFrom(src)
  if (!src && !path) return ''

  // 已是本机 blob / data，可直接导出
  if (isBlobOrDataUrl(src)) return src

  // 优先同源代理下载 static，彻底避开跨域污染
  if (path) {
    return fetchAsObjectUrl(`/api/v1/media/download?path=${encodeURIComponent(path)}`, true)
  }

  // 同源相对路径
  if (src.startsWith('/') && !isCrossOriginHttp(src)) {
    return fetchAsObjectUrl(src, src.startsWith('/api/'))
  }

  // 跨域 http(s)：尝试 CORS 拉取为 blob；失败则无法安全导出
  if (isCrossOriginHttp(src)) {
    return fetchAsObjectUrl(src, false)
  }

  if (src) return fetchAsObjectUrl(src, false)
  return ''
}

async function prepareSrc() {
  const token = ++prepareToken
  loadingSrc.value = true
  loadError.value = ''
  naturalW.value = 0
  naturalH.value = 0
  displaySrc.value = ''
  revokeLocalObjectUrl()

  try {
    const next = await resolveDisplaySrc(props.src, props.sourcePath)
    if (token !== prepareToken) {
      if (next && !isBlobOrDataUrl(props.src)) {
        try { URL.revokeObjectURL(next) } catch { /* ignore */ }
      }
      return
    }
    if (!next) {
      loadError.value = '没有可裁切的图片'
      return
    }
    if (next.startsWith('blob:') && next !== props.src) localObjectUrl = next
    displaySrc.value = next
  } catch (err) {
    if (token !== prepareToken) return
    loadError.value = err?.message || '图片加载失败（可能因跨域无法裁切）'
  } finally {
    if (token === prepareToken) loadingSrc.value = false
  }
}

function measureBox() {
  const parentW = rootEl.value?.clientWidth || viewportEl.value?.parentElement?.clientWidth || 280
  const maxW = Math.max(120, parentW)
  let w = maxW
  let h = w / ar.value
  if (h > MAX_VIEWPORT_H) {
    h = MAX_VIEWPORT_H
    w = h * ar.value
  }
  if (w > maxW) {
    w = maxW
    h = w / ar.value
  }
  boxW.value = Math.round(w)
  boxH.value = Math.round(h)
}

function clampOffsets() {
  const vpW = boxW.value
  const vpH = boxH.value
  if (!vpW || !vpH || !naturalW.value || !naturalH.value) return
  const scale = baseScale.value * zoom.value
  const drawW = naturalW.value * scale
  const drawH = naturalH.value * scale
  const minX = Math.min(0, vpW - drawW)
  const minY = Math.min(0, vpH - drawH)
  offsetX.value = Math.min(0, Math.max(minX, offsetX.value))
  offsetY.value = Math.min(0, Math.max(minY, offsetY.value))
  if (drawW <= vpW) offsetX.value = (vpW - drawW) / 2
  if (drawH <= vpH) offsetY.value = (vpH - drawH) / 2
}

function fitImage() {
  const vpW = boxW.value
  const vpH = boxH.value
  if (!vpW || !vpH || !naturalW.value || !naturalH.value) return
  const cover = Math.max(vpW / naturalW.value, vpH / naturalH.value)
  baseScale.value = cover
  zoom.value = 1
  const drawW = naturalW.value * cover
  const drawH = naturalH.value * cover
  offsetX.value = (vpW - drawW) / 2
  offsetY.value = (vpH - drawH) / 2
  clampOffsets()
}

function layoutAndFit() {
  measureBox()
  nextTick(() => {
    if (naturalW.value) fitImage()
  })
}

function onImageLoad() {
  const img = imgEl.value
  if (!img) return
  naturalW.value = img.naturalWidth || 0
  naturalH.value = img.naturalHeight || 0
  layoutAndFit()
}

function onImageError() {
  loadError.value = '图片显示失败'
  displaySrc.value = ''
}

function reset() {
  fitImage()
}

function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return
  dragging.value = true
  lastX.value = e.clientX
  lastY.value = e.clientY
  e.currentTarget?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!dragging.value) return
  offsetX.value += e.clientX - lastX.value
  offsetY.value += e.clientY - lastY.value
  lastX.value = e.clientX
  lastY.value = e.clientY
  clampOffsets()
}

function onPointerUp() {
  dragging.value = false
}

function onWheel(e) {
  const next = Math.min(3, Math.max(1, zoom.value + (e.deltaY > 0 ? -0.06 : 0.06)))
  zoom.value = Number(next.toFixed(2))
  nextTick(clampOffsets)
}

watch(zoom, () => nextTick(clampOffsets))
watch(() => [props.src, props.sourcePath], () => { void prepareSrc() }, { immediate: true })
watch(() => props.aspect, () => layoutAndFit())

let resizeObserver = null
onMounted(() => {
  measureBox()
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => layoutAndFit())
  if (rootEl.value) resizeObserver.observe(rootEl.value)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  revokeLocalObjectUrl()
})
watch(rootEl, (el, prev) => {
  if (!resizeObserver) return
  if (prev) resizeObserver.unobserve(prev)
  if (el) resizeObserver.observe(el)
})

async function exportBlob(mime = 'image/jpeg', quality = 0.92) {
  if (loadingSrc.value) throw new Error('图片加载中，请稍候')
  if (loadError.value) throw new Error(loadError.value)
  if (!imgEl.value || !naturalW.value || !naturalH.value) throw new Error('图片未就绪')
  const ratio = ar.value
  const outW = ratio >= 1 ? 1440 : 1080
  const outH = Math.round(outW / ratio)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  const vpW = boxW.value
  const vpH = boxH.value
  if (!vpW || !vpH) throw new Error('裁切区域未就绪')

  const scale = baseScale.value * zoom.value
  const sx = (-offsetX.value) / scale
  const sy = (-offsetY.value) / scale
  const sw = vpW / scale
  const sh = vpH / scale

  ctx.fillStyle = '#0b0d12'
  ctx.fillRect(0, 0, outW, outH)
  ctx.drawImage(imgEl.value, sx, sy, sw, sh, 0, 0, outW, outH)

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('导出失败'))
        else resolve(blob)
      }, mime, quality)
    } catch (err) {
      const msg = String(err?.message || err || '')
      if (/tainted|跨域|cross-origin/i.test(msg)) {
        reject(new Error('图片跨域无法裁切导出，请重新选择已生成图或改用上传'))
      } else {
        reject(err)
      }
    }
  })
}

defineExpose({ exportBlob, reset })
</script>

<style scoped>
.cropper {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.cropper-viewport {
  position: relative;
  display: block;
  margin-inline: auto;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 12px;
  background: #12151c;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.cropper-viewport:active { cursor: grabbing; }
.cropper-img {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  pointer-events: none;
  will-change: transform;
}
.cropper-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  padding: 12px;
  text-align: center;
}
.cropper-loading.err {
  color: #f0a0a0;
}
.cropper-frame {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}
.cropper-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cropper-zoom {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-3, #94a3b8);
}
.cropper-zoom input {
  flex: 1;
}
</style>
