import { Hono } from 'hono'
import path from 'path'
import { Readable } from 'stream'
import { success, badRequest, notFound, serverError } from '../utils/response.js'
import { resolveDisplayMediaUrl, resolveDisplayMediaUrls } from '../utils/media-display-url.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'
import {
  assertSafeStaticMediaPath,
  mimeForStaticPath,
  openMediaReadStream,
  openVideoGenerationReadStream,
  sanitizeDownloadFilename,
} from '../utils/media-download.js'

const app = new Hono()

/** GET /media/url?path=static/characters/xxx.png */
app.get('/url', (c) => {
  const pathParam = c.req.query('path')
  if (!pathParam?.trim()) return badRequest(c, 'path is required')
  const url = resolveDisplayMediaUrl(pathParam)
  if (!url) return badRequest(c, 'invalid path')
  return success(c, { path: pathParam.replace(/^\/+/, ''), url })
})

/** POST /media/resolve-urls  body: { paths: string[] } */
app.post('/resolve-urls', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : []
  if (!paths.length) return badRequest(c, 'paths is required')

  for (const raw of paths) {
    const normalized = String(raw || '').trim().replace(/^\/+/, '')
    if (normalized.startsWith('static/videos/subtitle-removed/')) {
      await trySyncStaticToOss(normalized).catch(() => null)
    }
  }

  const urls = resolveDisplayMediaUrls(paths)
  return success(c, { urls })
})

/** GET /media/download?path=static/...&filename= — 同源代理下载（OSS 优先，不依赖本地 static） */
app.get('/download', async (c) => {
  try {
    const staticPath = assertSafeStaticMediaPath(c.req.query('path') || '')
    const filename = sanitizeDownloadFilename(
      c.req.query('filename') || '',
      path.basename(staticPath),
    )
    const { stream } = await openMediaReadStream(staticPath)
    const webStream = Readable.toWeb(stream) as ReadableStream
    return new Response(webStream, {
      headers: {
        'Content-Type': mimeForStaticPath(staticPath),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err: any) {
    const message = String(err?.message || '')
    if (message === 'path is required') return badRequest(c, 'path is required')
    if (message === 'invalid path') return badRequest(c, 'invalid path')
    if (message === 'file not found') return notFound(c, 'file not found')
    return serverError(c, message || 'download failed')
  }
})

/** GET /media/download-video/:id?filename= — 视频生成记录下载（OSS / 上游 URL 均由服务端代理） */
app.get('/download-video/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id) || id <= 0) return badRequest(c, 'invalid id')
    const filename = sanitizeDownloadFilename(c.req.query('filename') || '', `video_${id}.mp4`)
    const { stream, contentType } = await openVideoGenerationReadStream(id)
    const webStream = Readable.toWeb(stream) as ReadableStream
    return new Response(webStream, {
      headers: {
        'Content-Type': contentType || 'video/mp4',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err: any) {
    const message = String(err?.message || '')
    if (message === 'not found' || message === 'file not found') return notFound(c, 'file not found')
    return serverError(c, message || 'download failed')
  }
})

export default app
