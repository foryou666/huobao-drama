<template>
  <div
    v-if="taskKey && timer.hasTask(taskKey)"
    class="gen-timer"
    :class="{ 'gen-timer-slow': timer.isSlow(taskKey) }"
  >
    <span class="gen-timer-meta">{{ timer.statusText(taskKey) }}</span>
  </div>
</template>

<script setup>
const props = defineProps({
  taskKey: { type: String, default: '' },
})

const timer = useGenerationTimer()
</script>

<style scoped>
.gen-timer {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-3);
  font-family: var(--font-mono);
}
.gen-timer-slow {
  color: var(--warning, #e6a700);
}
.gen-timer-meta {
  display: block;
}
</style>
