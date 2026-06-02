import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(__dirname, '../../data/huobao_drama.db'))
const cfg = db.prepare("SELECT api_key FROM ai_service_configs WHERE service_type='video' AND is_active=1 LIMIT 1").get()

const paths = [
  'https://api.chatfire.site/volc/asset/CreateAssetGroup',
  'https://api.chatfire.site/v1/volc/asset/CreateAssetGroup',
  'https://api.chatfire.site/volcengine/v1/volc/asset/CreateAssetGroup',
  'https://www.anyfast.ai/volc/asset/CreateAssetGroup',
]

const body = { model: 'volc-asset', Name: 'huobao-test' }

for (const url of paths) {
  console.log('\n===', url)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    console.log('status', resp.status, (await resp.text()).slice(0, 350))
  } catch (e) {
    console.log('error', e.message)
  }
}
