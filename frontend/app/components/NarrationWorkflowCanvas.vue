<template>
  <div class="nw-canvas-wrap" ref="wrapRef">
    <div class="nw-canvas-toolbar">
      <button type="button" class="btn btn-sm" title="缩小" @click="zoomBy(-0.1)">−</button>
      <span class="nw-zoom-label">{{ Math.round(view.zoom * 100) }}%</span>
      <button type="button" class="btn btn-sm" title="放大" @click="zoomBy(0.1)">+</button>
      <button type="button" class="btn btn-sm" @click="fitView">适应画布</button>
      <span class="dim nw-toolbar-hint">拖拽空白平移 · 滚轮缩放 · 点击节点查看详情</span>
    </div>

    <div
      class="nw-canvas-viewport"
      :class="{ 'is-panning': panning }"
      @wheel.prevent="onWheel"
      @mousedown="onPointerDown"
      @mousemove="onPointerMove"
      @mouseup="onPointerUp"
      @mouseleave="onPointerUp"
    >
      <div
        ref="stageRef"
        class="nw-canvas-stage"
        :style="stageStyle"
      >
        <svg class="nw-edges" :width="graph.bounds.width" :height="graph.bounds.height">
          <path
            v-for="(edge, idx) in edgePaths"
            :key="idx"
            :d="edge.d"
            class="nw-edge"
            :class="{ active: edge.active }"
          />
        </svg>

        <button
          v-for="node in graph.nodes"
          :key="node.id"
          type="button"
          class="nw-node"
          :class="[
            `nw-node--${node.type.split('-')[0]}`,
            {
              done: node.stageDone,
              selected: selectedId === node.id,
              generating: node.status === 'generating' || node.status === 'tts_generating',
            },
          ]"
          :style="nodeStyle(node)"
          :ref="el => setNodeRef(node.id, el)"
          @mousedown.stop
          @click.stop="$emit('select', node)"
        >
          <div class="nw-node-head">
            <span class="nw-node-type">{{ nodeTypeLabel(node) }}</span>
            <span v-if="node.stageDone" class="nw-node-badge">✓</span>
            <span v-else-if="node.status === 'generating'" class="nw-node-badge pulse">…</span>
          </div>
          <strong class="nw-node-title">{{ node.title }}</strong>
          <p class="nw-node-sub">{{ node.subtitle }}</p>

          <div v-if="node.type === 'grok' && node.videoUrl" class="nw-node-media nw-node-media--video">
            <img
              v-if="grokPosterUrl(node)"
              :src="grokPosterUrl(node)"
              alt=""
              class="nw-node-thumb"
              @load="measureNodes"
            />
            <div v-else class="nw-node-video-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span class="nw-node-play-badge" aria-hidden="true">▶</span>
          </div>

          <div v-else-if="node.imageUrl" class="nw-node-media">
            <img
              :src="mediaDisplayUrl(node.imageUrl)"
              alt=""
              class="nw-node-thumb"
              @load="measureNodes"
            />
          </div>

          <div v-else-if="node.type === 'segment' && node.data.segments?.length" class="nw-node-text">
            {{ node.data.segments[0].text?.slice(0, 120) }}{{ node.data.segments[0].text?.length > 120 ? '…' : '' }}
          </div>

          <div v-else-if="node.type === 'extract' && node.stageDone" class="nw-node-chips">
            <span v-for="c in node.data.analysis.characters?.slice(0, 3)" :key="c.id" class="nw-chip">{{ c.name }}</span>
            <span v-if="(node.data.analysis.characters?.length || 0) > 3" class="nw-chip dim">+{{ node.data.analysis.characters.length - 3 }}</span>
          </div>

          <div v-else-if="node.type === 'grok'" class="nw-node-meta">
            <span class="tag">{{ grokStatusLabel(node.status) }}</span>
            <span v-if="node.data.refCount" class="dim">{{ node.data.refCount }} 张参考图</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { buildNarrationCanvasGraph, nodeAnchor, bezierEdgePath } from '~/utils/narration-canvas-layout.js'
import { cacheVersion, mediaDisplayUrl, videoPosterDisplayUrl } from '~/utils/media-url.js'

const props = defineProps({
  job: { type: Object, default: null },
  segments: { type: Array, default: () => [] },
  analysis: { type: Object, default: () => ({}) },
  assetReadiness: { type: Object, default: () => ({}) },
  selectedId: { type: String, default: '' },
})

defineEmits(['select'])

const wrapRef = ref(null)
const stageRef = ref(null)
const view = reactive({ x: 40, y: 40, zoom: 0.85 })
const panning = ref(false)
const panStart = ref({ x: 0, y: 0, vx: 0, vy: 0 })
const nodeEls = new Map()
const nodeHeights = ref({})
let resizeObserver = null

function setNodeRef(id, el) {
  if (el) nodeEls.set(id, el)
  else nodeEls.delete(id)
}

function measureNodes() {
  const heights = {}
  for (const node of graph.value.nodes) {
    const el = nodeEls.get(node.id)
    if (el) heights[node.id] = el.offsetHeight
  }
  nodeHeights.value = heights
}

const graph = computed(() => buildNarrationCanvasGraph({
  segments: props.segments,
  analysis: props.analysis,
  assetReadiness: props.assetReadiness,
  job: props.job,
}))

const nodeMap = computed(() => {
  const m = new Map()
  for (const n of graph.value.nodes) m.set(n.id, n)
  return m
})

const edgePaths = computed(() => {
  const selected = props.selectedId
  return graph.value.edges.map(edge => {
    const fromNode = nodeMap.value.get(edge.from)
    const toNode = nodeMap.value.get(edge.to)
    if (!fromNode || !toNode) return null
    const from = nodeAnchor(fromNode, 'right', nodeHeights.value[fromNode.id])
    const to = nodeAnchor(toNode, 'left', nodeHeights.value[toNode.id])
    const active = selected && (edge.from === selected || edge.to === selected)
    return { d: bezierEdgePath(from, to), active }
  }).filter(Boolean)
})

const stageStyle = computed(() => ({
  transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
  transformOrigin: '0 0',
  width: `${graph.value.bounds.width}px`,
  height: `${graph.value.bounds.height}px`,
}))

function nodeStyle(node) {
  return {
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.w}px`,
    minHeight: `${node.h}px`,
  }
}

function grokPosterUrl(node) {
  void cacheVersion.value
  const raw = node.videoUrl || ''
  return videoPosterDisplayUrl({
    video_url: raw,
    local_path: raw.replace(/^\//, ''),
  })
}

function nodeTypeLabel(node) {
  if (node.type === 'segment') return '原文'
  if (node.type === 'extract') return '抽取'
  if (node.type.startsWith('asset-character')) return '角色'
  if (node.type.startsWith('asset-scene')) return '场景'
  if (node.type.startsWith('asset-prop')) return '道具'
  if (node.type === 'tts') return 'TTS'
  if (node.type === 'grok') return 'Grok'
  if (node.type === 'export') return '导出'
  return '节点'
}

function grokStatusLabel(status) {
  const map = {
    draft: '待生成',
    tts_generating: 'TTS中',
    tts_done: '待视频',
    generating: '生成中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] || status || '—'
}

function zoomBy(delta) {
  view.zoom = Math.min(1.6, Math.max(0.35, view.zoom + delta))
}

function onWheel(e) {
  const delta = e.deltaY > 0 ? -0.06 : 0.06
  view.zoom = Math.min(1.6, Math.max(0.35, view.zoom + delta))
}

function onPointerDown(e) {
  if (e.button !== 0) return
  panning.value = true
  panStart.value = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
}

function onPointerMove(e) {
  if (!panning.value) return
  view.x = panStart.value.vx + (e.clientX - panStart.value.x)
  view.y = panStart.value.vy + (e.clientY - panStart.value.y)
}

function onPointerUp() {
  panning.value = false
}

function fitView() {
  const el = wrapRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const gw = graph.value.bounds.width
  const gh = graph.value.bounds.height
  const pad = 48
  const scale = Math.min((rect.width - pad) / gw, (rect.height - pad) / gh, 1)
  view.zoom = Math.max(0.4, Math.min(1, scale))
  view.x = (rect.width - gw * view.zoom) / 2
  view.y = (rect.height - gh * view.zoom) / 2
}

watch(() => [props.segments.length, props.assetReadiness?.items?.length, graph.value.nodes.length], () => {
  nextTick(() => {
    measureNodes()
    observeNodeElements()
    fitView()
  })
}, { flush: 'post' })

function observeNodeElements() {
  if (!resizeObserver) return
  resizeObserver.disconnect()
  if (stageRef.value) resizeObserver.observe(stageRef.value)
  for (const el of nodeEls.values()) resizeObserver.observe(el)
}

onMounted(() => {
  nextTick(() => {
    measureNodes()
    fitView()
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => measureNodes())
      observeNodeElements()
    }
  })
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  nodeEls.clear()
})
</script>

<style scoped>
.nw-canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 0 16px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: #0d0f14;
}

.nw-canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.nw-zoom-label {
  min-width: 42px;
  text-align: center;
  font-size: 12px;
  color: var(--text-1);
}

.nw-toolbar-hint {
  margin-left: auto;
  font-size: 11px;
}

.nw-canvas-viewport {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  background-color: #0d0f14;
  background-image:
    radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
  background-size: 24px 24px;
}

.nw-canvas-viewport.is-panning {
  cursor: grabbing;
}

.nw-canvas-stage {
  position: relative;
  will-change: transform;
}

.nw-edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.nw-edge {
  fill: none;
  pointer-events: none;
  stroke: rgba(255, 255, 255, 0.16);
  stroke-width: 1.5;
}

.nw-edge.active {
  stroke: rgba(140, 175, 255, 0.35);
  stroke-width: 1.75;
}

.nw-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(22, 26, 36, 0.94);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.nw-node:hover {
  border-color: rgba(255, 255, 255, 0.28);
}

.nw-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(76, 125, 255, 0.35), 0 12px 32px rgba(0, 0, 0, 0.45);
}

.nw-node.done {
  border-color: rgba(102, 187, 106, 0.35);
}

.nw-node.generating {
  border-color: rgba(255, 193, 7, 0.45);
}

.nw-node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nw-node-type {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}

.nw-node-badge {
  font-size: 11px;
  color: #66bb6a;
}

.nw-node-badge.pulse {
  color: #ffc107;
  animation: nw-pulse 1s infinite;
}

@keyframes nw-pulse {
  50% { opacity: 0.4; }
}

.nw-node-title {
  font-size: 14px;
  line-height: 1.3;
}

.nw-node-sub {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.nw-node-media {
  margin-top: 4px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
}

.nw-node-media--video {
  position: relative;
}

.nw-node-video-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96px;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(0, 0, 0, 0.35);
}

.nw-node-play-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}

.nw-node-thumb,
.nw-node-video-thumb {
  width: 100%;
  height: 96px;
  object-fit: cover;
  display: block;
}

.nw-node-text {
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.65);
  background: rgba(0, 0, 0, 0.25);
  padding: 8px;
  border-radius: 8px;
  max-height: 72px;
  overflow: hidden;
}

.nw-node-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.nw-chip {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.nw-node-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
