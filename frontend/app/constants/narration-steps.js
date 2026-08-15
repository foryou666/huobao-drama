export const NARRATION_STAGES = [
  { id: 'extract', label: '实体抽取', desc: '角色 / 场景 / 道具' },
  { id: 'assets', label: '定稿图', desc: '角色三视图 / 场景 / 道具' },
  { id: 'segment', label: '旁白分段', desc: '按整句切分原文' },
  { id: 'tts', label: 'TTS 朗读', desc: 'RunningHub IndexTTS2 旁白配音' },
  { id: 'generate', label: 'Grok 视频', desc: '按段生成画面' },
  { id: 'export', label: '剪映导出', desc: '拼接草稿' },
]

export const NARRATION_STAGE_LABELS = {
  upload: '上传小说',
  extract: '实体抽取',
  assets: '定稿图',
  segment: '旁白分段',
  tts: 'TTS 朗读',
  generate: 'Grok 视频',
  export: '剪映导出',
  completed: '已完成',
}
