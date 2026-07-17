export const TTS_EMOTION_MODES = [
  { id: 'same', label: '跟随参考音色' },
  { id: 'text', label: '文字描述' },
  { id: 'vector', label: '情绪滑条' },
]

export const TTS_EMOTION_VECTOR_LABELS = [
  { key: 'happy', label: '开心' },
  { key: 'angry', label: '愤怒' },
  { key: 'sad', label: '悲伤' },
  { key: 'afraid', label: '恐惧' },
  { key: 'disgusted', label: '厌恶' },
  { key: 'melancholic', label: '忧郁' },
  { key: 'surprised', label: '惊讶' },
  { key: 'calm', label: '平静' },
]

export const TTS_EMOTION_QUICK_PRESETS = [
  { id: 'calm', label: '平静', mode: 'text', text: '平静、自然、舒缓' },
  { id: 'happy', label: '开心', mode: 'text', text: '开心、愉悦、轻快' },
  { id: 'sad', label: '悲伤', mode: 'text', text: '悲伤、低沉、压抑' },
  { id: 'angry', label: '愤怒', mode: 'text', text: '愤怒、激烈、强硬' },
  { id: 'suspense', label: '悬疑', mode: 'text', text: '悬疑、紧张、压迫感' },
]
