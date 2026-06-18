import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeAistarslabContentRefs, normalizeAistarslabReferenceUrls, buildAistarslabNewApiTaskPayload } from '../dist/utils/aistarslab-content.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const id = Number(process.argv[2] || 1207)
const row = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
if (!row) {
  console.error('Not found:', id)
  process.exit(1)
}

console.log('OSS configured:', !!(process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET))
console.log('PUBLIC_BASE_URL:', process.env.PUBLIC_BASE_URL || '(empty)')

const resolved = await normalizeAistarslabContentRefs(row.reference_payload, row.drama_id)
const refUrls = await normalizeAistarslabReferenceUrls(row.reference_image_urls, row.drama_id)
console.log('Raw refs:', row.reference_payload?.slice(0, 200))
console.log('Resolved count:', resolved.length)
for (const ref of resolved) {
  console.log(' -', ref.type, ref.url?.slice(0, 120))
}

const body = buildAistarslabNewApiTaskPayload({
  channel: row.style || '12',
  model: row.model,
  prompt: row.prompt,
  seconds: row.duration,
  aspectRatio: row.aspect_ratio,
  referenceMode: row.reference_mode,
  referenceImageUrls: refUrls,
  contentRefs: resolved,
})

console.log('\nUpstream body keys:', Object.keys(body))
console.log('images count:', body.images?.length || 0)
if (body.images?.length) {
  for (const url of body.images) console.log(' image:', String(url).slice(0, 120))
} else {
  console.log('WARNING: no images in upstream payload')
}
console.log('prompt prefix:', String(body.prompt).slice(0, 80))
