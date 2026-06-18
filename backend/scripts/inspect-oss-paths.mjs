import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDramaIdForStaticPath, resolveProjectObjectKeyForStaticPath } from '../dist/utils/oss-path.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = new Database(path.join(root, 'data', 'huobao_drama.db'), { readonly: true })

const paths = [
  'static/characters/b5d3205b-dd1a-4774-a24e-231b78d13221.png',
  'static/characters/06ea00fc-20c7-4364-880e-c0e161f4d4c4.png',
  'static/assets/944f3966-4ac5-4790-afd5-1e719432557a.png',
]

for (const p of paths) {
  const dramaId = resolveDramaIdForStaticPath(p)
  const key = resolveProjectObjectKeyForStaticPath(p)
  const char = db.prepare(`
    SELECT id, name, drama_id, image_url, local_path, oss_object_key
    FROM characters WHERE image_url = ? OR local_path = ?
  `).get(p, p)
  const mapping = db.prepare('SELECT * FROM oss_static_mappings WHERE local_path = ?').get(p)
  console.log({ path: p, dramaId, key, char, mapping })
}
