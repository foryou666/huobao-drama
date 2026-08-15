/**
 * 在服务器上同步参考音色 AI App 的双音频 nodeInfoList
 */
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(root, '../backend/package.json'))
const Database = require('better-sqlite3')
const db = new Database(path.join(root, '../data/huobao_drama.db'), { readonly: true })
const row = db.prepare(
  "SELECT api_key, base_url FROM ai_service_configs WHERE provider = 'runninghub_indextts2' ORDER BY priority DESC LIMIT 1",
).get()
if (!row?.api_key) {
  console.error('no api key')
  process.exit(1)
}

const apiKey = row.api_key
const apiBase = String(row.base_url || 'https://www.runninghub.cn').replace(/\/+$/, '')
const webappId = '1986388299516411905'
const url = `${apiBase}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=${encodeURIComponent(webappId)}`
const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
const payload = await resp.json()
const list = payload?.data?.nodeInfoList
if (!Array.isArray(list) || !list.length) {
  console.error('no nodeInfoList', JSON.stringify(payload).slice(0, 500))
  process.exit(1)
}

const template = list.map((x) => ({
  nodeId: String(x.nodeId),
  fieldName: String(x.fieldName),
  fieldValue: x.fieldValue,
  description: String(x.description || x.descriptionCn || x.descriptionEn || '').trim() || undefined,
}))

function classify(desc) {
  const d = String(desc || '')
  if (/情感|情绪|emotion|次要|secondary/i.test(d) && !/人物|角色|character|重要|important/i.test(d)) return 'emotion'
  if (/人物|角色|character|重要|important|音色/i.test(d)) return 'character'
  return 'unknown'
}

const audios = template.filter((x) => String(x.fieldName).toLowerCase() === 'audio')
const character = audios.find((x) => classify(x.description) === 'character') || audios[0]
const emotion = audios.find((x) => classify(x.description) === 'emotion') || audios.find((x) => x.nodeId !== character?.nodeId)
const textNode = template.find((x) => /^(text|value|string)$/i.test(x.fieldName)) || template.find((x) => x.fieldName === 'value')

const bindings = {
  text: textNode ? { nodeId: textNode.nodeId, fieldName: textNode.fieldName } : null,
  audio: character ? { nodeId: character.nodeId, fieldName: character.fieldName } : null,
  emotionAudio: emotion ? { nodeId: emotion.nodeId, fieldName: emotion.fieldName } : null,
  emotionVector: null,
  emotionWeight: null,
  emotions: null,
}

console.log('template', JSON.stringify(template, null, 2))
console.log('bindings', JSON.stringify(bindings, null, 2))

const writeDb = new Database(path.join(root, '../data/huobao_drama.db'))
const existing = writeDb.prepare(
  "SELECT id FROM ai_service_configs WHERE provider = 'runninghub_indextts2_ref' ORDER BY priority DESC LIMIT 1",
).get()
const settings = JSON.stringify({
  webapp_id: webappId,
  api_mode: 'ai_app',
  node_bindings: bindings,
  node_info_template: template,
  instance_type: 'default',
  use_personal_queue: false,
  docs_url: `https://www.runninghub.cn/call-api/api-detail/${webappId}?apiType=4`,
})
const ts = new Date().toISOString()
if (existing?.id) {
  writeDb.prepare(
    'UPDATE ai_service_configs SET settings = ?, is_active = 1, updated_at = ? WHERE id = ?',
  ).run(settings, ts, existing.id)
  console.log('updated ref config id', existing.id)
} else {
  const info = writeDb.prepare(`
    INSERT INTO ai_service_configs
      (service_type, provider, name, base_url, api_key, model, priority, is_active, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    'audio',
    'runninghub_indextts2_ref',
    'RunningHub IndexTTS2 参考音色',
    apiBase,
    apiKey,
    JSON.stringify([webappId]),
    119,
    settings,
    ts,
    ts,
  )
  console.log('created ref config id', info.lastInsertRowid)
}
writeDb.close()
console.log('done')
