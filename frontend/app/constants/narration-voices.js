/** IndexTTS2 内置解说音色（与 backend/src/constants/narration-voices.ts 保持一致） */
export const NARRATION_VOICE_PRESETS = [
  { id: 'v01', voice_id: 'voice_01', name: '沉稳男声', gender: '男', style: '纪录片 / 历史解说', sample_text: '欢迎收听，这是一段沉稳男声解说试听。' },
  { id: 'v02', voice_id: 'voice_02', name: '青年男声', gender: '男', style: '都市 / 爽文解说', sample_text: '欢迎收听，这是一段青年男声解说试听。' },
  { id: 'v03', voice_id: 'voice_03', name: '磁性男声', gender: '男', style: '悬疑 / 故事讲述', sample_text: '欢迎收听，这是一段磁性男声解说试听。' },
  { id: 'v04', voice_id: 'voice_04', name: '温柔女声', gender: '女', style: '情感 / 言情解说', sample_text: '欢迎收听，这是一段温柔女声解说试听。' },
  { id: 'v05', voice_id: 'voice_05', name: '知性女声', gender: '女', style: '知识 / 科普解说', sample_text: '欢迎收听，这是一段知性女声解说试听。' },
  { id: 'v06', voice_id: 'voice_06', name: '活泼女声', gender: '女', style: '轻松 / 日常解说', sample_text: '欢迎收听，这是一段活泼女声解说试听。' },
  { id: 'v07', voice_id: 'voice_07', name: '成熟男声', gender: '男', style: '权谋 / 古装解说', sample_text: '欢迎收听，这是一段成熟男声解说试听。' },
  { id: 'v08', voice_id: 'voice_08', name: '清亮女声', gender: '女', style: '青春 / 校园解说', sample_text: '欢迎收听，这是一段清亮女声解说试听。' },
  { id: 'v09', voice_id: 'voice_09', name: '浑厚男声', gender: '男', style: '史诗 / 战争解说', sample_text: '欢迎收听，这是一段浑厚男声解说试听。' },
  { id: 'v10', voice_id: 'voice_10', name: '甜美女声', gender: '女', style: '甜宠 / 轻小说', sample_text: '欢迎收听，这是一段甜美女声解说试听。' },
  { id: 'v11', voice_id: 'voice_11', name: '中性旁白', gender: '中性', style: '通用旁白', sample_text: '欢迎收听，这是一段中性旁白试听。' },
  { id: 'v12', voice_id: 'voice_12', name: '戏剧男声', gender: '男', style: '冲突 / 反转解说', sample_text: '欢迎收听，这是一段戏剧男声解说试听。' },
]

export const DEFAULT_NARRATION_VOICE_ID = 'voice_01'

export function findNarrationVoicePreset(voiceId) {
  const id = String(voiceId || '').trim()
  return NARRATION_VOICE_PRESETS.find(v => v.voice_id === id || v.id === id) || null
}

/** Grok Pro 单镜头最长秒数（与 backend grokVideoDurationBounds 一致） */
export const GROK_SHOT_MAX_SEC = 10

export function estimateSpeechSec(text) {
  const chars = String(text || '').replace(/\s/g, '').length
  return Math.max(1, Math.round(chars / 4.5))
}

export function shotsNeededForSpeech(ttsSec, maxShotSec = GROK_SHOT_MAX_SEC) {
  const sec = Number(ttsSec) || 0
  if (sec <= 0) return 1
  return Math.ceil(sec / maxShotSec)
}
