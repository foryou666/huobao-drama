import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'huobao_drama.db')
const db = new Database(dbPath)
const rows = db.prepare(`
  SELECT id, provider, model, status, prompt, style, duration, aspect_ratio, drama_id,
         config_id, reference_payload, reference_image_urls, image_url, first_frame_url,
         task_id, video_url, created_at, error_msg
  FROM video_generations
  WHERE deleted_at IS NULL
    AND (provider = 'aistarslab' OR provider = 'geeknow' OR provider = 'volcengine')
  ORDER BY id DESC
  LIMIT 10
`).all()

if (!rows.length) {
  console.log('No aistarslab/grok/official tasks, showing latest completed:')
  const fallback = db.prepare(`
    SELECT id, provider, model, status, prompt, style, duration, aspect_ratio, drama_id,
           config_id, reference_payload, reference_image_urls, image_url, first_frame_url,
           task_id, video_url, created_at, error_msg
    FROM video_generations
    WHERE deleted_at IS NULL AND status = 'completed'
    ORDER BY id DESC LIMIT 3
  `).all()
  for (const row of fallback) printRow(row)
} else {
  for (const row of rows) printRow(row)
}

function printRow(row) {
  console.log('---')
  console.log(JSON.stringify({
    ...row,
    prompt: row.prompt?.slice(0, 120) + (row.prompt?.length > 120 ? '...' : ''),
  }, null, 2))
}
