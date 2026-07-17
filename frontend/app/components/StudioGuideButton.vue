<template>
  <span class="studio-guide">
    <button type="button" class="studio-guide-btn" @click="open = true">
      查看说明
    </button>
    <div v-if="open" class="studio-guide-overlay" @click.self="open = false">
      <div class="studio-guide-dialog card">
        <div class="studio-guide-head">
          <h3 class="studio-guide-title">{{ title }}</h3>
          <button type="button" class="btn btn-ghost btn-sm" @click="open = false">关闭</button>
        </div>
        <div class="studio-guide-body">
          <slot>
            <p v-for="(line, idx) in lines" :key="idx" class="studio-guide-line">{{ line }}</p>
          </slot>
        </div>
      </div>
    </div>
  </span>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  title: { type: String, default: '使用说明' },
  /** 多行说明；也可传单个字符串 */
  text: { type: [String, Array], default: '' },
})

const open = ref(false)

const lines = computed(() => {
  if (Array.isArray(props.text)) return props.text.map(s => String(s || '').trim()).filter(Boolean)
  const raw = String(props.text || '').trim()
  if (!raw) return []
  return raw.split(/\n+/).map(s => s.trim()).filter(Boolean)
})
</script>

<style scoped>
.studio-guide {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.studio-guide-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-text, #3b6ef5);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.studio-guide-btn:hover {
  opacity: 0.8;
}

.studio-guide-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(8, 12, 20, 0.55);
}

.studio-guide-dialog {
  width: min(520px, 100%);
  max-height: 80vh;
  overflow: auto;
  padding: 16px 18px;
}

.studio-guide-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.studio-guide-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.studio-guide-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.studio-guide-line {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-1);
}
</style>
