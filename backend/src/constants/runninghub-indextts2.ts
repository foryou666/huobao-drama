/** RunningHub IndexTTS2 情感向量配音工作流 */

/** 调用页 workflowId：/run/workflow/{id} */
export const RUNNINGHUB_INDEXTTS2_WORKFLOW_ID = '2012710824451772417'

/** 页面元数据中的 webappId（AI 应用 API 备用） */
export const RUNNINGHUB_INDEXTTS2_WEBAPP_ID = '2012809189353070594'

/**
 * 旁白配音(参考音色) — AI 应用 API（apiType=4）
 * https://www.runninghub.cn/call-api/api-detail/1986388299516411905?apiType=4
 */
export const RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID = '1986388299516411905'

export const RUNNINGHUB_API_BASE = 'https://www.runninghub.cn'

export const RUNNINGHUB_INDEXTTS2_DOCS_URL =
  `https://www.runninghub.cn/call-api/api-detail/${RUNNINGHUB_INDEXTTS2_WORKFLOW_ID}?apiType=5`

export const RUNNINGHUB_INDEXTTS2_REF_DOCS_URL =
  `https://www.runninghub.cn/call-api/api-detail/${RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID}?apiType=4`

/** 与 RunningHub 文档一致：喜 怒 哀 惧 厌恶 低落 惊喜 平静 */
export const RUNNINGHUB_EMOTION_KEYS = [
  'happy',
  'angry',
  'sad',
  'afraid',
  'disgusted',
  'melancholic',
  'surprised',
  'calm',
] as const

export type RunningHubEmotionKey = (typeof RUNNINGHUB_EMOTION_KEYS)[number]

export const RUNNINGHUB_EMOTION_LABELS: Array<{ key: RunningHubEmotionKey; label: string }> = [
  { key: 'happy', label: '喜' },
  { key: 'angry', label: '怒' },
  { key: 'sad', label: '哀' },
  { key: 'afraid', label: '惧' },
  { key: 'disgusted', label: '厌恶' },
  { key: 'melancholic', label: '低落' },
  { key: 'surprised', label: '惊喜' },
  { key: 'calm', label: '平静' },
]

export const RUNNINGHUB_TTS_PROVIDER = 'runninghub_indextts2'
/** 旁白配音(参考音色) 专用 provider，与 workflow 版历史隔离 */
export const RUNNINGHUB_TTS_REF_PROVIDER = 'runninghub_indextts2_ref'

export type RunningHubTtsProfile = 'default' | 'ref'

export interface RunningHubNodeBinding {
  nodeId: string
  fieldName: string
}

export interface RunningHubNodeBindings {
  text?: RunningHubNodeBinding | null
  /** 人物参考音色（重要） */
  audio?: RunningHubNodeBinding | null
  /** 情感参考音频（次要，可选） */
  emotionAudio?: RunningHubNodeBinding | null
  /** 整段情感向量字符串，如 [0,0,0,0,0,0,0,0] */
  emotionVector?: RunningHubNodeBinding | null
  emotionWeight?: RunningHubNodeBinding | null
  /** 8 个独立滑条字段（若工作流暴露 Happy/Angry…） */
  emotions?: Partial<Record<RunningHubEmotionKey, RunningHubNodeBinding>> | null
}

export const DEFAULT_RUNNINGHUB_NODE_BINDINGS: RunningHubNodeBindings = {
  text: null,
  audio: null,
  emotionAudio: null,
  emotionVector: null,
  emotionWeight: null,
  emotions: null,
}
