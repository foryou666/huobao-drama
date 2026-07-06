import path from 'path'
import { getAbsolutePath } from './storage.js'

export function resolveMediaFilePath(relativePath: string): string {
  const normalized = String(relativePath || '').trim().replace(/^\/+/, '')
  if (!normalized) return ''
  if (path.isAbsolute(normalized)) return normalized
  if (normalized.startsWith('static/')) return getAbsolutePath(normalized)
  return getAbsolutePath(`static/${normalized}`)
}
