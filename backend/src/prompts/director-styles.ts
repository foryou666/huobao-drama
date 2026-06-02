import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = path.resolve(__dirname, '../../../prompts/director-styles')

export const DEFAULT_DIRECTOR_STYLE = 'hongguo_director'

export type DirectorStyleId = 'hongguo_director' | 'super_director' | 'north_america_director'

export interface DirectorStyleMeta {
  id: DirectorStyleId
  label: string
  description: string
}

export const DIRECTOR_STYLE_META: DirectorStyleMeta[] = [
  {
    id: 'hongguo_director',
    label: '红果导演',
    description: '竖屏短剧节奏：强钩子、快反转、对白驱动，默认推荐',
  },
  {
    id: 'super_director',
    label: '超级导演',
    description: '电影感叙事：意象化场景、戏剧张力与人物弧光',
  },
  {
    id: 'north_america_director',
    label: '北美导演',
    description: '好莱坞剧本规范：slug 场景、现在时动作行、覆盖式分镜',
  },
]

const AGENT_SECTION_MAP: Record<string, string> = {
  script_rewriter: '剧本改写',
  storyboard_breaker: '分镜拆解',
}

const styleCache = new Map<string, string>()

function isDirectorStyleId(value: string): value is DirectorStyleId {
  return DIRECTOR_STYLE_META.some(item => item.id === value)
}

export function normalizeDirectorStyle(value?: string | null): DirectorStyleId {
  const trimmed = value?.trim()
  if (trimmed && isDirectorStyleId(trimmed)) return trimmed
  return DEFAULT_DIRECTOR_STYLE
}

function readStyleFile(styleId: DirectorStyleId): string {
  const filePath = path.join(PROMPTS_DIR, `${styleId}.md`)
  if (!fs.existsSync(filePath)) {
    styleCache.set(styleId, '')
    return ''
  }

  const mtime = fs.statSync(filePath).mtimeMs
  const cacheKey = `${styleId}:${mtime}`
  const cached = styleCache.get(cacheKey)
  if (cached !== undefined) return cached

  const content = fs.readFileSync(filePath, 'utf-8')
  // Drop stale entries for this style
  for (const key of styleCache.keys()) {
    if (key.startsWith(`${styleId}:`)) styleCache.delete(key)
  }
  styleCache.set(cacheKey, content)
  return content
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content.trim()
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content.trim()
  return content.slice(end + 4).trim()
}

function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const body = stripFrontmatter(content)
  const parts = body.split(/^## /m)
  for (const part of parts) {
    if (!part.trim()) continue
    const newline = part.indexOf('\n')
    if (newline === -1) continue
    const title = part.slice(0, newline).trim()
    const text = part.slice(newline + 1).trim()
    if (title && text) sections[title] = text
  }
  return sections
}

export function getDirectorStyleMeta(styleId?: string | null): DirectorStyleMeta {
  const id = normalizeDirectorStyle(styleId)
  return DIRECTOR_STYLE_META.find(item => item.id === id) || DIRECTOR_STYLE_META[0]
}

/** 导演风格文件中是否包含该 Agent 的专属章节 */
export function hasDirectorStyleSection(styleId: string | null | undefined, agentType: string): boolean {
  const sectionTitle = AGENT_SECTION_MAP[agentType]
  if (!sectionTitle) return false

  const id = normalizeDirectorStyle(styleId)
  const raw = readStyleFile(id)
  if (!raw.trim()) return false

  const sections = parseSections(raw)
  return Boolean(sections[sectionTitle]?.trim())
}

/** 返回注入 Agent 的导演风格底层提示词 */
export function getDirectorStylePrompt(styleId: string | null | undefined, agentType: string): string {
  const id = normalizeDirectorStyle(styleId)
  const raw = readStyleFile(id)
  if (!raw.trim()) return ''

  const sectionTitle = AGENT_SECTION_MAP[agentType]
  if (!sectionTitle) return ''

  const sections = parseSections(raw)
  const sectionBody = sections[sectionTitle]
  const meta = getDirectorStyleMeta(id)

  const core = sectionBody || stripFrontmatter(raw)
  if (!core.trim()) return ''

  return [
    `## 导演风格：${meta.label}`,
    '以下为当前项目选定的底层提示词规范，优先级高于通用改写习惯；若与用户当次消息冲突，以用户当次消息为准。',
    '',
    core,
  ].join('\n')
}
