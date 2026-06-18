import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const rows = db.prepare(`
  SELECT id, status, error_msg, task_id, reference_mode, reference_payload, reference_image_urls, created_at
  FROM video_generations
  WHERE provider = 'aistarslab'
  ORDER BY id DESC LIMIT 8
`).all()

for (const r of rows) {
  console.log(JSON.stringify({
    id: r.id,
    status: r.status,
    error: r.error_msg,
    task_id: r.task_id,
    ref_mode: r.reference_mode,
    ref_payload: r.reference_payload?.slice(0, 200),
    ref_urls: r.reference_image_urls?.slice(0, 200),
    created: r.created_at,
  }))
}
