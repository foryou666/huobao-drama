/** 解说漫 Grok 视频三通道（GeekNow / 花镜 / 启灵泽） */

export type NarrationGrokChannelId = 'geeknow' | 'huajing' | 'qilingze'

export interface NarrationGrokModelOption {
  id: string
  label: string
}

export interface NarrationGrokChannelDef {
  id: NarrationGrokChannelId
  label: string
  /** DB provider 字段 */
  provider: string
  /** 额外用 base_url 匹配（花镜存为 chatfire） */
  baseUrlIncludes?: string
  nameIncludes?: string
  defaultModel: string
  models: NarrationGrokModelOption[]
  /** 请求体：multipart（grok-video-*）或 json（grok-imagine-*） */
  requestStyle: 'multipart' | 'json'
}

export const NARRATION_GROK_CHANNELS: NarrationGrokChannelDef[] = [
  {
    id: 'geeknow',
    label: 'GeekNow',
    provider: 'geeknow',
    defaultModel: 'grok-video-3-pro',
    requestStyle: 'multipart',
    models: [
      { id: 'grok-video-3-pro', label: 'Grok 3 Pro（10s）' },
      { id: 'grok-video-3-max', label: 'Grok 3 Max（15s）' },
      { id: 'grok-video-1.5-pro', label: 'Grok 1.5 Pro（10s）' },
      { id: 'grok-video-1.5-max', label: 'Grok 1.5 Max（15s）' },
    ],
  },
  {
    id: 'huajing',
    label: '花镜',
    provider: 'chatfire',
    baseUrlIncludes: 'huajingapi.top',
    nameIncludes: '花镜',
    defaultModel: 'grok-imagine-video-1.5',
    requestStyle: 'json',
    models: [
      { id: 'grok-imagine-video-1.5', label: 'Grok Imagine 1.5' },
      { id: 'grok-imagine-video-1.5-fast', label: 'Grok Imagine 1.5 Fast' },
      { id: 'grok-imagine-video-1.5-1080p', label: 'Grok Imagine 1.5 1080p' },
      { id: 'grok-imagine-video', label: 'Grok Imagine Video' },
    ],
  },
  {
    id: 'qilingze',
    label: '启灵泽',
    provider: 'qilingze',
    defaultModel: 'grok-video-1.5',
    requestStyle: 'multipart',
    models: [
      { id: 'grok-video-1.5', label: 'Grok Video 1.5' },
      { id: 'grok-video-1.0', label: 'Grok Video 1.0' },
    ],
  },
]

export function getNarrationGrokChannelDef(channelId?: string | null): NarrationGrokChannelDef {
  const id = String(channelId || '').trim().toLowerCase()
  return NARRATION_GROK_CHANNELS.find(c => c.id === id) || NARRATION_GROK_CHANNELS[0]!
}

export function isGrokImagineModel(model?: string | null): boolean {
  return /^grok-imagine-video/i.test(String(model || '').trim())
}
