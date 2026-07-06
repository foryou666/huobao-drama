import { getActiveConfig, getTextProviderBaseUrl, type AIConfig } from './ai.js'
import { extractVideoFrameAt } from '../utils/shot-frame.js'
import { resolveMediaUrlForExternalApi } from '../utils/oss-upload.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import type { RepaintAnalysis, RepaintShotVisual } from './repaint-types.js'
import type { DetectedShot } from '../utils/shot-detect.js'

const VISION_MODEL = process.env.REPAINT_VISION_MODEL || 'qwen-vl-max'
const BATCH_SIZE = 4
const MAX_VISION_SHOTS = 50

function resolveVisionConfig(): AIConfig {
  const image = getActiveConfig('image')
  if (image?.provider.toLowerCase().includes('ali')) return image
  const text = getActiveConfig('text')
  if (text?.provider.toLowerCase().includes('ali')) return text
  throw new Error('请在设置中配置百炼（ali）文本或图片 API，用于视频理解')
}

function dashScopeCompatibleUrl(config: AIConfig) {
  const baseUrl = getTextProviderBaseUrl(config)
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function stripJsonBlock(text: string) {
  let out = String(text || '').trim()
  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) out = fenced[1].trim()
  return out
}

function shotMidSec(shot: DetectedShot) {
  return shot.start_sec + (shot.end_sec - shot.start_sec) / 2
}

function dialogueForShot(analysis: RepaintAnalysis, shotId: string) {
  const assignment = analysis.shot_assignments.find(a => a.shot_id === shotId)
  return analysis.utterances
    .filter(u => assignment?.utterance_ids.includes(u.id))
    .map(u => u.text.trim())
    .filter(Boolean)
    .join(' ')
}

function buildBatchUserText(
  analysis: RepaintAnalysis,
  batch: Array<{ shot: DetectedShot; imageUrl: string; framePath: string }>,
) {
  const lines = [
    '以下每张图片对应该镜头 ID 的中点关键帧。请仅根据画面与 ASR 台词推断分镜参数，输出 JSON。',
    '输出格式：',
    '{"shots":[{"shot_id":"s1","shot_size":"中近景 (MCU)","shot_size_detail":"卡胸部以上","camera_angle":"平视 (Eye-level)","camera_movement":"固定 (Static)","movement_motivation":"...","action_blocking":"...","dialogue_note":"Silence. 或 角色名: 台词 或 角色名 (O.S.): 台词"}]}',
    '',
    '【镜头上下文】',
  ]

  for (const item of batch) {
    const dialogue = dialogueForShot(analysis, item.shot.id)
    lines.push(
      `- ${item.shot.id}: ${item.shot.start_sec}s-${item.shot.end_sec}s (${item.shot.duration_sec}s)`
      + ` | ASR: ${dialogue || '（无对白）'}`,
    )
  }

  lines.push('', '图片顺序与上述镜头列表一致。')
  return lines.join('\n')
}

async function callVisionBatch(
  config: AIConfig,
  batch: Array<{ shot: DetectedShot; imageUrl: string; framePath: string }>,
  analysis: RepaintAnalysis,
): Promise<RepaintShotVisual[]> {
  const content: Array<Record<string, unknown>> = []
  for (const item of batch) {
    content.push({ type: 'image_url', image_url: { url: item.imageUrl } })
  }
  content.push({ type: 'text', text: buildBatchUserText(analysis, batch) })

  const system = `你是专业影视拉片分析师，擅长从关键帧推断景别、机位、运镜动机、人物调度。
要求：
1. 只描述画面中可见或可合理推断的内容，不要编造剧情
2. 台词以 ASR 为准写入 dialogue_note；画面未见说话者但对白存在时用 (O.S.)
3. movement_motivation 说明运镜或静止的内在动机
4. action_blocking 写清楚人物位置、朝向、动作、道具互动
5. 输出合法 JSON，shots 数组与输入镜头 ID 一一对应`

  const resp = await fetch(dashScopeCompatibleUrl(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model?.includes('vl') ? config.model : VISION_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
  })

  const raw = await resp.text()
  if (!resp.ok) throw new Error(raw.slice(0, 400) || `视觉理解错误 ${resp.status}`)

  const json = JSON.parse(raw)
  const text = json?.choices?.[0]?.message?.content
  const parsed = typeof text === 'string'
    ? JSON.parse(stripJsonBlock(text))
  : text

  const items = Array.isArray(parsed?.shots) ? parsed.shots : []
  const byId = new Map<string, any>()
  for (const item of items) {
    if (item?.shot_id) byId.set(String(item.shot_id), item)
  }

  return batch.map((item) => {
    const row = byId.get(item.shot.id) || {}
    return {
      shot_id: item.shot.id,
      shot_size: String(row.shot_size || '').trim() || undefined,
      shot_size_detail: String(row.shot_size_detail || '').trim() || undefined,
      camera_angle: String(row.camera_angle || '').trim() || undefined,
      camera_movement: String(row.camera_movement || '').trim() || undefined,
      movement_motivation: String(row.movement_motivation || '').trim() || undefined,
      action_blocking: String(row.action_blocking || '').trim() || undefined,
      dialogue_note: String(row.dialogue_note || '').trim() || undefined,
      frame_path: item.framePath,
    } satisfies RepaintShotVisual
  })
}

export async function analyzeShotsWithVision(
  analysis: RepaintAnalysis,
  sourceVideoPath: string,
  dramaId?: number | null,
): Promise<{ visuals: RepaintShotVisual[]; partialWarnings: string[] }> {
  const shots = analysis.shots.slice(0, MAX_VISION_SHOTS)
  if (!shots.length) return { visuals: [], partialWarnings: [] }

  const config = resolveVisionConfig()
  logTaskStart('RepaintVision', 'analyze', { shots: shots.length, model: VISION_MODEL })

  const results: RepaintShotVisual[] = []
  const warnings: string[] = []

  for (let i = 0; i < shots.length; i += BATCH_SIZE) {
    const batchShots = shots.slice(i, i + BATCH_SIZE)
    logTaskProgress('RepaintVision', 'batch', { from: i, count: batchShots.length })

    const prepared: Array<{ shot: DetectedShot; imageUrl: string; framePath: string }> = []
    for (const shot of batchShots) {
      try {
        const framePath = await extractVideoFrameAt(sourceVideoPath, shotMidSec(shot))
        await trySyncStaticToOss(framePath, dramaId ?? undefined)
        const imageUrl = await resolveMediaUrlForExternalApi(framePath, dramaId)
        if (!imageUrl) throw new Error('帧图需 OSS 公网 URL')
        prepared.push({ shot, imageUrl, framePath })
      } catch (err: any) {
        warnings.push(`${shot.id} 抽帧失败：${err.message}`)
      }
    }

    if (!prepared.length) continue

    try {
      const batchResult = await callVisionBatch(config, prepared, analysis)
      results.push(...batchResult)
    } catch (err: any) {
      logTaskError('RepaintVision', 'batch', { error: err.message, from: i })
      warnings.push(`镜头批次 ${i + 1}-${i + batchShots.length} 视觉理解失败：${err.message}`)
    }
  }

  logTaskSuccess('RepaintVision', 'analyze', {
    parsed: results.length,
    warnings: warnings.length,
  })

  if (!results.length) {
    throw new Error(warnings.join('；') || '视觉理解未返回结果')
  }

  if (warnings.length) {
    logTaskError('RepaintVision', 'partial', { warnings: warnings.join('；') })
  }

  return { visuals: results, partialWarnings: warnings }
}

export async function analyzeShotsWithVisionSafe(
  analysis: RepaintAnalysis,
  sourceVideoPath: string,
  dramaId?: number | null,
): Promise<{ visuals: RepaintShotVisual[]; warning?: string }> {
  try {
    const { visuals, partialWarnings } = await analyzeShotsWithVision(analysis, sourceVideoPath, dramaId)
    return {
      visuals,
      warning: partialWarnings.length ? partialWarnings.join('；') : undefined,
    }
  } catch (err: any) {
    return {
      visuals: [],
      warning: err.message || String(err),
    }
  }
}
