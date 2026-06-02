<template>
  <div class="vp-diff">
    <div v-if="showStats" class="vp-diff-stats">
      <span class="tag">变更行 {{ stats.changed }}</span>
      <span class="tag tag-success">新增行 {{ stats.added }}</span>
      <span class="tag tag-error">删除行 {{ stats.removed }}</span>
      <span class="dim vp-diff-legend">
        <span class="vp-diff-mark vp-diff-del">删除</span>
        <span class="vp-diff-mark vp-diff-add">新增</span>
      </span>
    </div>

    <div class="vp-diff-mode-tabs">
      <button type="button" :class="['btn btn-sm', { 'btn-primary': mode === 'split' }]" @click="mode = 'split'">左右对比</button>
      <button type="button" :class="['btn btn-sm', { 'btn-primary': mode === 'inline' }]" @click="mode = 'inline'">着色对比</button>
    </div>

    <div v-if="mode === 'split'" class="vp-diff-split">
      <div class="vp-diff-pane">
        <div class="vp-diff-pane-head">修改前</div>
        <div class="vp-diff-pane-body">
          <div
            v-for="(row, idx) in rows"
            :key="`l:${idx}`"
            :class="['vp-diff-line', rowClass(row, 'before')]"
          >
            <template v-if="row.type === 'change'">
              <span v-for="(part, pi) in row.beforeParts" :key="pi" :class="partClass(part)">{{ part.value }}</span>
            </template>
            <template v-else>{{ row.before || ' ' }}</template>
          </div>
        </div>
      </div>
      <div class="vp-diff-pane">
        <div class="vp-diff-pane-head">修改后</div>
        <div class="vp-diff-pane-body">
          <div
            v-for="(row, idx) in rows"
            :key="`r:${idx}`"
            :class="['vp-diff-line', rowClass(row, 'after')]"
          >
            <template v-if="row.type === 'change'">
              <span v-for="(part, pi) in row.afterParts" :key="pi" :class="partClass(part)">{{ part.value }}</span>
            </template>
            <template v-else>{{ row.after || ' ' }}</template>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="vp-diff-inline card">
      <div
        v-for="(row, idx) in rows"
        :key="`i:${idx}`"
        :class="['vp-diff-line', rowClass(row, 'inline')]"
      >
        <template v-if="row.type === 'change'">
          <span v-for="(part, pi) in row.beforeParts" :key="`b:${pi}`" :class="partClass(part)">{{ part.value }}</span>
          <span v-for="(part, pi) in row.afterParts" :key="`a:${pi}`" :class="partClass(part)">{{ part.value }}</span>
        </template>
        <template v-else-if="row.type === 'remove'">{{ row.before }}</template>
        <template v-else-if="row.type === 'add'">{{ row.after }}</template>
        <template v-else>{{ row.before }}</template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { buildSideBySideDiff, countDiffStats } from '~/utils/text-diff.js'

const props = defineProps({
  beforeText: { type: String, default: '' },
  afterText: { type: String, default: '' },
  showStats: { type: Boolean, default: true },
})

const mode = ref('split')

const rows = computed(() => buildSideBySideDiff(props.beforeText, props.afterText))
const stats = computed(() => countDiffStats(props.beforeText, props.afterText))

function rowClass(row, side) {
  if (row.type === 'same') return 'is-same'
  if (row.type === 'change') return 'is-change'
  if (row.type === 'remove') return side === 'after' ? 'is-gap' : 'is-remove'
  if (row.type === 'add') return side === 'before' ? 'is-gap' : 'is-add'
  return ''
}

function partClass(part) {
  if (part.type === 'remove') return 'vp-diff-del'
  if (part.type === 'add') return 'vp-diff-add'
  return ''
}
</script>

<style scoped>
.vp-diff { display: flex; flex-direction: column; gap: 10px; }
.vp-diff-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.vp-diff-legend { display: inline-flex; gap: 8px; margin-left: auto; font-size: 11px; }
.vp-diff-mode-tabs { display: flex; gap: 6px; }
.vp-diff-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  min-height: 240px;
}
.vp-diff-pane {
  border: 1px solid rgba(27, 41, 64, 0.1);
  border-radius: 14px;
  overflow: hidden;
  min-width: 0;
}
.vp-diff-pane-head {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
  background: rgba(248, 251, 255, 0.9);
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
}
.vp-diff-pane-body,
.vp-diff-inline {
  max-height: 360px;
  overflow: auto;
  padding: 10px 12px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.vp-diff-line { padding: 1px 0; }
.vp-diff-line.is-same { color: var(--text-2); }
.vp-diff-line.is-change { background: rgba(59, 130, 246, 0.06); }
.vp-diff-line.is-remove { background: rgba(239, 68, 68, 0.1); color: #991b1b; }
.vp-diff-line.is-add { background: rgba(34, 197, 94, 0.1); color: #166534; }
.vp-diff-line.is-gap { min-height: 1.65em; background: rgba(15, 23, 42, 0.03); }
.vp-diff-del {
  background: rgba(239, 68, 68, 0.18);
  text-decoration: line-through;
}
.vp-diff-add {
  background: rgba(34, 197, 94, 0.22);
}
.vp-diff-mark.vp-diff-del {
  padding: 1px 6px;
  border-radius: 4px;
  text-decoration: line-through;
}
.vp-diff-mark.vp-diff-add {
  padding: 1px 6px;
  border-radius: 4px;
}
@media (max-width: 820px) {
  .vp-diff-split { grid-template-columns: 1fr; }
}
</style>
