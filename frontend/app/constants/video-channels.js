/** 各通道参考素材上限（与后端 / Composer 一致） */
export const VIDEO_CHANNEL_REF_LIMITS = {
  '/videos': { images: 9, audios: 3, videos: 3 },
  '/videos/official': { images: 9, audios: 3, videos: 0 },
  '/videos/aistarslab': { images: 9, audios: 3, videos: 3 },
  '/videos/jimeng': { images: 9, audios: 3, videos: 3 },
  '/videos/training': { images: 1, audios: 0, videos: 0 },
  '/videos/grok': { images: 6, audios: 0, videos: 0 },
}

export const JIMENG_REF_LIMITS = VIDEO_CHANNEL_REF_LIMITS['/videos/jimeng']
export const TRAINING_REF_LIMITS = VIDEO_CHANNEL_REF_LIMITS['/videos/training']
export const CHENGMENT_REF_LIMITS = VIDEO_CHANNEL_REF_LIMITS['/videos']

/** 支持过人脸的通道标注（通道1 已改为 9 图全能参考，导航不再单独标注） */
export const VIDEO_CHANNEL_FACE_PASS = {
  '/videos/aistarslab': '过人脸(95%)',
  '/videos/grok': '过人脸(95%)',
}

export function formatRefLimitsHint(limits) {
  if (!limits) return ''
  return `${limits.images}图 ${limits.audios}音频 ${limits.videos}视频`
}

export function formatChannelRefHint(path) {
  const limits = VIDEO_CHANNEL_REF_LIMITS[path]
  if (!limits) return ''
  const base = formatRefLimitsHint(limits)
  const facePass = VIDEO_CHANNEL_FACE_PASS[path]
  return facePass ? `${base} ${facePass}` : base
}

/** 顶部导航对外展示的通道名（不含上游品牌） */
export function buildVideoNavItems(includeJimeng = false) {
  const items = [
    { to: '/videos', label: 'seedance通道1' },
    { to: '/videos/aistarslab', label: 'seedance通道3' },
  ]
  if (includeJimeng) {
    items.push({ to: '/videos/jimeng', label: 'seedance通道4' })
  }
  items.push({ to: '/videos/training', label: '视频通道5(培训)' })
  items.push({ to: '/videos/grok', label: 'grok视频' })
  return items.map(item => ({
    ...item,
    refHint: formatChannelRefHint(item.to),
  }))
}
/** 管理员积分页：导航名与实际通道对照 */
export const VIDEO_CHANNEL_ADMIN_GUIDE = [
  {
    navLabel: 'seedance通道1',
    path: '/videos',
    internalName: '视频生成（原 · 橙盟 Seedance）',
    upstream: 'api.chengmeng.site',
    features: '9图 3音频 3视频参考、多模型',
    pricingLabels: '「橙盟 Seedance 2.0 Fast」「橙盟 Seedance 2.0」及 API 同步的其他模型定价项',
    billing: '积分/条',
  },
  {
    navLabel: 'seedance通道2',
    path: '/videos/official',
    internalName: '官方 Seedance（火山方舟）',
    upstream: 'ark.cn-beijing.volces.com',
    features: 'doubao-seedance-2.0 / 2.0 Fast，时长 4–15 秒',
    pricingLabels: '「官方 Seedance 2.0」「官方 Seedance 2.0 Fast」',
    billing: '积分/秒',
  },
  {
    navLabel: 'seedance通道3',
    path: '/videos/aistarslab',
    internalName: 'Seedance VIP',
    upstream: 'Seedance VIP OpenAPI',
    features: '图/音/视频参考，按线路动态计价',
    pricingLabels: '「Seedance 2.0 VIP」',
    billing: '积分/条（积分页设置）',
  },
  {
    navLabel: 'seedance通道4',
    path: '/videos/jimeng',
    internalName: '即梦（jimeng.jianying.com）',
    upstream: 'Cookie 鉴权 · Session 由管理员配置',
    features: '全能参考 9图 3音 3视频（@图片N @视频N @音频N）',
    pricingLabels: '「Seedance 2.0 Fast VIP（通道4）」「Seedance 2.0 VIP（通道4）」',
    billing: '积分/条',
  },
  {
    navLabel: '视频通道5(培训)',
    path: '/videos/training',
    internalName: '豆包培训（内部练手）',
    upstream: 'doubao.com · Cookie 鉴权',
    features: 'Seedance 2.0 Fast 练手，可选 1 张参考图，生成后叠加「内部培训专用」标识',
    pricingLabels: '「豆包培训视频（通道5）」',
    billing: '不扣积分（每日账号额度限制）',
  },
  {
    navLabel: 'grok视频',
    path: '/videos/grok',
    internalName: 'Grok 视频（GeekNow）',
    upstream: 'geek.closeai.icu',
    features: 'Grok 1.5 / 3.0 Pro·Max，固定时长按次',
    pricingLabels: '「Grok 1.5 Pro 视频」等 4 项 Grok 模型定价',
    billing: '积分/条',
  },
]
