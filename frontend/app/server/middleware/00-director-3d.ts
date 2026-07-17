import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { sendStream, setResponseHeader } from 'h3'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const deskRoot = normalize(join(process.cwd(), 'public', 'director-3d'))

function resolveDeskFile(pathname: string): string | null {
  let rel = decodeURIComponent(pathname.slice('/director-3d'.length) || '/')
  if (!rel || rel === '/') rel = '/index.html'
  if (rel.endsWith('/')) rel += 'index.html'

  const target = normalize(join(deskRoot, rel.replace(/^\//, '')))
  if (target !== deskRoot && !target.startsWith(deskRoot + sep)) return null
  if (!existsSync(target) || !statSync(target).isFile()) return null
  return target
}

export default defineEventHandler((event) => {
  const pathname = event.path.split('?')[0]
  if (!pathname.startsWith('/director-3d')) return

  const filePath = resolveDeskFile(pathname)
  if (!filePath) return

  const ext = extname(filePath).toLowerCase()
  setResponseHeader(event, 'content-type', MIME[ext] || 'application/octet-stream')
  return sendStream(event, createReadStream(filePath))
})
