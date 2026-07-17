<template>
  <div v-if="hasContent" class="entity-view-strip-root" :class="[theme, { compact, landscape }]">
    <div v-if="showSummary && summaryTags.length" class="entity-view-summary">
      <span v-for="tag in summaryTags" :key="tag" class="entity-view-summary-tag">{{ tag }}</span>
    </div>
    <div class="entity-view-grid">
      <template v-for="view in visibleViews">
        <button
          v-if="clickable"
          :key="view.view_id"
          type="button"
          class="entity-view-card"
          :class="{
            active: isViewSelected(view),
            missing: !view.url,
            readonly: view.readonly,
          }"
          :title="viewTitle(view)"
          @click="$emit('preview', viewPreview(view))"
        >
          <div class="entity-view-card-cover">
            <img v-if="view.url" :src="displaySrc(view.url)" :alt="view.label" loading="lazy" decoding="async" />
            <span v-else class="entity-view-card-empty">待生成</span>
          </div>
          <span class="entity-view-card-label">{{ view.label }}</span>
        </button>
        <div
          v-else
          :key="view.view_id"
          class="entity-view-card"
          :title="view.label"
        >
          <div class="entity-view-card-cover">
            <img :src="displaySrc(view.url)" :alt="view.label" loading="lazy" decoding="async" />
          </div>
          <span class="entity-view-card-label">{{ view.label }}</span>
        </div>
      </template>
      <span v-if="hiddenCount > 0" class="entity-view-more">+{{ hiddenCount }}</span>
    </div>
  </div>
</template>

<script setup>
import { resolveViewPreviewsFromMedia } from '~/utils/entity-view-media.js'
import { mediaDisplayUrl } from '~/utils/media-url.js'

const props = defineProps({
  media: { type: Object, default: null },
  theme: { type: String, default: 'scene' }, // scene | prop
  compact: { type: Boolean, default: false },
  /** 资产库等横屏场景：缩略图 16:9 且标签更宽 */
  landscape: { type: Boolean, default: false },
  clickable: { type: Boolean, default: true },
  showSummary: { type: Boolean, default: true },
  maxVisible: { type: Number, default: 12 },
  isActive: { type: Function, default: null },
  isViewActive: { type: Function, default: null },
})

defineEmits(['preview'])

const viewPreviews = computed(() => resolveViewPreviewsFromMedia(props.media))
const visibleViews = computed(() => viewPreviews.value.slice(0, props.maxVisible))
const hiddenCount = computed(() => Math.max(0, viewPreviews.value.length - props.maxVisible))

const summaryTags = computed(() => {
  const data = props.media
  if (!data) return []
  const tags = []
  const count = data.view_count || viewPreviews.value.length
  if (count > 1) tags.push(`${count}张${props.theme === 'prop' ? '图' : '视角'}`)
  else if (count === 1) tags.push('1张图')
  return tags
})

const hasContent = computed(() => summaryTags.value.length > 0 || visibleViews.value.length > 0)

function displaySrc(url) {
  return mediaDisplayUrl(url)
}

function isViewSelected(view) {
  if (props.isViewActive) return props.isViewActive(view)
  return props.isActive?.(view.url)
}

function viewTitle(view) {
  const extra = view.readonly ? '（只读）' : (!view.url ? '（待生成）' : '')
  return `${view.label}${extra}`
}

function viewPreview(view) {
  return {
    url: view.url,
    label: view.label,
    tag: view.label,
    view_id: view.view_id,
    angle_id: view.view_id,
    readonly: !!view.readonly,
  }
}
</script>

<style scoped>
.entity-view-strip-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.entity-view-strip-root.compact { gap: 4px; }
.entity-view-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.entity-view-summary-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
}
.entity-view-strip-root.scene .entity-view-summary-tag {
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.22);
  color: #1d4ed8;
}
.entity-view-strip-root.prop .entity-view-summary-tag {
  background: rgba(180, 83, 9, 0.08);
  border: 1px solid rgba(180, 83, 9, 0.22);
  color: #b45309;
}
.entity-view-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.entity-view-strip-root.compact .entity-view-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.entity-view-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: transparent;
  cursor: default;
  text-align: center;
}
.entity-view-card[type='button'] { cursor: pointer; }
.entity-view-strip-root.scene .entity-view-card {
  background: rgba(37, 99, 235, 0.04);
}
.entity-view-strip-root.prop .entity-view-card {
  background: rgba(180, 83, 9, 0.04);
}
.entity-view-card:hover {
  border-color: rgba(59, 130, 246, 0.45);
}
.entity-view-card.active {
  border-color: rgba(59, 130, 246, 0.85);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2);
}
.entity-view-card.readonly {
  opacity: 0.88;
  border-style: dashed;
}
.entity-view-card.missing {
  border-style: dashed;
  opacity: 0.72;
}
.entity-view-card-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 9px;
  color: var(--text-dim);
}
.entity-view-card-cover {
  width: 100%;
  aspect-ratio: 1;
  background: #f8fafc;
}
.entity-view-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.entity-view-card-label {
  font-size: 9px;
  line-height: 1.25;
  font-weight: 600;
  padding: 0 3px 4px;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.entity-view-strip-root.scene .entity-view-card-label { color: #1d4ed8; }
.entity-view-strip-root.prop .entity-view-card-label { color: #b45309; }
.entity-view-more {
  align-self: center;
  font-size: 10px;
  color: var(--text-dim);
  padding: 0 4px;
}

.entity-view-strip-root.landscape .entity-view-grid,
.entity-view-strip-root.landscape.compact .entity-view-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.entity-view-strip-root.landscape .entity-view-card-cover {
  aspect-ratio: 16 / 9;
}
</style>
