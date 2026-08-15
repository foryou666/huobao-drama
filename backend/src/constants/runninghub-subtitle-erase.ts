/**
 * RunningHub 视频去字幕 LTX2.3（AI 应用 API）
 * https://www.runninghub.cn/call-api/api-detail/2082744190789840898?apiType=4
 */
export const RUNNINGHUB_SUBTITLE_ERASE_WEBAPP_ID = '2082744190789840898'

export const RUNNINGHUB_SUBTITLE_ERASE_DOCS_URL =
  `https://www.runninghub.cn/call-api/api-detail/${RUNNINGHUB_SUBTITLE_ERASE_WEBAPP_ID}?apiType=4`

/** VHS_LoadVideo — 官方 demo 仅此节点 */
export const RUNNINGHUB_SUBTITLE_ERASE_VIDEO_NODE = {
  nodeId: '5134',
  fieldName: 'video',
} as const

/** 官方 demo 使用 plus（48G） */
export const RUNNINGHUB_SUBTITLE_ERASE_INSTANCE_TYPE = 'plus'
export const RUNNINGHUB_SUBTITLE_ERASE_PROVIDER = 'runninghub_subtitle_erase'

export const SUBTITLE_ERASE_MAX_FILES_PER_BATCH = 10
/** 暂定 60 秒上限（上游未写死；过长易 OOM） */
export const SUBTITLE_ERASE_MAX_DURATION_SEC = 60
export const SUBTITLE_ERASE_MAX_FILE_BYTES = 500 * 1024 * 1024

export type SubtitleEraseMode = 'subtitle' | 'watermark' | 'both'

/** LTX2.3 应用无模式开关，保留兼容 */
export function resolveSubtitleErasePrompt(_mode?: string | null): string {
  return ''
}

export function resolveSubtitleEraseModeFlag(mode?: string | null): boolean {
  const normalized = String(mode || 'subtitle').trim().toLowerCase()
  return normalized !== 'watermark' && normalized !== 'wm' && normalized !== 'false'
}
