import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const rows = db.prepare(`
  SELECT v.id, v.status, v.created_at, v.task_id, v.reference_mode,
         length(v.reference_payload) as payload_len,
         length(v.reference_image_urls) as ref_urls_len
  FROM video_generations v
  JOIN ai_service_configs c ON c.id = v.config_id
  WHERE c.provider = 'aistarslab'
  ORDER BY v.id DESC LIMIT 10
`).all()
console.table(rows)
