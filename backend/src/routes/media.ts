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
  resolveStaticMediaDownloadLink,
  resolveVideoGenerationDownloadLink,
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

/** GET /media/download-link?path=&filename= — 返回直链（本地 /static 或 OSS 签名），避免整包经 Node 缓冲 */
app.get('/download-link', async (c) => {
  try {
    const staticPath = assertSafeStaticMediaPath(c.req.query('path') || '')
    const filename = sanitizeDownloadFilename(
      c.req.query('filename') || '',
      path.basename(staticPath),
    )
    const link = await resolveStaticMediaDownloadLink(staticPath, filename)
    if (!link) return notFound(c, 'file not found')
    return success(c, link)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (message === 'path is required') return badRequest(c, 'path is required')
    if (message === 'invalid path') return badRequest(c, 'invalid path')
    if (message === 'file not found') return notFound(c, 'file not found')
    return serverError(c, message || 'download failed')
  }
})

/** GET /media/download?path=static/...&filename= — 同源代理下载（无直链时回退） */
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

/** GET /media/download-video/:id/link — 鉴权后返回直链，浏览器直接拉文件 */
app.get('/download-video/:id/link', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id) || id <= 0) return badRequest(c, 'invalid id')
    const filename = sanitizeDownloadFilename(c.req.query('filename') || '', `video_${id}.mp4`)
    const link = await resolveVideoGenerationDownloadLink(id, filename)
    if (!link) return notFound(c, 'file not found')
    return success(c, link)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (message === 'not found' || message === 'file not found') return notFound(c, 'file not found')
    return serverError(c, message || 'download failed')
  }
})

/** GET /media/download-video/:id?filename= — 代理流式下载（无直链时回退） */
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
