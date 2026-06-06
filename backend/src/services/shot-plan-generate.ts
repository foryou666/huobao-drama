import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getIndustrialShotPrompt, SHOT_PLAN_GENERATION_SUFFIX } from '../prompts/industrial-shot-prompt.js'
import { getTextConfig, getTextProviderBaseUrl } from './ai.js'
import { buildShotPlanContext, formatShotPlanContextForPrompt } from './shot-plan-context.js'
import { importIndustrialScript } from './shot-plans.js'
import { logTaskProgress, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { writeShotPlanLog } from '../utils/shot-plan-logger.js'

const DEFAULT_SHOT_PLAN_MAX_TOKENS = 32768

export interface TextCompletionResult {
  content: string
  model: string
  provider: string
  temperature: number
  maxTokens: number
  finishReason?: string | null
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    reasoning_tokens?: number
  }
  elapsedMs: number
}

function stripMarkdownFences(text: string): string {
  let out = String(text || '').trim()
  if (!out) return ''
  const fenced = out.match(/^```(?:[\w-]+)?\s*([\s\S]*?)```$/i)
  if (fenced) out = fenced[1].trim()
  return out
}

function getAgentTextOptions(agentType: string) {
  const [cfg] = db.select().from(schema.agentConfigs)
    .where(and(eq(schema.agentConfigs.agentType, agentType), isNull(schema.agentConfigs.deletedAt)))
    .all()
    .filter(r => r.isActive)
  return {
    model: cfg?.model || null,
    temperature: cfg?.temperature ?? 0.5,
    maxTokens: cfg?.maxTokens ?? DEFAULT_SHOT_PLAN_MAX_TOKENS,
  }
}

async function callTextCompletion(
  system: string,
  user: string,
  options?: { model?: string | null; temperature?: number; maxTokens?: number },
): Promise<TextCompletionResult> {
  const started = performance.now()
  const textConfig = getTextConfig()
  const baseUrl = getTextProviderBaseUrl(textConfig)
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const model = options?.model || textConfig.model
  const temperature = options?.temperature ?? 0.5
  const maxTokens = options?.maxTokens ?? DEFAULT_SHOT_PLAN_MAX_TOKENS

  logTaskProgress('ShotPlanGenerate', 'request', { model, provider: textConfig.provider, maxTokens })

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${textConfig.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  const raw = await resp.text()
  if (!resp.ok) {
    throw new Error(raw.slice(0, 400) || `文本服务错误 ${resp.status}`)
  }

  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('文本服务返回非 JSON')
  }

  const choice = json?.choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('文本服务未返回有效内容')
  }

  const finishReason = choice?.finish_reason ?? null
  if (finishReason === 'length') {
    logTaskWarn('ShotPlanGenerate', 'truncated', { model, maxTokens, finishReason })
  }

  const usage = json?.usage
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens
    ?? usage?.reasoning_tokens

  return {
    content: stripMarkdownFences(content),
    model,
    provider: textConfig.provider,
    temperature,
    maxTokens,
    finishReason,
    usage: usage ? {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      reasoning_tokens: reasoningTokens,
    } : undefined,
    elapsedMs: Math.round(performance.now() - started),
  }
}

export async function generateAndImportShotPlans(episodeId: number, dramaId: number) {
  const ctxResult = buildShotPlanContext(episodeId, dramaId)
  if ('error' in ctxResult) throw new Error(ctxResult.error)

  const industrialPrompt = getIndustrialShotPrompt()
  if (!industrialPrompt) throw new Error('工业分镜提示词文件缺失')

  const system = [industrialPrompt, '', SHOT_PLAN_GENERATION_SUFFIX].join('\n')
  const user = [
    '请根据以下素材，生成本集完整工业分镜脚本（从【全局基调设定】或【场景：...】开始，覆盖全部剧本情节）。',
    '',
    formatShotPlanContextForPrompt(ctxResult),
  ].join('\n')

  const agentOpts = getAgentTextOptions('shot_plan_generator')

  let completion: TextCompletionResult
  try {
    completion = await callTextCompletion(system, user, agentOpts)
  } catch (err) {
    writeShotPlanLog({
      source: 'generate',
      episodeId,
      dramaId,
      episodeNumber: ctxResult.episode.episode_number,
      episodeTitle: ctxResult.episode.title,
      model: agentOpts.model || undefined,
      temperature: agentOpts.temperature,
      maxTokens: agentOpts.maxTokens,
      systemPrompt: system,
      userPrompt: user,
      error: (err as Error).message,
    })
    throw err
  }

  logTaskProgress('ShotPlanGenerate', 'import', { episodeId, chars: completion.content.length })
  const result = importIndustrialScript(episodeId, dramaId, completion.content)

  const logFiles = writeShotPlanLog({
    source: 'generate',
    episodeId,
    dramaId,
    episodeNumber: ctxResult.episode.episode_number,
    episodeTitle: ctxResult.episode.title,
    model: completion.model,
    provider: completion.provider,
    temperature: completion.temperature,
    maxTokens: completion.maxTokens,
    finishReason: completion.finishReason,
    usage: completion.usage,
    elapsedMs: completion.elapsedMs,
    systemPrompt: system,
    userPrompt: user,
    assistantReply: completion.content,
    importResult: result as unknown as Record<string, unknown>,
  })

  logTaskSuccess('ShotPlanGenerate', 'done', {
    episodeId,
    ...result,
    log: logFiles.basename,
    finishReason: completion.finishReason,
  })

  return {
    ...result,
    log_basename: logFiles.basename,
    finish_reason: completion.finishReason,
    truncated: completion.finishReason === 'length',
  }
}
