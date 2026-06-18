import 'dotenv/config'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeAistarslabContentRefs, normalizeAistarslabReferenceUrls, buildAistarslabOpenApiTaskPayload } from '../dist/utils/aistarslab-content.js'
import { AISTARSLAB_OPENAPI_CREATE_PATH, AISTARSLAB_DEFAULT_BASE_URL } from '../dist/constants/aistarslab.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const id = Number(process.argv[2] || 1207)
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const row = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(id)
if (!row) process.exit(1)

const resolved = await normalizeAistarslabContentRefs(row.reference_payload, row.drama_id)
const refUrls = await normalizeAistarslabReferenceUrls(row.reference_image_urls, row.drama_id)
const body = buildAistarslabOpenApiTaskPayload({
  channel: row.style || '12',
  model: row.model,
  prompt: row.prompt,
  seconds: row.duration,
  aspectRatio: row.aspect_ratio,
  referenceMode: row.reference_mode,
  referenceImageUrls: refUrls,
  contentRefs: resolved,
})

const out = {
  task_id_local: row.id,
  upstream_task_id: row.task_id,
  status: row.status,
  endpoint: `POST ${AISTARSLAB_DEFAULT_BASE_URL}${AISTARSLAB_OPENAPI_CREATE_PATH}`,
  stored_reference_payload: JSON.parse(row.reference_payload || '[]'),
  stored_reference_image_urls: JSON.parse(row.reference_image_urls || '[]'),
  resolved_content_refs: resolved,
  resolved_reference_image_urls: refUrls,
  upstream_request_body: body,
}

const outPath = path.join(root, 'data', `aistarslab-task-${id}-payload.json`)
fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log('written', outPath)
console.log('images count:', body.images?.length || 0)
console.log('modeType:', body.modeType, 'size:', body.size)
