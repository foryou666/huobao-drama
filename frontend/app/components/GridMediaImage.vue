<template>
  <img
    v-if="resolvedSrc"
    :src="resolvedSrc"
    :alt="alt"
    loading="lazy"
    decoding="async"
    class="grid-media-image"
    :class="fitClass"
    @error="onError"
  />
  <div v-else class="grid-media-empty">{{ placeholder }}</div>
</template>

<script setup>
import { mediaGridUrl, normalizeMediaPath, thumbPathFromSource } from '~/utils/media-url.js'

const props = defineProps({
  src: { type: String, default: '' },
  thumb: { type: String, default: '' },
  alt: { type: String, default: '' },
  fit: { type: String, default: 'cover' },
  placeholder: { type: String, default: '' },
})

const failed = ref(false)
const useFullFallback = ref(false)

const resolvedSrc = computed(() => {
  if (failed.value) return ''
  if (useFullFallback.value) {
    return mediaGridUrl(props.src)
  }
  return mediaGridUrl(props.src, props.thumb)
})

const fitClass = computed(() => `is-${props.fit || 'cover'}`)

watch(() => [props.src, props.thumb], () => {
  failed.value = false
  useFullFallback.value = false
})

function onError() {
  const hasThumb = !!(normalizeMediaPath(props.thumb) || thumbPathFromSource(props.src))
  if (hasThumb && !useFullFallback.value) {
    useFullFallback.value = true
    return
  }
  failed.value = true
}
</script>

<style scoped>
.grid-media-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  background: var(--bg-3, #f0f0f0);
}

.grid-media-image.is-contain {
  object-fit: contain;
}

.grid-media-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: var(--text-3, #999);
  background: var(--bg-3, #f0f0f0);
}
</style>
