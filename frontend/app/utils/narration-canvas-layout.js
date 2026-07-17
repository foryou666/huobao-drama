const NODE_W = 268
const COL_GAP = 200
const ROW_GAP = 18
const PAD_X = 100
const PAD_Y = 80

const NODE_HEIGHT = {
  segment: 280,
  extract: 180,
  asset: 290,
  tts: 150,
  grok: 300,
  export: 140,
}

function nodeHeight(type) {
  if (type.startsWith('asset-')) return NODE_HEIGHT.asset
  return NODE_HEIGHT[type] || 160
}

function stackColumn(items, x, startY) {
  let y = startY
  return items.map(item => {
    const h = nodeHeight(item.type)
    const placed = { ...item, x, y, w: NODE_W, h }
    y += h + ROW_GAP
    return placed
  })
}

function columnHeight(nodes) {
  if (!nodes.length) return nodeHeight('asset')
  const last = nodes[nodes.length - 1]
  return last.y + last.h - nodes[0].y
}

function centerColumn(nodes, targetCenterY) {
  if (!nodes.length) return nodes
  const h = columnHeight(nodes)
  const top = targetCenterY - h / 2
  const offset = top - nodes[0].y
  return nodes.map(n => ({ ...n, y: n.y + offset }))
}

export function buildNarrationCanvasGraph({
  segments = [],
  analysis = {},
  assetReadiness = {},
  job = null,
}) {
  const edges = []
  const items = assetReadiness?.items || []

  const segmentNode = {
    id: 'segment',
    type: 'segment',
    title: '旁白分段',
    subtitle: `${segments.length} 段原文`,
    stageDone: segments.length > 0,
    data: { segments },
  }

  const extractNode = {
    id: 'extract',
    type: 'extract',
    title: '实体抽取',
    subtitle: [
      analysis.characters?.length ? `${analysis.characters.length} 角色` : '',
      analysis.scenes?.length ? `${analysis.scenes.length} 场景` : '',
      analysis.props?.length ? `${analysis.props.length} 道具` : '',
    ].filter(Boolean).join(' · ') || '待抽取',
    stageDone: (analysis.characters?.length || 0) + (analysis.scenes?.length || 0) > 0,
    data: { analysis },
  }

  const assetNodes = items.map(item => ({
    id: `asset-${item.type}-${item.id}`,
    type: `asset-${item.type}`,
    title: item.name,
    subtitle: item.type === 'character' ? '角色三视图' : item.type === 'scene' ? '场景定稿' : '道具定稿',
    stageDone: item.has_image,
    status: item.image_status,
    imageUrl: item.image_url,
    data: { item },
  }))

  const ttsDone = segments.some(s => s.tts_audio_url || s.status === 'tts_done')
  const ttsNode = {
    id: 'tts',
    type: 'tts',
    title: 'TTS 朗读',
    subtitle: ttsDone ? '旁白音频已合成' : 'IndexTTS2',
    stageDone: ttsDone,
    data: {},
  }

  const grokNodes = segments.map(seg => {
    const refs = seg.content_refs || []
    const ttsSec = Number(seg.tts_duration_sec) || 0
    const durHint = ttsSec > 0
      ? (seg.duration_mismatch ? `旁白 ${ttsSec.toFixed(0)}s · 需 ${seg.shots_needed || '?'} 镜` : `旁白 ${ttsSec.toFixed(0)}s`)
      : (seg.video_prompt?.slice(0, 48) || '待生成画面')
    return {
      id: `grok-${seg.id}`,
      type: 'grok',
      title: `镜头 ${seg.segment_index + 1}`,
      subtitle: durHint,
      stageDone: seg.status === 'completed',
      status: seg.status,
      imageUrl: seg.video_url && seg.status === 'completed' ? seg.video_url : null,
      videoUrl: seg.video_url && seg.status === 'completed' ? seg.video_url : null,
      data: { seg, refCount: refs.length },
    }
  })

  const exportNode = {
    id: 'export',
    type: 'export',
    title: '剪映导出',
    subtitle: job?.jianying_draft_url ? '草稿已生成' : '拼接音频与视频',
    stageDone: !!job?.jianying_draft_url,
    data: {},
  }

  const assetH = columnHeight(assetNodes.map(n => ({ y: 0, h: nodeHeight(n.type) })))
  const grokH = columnHeight(grokNodes.map(n => ({ y: 0, h: nodeHeight(n.type) })))
  const canvasCenterY = PAD_Y + Math.max(assetH, grokH, nodeHeight('segment')) / 2

  let colX = PAD_X

  const segmentP = {
    ...segmentNode,
    x: colX,
    y: canvasCenterY - nodeHeight('segment') / 2,
    w: NODE_W,
    h: nodeHeight('segment'),
  }
  colX += NODE_W + COL_GAP

  const extractP = {
    ...extractNode,
    x: colX,
    y: canvasCenterY - nodeHeight('extract') / 2,
    w: NODE_W,
    h: nodeHeight('extract'),
  }
  colX += NODE_W + COL_GAP
  edges.push({ from: 'segment', to: 'extract' })

  let stackedAssets = stackColumn(assetNodes, colX, PAD_Y)
  stackedAssets = centerColumn(stackedAssets, canvasCenterY)
  colX += NODE_W + COL_GAP

  for (const asset of stackedAssets) {
    edges.push({ from: 'extract', to: asset.id })
  }

  const ttsP = {
    ...ttsNode,
    x: colX,
    y: canvasCenterY - nodeHeight('tts') / 2,
    w: NODE_W,
    h: nodeHeight('tts'),
  }
  colX += NODE_W + COL_GAP

  let stackedGrok = stackColumn(grokNodes, colX, PAD_Y)
  stackedGrok = centerColumn(stackedGrok, canvasCenterY)
  colX += NODE_W + COL_GAP

  const exportP = {
    ...exportNode,
    x: colX,
    y: canvasCenterY - nodeHeight('export') / 2,
    w: NODE_W,
    h: nodeHeight('export'),
  }

  for (const grok of stackedGrok) {
    const seg = grok.data.seg
    const meta = (analysis.segment_meta || []).find(m => m.segment_index === seg.segment_index)
    edges.push({ from: 'segment', to: grok.id })
    edges.push({ from: 'tts', to: grok.id })

    for (const cid of meta?.character_ids || []) {
      const aid = `asset-character-${cid}`
      if (stackedAssets.some(a => a.id === aid)) edges.push({ from: aid, to: grok.id })
    }
    if (meta?.scene_id) {
      const sid = `asset-scene-${meta.scene_id}`
      if (stackedAssets.some(a => a.id === sid)) edges.push({ from: sid, to: grok.id })
    }
    for (const pid of meta?.prop_ids || []) {
      const pidn = `asset-prop-${pid}`
      if (stackedAssets.some(a => a.id === pidn)) edges.push({ from: pidn, to: grok.id })
    }
    edges.push({ from: grok.id, to: 'export' })
  }

  const allNodes = [segmentP, extractP, ...stackedAssets, ttsP, ...stackedGrok, exportP]
  const minY = Math.min(...allNodes.map(n => n.y)) - PAD_Y / 2
  const normalizedNodes = allNodes.map(n => ({ ...n, y: n.y - minY }))
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
