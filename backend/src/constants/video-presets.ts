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

/** 影光工场推荐一键写入的视频服务 */
export const SEEDANCE_VIDEO_PRESETS: VideoServicePreset[] = [
  {
    serviceType: 'video',
    name: '火山官方 Seedance 2.0',
    label: '视频',
    provider: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    model: SEEDANCE_MODELS.V2_0,
    priority: 101,
  },
  {
    serviceType: 'video',
    name: '影光工场视频 Seedance 2.0',
    label: '视频',
    provider: 'volcengine',
    baseUrl: SEEDANCE_CHATFIRE_BASE_URL,
    model: SEEDANCE_MODELS.V2_0,
    priority: 100,
  },
  {
    serviceType: 'video',
    name: '影光工场视频 Seedance 2.0 Fast',
    label: '视频',
    provider: 'volcengine',
    baseUrl: SEEDANCE_CHATFIRE_BASE_URL,
    model: SEEDANCE_MODELS.V2_0_FAST,
    priority: 99,
  },
  {
    serviceType: 'video',
    name: '影光工场视频 Seedance 1.5 Pro',
    label: '视频',
    provider: 'volcengine',
    baseUrl: SEEDANCE_CHATFIRE_BASE_URL,
    model: SEEDANCE_MODELS.V1_5_PRO,
    priority: 98,
  },
]
