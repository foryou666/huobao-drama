const NODE_W = 268
const COL_GAP = 160
const PAD_X = 80
const PAD_Y = 72

const NODE_HEIGHT = {
  segment: 200,
  extract: 160,
  /** 角色/场景/道具缩略图集中在一个区域，避免竖向铺开 */
  'asset-group': 300,
  tts: 140,
  'grok-group': 180,
  grok: 300,
  export: 140,
}

function nodeHeight(type) {
  return NODE_HEIGHT[type] || 160
}

/**
 * 画布列顺序：提取 → 资产定稿(集中) → 旁白分段 → TTS → 画面 → 导出
 * 资产不再各占一卡，避免缩放才能看全貌。
 */
export function buildNarrationCanvasGraph({
  segments = [],
  analysis = {},
  assetReadiness = {},
  job = null,
}) {
  const edges = []
  const items = assetReadiness?.items || []
  const readyCount = Number(assetReadiness?.ready_count || items.filter(i => i.has_image).length)
  const totalCount = Number(assetReadiness?.total || items.length)
  const generating = items.some(i => i.image_status === 'generating')

  const extractNode = {
    id: 'extract',
    type: 'extract',
    title: '角色 / 场景 / 道具',
    subtitle: [
      analysis.characters?.length ? `${analysis.characters.length} 角色` : '',
      analysis.scenes?.length ? `${analysis.scenes.length} 场景` : '',
      analysis.props?.length ? `${analysis.props.length} 道具` : '',
    ].filter(Boolean).join(' · ') || '点击此节点 → 从剧本提取',
    stageDone: (analysis.characters?.length || 0) + (analysis.scenes?.length || 0) > 0,
    data: { analysis },
  }

  const assetGroup = items.length
    ? {
        id: 'asset-group',
        type: 'asset-group',
        title: '资产定稿',
        subtitle: totalCount
          ? `${readyCount}/${totalCount} 已定稿 · 点击管理`
          : '抽取后在此集中生图',
        stageDone: totalCount > 0 && readyCount === totalCount,
        status: generating ? 'generating' : (readyCount ? 'completed' : 'draft'),
        data: {
          items,
          ready: readyCount,
          total: totalCount,
          thumbs: items.slice(0, 12).map(item => ({
            id: `${item.type}-${item.id}`,
            name: item.name,
            type: item.type,
            imageUrl: item.image_url || null,
            ready: !!item.has_image,
            status: item.image_status,
          })),
        },
      }
    : null

  const segmentNode = {
    id: 'segment',
    type: 'segment',
    title: '旁白分段',
    subtitle: segments.length ? `${segments.length} 段原文` : '提取资产后再分段',
    stageDone: segments.length > 0,
    data: { segments },
  }

  const ttsDone = segments.some(s => s.tts_audio_url || s.status === 'tts_done')
  const ttsNode = {
    id: 'tts',
    type: 'tts',
    title: 'TTS 朗读',
    subtitle: ttsDone ? '旁白音频已合成' : 'RunningHub IndexTTS2',
    stageDone: ttsDone,
    data: {},
  }

  const grokDone = segments.filter(s => s.status === 'completed' || !!(s.video_url || s.videoUrl || s.video_path || s.videoPath)).length
  const grokBusy = segments.some(s => s.status === 'generating')
  const mismatch = segments.filter(s => s.duration_mismatch).length
  const grokGroup = {
    id: 'grok-group',
    type: 'grok-group',
    title: '画面镜头',
    subtitle: segments.length
      ? `${grokDone}/${segments.length} 已生成${mismatch ? ` · ${mismatch} 段偏长` : ''}`
      : '待分段',
    stageDone: segments.length > 0 && grokDone === segments.length,
    status: grokBusy ? 'generating' : (grokDone ? 'completed' : 'draft'),
    data: { segments, done: grokDone, total: segments.length },
  }

  const exportNode = {
    id: 'export',
    type: 'export',
    title: '剪映导出',
    subtitle: job?.jianying_draft_url ? '草稿已生成' : '拼接音频与视频',
    stageDone: !!job?.jianying_draft_url,
    data: {},
  }

  const pipeline = [extractNode]
  if (assetGroup) pipeline.push(assetGroup)
  pipeline.push(segmentNode, ttsNode, grokGroup, exportNode)

  const maxH = Math.max(...pipeline.map(n => nodeHeight(n.type)))
  const centerY = PAD_Y + maxH / 2

  let colX = PAD_X
  const placed = []
  for (const node of pipeline) {
    const h = nodeHeight(node.type)
    placed.push({
      ...node,
      x: colX,
      y: centerY - h / 2,
      w: NODE_W,
      h,
    })
    colX += NODE_W + COL_GAP
  }

  for (let i = 0; i < placed.length - 1; i++) {
    edges.push({ from: placed[i].id, to: placed[i + 1].id })
  }

  const minY = Math.min(...placed.map(n => n.y)) - PAD_Y / 2
  const normalizedNodes = placed.map(n => ({ ...n, y: n.y - minY }))
  const maxX = Math.max(...normalizedNodes.map(n => n.x + n.w)) + PAD_X
  const maxY = Math.max(...normalizedNodes.map(n => n.y + n.h)) + PAD_Y

  return {
    nodes: normalizedNodes,
    edges,
    bounds: { width: maxX, height: maxY, minY: 0 },
  }
}

export function nodeAnchor(node, side, measuredHeight) {
  const h = measuredHeight || node.h
  const cx = node.x + node.w / 2
  const cy = node.y + h / 2
  if (side === 'right') return { x: node.x + node.w, y: cy }
  if (side === 'left') return { x: node.x, y: cy }
  if (side === 'top') return { x: cx, y: node.y }
  return { x: cx, y: node.y + h }
}

export function bezierEdgePath(from, to) {
  const dx = Math.max(60, Math.abs(to.x - from.x) * 0.45)
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
}
