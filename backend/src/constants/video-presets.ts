import { SEEDANCE_CHATFIRE_BASE_URL, SEEDANCE_MODELS } from './seedance.js'

export interface VideoServicePreset {
  serviceType: 'video'
  name: string
  label: string
  provider: string
  baseUrl: string
  model: string
  priority: number
}

/** 红果推荐一键写入的视频服务（统一 ChatFire 网关，含 Seedance 1.5 / 2.0 / 2.0 Fast） */
export const SEEDANCE_VIDEO_PRESETS: VideoServicePreset[] = [
  {
    serviceType: 'video',
    name: '红果视频 Seedance 2.0',
    label: '视频',
    provider: 'volcengine',
    baseUrl: SEEDANCE_CHATFIRE_BASE_URL,
    model: SEEDANCE_MODELS.V2_0,
    priority: 100,
  },
  {
    serviceType: 'video',
    name: '红果视频 Seedance 2.0 Fast',
    label: '视频',
    provider: 'volcengine',
    baseUrl: SEEDANCE_CHATFIRE_BASE_URL,
    model: SEEDANCE_MODELS.V2_0_FAST,
    priority: 99,
  },
  {
    serviceType: 'video',
    name: '红果视频 Seedance 1.5 Pro',
    label: '视频',
    provider: 'volcengine',
    baseUrl: SEEDANCE_CHATFIRE_BASE_URL,
    model: SEEDANCE_MODELS.V1_5_PRO,
    priority: 98,
  },
]
