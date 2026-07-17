<template>
  <div class="canvas-page">
    <header class="canvas-header">
      <div class="header-left">
        <button type="button" class="btn btn-ghost btn-sm" @click="router.push('/canvas')">← 画布</button>
        <div class="min-w-0">
          <h1 class="title">{{ board?.title || '生产线画布' }}</h1>
          <p class="dim meta">
            <button v-if="board?.drama?.id" type="button" class="linkish" @click="openDramaWorkbench">
              {{ board.drama.title }}
            </button>
            <span v-else>—</span>
            · {{ board?.nodes?.length || 0 }} 节点
            <span v-if="dirty"> · 未保存</span>
            <span v-if="saving"> · 保存中…</span>
          </p>
        </div>
      </div>
      <div class="header-actions">
        <label class="episode-picker">
          <span class="dim">当前集</span>
          <select
            class="episode-select"
            :value="focusEpisodeId || ''"
            :disabled="loading || switchingEpisode || !(board?.episodes || []).length"
            @change="onFocusEpisodeChange"
          >
            <option v-if="!(board?.episodes || []).length" value="">暂无剧集</option>
            <option v-for="ep in board?.episodes || []" :key="ep.id" :value="ep.id">
              第 {{ ep.episode_number }} 集{{ ep.title ? ` · ${ep.title}` : '' }}
            </option>
          </select>
        </label>
        <button type="button" class="btn btn-sm" :disabled="loading" @click="reloadAll">刷新</button>
        <button type="button" class="btn btn-sm" :disabled="syncing || !focusEpisodeId" @click="syncFromProject">
          {{ syncing ? '同步中…' : '同步本集' }}
        </button>
        <button type="button" class="btn btn-sm" @click="addNote">便签</button>
        <button type="button" class="btn btn-sm btn-primary" :disabled="!dirty || saving" @click="saveLayout">
          保存布局
        </button>
      </div>
    </header>

    <!-- 生产线步骤条 -->
    <nav class="pipeline-rail" aria-label="制作流水线">
      <button
        v-for="step in steps"
        :key="step.key"
        type="button"
        class="pipe-step"
        :class="[`st-${step.status}`, { active: activeStepKey === step.key, running: running && activeStepKey === step.key }]"
        :disabled="running"
        @click="onSelectStep(step.key)"
      >
        <span class="pipe-dot" />
        <span class="pipe-label">{{ step.label }}</span>
        <span v-if="step.total != null" class="pipe-count">{{ step.completed || 0 }}/{{ step.total }}</span>
        <span v-else-if="step.count != null" class="pipe-count">{{ step.count }}</span>
      </button>
      <div class="pipe-actions">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="running || !focusEpisodeId"
          @click="runActiveStep"
        >
          {{ running ? '运行中…' : `运行「${activeStep?.label || ''}」` }}
        </button>
        <button v-if="running" type="button" class="btn btn-sm" @click="stopAgent">停止</button>
      </div>
    </nav>

    <div v-if="loading" class="state dim">加载中…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>

    <div v-else class="workspace">
      <aside class="sidebar">
        <div class="side-tabs">
          <button type="button" :class="{ on: sideTab === 'assets' }" @click="sideTab = 'assets'">资产</button>
          <button type="button" :class="{ on: sideTab === 'shots' }" @click="sideTab = 'shots'">分镜</button>
          <button type="button" :class="{ on: sideTab === 'batch' }" @click="sideTab = 'batch'">批量</button>
        </div>

        <template v-if="sideTab === 'assets'">
          <div v-for="group in assetPoolGroups" :key="group.key" class="pool-group">
            <div class="pool-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="`${group.key}-${item.id}`"
              type="button"
              class="pool-item"
              :class="{ 'on-board': isOnBoard(group.key, item.id) }"
              :disabled="isOnBoard(group.key, item.id) || importing"
              @click="importRef(group.key, item.id)"
            >
              <span
                v-if="thumbUrl(item.image_url)"
                class="pool-thumb"
                :style="{ backgroundImage: `url(${thumbUrl(item.image_url)})` }"
              />
              <span v-else class="pool-thumb empty" />
              <span class="pool-meta">
                <span class="pool-name">{{ item.name }}</span>
                <span class="dim">{{ isOnBoard(group.key, item.id) ? '已上板' : (item.has_image ? '有图' : '上板') }}</span>
              </span>
            </button>
            <p v-if="!group.items.length" class="dim empty-pool">暂无</p>
          </div>
        </template>

        <template v-else-if="sideTab === 'shots'">
          <div class="pool-group">
            <div class="pool-label">本集分镜 · {{ (pool.storyboards || []).length }}</div>
            <button
              v-for="item in pool.storyboards || []"
              :key="`sb-${item.id}`"
              type="button"
              class="pool-item"
              :class="{ 'on-board': isOnBoard('storyboard', item.id) }"
              :disabled="isOnBoard('storyboard', item.id) || importing"
              @click="importRef('storyboard', item.id)"
            >
              <span
                v-if="thumbUrl(item.image_url)"
                class="pool-thumb"
                :style="{ backgroundImage: `url(${thumbUrl(item.image_url)})` }"
              />
              <span v-else class="pool-thumb empty" />
              <span class="pool-meta">
                <span class="pool-name">#{{ item.shot_index }} {{ item.name }}</span>
                <span class="dim">{{ item.has_video ? '有视频' : (item.has_image ? '有图' : '上板') }}</span>
              </span>
            </button>
            <p v-if="!(pool.storyboards || []).length" class="dim empty-pool">
              尚无分镜。可点上方「拆解分镜」运行 Agent。
            </p>
          </div>
        </template>

        <template v-else>
          <div class="batch-panel">
            <p class="dim batch-hint">对当前集缺失视觉资产一键补全（与工作台同一 API）</p>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="!!busyAction || !missingCharIds.length"
              @click="batchMissingChars"
            >
              补全角色图（{{ missingCharIds.length }}）
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="!!busyAction || !missingSceneIds.length"
              @click="batchMissingScenes"
            >
              补全场景图（{{ missingSceneIds.length }}）
            </button>
            <button type="button" class="btn btn-sm" @click="openDramaWorkbench">打开经典工作台</button>
          </div>
        </template>
      </aside>

      <div
        ref="viewportRef"
        class="viewport"
        @wheel.prevent="onWheel"
        @pointerdown="onViewportDown"
        @pointermove="onViewportMove"
        @pointerup="onViewportUp"
        @pointerleave="onViewportUp"
      >
        <div class="world" :style="worldStyle">
          <svg class="edges" :viewBox="edgeViewBox">
            <line
              v-for="edge in board?.edges || []"
              :key="edge.edge_key"
              :x1="nodeCenter(edge.from_node_key).x"
              :y1="nodeCenter(edge.from_node_key).y"
              :x2="nodeCenter(edge.to_node_key).x"
              :y2="nodeCenter(edge.to_node_key).y"
              stroke="rgba(157,183,255,.35)"
              stroke-width="2"
            />
          </svg>

          <div
            v-for="node in board?.nodes || []"
            :key="node.node_key"
            class="node"
            :class="[
              `kind-${node.kind}`,
              { selected: selectedKey === node.node_key, stale: node.stale },
            ]"
            :style="{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.w || 200}px`,
              height: `${node.h || 120}px`,
              zIndex: node.z_index || 0,
            }"
            @pointerdown.stop="onNodeDown($event, node)"
          >
            <div
              v-if="nodeThumb(node)"
              class="node-cover"
              :style="{ backgroundImage: `url(${nodeThumb(node)})` }"
            />
            <div class="node-body">
              <div class="node-type">{{ kindLabel(node.kind) }}</div>
              <div class="node-title">{{ node.label || node.kind }}</div>
              <div v-if="nodeBadges(node).length" class="node-badges">
                <span v-for="b in nodeBadges(node)" :key="b" class="badge">{{ b }}</span>
              </div>
              <p v-if="node.stale" class="node-stale">项目中已删除</p>
            </div>
            <button
              type="button"
              class="node-remove"
              title="从画布移除（不删项目实体）"
              @pointerdown.stop
              @click.stop="removeNode(node)"
            >×</button>
          </div>
        </div>
        <div v-if="!(board?.nodes || []).length" class="viewport-empty dim">
          本集暂无节点。打开时会自动同步；也可从左侧上板，或运行生产线步骤生成资产。
        </div>
        <div class="viewport-hint dim">拖空白平移 · 滚轮缩放 · Ctrl+S 保存 · 顶部流水线即工作台全流程</div>
      </div>

      <aside class="detail">
        <template v-if="selectedNode">
          <div class="detail-head">
            <strong>{{ selectedNode.label }}</strong>
            <button type="button" class="btn btn-ghost btn-sm" @click="selectedKey = ''">关闭</button>
          </div>
          <p class="dim">{{ kindLabel(selectedNode.kind) }}
            <template v-if="selectedNode.ref_id"> · #{{ selectedNode.ref_id }}</template>
          </p>
          <div
            v-if="nodeThumb(selectedNode)"
            class="detail-cover"
            :style="{ backgroundImage: `url(${nodeThumb(selectedNode)})` }"
          />
          <p v-if="selectedNode.stale" class="error">实体已删除，可移出画布。</p>
          <p v-else-if="selectedNode.entity?.description || selectedNode.entity?.script_preview" class="detail-desc">
            {{ selectedNode.entity.description || selectedNode.entity.script_preview }}
          </p>

          <div class="detail-actions">
            <button
              v-if="selectedNode.kind === 'character' || selectedNode.kind === 'scene'"
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="!!busyAction"
              @click="genSelectedImage"
            >生成{{ selectedNode.kind === 'character' ? '角色' : '场景' }}图</button>
            <button
              v-if="selectedNode.kind === 'storyboard'"
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="!!busyAction"
              @click="genSelectedVideo"
            >生成镜头视频</button>
            <button
              v-if="selectedNode.kind === 'episode' || selectedNode.kind === 'storyboard'"
              type="button"
              class="btn btn-sm"
              @click="openDramaWorkbench"
            >在工作台打开</button>
            <button type="button" class="btn btn-sm" @click="removeNode(selectedNode)">移出画布</button>
          </div>
        </template>

        <template v-else>
          <div class="detail-head"><strong>AI 控制台</strong></div>
          <p class="dim">当前步骤：{{ activeStep?.label }}</p>
          <div class="chips">
            <button
              v-for="chip in quickChips"
              :key="chip"
              type="button"
              class="chip"
              :disabled="running"
              @click="runAgentPrompt(chip)"
            >{{ chip }}</button>
          </div>
          <form class="prompt-form" @submit.prevent="submitCustomPrompt">
            <textarea
              v-model="customPrompt"
              rows="3"
              placeholder="输入指令，例如：补全遗漏角色并去重保存"
              :disabled="running"
            />
            <button type="submit" class="btn btn-sm btn-primary" :disabled="running || !customPrompt.trim()">
              发送
            </button>
          </form>
          <div v-if="streamText || lastLog" class="stream-box">
            <div v-if="lastLog" class="dim stream-log">{{ lastLog }}</div>
            <pre class="stream-text">{{ streamText || '…' }}</pre>
          </div>
          <div v-if="studio?.counts" class="counts">
            <div>角色 {{ studio.counts.characters_with_image }}/{{ studio.counts.characters }}</div>
            <div>场景 {{ studio.counts.scenes_with_image }}/{{ studio.counts.scenes }}</div>
            <div>分镜 {{ studio.counts.storyboards }}</div>
            <div>视频 {{ studio.counts.storyboards_with_video }}/{{ studio.counts.storyboards }}</div>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { canvasAPI } from '~/composables/useApi'
import { useCanvasStudio } from '~/composables/useCanvasStudio'
import { mediaDisplayUrl, prefetchMediaUrls } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'

const route = useRoute()
const router = useRouter()
const boardId = computed(() => Number(route.params.id))

const loading = ref(true)
const saving = ref(false)
const syncing = ref(false)
const switchingEpisode = ref(false)
const importing = ref(false)
const dirty = ref(false)
const error = ref('')
const board = ref(null)
const pool = ref({ characters: [], scenes: [], props: [], storyboards: [], episodes: [] })
const selectedKey = ref('')
const sideTab = ref('assets')
const customPrompt = ref('')
const view = reactive({ x: 40, y: 40, zoom: 1 })
const worldSize = 5000
const viewportRef = ref(null)

const focusEpisodeId = computed(() => Number(board.value?.focus_episode_id) || 0)
const dramaId = computed(() => board.value?.drama?.id || null)
const episodeIdRef = computed(() => focusEpisodeId.value || null)

const {
  studio,
  running,
  busyAction,
  streamText,
  lastLog,
  activeStepKey,
  steps,
  activeStep,
  quickChips,
  refreshStudio,
  stopAgent,
  runAgentPrompt,
  runPipelineStep,
  generateNodeImage,
  batchGenerateMissing,
  generateStoryboardVideo,
} = useCanvasStudio(boardId, dramaId, episodeIdRef)

const selectedNode = computed(() =>
  (board.value?.nodes || []).find(n => n.node_key === selectedKey.value) || null,
)

const worldStyle = computed(() => ({
  transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
}))

const edgeViewBox = computed(() => `0 0 ${worldSize} ${worldSize}`)

const assetPoolGroups = computed(() => ([
  { key: 'character', label: '角色', items: pool.value.characters || [] },
  { key: 'scene', label: '场景', items: pool.value.scenes || [] },
  { key: 'prop', label: '道具', items: pool.value.props || [] },
  { key: 'episode', label: '本集', items: pool.value.episodes || [] },
]))

const missingCharIds = computed(() =>
  (pool.value.characters || []).filter(c => !c.has_image).map(c => c.id),
)
const missingSceneIds = computed(() =>
  (pool.value.scenes || []).filter(s => !s.has_image).map(s => s.id),
)

const KIND_LABELS = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  episode: '集',
  storyboard: '分镜',
  note: '便签',
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || kind
}

function thumbUrl(raw) {
  return mediaDisplayUrl(raw) || ''
}

function nodeThumb(node) {
  return thumbUrl(node?.entity?.image_url || node?.entity?.video_url)
}

function nodeBadges(node) {
  const e = node?.entity || {}
  const out = []
  if (e.has_image) out.push('图')
  if (e.has_video) out.push('视频')
  if (e.has_rewritten) out.push('已改写')
  else if (e.has_script) out.push('有剧本')
  if (e.voice_style) out.push('音色')
  return out
}

function isOnBoard(kind, id) {
  return (board.value?.nodes || []).some(
    n => !n.stale && (n.ref_type || n.kind) === kind && Number(n.ref_id) === Number(id),
  )
}

function nodeCenter(nodeKey) {
  const node = (board.value?.nodes || []).find(n => n.node_key === nodeKey)
  if (!node) return { x: 0, y: 0 }
  return {
    x: Number(node.x || 0) + Number(node.w || 200) / 2,
    y: Number(node.y || 0) + Number(node.h || 120) / 2,
  }
}

function prefetchBoardMedia(data, poolData) {
  const paths = []
  for (const n of data?.nodes || []) {
    if (n.entity?.image_url) paths.push(n.entity.image_url)
  }
  for (const list of [
    poolData?.characters,
    poolData?.scenes,
    poolData?.props,
    poolData?.storyboards,
  ]) {
    for (const item of list || []) {
      if (item.image_url) paths.push(item.image_url)
    }
  }
  prefetchMediaUrls(paths).catch(() => {})
}

function applyBoard(data) {
  board.value = data
  const vp = data?.viewport || {}
  view.x = Number(vp.x) || 0
  view.y = Number(vp.y) || 0
  view.zoom = Number(vp.zoom) || 1
  dirty.value = false
}

async function reloadAll() {
  loading.value = true
  error.value = ''
  try {
    const detail = await canvasAPI.get(boardId.value)
    applyBoard(detail)
    const poolRes = await canvasAPI.pool(boardId.value, detail?.focus_episode_id)
    pool.value = poolRes || { characters: [], scenes: [], props: [], storyboards: [], episodes: [] }
    prefetchBoardMedia(detail, pool.value)
    await refreshStudio()
  } catch (err) {
    error.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function onFocusEpisodeChange(e) {
  const nextId = Number(e?.target?.value)
  if (!nextId || nextId === focusEpisodeId.value) return
  if (dirty.value) {
    try {
      await saveLayout()
    } catch {
      toast.error('请先保存布局再切换集')
      e.target.value = String(focusEpisodeId.value || '')
      return
    }
  }
  switchingEpisode.value = true
  selectedKey.value = ''
  try {
    const data = await canvasAPI.patch(boardId.value, { focus_episode_id: nextId })
    applyBoard(data)
    const poolRes = await canvasAPI.pool(boardId.value, nextId)
    pool.value = poolRes || pool.value
    prefetchBoardMedia(data, pool.value)
    await refreshStudio()
    toast.success(`已切换到第 ${data?.episodes?.find(ep => ep.id === nextId)?.episode_number || ''} 集`)
  } catch (err) {
    toast.error(err?.message || '切换集失败')
    e.target.value = String(focusEpisodeId.value || '')
  } finally {
    switchingEpisode.value = false
  }
}

async function syncFromProject() {
  syncing.value = true
  try {
    const data = await canvasAPI.sync(boardId.value)
    applyBoard(data)
    const n = Number(data?.synced_count || 0)
    toast.success(n > 0 ? `已同步 ${n} 个本集实体上板` : '本集已对齐，无新增')
    const poolRes = await canvasAPI.pool(boardId.value, data?.focus_episode_id)
    pool.value = poolRes || pool.value
    prefetchBoardMedia(data, pool.value)
    await refreshStudio()
  } catch (err) {
    toast.error(err?.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

async function importRef(kind, id) {
  importing.value = true
  try {
    const data = await canvasAPI.importNodes(boardId.value, [{ ref_type: kind, ref_id: id }])
    applyBoard(data)
    prefetchBoardMedia(data, pool.value)
    toast.success('已上板')
  } catch (err) {
    toast.error(err?.message || '上板失败')
  } finally {
    importing.value = false
  }
}

async function addNote() {
  try {
    const data = await canvasAPI.addNote(boardId.value, {
      text: '便签',
      x: (-view.x + 160) / view.zoom,
      y: (-view.y + 120) / view.zoom,
    })
    applyBoard(data)
  } catch (err) {
    toast.error(err?.message || '添加失败')
  }
}

async function removeNode(node) {
  if (!node) return
  try {
    const data = await canvasAPI.removeNode(boardId.value, node.node_key)
    applyBoard(data)
    if (selectedKey.value === node.node_key) selectedKey.value = ''
  } catch (err) {
    toast.error(err?.message || '移除失败')
  }
}

async function saveLayout() {
  if (!board.value) return
  saving.value = true
  try {
    const data = await canvasAPI.saveLayout(boardId.value, {
      base_updated_at: board.value.updated_at,
      viewport: { x: view.x, y: view.y, zoom: view.zoom },
      nodes: (board.value.nodes || []).map(n => ({
        node_key: n.node_key,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        z_index: n.z_index,
      })),
      edges: (board.value.edges || []).map(e => ({
        edge_key: e.edge_key,
        from_node_key: e.from_node_key,
        to_node_key: e.to_node_key,
        edge_type: e.edge_type,
      })),
    })
    applyBoard(data)
    toast.success('布局已保存')
  } catch (err) {
    toast.error(err?.message || '保存失败')
    if (String(err?.message || '').includes('刷新')) await reloadAll()
  } finally {
    saving.value = false
  }
}

function openDramaWorkbench() {
  const id = board.value?.drama?.id
  const epNum = board.value?.episodes?.find(e => e.id === focusEpisodeId.value)?.episode_number
  if (id && epNum != null) router.push(`/drama/${id}/episode/${epNum}`)
  else if (id) router.push(`/drama/${id}`)
}

function onSelectStep(key) {
  activeStepKey.value = key
  selectedKey.value = ''
}

async function runActiveStep() {
  const ok = await runPipelineStep(activeStepKey.value)
  if (ok) await syncFromProject()
}

async function submitCustomPrompt() {
  const text = customPrompt.value.trim()
  if (!text) return
  const ok = await runAgentPrompt(text)
  if (ok) {
    customPrompt.value = ''
    await syncFromProject()
  }
}

async function genSelectedImage() {
  const n = selectedNode.value
  if (!n?.ref_id) return
  const ok = await generateNodeImage(n.kind, Number(n.ref_id))
  if (ok) await reloadAll()
}

async function genSelectedVideo() {
  const n = selectedNode.value
  if (!n?.ref_id) return
  const ok = await generateStoryboardVideo(Number(n.ref_id), n.entity?.description)
  if (ok) await reloadAll()
}

async function batchMissingChars() {
  const ok = await batchGenerateMissing('character', missingCharIds.value)
  if (ok) await reloadAll()
}

async function batchMissingScenes() {
  const ok = await batchGenerateMissing('scene', missingSceneIds.value)
  if (ok) await reloadAll()
}

/* —— viewport pan / zoom / node drag —— */
let pan = null
let drag = null

function onWheel(e) {
  const delta = e.deltaY > 0 ? -0.08 : 0.08
  const next = Math.min(2.2, Math.max(0.35, view.zoom + delta))
  view.zoom = Number(next.toFixed(3))
  dirty.value = true
}

function onViewportDown(e) {
  if (e.button !== 0) return
  pan = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }
  e.currentTarget?.setPointerCapture?.(e.pointerId)
}

function onViewportMove(e) {
  if (drag) {
    const zoom = view.zoom || 1
    drag.node.x = drag.ox + (e.clientX - drag.x) / zoom
    drag.node.y = drag.oy + (e.clientY - drag.y) / zoom
    dirty.value = true
    return
  }
  if (!pan) return
  view.x = pan.ox + (e.clientX - pan.x)
  view.y = pan.oy + (e.clientY - pan.y)
  dirty.value = true
}

function onViewportUp() {
  pan = null
  drag = null
}

function onNodeDown(e, node) {
  if (e.button !== 0) return
  selectedKey.value = node.node_key
  drag = { node, x: e.clientX, y: e.clientY, ox: Number(node.x) || 0, oy: Number(node.y) || 0 }
  pan = null
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (dirty.value) saveLayout()
  }
}

watch(focusEpisodeId, () => {
  refreshStudio()
})

onMounted(() => {
  reloadAll()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  stopAgent()
})
</script>

<style scoped>
.canvas-page {
  height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(1000px 480px at 8% -8%, rgba(91,140,255,.14), transparent 55%),
    radial-gradient(800px 420px at 92% 0%, rgba(125,211,252,.08), transparent 50%),
    var(--bg, #0f1218);
}
.canvas-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.06);
}
.header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.title { margin: 0; font-size: 1.05rem; }
.meta { margin: 4px 0 0; font-size: 0.8rem; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; flex-wrap: wrap; }
.episode-picker {
  display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #c5cde0;
}
.episode-select {
  max-width: 240px; min-width: 130px; padding: 6px 10px; border-radius: 8px;
  border: 1px solid rgba(157, 183, 255, .35);
  background: #1a2030; color: #e8ecf5; font: inherit; color-scheme: dark;
}
.linkish {
  background: none; border: 0; color: #9db7ff; cursor: pointer; padding: 0; font: inherit;
}
.linkish:hover { text-decoration: underline; }

.pipeline-rail {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.06);
  background: rgba(0,0,0,.18);
}
.pipe-step {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.03); color: #d7deee;
  font-size: 0.78rem; cursor: pointer;
}
.pipe-step:hover:not(:disabled) { border-color: rgba(91,140,255,.45); }
.pipe-step.active { border-color: #5b8cff; background: rgba(91,140,255,.16); }
.pipe-step.running { box-shadow: 0 0 0 1px rgba(91,140,255,.5); }
.pipe-step.st-done .pipe-dot { background: #86efac; }
.pipe-step.st-partial .pipe-dot, .pipe-step.st-ready .pipe-dot { background: #fcd34d; }
.pipe-step.st-pending .pipe-dot { background: #64748b; }
.pipe-dot { width: 7px; height: 7px; border-radius: 50%; background: #64748b; }
.pipe-count { opacity: .7; font-variant-numeric: tabular-nums; }
.pipe-actions { margin-left: auto; display: flex; gap: 6px; }

.state { padding: 48px 20px; text-align: center; }
.error { color: #ff8f8f; }
.workspace {
  flex: 1; min-height: 0;
  display: grid; grid-template-columns: 260px 1fr minmax(260px, 300px);
}
.sidebar, .detail {
  overflow: auto; padding: 12px;
  background: rgba(0,0,0,.15);
  border-right: 1px solid rgba(255,255,255,.06);
}
.detail { border-right: 0; border-left: 1px solid rgba(255,255,255,.06); }
.side-tabs {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 12px;
}
.side-tabs button {
  padding: 6px 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08);
  background: transparent; color: #9aa3b8; cursor: pointer; font-size: 0.78rem;
}
.side-tabs button.on { background: rgba(91,140,255,.18); color: #e8ecf5; border-color: rgba(91,140,255,.4); }
.detail-head, .sidebar-head {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
}
.pool-group { margin-bottom: 14px; }
.pool-label { font-size: 0.75rem; color: #8b92a5; margin-bottom: 6px; }
.pool-item {
  width: 100%; display: flex; align-items: center; gap: 8px;
  text-align: left; padding: 6px 8px; margin-bottom: 4px;
  border: 1px solid rgba(255,255,255,.06); border-radius: 8px;
  background: rgba(255,255,255,.03); color: inherit; cursor: pointer;
}
.pool-item:hover:not(:disabled) { border-color: rgba(91,140,255,.45); }
.pool-item.on-board, .pool-item:disabled { opacity: .55; cursor: default; }
.pool-thumb {
  width: 36px; height: 36px; border-radius: 6px; flex-shrink: 0;
  background: #1a2030 center/cover no-repeat;
}
.pool-thumb.empty { background: rgba(255,255,255,.06); }
.pool-meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pool-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.84rem; }
.empty-pool { font-size: 0.8rem; margin: 0; }
.batch-panel { display: flex; flex-direction: column; gap: 8px; }
.batch-hint { font-size: 0.8rem; margin: 0 0 4px; line-height: 1.45; }

.viewport {
  position: relative; overflow: hidden; cursor: grab;
  background-image:
    linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px);
  background-size: 24px 24px;
}
.viewport:active { cursor: grabbing; }
.world {
  position: absolute; inset: 0; width: 5000px; height: 5000px;
  transform-origin: 0 0; will-change: transform;
}
.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.node {
  position: absolute; border-radius: 12px; overflow: hidden;
  border: 1px solid rgba(255,255,255,.1);
  background: rgba(22, 26, 36, .94);
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
  cursor: grab; user-select: none;
  display: flex; flex-direction: column;
}
.node.selected { border-color: #5b8cff; box-shadow: 0 0 0 1px rgba(91,140,255,.4); }
.node.stale { opacity: .7; border-style: dashed; }
.node-cover {
  height: 72px; background: #151a24 center/cover no-repeat; flex-shrink: 0;
}
.node-body { padding: 8px 10px 10px; min-height: 0; }
.node-type { font-size: 0.68rem; color: #9db7ff; margin-bottom: 2px; }
.node-title { font-size: 0.88rem; font-weight: 600; line-height: 1.25; }
.node-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.badge {
  font-size: 0.65rem; padding: 1px 6px; border-radius: 999px;
  background: rgba(91,140,255,.18); color: #c5d5ff;
}
.node-stale { margin: 6px 0 0; font-size: 0.75rem; color: #ff8f8f; }
.node-remove {
  position: absolute; top: 4px; right: 6px; border: 0; background: rgba(0,0,0,.35);
  color: #c5cde0; cursor: pointer; font-size: 14px; line-height: 1;
  width: 22px; height: 22px; border-radius: 6px;
}
.kind-character { border-top: 2px solid #7dd3fc; }
.kind-scene { border-top: 2px solid #86efac; }
.kind-prop { border-top: 2px solid #fcd34d; }
.kind-episode { border-top: 2px solid #c4b5fd; }
.kind-storyboard { border-top: 2px solid #fb923c; }
.kind-note { border-top: 2px solid #fb7185; }
.viewport-hint {
  position: absolute; left: 12px; bottom: 10px; font-size: 0.75rem; pointer-events: none;
}
.viewport-empty {
  position: absolute; inset: 0; display: grid; place-items: center;
  pointer-events: none; padding: 24px; text-align: center; font-size: 0.9rem;
}

.detail-cover {
  height: 120px; border-radius: 10px; margin: 8px 0;
  background: #151a24 center/cover no-repeat;
}
.detail-desc { font-size: 0.84rem; line-height: 1.5; white-space: pre-wrap; max-height: 160px; overflow: auto; }
.detail-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.chips { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.chip {
  text-align: left; padding: 8px 10px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.03);
  color: #d7deee; font-size: 0.78rem; cursor: pointer; line-height: 1.35;
}
.chip:hover:not(:disabled) { border-color: rgba(91,140,255,.45); }
.prompt-form { display: flex; flex-direction: column; gap: 8px; }
.prompt-form textarea {
  width: 100%; resize: vertical; min-height: 72px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.1); background: #151a24; color: #e8ecf5;
  padding: 8px 10px; font: inherit;
}
.stream-box {
  margin-top: 12px; padding: 10px; border-radius: 10px;
  background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.06);
  max-height: 220px; overflow: auto;
}
.stream-log { font-size: 0.75rem; margin-bottom: 6px; }
.stream-text {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-size: 0.78rem; line-height: 1.45; color: #c5cde0;
}
.counts {
  margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
  font-size: 0.78rem; color: #9aa3b8;
}
@media (max-width: 1100px) {
  .workspace { grid-template-columns: 220px 1fr; }
  .detail { display: none; }
}
@media (max-width: 800px) {
  .workspace { grid-template-columns: 1fr; }
  .sidebar { max-height: 180px; }
}
</style>
