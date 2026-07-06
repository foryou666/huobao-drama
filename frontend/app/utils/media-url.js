import { ref } from 'vue'
import { api } from '~/composables/useApi'

const urlCache = ref(Object.create(null))
export const cacheVersion = ref(0)
let pending = new Set()
let flushTimer = null

export function normalizeMediaPath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function bumpCache() {
  cacheVersion.value += 1
}

function scheduleResolve(path) {
  if (!path.startsWith('static/') || urlCache.value[path]) return
  pending.add(path)
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushResolve().catch(() => {}) }, 30)
}

async function flushResolve() {
  const batch = [...pending].filter(p => !urlCache.value[p]).slice(0, 48)
  for (const path of batch) pending.delete(path)
  if (!batch.length) {
    pending.clear()
    return
  }
  try {
    const data = await api.post('/media/resolve-urls', { paths: batch })
    const urls = data?.urls || {}
    let changed = false
    for (const [path, url] of Object.entries(urls)) {
      if (url && urlCache.value[path] !== url) {
        urlCache.value[path] = url
        changed = true
      }
    }
    if (changed) bumpCache()
  } catch {
    // 保留本地回退
  }
  if (pending.size) {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => { flushResolve().catch(() => {}) }, 30)
  }
}

/** 由原图 static 路径推导缩略图路径 */
export function thumbPathFromSource(raw) {
  const path = normalizeMediaPath(raw)
  if (!path || !path.startsWith('static/')) return ''
  if (path.startsWith('static/thumbs/')) return path
  const rest = path.slice('static/'.length)
  const withoutExt = rest.replace(/\.[^.]+$/i, '')
  return `static/thumbs/${withoutExt}.webp`
}

/** static/videos/a.mp4 → static/thumbs/videos/a.webp */
export function videoPosterPathFromSource(raw) {
  const path = normalizeMediaPath(raw)
  if (!path.startsWith('static/videos/')) return ''
  const rest = path.slice('static/'.length)
  const withoutExt = rest.replace(/\.[^.]+$/i, '')
  return `static/thumbs/${withoutExt}.webp`
}

export function videoPosterDisplayUrl(item) {
  if (item?.display_poster_url) return item.display_poster_url
  const poster = videoPosterPathFromSource(item?.local_path || item?.localPath || item?.video_url || item?.videoUrl || '')
  if (!poster) return ''
  void cacheVersion.value
  const url = mediaDisplayUrl(poster)
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/static/')) return url
  if (urlCache.value[poster]) return url
  return ''
}

/** 批量预取：原图 + 推导缩略图/封面 */
export function collectMediaPrefetchPaths(...rawPaths) {
  const out = new Set()
  for (const raw of rawPaths) {
    const path = normalizeMediaPath(raw)
    if (!path.startsWith('static/')) continue
    out.add(path)
    const thumb = thumbPathFromSource(path)
    if (thumb) out.add(thumb)
    const poster = videoPosterPathFromSource(path)
    if (poster) out.add(poster)
  }
  return [...out]
}

function localStaticUrl(path) {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('static/')) return `/${path}`
  return path.startsWith('/') ? path : `/${path}`
}

function isOssOrCachedUrl(path, url) {
  if (!url) return false
  if (url.startsWith('http://') || url.startsWith('https://')) return true
  return !!(path && urlCache.value[path])
}

/** 列表/网格缩略图：优先 thumbs（仅当 OSS 已解析）；否则原图；均未就绪则留空 */
export function mediaGridUrl(raw, explicitThumb) {
  void cacheVersion.value
  const full = normalizeMediaPath(raw)
  const thumb = normalizeMediaPath(explicitThumb) || thumbPathFromSource(raw)
  if (thumb) {
    const thumbUrl = mediaDisplayUrl(thumb)
    if (isOssOrCachedUrl(thumb, thumbUrl)) return thumbUrl
  }
  const fullUrl = mediaDisplayUrl(full)
  if (isOssOrCachedUrl(full, fullUrl)) return fullUrl
  return ''
}

/** 页面展示 URL：优先 OSS；解析完成前不回落到 /static/，避免阻塞页面且减轻应用服务器流量 */
export function mediaDisplayUrl(raw) {
  void cacheVersion.value
  const path = normalizeMediaPath(raw)
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (urlCache.value[path]) return urlCache.value[path]
  if (path.startsWith('static/')) {
    scheduleResolve(path)
    return ''
  }
  return path.startsWith('/') ? path : `/${path}`
}

/** 批量预取 OSS 展示地址（页面 refresh 后调用，force 可刷新域名变更） */
export async function prefetchMediaUrls(paths, { force = false } = {}) {
  const normalized = [...new Set(
    (paths || []).map(normalizeMediaPath).filter(p => p.startsWith('static/')),
  )]
  const toFetch = force ? normalized : normalized.filter(p => !urlCache.value[p])
  if (!toFetch.length) return
  const chunkSize = 48
  try {
    for (let i = 0; i < toFetch.length; i += chunkSize) {
      const batch = toFetch.slice(i, i + chunkSize)
      const data = await api.post('/media/resolve-urls', { paths: batch })
      const urls = data?.urls || {}
      let changed = false
      for (const [path, url] of Object.entries(urls)) {
        if (url && urlCache.value[path] !== url) {
          urlCache.value[path] = url
          changed = true
        }
      }
      if (changed) bumpCache()
    }
  } catch (err) {
    console.warn('[media-url] prefetch failed', err?.message || err)
  }
}

/** 后台预取，不阻塞页面数据展示 */
export function prefetchMediaUrlsInBackground(paths, options = {}) {
  void prefetchMediaUrls(paths, options).catch(() => {})
}

/** 写入 ledger 接口已返回的 OSS 展示地址，减少重复 resolve */
export function seedMediaUrlCache(entries) {
  let changed = false
  for (const entry of entries || []) {
    const path = normalizeMediaPath(entry?.path)
    const url = String(entry?.url || '').trim()
    if (!path || !url.startsWith('http')) continue
    if (urlCache.value[path] !== url) {
      urlCache.value[path] = url
      changed = true
    }
  }
  if (changed) bumpCache()
}

/** 从视频 ledger 条目预热 URL 缓存（封面/成片优先） */
export function seedMediaUrlCacheFromLedgerItems(items) {
  const entries = []
  for (const item of items || []) {
    const videoPath = normalizeMediaPath(
      item.local_path || item.localPath || item.video_url || item.videoUrl,
    )
    const displayVideo = item.display_video_url || item.displayVideoUrl
    const displayPoster = item.display_poster_url || item.displayPosterUrl
    if (videoPath && String(displayVideo || '').startsWith('http')) {
      entries.push({ path: videoPath, url: displayVideo })
    }
    const posterPath = videoPosterPathFromSource(videoPath)
    if (posterPath && String(displayPoster || '').startsWith('http')) {
      entries.push({ path: posterPath, url: displayPoster })
    }
    for (const ref of item.reference_images || []) {
      const refPath = normalizeMediaPath(ref.path)
      const refUrl = ref.display_url || ref.displayUrl
      if (refPath && String(refUrl || '').startsWith('http')) {
        entries.push({ path: refPath, url: refUrl })
      }
    }
  }
  seedMediaUrlCache(entries)
}

/** 列表加载后后台补全未缓存的 OSS 地址（不阻塞首屏） */
export function prefetchLedgerMedia(items, { force = false } = {}) {
  const paths = collectMediaPrefetchPaths(
    ...(items || []).flatMap(item => [
      item.local_path || item.localPath,
      item.video_url || item.videoUrl,
      ...(item.reference_images || []).map(ref => ref.path),
    ]),
  )
  if (!paths.length) return
  void prefetchMediaUrls(paths, { force })
}

export function clearMediaUrlCache() {
  urlCache.value = Object.create(null)
  bumpCache()
}
