import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { resolveDisplayMediaUrl, resolveDisplayMediaUrls } from '../utils/media-display-url.js'

const app = new Hono()

/** GET /media/url?path=static/characters/xxx.png */
app.get('/url', (c) => {
  const path = c.req.query('path')
  if (!path?.trim()) return badRequest(c, 'path is required')
  const url = resolveDisplayMediaUrl(path)
  if (!url) return badRequest(c, 'invalid path')
  return success(c, { path: path.replace(/^\/+/, ''), url })
})

/** POST /media/resolve-urls  body: { paths: string[] } */
app.post('/resolve-urls', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : []
  if (!paths.length) return badRequest(c, 'paths is required')
  const urls = resolveDisplayMediaUrls(paths)
  return success(c, { urls })
})

export default app
