/**
 * Provider Adapter 注册表
 * 根据 provider 名称返回对应的 Adapter 实例
 */
import { MiniMaxImageAdapter } from './minimax-image'
import { MiniMaxVideoAdapter } from './minimax-video'
import { MiniMaxTTSAdapter } from './minimax-tts'
import { IndexTTS2Adapter } from './indextts2'
import { OpenAIImageAdapter } from './openai-image'
import { ApimartImageAdapter } from './apimart-image'
import { GeminiImageAdapter } from './gemini-image'
import { VolcEngineImageAdapter } from './volcengine-image'
import { VolcEngineVideoAdapter } from './volcengine-video'
import { ViduVideoAdapter } from './vidu-video'
import { AliImageAdapter } from './ali-image'
import { AliVideoAdapter } from './ali-video'
import { ChengmengVideoAdapter } from './chengmeng-video'
import { GeeknowGrokVideoAdapter } from './geeknow-grok-video'
import { JimengWebVideoAdapter } from './jimeng-web-video'
import { XyqWebVideoAdapter } from './xyq-web-video'
import { CozeWebVideoAdapter } from './coze-web-video'
import { FunshionWebVideoAdapter } from './funshion-web-video'
import { XingyuemengWebVideoAdapter } from './xingyuemeng-web-video'
import { AistarslabVideoAdapter } from './aistarslab-video'
import { AigcccVideoAdapter } from './aigccc-video'
import type { ImageProviderAdapter, VideoProviderAdapter, TTSProviderAdapter } from './types'

// 图片 Adapter 注册表
export const imageAdapters: Record<string, ImageProviderAdapter> = {
  minimax: new MiniMaxImageAdapter(),
  openai: new OpenAIImageAdapter(),
  gemini: new GeminiImageAdapter(),
  volcengine: new VolcEngineImageAdapter(),
  ali: new AliImageAdapter(),
  // Chatfire / GeekNow / 启灵泽(NewAPI) — OpenAI 兼容 /v1/images/generations
  chatfire: new OpenAIImageAdapter(),
  geeknow: new OpenAIImageAdapter(),
  qilingze: new OpenAIImageAdapter(),
  apimart: new ApimartImageAdapter(),
}

// 视频 Adapter 注册表
export const videoAdapters: Record<string, VideoProviderAdapter> = {
  minimax: new MiniMaxVideoAdapter(),
  volcengine: new VolcEngineVideoAdapter(),
  vidu: new ViduVideoAdapter(),
  ali: new AliVideoAdapter(),
  chengmeng: new ChengmengVideoAdapter(),
  geeknow: new GeeknowGrokVideoAdapter(),
  // 花镜 / 启灵泽：NewAPI 兼容 Grok 视频（与 GeekNow 同适配器）
  chatfire: new GeeknowGrokVideoAdapter(),
  qilingze: new GeeknowGrokVideoAdapter(),
  jimeng_web: new JimengWebVideoAdapter(),
  xyq_web: new XyqWebVideoAdapter(),
  coze_web: new CozeWebVideoAdapter(),
  funshion_web: new FunshionWebVideoAdapter(),
  xingyuemeng_web: new XingyuemengWebVideoAdapter(),
  aistarslab: new AistarslabVideoAdapter(),
  aigccc: new AigcccVideoAdapter(),
}

// TTS Adapter 注册表
export const ttsAdapters: Record<string, TTSProviderAdapter> = {
  minimax: new MiniMaxTTSAdapter(),
  indextts2: new IndexTTS2Adapter(),
  tts2: new IndexTTS2Adapter(),
}

export function getTTSAdapter(provider: string): TTSProviderAdapter {
  return ttsAdapters[provider.toLowerCase()] || ttsAdapters['minimax']
}

/**
 * 获取图片 Adapter
 * @param provider 厂商名称
 * @returns 对应的 Adapter，未知厂商返回 MiniMax 默认
 */
export function getImageAdapter(provider: string): ImageProviderAdapter {
  return imageAdapters[provider.toLowerCase()] || imageAdapters['minimax']
}

/**
 * 获取视频 Adapter
 * @param provider 厂商名称
 * @returns 对应的 Adapter，未知厂商返回 MiniMax 默认
 */
export function getVideoAdapter(provider: string): VideoProviderAdapter {
  const key = provider.toLowerCase()
  if (key === 'volcengine_proxy') return videoAdapters['volcengine']
  return videoAdapters[key] || videoAdapters['minimax']
}
