/** 各通道参考素材上限（与后端 / Composer 一致） */
export const VIDEO_CHANNEL_REF_LIMITS = {
  '/videos': { images: 9, audios: 3, videos: 3 },
  /** S通道2 默认按 2.0：9/3/3；Seedance 2.5 由页面按模型覆盖为 30/10/10（合计≤50） */
  '/videos/official': { images: 9, audios: 3, videos: 3 },
  '/videos/aistarslab': { images: 9, audios: 3, videos: 3 },
  '/videos/aigccc': { images: 9, audios: 3, videos: 3 },
  /** S通道4 默认按 Seedance 2.5：30 图 / 10 音 / 10 视频（合计 ≤50）；2.0 档由页面按模型覆盖为 9/3/3 */
  '/videos/jimeng': { images: 30, audios: 10, videos: 10, max_total: 50 },
  '/videos/xyq': { images: 9, audios: 3, videos: 3 },
  '/videos/coze': { images: 9, audios: 3, videos: 3 },
  '/videos/funshion': { images: 9, audios: 3, videos: 3 },
  '/videos/xingyuemeng': { images: 9, audios: 3, videos: 3 },
  '/videos/training': { images: 1, audios: 0, videos: 0 },
  '/videos/grok': { images: 6, audios: 0, videos: 0 },
}

/** S通道2 · Seedance 2.5 参考上限（与 backend OFFICIAL_SEEDANCE_2_5_REF_LIMITS 一致） */
export const OFFICIAL_SEEDANCE_25_REF_LIMITS = {
  images: 30,
  audios: 10,
  videos: 10,
  max_total: 50,
}

export function isSeedance25ModelId(modelId) {
  const id = String(modelId || '')
  return id.includes('2-5') || id.includes('2.5')
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
  const base = `${limits.images}图 ${limits.audios}音频 ${limits.videos}视频`
  const maxTotal = limits.max_total ?? limits.maxTotal
  if (maxTotal != null && Number.isFinite(Number(maxTotal))) {
    return `${base}（合计≤${maxTotal}）`
  }
  return base
}

export function formatChannelRefHint(path) {
  const limits = VIDEO_CHANNEL_REF_LIMITS[path]
  if (!limits) return ''
  const base = formatRefLimitsHint(limits)
  const facePass = VIDEO_CHANNEL_FACE_PASS[path]
  return facePass ? `${base} ${facePass}` : base
}

/** 顶部导航对外展示的通道名（不含上游品牌） */
export function buildVideoNavItems(opts = {}) {
  const includeJimeng = opts.includeJimeng !== false
  const includeXyq = opts.includeXyq !== false
  const includeCoze = opts.includeCoze !== false
  const isAdmin = !!opts.isAdmin

  const items = [
    { to: '/videos', label: 'S通道1' },
    { to: '/videos/official', label: 'S通道2' },
    { to: '/videos/aistarslab', label: 'S通道3' },
  ]
  if (includeJimeng) {
    items.push({ to: '/videos/jimeng', label: 'S通道4' })
  }
  if (includeXyq) {
    items.push({ to: '/videos/xyq', label: 'S通道5' })
  }
  items.push({ to: '/videos/aigccc', label: 'S通道6' })
  if (includeCoze) {
    items.push({ to: '/videos/coze', label: 'S通道7' })
  }
  // 通道8：全员可见（不再按 canUseFunshion 隐藏）
  items.push({ to: '/videos/funshion', label: '通道8(梦工厂专用)' })
  items.push({ to: '/videos/xingyuemeng', label: 'S通道9' })
  if (isAdmin) {
    items.push({ to: '/videos/training', label: '培训通道(管理员)', adminOnly: true })
  }
  items.push({ to: '/videos/grok', label: 'grok视频' })
  return items
}
/** 管理员积分页：导航名与实际通道对照 */
export const VIDEO_CHANNEL_ADMIN_GUIDE = [
  {
    navLabel: 'S通道1',
    path: '/videos',
    internalName: '视频生成（原 · 橙盟 S）',
    upstream: 'api.chengmeng.site',
    features: '9图全能参考 · 满血线路',
    pricingLabels: '「橙盟 9图-满血」（model_id=70）',
    billing: '积分/条（按 15 秒）',
  },
  {
    navLabel: 'S通道2',
    path: '/videos/official',
    internalName: '官方 S（火山方舟）',
    upstream: 'ark.cn-beijing.volces.com',
    features: 'Seedance 2.5（4–30s，图≤30/合计≤50）/ 2.0 Fast / 2.0，图/音/视频参考',
    pricingLabels: '「官方 Seedance 2.5」「官方 S 2.0」「官方 S 2.0 Fast」',
    billing: '与通道9 同价：Mini/Fast/Pro/2.5 · 时长×分辨率',
  },
  {
    navLabel: 'S通道3',
    path: '/videos/aistarslab',
    internalName: 'S VIP',
    upstream: 'S VIP OpenAPI',
    features: '图/音/视频参考，按线路动态计价',
    pricingLabels: '「S 2.0 VIP」',
    billing: '积分/条（积分页设置）',
  },
  {
    navLabel: 'S通道4',
    path: '/videos/jimeng',
    internalName: '即梦（jimeng.jianying.com）',
    upstream: 'Cookie 鉴权 · Session 由管理员配置',
    features: 'S 2.5（最长 30s，图≤30/合计≤50）/ S 2.0 Fast VIP / VIP（9图3音3视频）',
    pricingLabels: '「S 2.5（通道4）」「S 2.0 Fast VIP（通道4）」「S 2.0 VIP（通道4）」',
    billing: 'S 2.5 130 积分/秒（自带参考视频 7 折）· Fast VIP 标价 60·实收 48（8折）· VIP 80（有参考视频 130）',
  },
  {
    navLabel: 'S通道5',
    path: '/videos/xyq',
    internalName: '小云雀（xyq.jianying.com）',
    upstream: 'Access Key 鉴权 · 扣小云雀账号积分',
    features: 'S 2.5（最长 30s，最多 50 图/合计 ≤50）/ S2.0A / S2.0B / Fast VIP / VIP（9图3音3视频）',
    pricingLabels: '「S 2.5（S通道5）」等 5 项',
    billing: 'S 2.5 按秒 130 积分（自带参考视频 7 折）· 其余按条 300/500/750/900',
  },
  {
    navLabel: 'S通道6',
    path: '/videos/aigccc',
    internalName: 'AIGC Seedance 2.0（aigccc666）',
    upstream: 'www.aigccc666.com · ApiKey 鉴权',
    features: 'S2.0 fast / S2.0满血，9图 3音 3视频，异步轮询',
    pricingLabels: '「S2.0 fast」「S2.0满血」',
    billing: 'Fast 480 / 满血 620 积分/条',
  },
  {
    navLabel: 'S通道7',
    path: '/videos/coze',
    internalName: '扣子网页（www.coze.cn）',
    upstream: 'Cookie / PAT 鉴权 · Coze Ark 兼容 API',
    features: 'Seedance 2.0 Fast / 2.0，全能参考 9图 3音 3视频，时长 4–15 秒',
    pricingLabels: '「S 2.0 Fast（S通道7）」「S 2.0（S通道7）」',
    billing: 'Fast 50 积分/秒 · 满血 65 积分/秒',
  },
  {
    navLabel: '通道8(梦工厂专用)',
    path: '/videos/funshion',
    internalName: '橙星梦工厂（mgc.funshion.com）',
    upstream: 'Bearer Token（视频页 Network / localStorage.token）',
    features: 'Seedance 2.0 Fast / 2.0，全能参考 9图 3音 3视频，时长 4–15 秒',
    pricingLabels: '「S 2.0 Fast（通道8）」「S 2.0（通道8）」',
    billing: 'Fast 60 积分/秒 · 满血 80 积分/秒',
    adminOnly: false,
  },
  {
    navLabel: 'S通道9',
    path: '/videos/xingyuemeng',
    internalName: '星月梦（xingyuemeng.com）',
    upstream: 'Bearer Token（Application → Local Storage → xymai_token）',
    features: 'Seedance 2.0 Mini / Fast / Pro，全能参考 9图 3音 3视频，时长 4–15 秒',
    pricingLabels: '「S 2.0 Mini（S通道9）」「S 2.0 Fast（S通道9）」「S 2.0 Pro（S通道9）」',
    billing: 'Mini 40 积分/秒 · Fast 60 积分/秒 · Pro 80 积分/秒',
    adminOnly: false,
  },
  {
    navLabel: '培训通道(管理员)',
    path: '/videos/training',
    internalName: '豆包培训（内部练手）',
    upstream: 'doubao.com · Cookie 鉴权',
    features: 'Seedance 2.0 Fast / Mini 练手，可选 1 张参考图，生成后叠加「内部培训专用」标识',
    pricingLabels: '「豆包培训视频（通道5）」',
    billing: '不扣积分（每日账号额度限制）',
    adminOnly: true,
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
