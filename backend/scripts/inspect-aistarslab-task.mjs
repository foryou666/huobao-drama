import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeAistarslabContentRefs, normalizeAistarslabReferenceUrls, buildAistarslabNewApiTaskPayload } from '../dist/utils/aistarslab-content.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const id = Number(process.argv[2] || 0)

let row
if (id) {
  row = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
} else {
  row = db.prepare(`
    SELECT v.* FROM video_generations v
    JOIN ai_service_configs c ON c.id = v.config_id
    WHERE c.provider = 'aistarslab'
    ORDER BY v.id DESC LIMIT 1
  `).get()
}

if (!row) {
  console.error('Not found')
  process.exit(1)
}

console.log('=== Task', row.id, '===')
console.log('status:', row.status)
console.log('created_at:', row.created_at)
console.log('task_id:', row.task_id)
console.log('reference_mode:', row.reference_mode)
console.log('model:', row.model)
console.log('style(channel):', row.style)
console.log('\n--- reference_payload (raw) ---')
console.log(row.reference_payload)
console.log('\n--- reference_image_urls (raw) ---')
console.log(row.reference_image_urls)

const resolved = await normalizeAistarslabContentRefs(row.reference_payload)
const refUrls = await normalizeAistarslabReferenceUrls(row.reference_image_urls)
console.log('\n--- resolved reference_image_urls ---')
console.log(refUrls)

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

console.log('\n--- upstream POST body (simulated) ---')
console.log(JSON.stringify(body, null, 2))
