<template>
  <div
    v-if="open"
    class="changelog-overlay"
    @mousedown="onOverlayMouseDown"
    @click="onOverlayClick"
  >
    <div class="changelog-dialog card" role="dialog" aria-labelledby="changelog-title">
      <div class="changelog-head">
        <div>
          <h3 id="changelog-title" class="changelog-title">版本更新记录</h3>
          <p class="dim changelog-sub">
            当前版本 v{{ currentVersion }}<template v-if="buildTime"> · 构建于 {{ buildTime }}</template>
          </p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="close">关闭</button>
      </div>

      <div class="changelog-body">
        <article
          v-for="entry in CHANGELOG"
          :key="entry.version"
          :class="['changelog-entry', { current: entry.version === currentVersion }]"
        >
          <header class="changelog-entry-head">
            <div class="changelog-entry-meta">
              <span class="changelog-version">v{{ entry.version }}</span>
              <span v-if="entry.version === currentVersion" class="tag tag-success">当前</span>
              <span class="changelog-date">{{ entry.date }}</span>
            </div>
            <h4 v-if="entry.title" class="changelog-entry-title">{{ entry.title }}</h4>
          </header>
          <ul class="changelog-list">
            <li v-for="(item, idx) in entry.changes" :key="idx">{{ item }}</li>
          </ul>
        </article>
      </div>

      <div class="changelog-foot dim">
        发版时请维护 <code>app/constants/changelog.ts</code> 与 package.json 版本号
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CHANGELOG } from '~/constants/changelog'
import { useOverlayDismiss } from '~/composables/useOverlayDismiss'

defineProps<{
  open: boolean
  currentVersion: string
  buildTime?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { onOverlayMouseDown, onOverlayClick } = useOverlayDismiss(() => emit('close'))

function close() {
  emit('close')
}
</script>

<style scoped>
.changelog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: rgba(15, 23, 42, 0.42);
}

.changelog-dialog {
  width: min(640px, 100%);
  max-height: min(82vh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-elevated);
}

.changelog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 14px;
  border-bottom: 1px solid var(--border);
}

.changelog-title {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--text-0);
}

.changelog-sub {
  margin-top: 6px;
  font-size: 13px;
}

.changelog-body {
  flex: 1;
  overflow: auto;
  padding: 8px 22px 16px;
}

.changelog-entry {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}

.changelog-entry:last-child {
  border-bottom: none;
}

.changelog-entry.current {
  background: linear-gradient(90deg, rgba(76, 125, 255, 0.06), transparent 60%);
  margin: 0 -22px;
  padding-left: 22px;
  padding-right: 22px;
}

.changelog-entry-head {
  margin-bottom: 10px;
}

.changelog-entry-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.changelog-version {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--accent-dark);
}

.changelog-date {
  font-size: 12px;
  color: var(--text-3);
}

.changelog-entry-title {
  margin-top: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}

.changelog-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}

.changelog-list li {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-2);
}

.changelog-foot {
  padding: 10px 22px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.changelog-foot code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-2);
}
</style>
