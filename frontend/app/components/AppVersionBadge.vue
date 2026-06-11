<template>
  <div class="app-version-root">
    <button
      type="button"
      class="app-version"
      :title="tooltip"
      aria-label="查看版本更新记录"
      @click="showChangelog = true"
    >
      {{ label }}
    </button>

    <ChangelogModal
      :open="showChangelog"
      :current-version="version"
      :build-time="buildTime || undefined"
      @close="showChangelog = false"
    />
  </div>
</template>

<script setup>
const config = useRuntimeConfig()
const showChangelog = ref(false)

const version = computed(() => String(config.public.appVersion || '0.0.0'))
const buildTime = computed(() => {
  const raw = String(config.public.buildTime || '').trim()
  return raw && raw !== 'dev' ? raw : ''
})

const label = computed(() => {
  if (buildTime.value) return `v${version.value} · ${buildTime.value}`
  return `v${version.value}`
})

const tooltip = computed(() => {
  const base = buildTime.value
    ? `前端版本 ${version.value}，构建于 ${buildTime.value}`
    : `前端版本 ${version.value}`
  return `${base} · 点击查看更新记录`
})
</script>

<style scoped>
.app-version-root {
  position: fixed;
  left: 12px;
  bottom: 10px;
  z-index: 9990;
}

.app-version {
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.72);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.2;
  color: var(--text-0);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.app-version:hover {
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.95);
  color: var(--accent-dark);
}

.app-version:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
