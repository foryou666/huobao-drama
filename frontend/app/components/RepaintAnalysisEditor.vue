<template>
  <div class="repaint-editor">
    <div v-if="analysis.warnings?.length" class="repaint-warnings">
      <p v-for="(warn, idx) in analysis.warnings" :key="idx">{{ warn }}</p>
    </div>

    <div v-if="analysis.shots?.length" class="repaint-timeline-wrap">
      <div class="repaint-timeline-label">镜头时间轴（{{ analysis.shots.length }} 段）</div>
      <div class="repaint-timeline" role="list">
        <button
          v-for="shot in analysis.shots"
          :key="shot.id"
          type="button"
          class="repaint-timeline-seg"
          :class="{ active: selectedShotId === shot.id }"
          :style="segmentStyle(shot)"
          :title="`${shot.id}: ${shot.start_sec}s - ${shot.end_sec}s`"
          @click="selectedShotId = shot.id"
        >
          <span class="repaint-timeline-seg-id">{{ shot.id }}</span>
        </button>
      </div>
      <p v-if="selectedShot" class="dim repaint-shot-detail">
        {{ selectedShot.id }} · {{ selectedShot.start_sec }}s – {{ selectedShot.end_sec }}s（{{ selectedShot.duration_sec }}s）
        <span v-if="selectedUtterances.length"> · {{ selectedUtterances.length }} 条台词</span>
      </p>
      <div v-if="selectedShotVisual" class="repaint-shot-visual card">
        <strong>镜头视觉理解</strong>
        <p v-if="selectedShotVisual.shot_size"><span class="dim">景别</span> {{ selectedShotVisual.shot_size }}<span v-if="selectedShotVisual.shot_size_detail"> — {{ selectedShotVisual.shot_size_detail }}</span></p>
        <p v-if="selectedShotVisual.camera_angle"><span class="dim">角度</span> {{ selectedShotVisual.camera_angle }}</p>
        <p v-if="selectedShotVisual.camera_movement"><span class="dim">运镜</span> {{ selectedShotVisual.camera_movement }}</p>
        <p v-if="selectedShotVisual.movement_motivation"><span class="dim">动机</span> {{ selectedShotVisual.movement_motivation }}</p>
        <p v-if="selectedShotVisual.action_blocking"><span class="dim">调度</span> {{ selectedShotVisual.action_blocking }}</p>
        <p v-if="selectedShotVisual.dialogue_note"><span class="dim">对白</span> {{ selectedShotVisual.dialogue_note }}</p>
      </div>
    </div>

    <div class="repaint-columns">
      <div class="repaint-col">
        <h3>台词（ASR）</h3>
        <div v-if="!displayUtterances.length" class="dim repaint-empty">暂无台词</div>
        <ul v-else class="repaint-utterance-list">
          <li v-for="u in displayUtterances" :key="u.id">
            <span class="mono dim">{{ formatSec(u.start_sec) }}–{{ formatSec(u.end_sec) }}</span>
            <textarea
              v-model="u.text"
              class="textarea repaint-utterance-input"
              rows="2"
              @change="emitChange"
            />
          </li>
        </ul>
      </div>

      <div class="repaint-col">
        <h3>角色</h3>
        <div v-for="char in analysis.characters" :key="char.id" class="repaint-entity-card">
          <input v-model="char.name" class="input" placeholder="姓名" @change="emitChange" />
          <input v-model="char.role" class="input" placeholder="定位" @change="emitChange" />
          <textarea v-model="char.appearance" class="textarea" rows="2" placeholder="外貌（欧美写实）" @change="emitChange" />
        </div>
        <button type="button" class="btn btn-sm" @click="addCharacter">+ 添加角色</button>
      </div>

      <div class="repaint-col">
        <h3>场景</h3>
        <div v-for="scene in analysis.scenes" :key="scene.id" class="repaint-entity-card">
          <input v-model="scene.location" class="input" placeholder="地点" @change="emitChange" />
          <input v-model="scene.time" class="input" placeholder="时间/光线" @change="emitChange" />
          <textarea v-model="scene.prompt" class="textarea" rows="2" placeholder="场景视觉描述" @change="emitChange" />
        </div>
        <button type="button" class="btn btn-sm" @click="addScene">+ 添加场景</button>
      </div>

      <div class="repaint-col">
        <h3>道具</h3>
        <div v-for="prop in analysis.props" :key="prop.id" class="repaint-entity-card">
          <input v-model="prop.name" class="input" placeholder="名称" @change="emitChange" />
          <input v-model="prop.type" class="input" placeholder="类型" @change="emitChange" />
          <textarea v-model="prop.description" class="textarea" rows="2" placeholder="描述" @change="emitChange" />
        </div>
        <button type="button" class="btn btn-sm" @click="addProp">+ 添加道具</button>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  analysis: { type: Object, required: true },
  totalDuration: { type: Number, default: 0 },
})

const emit = defineEmits(['update'])

const selectedShotId = ref('')

const selectedShot = computed(() =>
  props.analysis.shots?.find(s => s.id === selectedShotId.value) || null,
)

const selectedUtteranceIds = computed(() => {
  if (!selectedShot.value) return null
  const assignment = props.analysis.shot_assignments?.find(a => a.shot_id === selectedShot.value.id)
  return assignment?.utterance_ids || null
})

const displayUtterances = computed(() => {
  const all = props.analysis.utterances || []
  if (!selectedShot.value || !selectedUtteranceIds.value) return all
  const idSet = new Set(selectedUtteranceIds.value)
  return all.filter(u => idSet.has(u.id))
})

const selectedUtterances = computed(() => displayUtterances.value)

const selectedShotVisual = computed(() => {
  if (!selectedShot.value) return null
  return props.analysis.shot_visuals?.find(v => v.shot_id === selectedShot.value.id) || null
})

watch(
  () => props.analysis.shots,
  (shots) => {
    if (!selectedShotId.value && shots?.length) selectedShotId.value = shots[0].id
  },
  { immediate: true },
)

function formatSec(sec) {
  return Number(sec || 0).toFixed(1)
}

function segmentStyle(shot) {
  const total = Math.max(props.totalDuration || 1, 0.1)
  const width = Math.max((Number(shot.duration_sec) / total) * 100, 2)
  return { flex: `0 0 ${width}%` }
}

function emitChange() {
  emit('update', props.analysis)
}

function addCharacter() {
  const id = `c${(props.analysis.characters?.length || 0) + 1}`
  props.analysis.characters.push({ id, name: '', role: '', appearance: '', shot_ids: [] })
  emitChange()
}

function addScene() {
  const id = `sc${(props.analysis.scenes?.length || 0) + 1}`
  props.analysis.scenes.push({ id, location: '', time: '', prompt: '', shot_ids: [] })
  emitChange()
}

function addProp() {
  const id = `p${(props.analysis.props?.length || 0) + 1}`
  props.analysis.props.push({ id, name: '', type: 'prop', description: '', shot_ids: [] })
  emitChange()
}
</script>

<style scoped>
.repaint-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.repaint-warnings {
  padding: 10px 12px;
  border-radius: var(--radius);
  background: rgba(255, 183, 77, 0.12);
  border: 1px solid rgba(255, 183, 77, 0.35);
  font-size: 13px;
}

.repaint-warnings p {
  margin: 0 0 4px;
}

.repaint-timeline-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 6px;
}

.repaint-timeline {
  display: flex;
  width: 100%;
  height: 36px;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
}

.repaint-timeline-seg {
  border: none;
  border-right: 1px solid var(--border);
  background: var(--bg-3);
  color: var(--text-1);
  font-size: 10px;
  cursor: pointer;
  padding: 0 4px;
  min-width: 24px;
}

.repaint-timeline-seg:hover,
.repaint-timeline-seg.active {
  background: var(--accent-bg);
  color: var(--accent-text);
}

.repaint-timeline-seg-id {
  pointer-events: none;
}

.repaint-shot-detail {
  margin: 6px 0 0;
  font-size: 12px;
}

.repaint-shot-visual {
  margin-top: 10px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
}

.repaint-shot-visual p {
  margin: 6px 0 0;
}

.repaint-columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1100px) {
  .repaint-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .repaint-columns {
    grid-template-columns: 1fr;
  }
}

.repaint-col h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.repaint-empty {
  font-size: 13px;
}

.repaint-utterance-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
}

.repaint-utterance-input {
  width: 100%;
  margin-top: 4px;
  font-size: 13px;
}

.repaint-entity-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  padding: 8px;
  border-radius: var(--radius);
  background: var(--bg-2);
  border: 1px solid var(--border);
}

.repaint-entity-card .input,
.repaint-entity-card .textarea {
  font-size: 13px;
}
</style>
