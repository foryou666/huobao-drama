import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })
const row = db.prepare('SELECT id, drama_id, reference_payload FROM video_generations WHERE id = 1255').get()
console.log('task', row)
const char = db.prepare("SELECT id, name, drama_id FROM characters WHERE image_url LIKE '%b5d3205b%' OR local_path LIKE '%b5d3205b%'").all()
console.log('char', char)
