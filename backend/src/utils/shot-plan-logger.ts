import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SHOT_PLAN_LOG_DIR = process.env.SHOT_PLAN_LOG_DIR
  || path.resolve(__dirname, '../../../data/logs/shot-plans')

export type ShotPlanLogSource = 'generate' | 'import' | 'agent'

export interface ShotPlanLogEntry {
  source: ShotPlanLogSource
  episodeId: number
  dramaId: number
  episodeNumber?: number
  episodeTitle?: string
  model?: string
  provider?: string
  temperature?: number
  maxTokens?: number
  finishReason?: string | null
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    reasoning_tokens?: number
  }
  systemPrompt?: string
  userPrompt?: string
  assistantReply?: string
  importResult?: Record<string, unknown>
  error?: string
  elapsedMs?: number
}

function ensureLogDir() {
  fs.mkdirSync(SHOT_PLAN_LOG_DIR, { recursive: true })
}

function timestampSlug(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function buildLogBasename(entry: ShotPlanLogEntry, date = new Date()) {
  const ep = entry.episodeNumber != null ? `ep${entry.episodeNumber}` : `episode${entry.episodeId}`
  return `${timestampSlug(date)}_${ep}_${entry.source}`
}

function renderMarkdown(entry: ShotPlanLogEntry, savedAt: string, basename: string) {
  const lines: string[] = [
    '# 分镜生成日志',
    '',
    '## 元信息',
    '',
    `| 字段 | 值 |`,
    `| --- | --- |`,
    `| 文件名 | \`${basename}.md\` |`,
    `| 记录时间 | ${savedAt} |`,
    `| 来源 | ${entry.source} |`,
    `| 剧集 ID | ${entry.episodeId} |`,
    `| 项目 ID | ${entry.dramaId} |`,
  ]
  if (entry.episodeNumber != null) lines.push(`| 集数 | 第 ${entry.episodeNumber} 集 |`)
  if (entry.episodeTitle) lines.push(`| 标题 | ${entry.episodeTitle} |`)
  if (entry.model) lines.push(`| 模型 | ${entry.model} |`)
  if (entry.provider) lines.push(`| Provider | ${entry.provider} |`)
  if (entry.temperature != null) lines.push(`| temperature | ${entry.temperature} |`)
  if (entry.maxTokens != null) lines.push(`| max_tokens | ${entry.maxTokens} |`)
  if (entry.finishReason) lines.push(`| finish_reason | ${entry.finishReason} |`)
  if (entry.elapsedMs != null) lines.push(`| 耗时 | ${(entry.elapsedMs / 1000).toFixed(1)}s |`)
  if (entry.usage) {
    const u = entry.usage
    lines.push(`| Token 用量 | prompt=${u.prompt_tokens ?? '-'} completion=${u.completion_tokens ?? '-'} total=${u.total_tokens ?? '-'}${u.reasoning_tokens != null ? ` reasoning=${u.reasoning_tokens}` : ''} |`)
  }
  if (entry.error) lines.push(`| 错误 | ${entry.error} |`)

  if (entry.importResult) {
    lines.push('', '## 导入结果', '')
    for (const [k, v] of Object.entries(entry.importResult)) {
      lines.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    }
  }

  if (entry.systemPrompt) {
    lines.push('', '## 发送 · System', '', '```text', entry.systemPrompt, '```')
  }

  if (entry.userPrompt) {
    lines.push('', '## 发送 · User', '', '```text', entry.userPrompt, '```')
  }

  if (entry.assistantReply) {
    lines.push('', '## 回复 · Assistant', '', '```text', entry.assistantReply, '```')
  }

  if (entry.finishReason === 'length') {
    lines.push('', '> ⚠️ **finish_reason=length**：输出可能因 max_tokens 上限被截断，镜头数可能不完整。')
  }

  return lines.join('\n')
}

export function writeShotPlanLog(entry: ShotPlanLogEntry): { basename: string; mdPath: string; jsonPath: string } {
  ensureLogDir()
  const savedAt = new Date().toISOString()
  const basename = buildLogBasename(entry)
  const mdPath = path.join(SHOT_PLAN_LOG_DIR, `${basename}.md`)
  const jsonPath = path.join(SHOT_PLAN_LOG_DIR, `${basename}.json`)

  const payload = { saved_at: savedAt, ...entry }
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8')
  fs.writeFileSync(mdPath, renderMarkdown(entry, savedAt, basename), 'utf-8')

  return { basename, mdPath, jsonPath }
}

export interface ShotPlanLogListItem {
  basename: string
  episode_id: number
  episode_number?: number
  source: ShotPlanLogSource
  saved_at: string
  model?: string
  plan_count?: number
  finish_reason?: string | null
  error?: string
}

function parseLogMeta(jsonPath: string): ShotPlanLogListItem | null {
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    return {
      basename: path.basename(jsonPath, '.json'),
      episode_id: raw.episodeId,
      episode_number: raw.episodeNumber,
      source: raw.source,
      saved_at: raw.saved_at,
      model: raw.model,
      plan_count: typeof raw.importResult?.plan_count === 'number' ? raw.importResult.plan_count : undefined,
      finish_reason: raw.finishReason ?? null,
      error: raw.error,
    }
  } catch {
    return null
  }
}

export function listShotPlanLogs(opts?: { episodeId?: number; limit?: number }): ShotPlanLogListItem[] {
  ensureLogDir()
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100)
  const files = fs.readdirSync(SHOT_PLAN_LOG_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => path.join(SHOT_PLAN_LOG_DIR, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)

  const items: ShotPlanLogListItem[] = []
  for (const file of files) {
    const meta = parseLogMeta(file)
    if (!meta) continue
    if (opts?.episodeId && meta.episode_id !== opts.episodeId) continue
    items.push(meta)
    if (items.length >= limit) break
  }
  return items
}

export function readShotPlanLog(basename: string, format: 'md' | 'json' = 'md'): string | null {
  const safe = path.basename(basename).replace(/\.(md|json)$/, '')
  const filePath = path.join(SHOT_PLAN_LOG_DIR, `${safe}.${format}`)
  if (!filePath.startsWith(SHOT_PLAN_LOG_DIR)) return null
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}
