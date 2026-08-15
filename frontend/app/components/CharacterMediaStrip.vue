<template>

  <div v-if="hasContent" class="char-media-strip-root" :class="{ compact, readonly, 'is-outfits': useOutfitLayout, landscape }">

    <div v-if="showSummary && summaryTags.length" class="char-media-summary">

      <span v-for="tag in summaryTags" :key="tag" class="char-media-summary-tag">{{ tag }}</span>

    </div>



    <!-- 按服装分组：每套服装一张定稿缩略图 + 名称 -->

    <template v-if="useOutfitLayout">

      <div v-if="showBaseline" class="char-media-baseline">

        <button

          v-if="clickable"

          type="button"

          class="char-media-chip is-primary"

          title="角色基准图"

          @click="emitPreview(baselinePreview)"

        >

          <img :src="displaySrc(baselinePreview.url)" alt="基准" loading="lazy" decoding="async" />

          <span class="char-media-chip-label">基准</span>
          <span v-if="baselineCertified" class="char-media-portrait-badge" title="方舟虚拟人像已认证，通道2提交时使用认证资产">已认证</span>

        </button>

        <div v-else class="char-media-chip is-primary" title="角色基准图">

          <img :src="displaySrc(baselinePreview.url)" alt="基准" loading="lazy" decoding="async" />

          <span class="char-media-chip-label">基准</span>
          <span v-if="baselineCertified" class="char-media-portrait-badge" title="方舟虚拟人像已认证，通道2提交时使用认证资产">已认证</span>

        </div>

      </div>



      <div class="char-outfit-grid">

        <template v-for="outfit in visibleOutfits">

          <button

            v-if="clickable"

            :key="outfit.outfit_id"

            type="button"

            class="char-outfit-card"

            :class="{ active: isOutfitActive(outfit) || expandedOutfitId === outfit.outfit_id, selectable: expandable }"

            :title="outfitTitle(outfit)"

            @click="onOutfitClick(outfit)"

          >

            <div class="char-outfit-card-cover">

              <img :src="displaySrc(outfit.url)" :alt="outfit.label" loading="lazy" decoding="async" />

              <span v-if="isOutfitPortraitActive(outfit)" class="char-media-portrait-badge">已认证</span>

              <span v-if="outfit.candidate_count > 1" class="char-outfit-count">{{ outfit.candidate_count }}</span>

            </div>

            <span class="char-outfit-card-label">{{ outfit.label }}</span>

          </button>

          <div

            v-else

            :key="outfit.outfit_id"

            class="char-outfit-card"

            :title="outfitTitle(outfit)"

          >

            <div class="char-outfit-card-cover">

              <img :src="displaySrc(outfit.url)" :alt="outfit.label" loading="lazy" decoding="async" />

              <span v-if="isOutfitPortraitActive(outfit)" class="char-media-portrait-badge">已认证</span>

              <span v-if="outfit.candidate_count > 1" class="char-outfit-count">{{ outfit.candidate_count }}</span>

            </div>

            <span class="char-outfit-card-label">{{ outfit.label }}</span>

          </div>

        </template>

        <span v-if="hiddenOutfitCount > 0" class="char-media-more">+{{ hiddenOutfitCount }}套</span>

      </div>



      <div v-if="expandedOutfit && expandedOutfit.candidates?.length > 1" class="char-outfit-expanded">

        <div class="char-outfit-expanded-head">

          <span class="char-outfit-expanded-name">{{ expandedOutfit.label }}</span>

          <span class="dim">{{ pickDefaultOnClick ? '点击备选图切换造型' : '点击切换预览' }}</span>

        </div>

        <div class="char-outfit-candidate-strip">

          <template v-for="candidate in expandedOutfit.candidates">

            <button

              v-if="clickable"

              :key="`${expandedOutfit.outfit_id}:${candidate.id}`"

              type="button"

              class="char-media-chip"

              :class="{ 'is-outfit-default': candidate.is_default }"

              :title="`${expandedOutfit.label} · ${candidate.label}`"

              @click="emitPreview(candidatePreview(expandedOutfit, candidate))"

            >

              <img :src="displaySrc(candidate.url)" :alt="candidate.label" loading="lazy" decoding="async" />

              <span class="char-media-chip-label">{{ candidate.is_default ? '定稿' : candidate.label }}</span>

            </button>

            <div

              v-else

              :key="`${expandedOutfit.outfit_id}:${candidate.id}`"

              class="char-media-chip"

              :class="{ 'is-outfit-default': candidate.is_default }"

              :title="`${expandedOutfit.label} · ${candidate.label}`"

            >

              <img :src="displaySrc(candidate.url)" :alt="candidate.label" loading="lazy" decoding="async" />

              <span class="char-media-chip-label">{{ candidate.is_default ? '定稿' : candidate.label }}</span>

            </div>

          </template>

        </div>

      </div>

    </template>



    <!-- 扁平列表（无服装分组时） -->

    <div v-else-if="visibleImages.length" class="char-media-strip">

      <template v-for="img in visibleImages">

        <button

          v-if="clickable"

          :key="img.url"

          type="button"

          class="char-media-chip"

          :class="chipClass(img)"

          :title="chipTitle(img)"

          @click="emitPreview(img)"

        >

          <img :src="displaySrc(img.url)" :alt="img.tag || characterImageTagLabel(img, { short: true })" loading="lazy" decoding="async" />

          <span class="char-media-chip-label">{{ img.tag || characterImageTagLabel(img, { short: true }) }}</span>
          <span v-if="imageCertified(img)" class="char-media-portrait-badge">已认证</span>

        </button>

        <div

          v-else

          :key="img.url"

          class="char-media-chip"

          :class="chipClass(img)"

          :title="chipTitle(img)"

        >

          <img :src="displaySrc(img.url)" :alt="img.tag || characterImageTagLabel(img, { short: true })" loading="lazy" decoding="async" />

          <span class="char-media-chip-label">{{ img.tag || characterImageTagLabel(img, { short: true }) }}</span>
          <span v-if="imageCertified(img)" class="char-media-portrait-badge">已认证</span>

        </div>

      </template>

      <span v-if="hiddenCount > 0" class="char-media-more">+{{ hiddenCount }}</span>

    </div>

  </div>

</template>



<script setup>

import {

  summarizeCharacterMedia,

  listCharacterImages,

  listCharacterOutfitPreviews,

  resolveOutfitPreviewsFromMedia,

  characterImageTagLabel,

  characterImageTagType,

} from '~/utils/character-image-variants.js'

import { mediaDisplayUrl } from '~/utils/media-url.js'
import { isCharacterPortraitActive, isCertifiedPortraitImage, isOutfitPortraitActive } from '~/utils/portrait-status.js'



const props = defineProps({

  char: { type: Object, default: null },

  media: { type: Object, default: null },

  images: { type: Array, default: null },

  layout: { type: String, default: 'auto' }, // auto | flat | outfits

  compact: { type: Boolean, default: false },

  /** 资产库等横屏场景：缩略图 16:9 且标签更宽 */
  landscape: { type: Boolean, default: false },

  readonly: { type: Boolean, default: true },

  clickable: { type: Boolean, default: true },

  expandable: { type: Boolean, default: true },

  /** 为 true 时点击服装卡片会先选中该套定稿图（用于视频分镜选造型） */
  pickDefaultOnClick: { type: Boolean, default: false },

  showSummary: { type: Boolean, default: true },

  maxVisible: { type: Number, default: 8 },

  isActive: { type: Function, default: null },

})



const emit = defineEmits(['preview'])



const expandedOutfitId = ref(null)



const summary = computed(() => {

  if (props.media) return props.media

  if (props.char) return summarizeCharacterMedia(props.char)

  return null

})



const outfitPreviews = computed(() => {

  if (props.media) return resolveOutfitPreviewsFromMedia(props.media)

  if (props.char) return listCharacterOutfitPreviews(props.char)

  return []

})



const useOutfitLayout = computed(() => {

  if (props.layout === 'flat') return false

  if (props.layout === 'outfits') return outfitPreviews.value.length > 0

  return outfitPreviews.value.length > 0

})



const imageList = computed(() => {

  if (props.images?.length) return props.images

  if (props.media?.preview_images?.length) return props.media.preview_images

  if (props.char) {

    return listCharacterImages(props.char).map(item => ({

      ...item,

      tag: characterImageTagLabel(item, { short: true }),

      tag_type: characterImageTagType(item),

    }))

  }

  return []

})



const visibleImages = computed(() => imageList.value.slice(0, props.maxVisible))

const hiddenCount = computed(() => Math.max(0, imageList.value.length - props.maxVisible))



const visibleOutfits = computed(() => outfitPreviews.value.slice(0, props.maxVisible))

const hiddenOutfitCount = computed(() => Math.max(0, outfitPreviews.value.length - props.maxVisible))



const expandedOutfit = computed(() =>

  outfitPreviews.value.find(item => item.outfit_id === expandedOutfitId.value) || null,

)



const baselinePreview = computed(() => {

  const url = summary.value?.primary_url

  if (!url) return null

  return { url, label: '基准', tag: '基准', tag_type: 'primary', variant: 'primary' }

})



const showBaseline = computed(() => {

  if (!baselinePreview.value?.url) return false

  const primary = String(baselinePreview.value.url).trim()

  return !outfitPreviews.value.some(outfit => String(outfit.url).trim() === primary)

})

const baselineCertified = computed(() => {
  const source = portraitCharSource.value
  if (!source || !baselinePreview.value?.url) return false
  return isCertifiedPortraitImage(source, baselinePreview.value.url)
})

function imageCertified(img) {
  const source = portraitCharSource.value
  if (!source || !img?.url) return false
  return isCertifiedPortraitImage(source, img.url)
}

function chipTitle(img) {
  if (imageCertified(img)) return '方舟虚拟人像已认证，通道2提交时使用认证资产'
  if (img?.variant === 'primary' || img?.source === 'primary' || img?.tag_type === 'primary') {
    return isCharacterPortraitActive(portraitCharSource.value)
      ? '基准图'
      : '基准图（未认证虚拟人像）'
  }
  return img?.label || img?.tag || '造型定稿（可单独认证虚拟人像）'
}

const portraitCharSource = computed(() => {
  if (props.char) return props.char
  if (!props.media) return null
  return {
    image_url: props.media.primary_url || props.media.primaryUrl,
    imageUrl: props.media.primary_url || props.media.primaryUrl,
    seedance_asset_id: props.media.seedance_asset_id || props.media.seedanceAssetId,
    seedance_asset_status: props.media.seedance_asset_status || props.media.seedanceAssetStatus,
    seedanceAssetId: props.media.seedance_asset_id || props.media.seedanceAssetId,
    seedanceAssetStatus: props.media.seedance_asset_status || props.media.seedanceAssetStatus,
    character_media: props.media,
    characterMedia: props.media,
  }
})



const summaryTags = computed(() => {

  const data = summary.value

  if (!data) return []

  const tags = []

  if (data.outfit_count > 0) tags.push(`${data.outfit_count}套服装`)

  else if (data.image_count) tags.push(`${data.image_count}张图`)

  if (data.candidate_count > 0) tags.push(`${data.candidate_count}张备选`)

  if (data.transform_count) tags.push(`${data.transform_count}个风格`)

  return tags

})



const hasContent = computed(() =>

  summaryTags.value.length > 0

  || visibleImages.value.length > 0

  || visibleOutfits.value.length > 0,

)



watch(() => [props.char?.id, props.media?.outfit_count], () => {

  expandedOutfitId.value = null

})



function displaySrc(url) {

  return mediaDisplayUrl(url)

}



function chipClass(img) {

  return [

    `is-${img.tag_type || characterImageTagType(img)}`,

    { active: props.isActive?.(img.url) },

  ]

}



function outfitTitle(outfit) {
  const extra = outfit.candidate_count > 1 ? `（${outfit.candidate_count}张备选）` : ''
  const cert = isOutfitPortraitActive(outfit) ? ' ·已认证' : ''
  return `${outfit.label}${extra}${cert}`
}

function isOutfitActive(outfit) {

  if (!props.isActive || !outfit) return false

  if (props.isActive(outfit.url)) return true

  return (outfit.candidates || []).some(candidate => props.isActive(candidate.url))

}

function outfitDefaultPreview(outfit) {

  return {

    url: outfit.url,

    label: `${outfit.label} · 定稿`,

    tag: `${outfit.label}·定稿`,

    tag_type: 'outfit-default',

    outfit_id: outfit.outfit_id,

    is_default: true,

  }

}



function candidatePreview(outfit, candidate) {

  return {

    url: candidate.url,

    label: `${outfit.label} · ${candidate.label}`,

    tag: candidate.is_default ? `${outfit.label}·定稿` : candidate.label,

    tag_type: candidate.is_default ? 'outfit-default' : 'outfit-candidate',

    outfit_id: outfit.outfit_id,

    is_default: candidate.is_default,

  }

}



function emitPreview(img) {

  if (!img?.url) return

  emit('preview', img)

}



function onOutfitClick(outfit) {

  if (props.pickDefaultOnClick) {

    emitPreview(outfitDefaultPreview(outfit))

  }

  if (props.expandable && outfit.candidate_count > 1) {

    expandedOutfitId.value = expandedOutfitId.value === outfit.outfit_id ? null : outfit.outfit_id

    return

  }

  if (!props.pickDefaultOnClick) {

    emitPreview(outfitDefaultPreview(outfit))

  }

}

</script>



<style scoped>

.char-media-strip-root {

  display: flex;

  flex-direction: column;

  gap: 6px;

}

.char-media-strip-root.compact {

  gap: 4px;

}

.char-media-summary {

  display: flex;

  flex-wrap: wrap;

  gap: 4px;

}

.char-media-summary-tag {

  display: inline-flex;

  align-items: center;

  padding: 2px 8px;

  border-radius: 999px;

  background: rgba(37, 99, 235, 0.08);

  border: 1px solid rgba(37, 99, 235, 0.22);

  font-size: 10px;

  color: #1d4ed8;

  font-weight: 600;

  line-height: 1.4;

}

.char-media-baseline {

  display: flex;

}

.char-outfit-grid {

  display: grid;

  grid-template-columns: repeat(4, minmax(0, 1fr));

  gap: 6px;

  align-items: start;

}

.char-media-strip-root.compact .char-outfit-grid {

  grid-template-columns: repeat(3, minmax(0, 1fr));

  gap: 4px;

}

.char-outfit-card {

  display: flex;

  flex-direction: column;

  gap: 3px;

  padding: 0;

  border: 1px solid var(--border);

  border-radius: 8px;

  overflow: hidden;

  background: rgba(15, 118, 110, 0.04);

  cursor: default;

  text-align: center;

}

.char-outfit-card[type='button'],

.char-media-strip-root:not(.readonly) .char-outfit-card {

  cursor: pointer;

}

.char-outfit-card:hover {

  border-color: rgba(15, 118, 110, 0.45);

}

.char-outfit-card.active {

  border-color: rgba(15, 118, 110, 0.85);

  box-shadow: 0 0 0 1px rgba(15, 118, 110, 0.2);

}

.char-outfit-card-cover {

  position: relative;

  width: 100%;

  aspect-ratio: 1;

  background: #f8fafc;

}

.char-outfit-card-cover img {

  width: 100%;

  height: 100%;

  object-fit: cover;

  display: block;

}

.char-outfit-count {

  position: absolute;

  right: 3px;

  bottom: 3px;

  min-width: 16px;

  height: 16px;

  padding: 0 4px;

  border-radius: 999px;

  background: rgba(15, 23, 42, 0.72);

  color: #fff;

  font-size: 9px;

  font-weight: 700;

  line-height: 16px;

  text-align: center;

}

.char-outfit-card-label {

  font-size: 9px;

  line-height: 1.25;

  color: #0f766e;

  font-weight: 600;

  padding: 0 3px 4px;

  word-break: break-all;

  display: -webkit-box;

  -webkit-line-clamp: 2;

  -webkit-box-orient: vertical;

  overflow: hidden;

}

.char-outfit-expanded {

  display: flex;

  flex-direction: column;

  gap: 4px;

  padding: 6px;

  border-radius: 8px;

  background: rgba(15, 118, 110, 0.05);

  border: 1px dashed rgba(15, 118, 110, 0.25);

}

.char-outfit-expanded-head {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 8px;

  font-size: 10px;

}

.char-outfit-expanded-name {

  font-weight: 600;

  color: #0f766e;

}

.char-outfit-candidate-strip {

  display: flex;

  flex-wrap: wrap;

  gap: 4px;

}

.char-media-strip {

  display: flex;

  flex-wrap: wrap;

  gap: 6px;

  align-items: flex-start;

}

.char-media-strip-root.compact .char-media-strip {

  gap: 4px;

}

.char-media-chip {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 52px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: transparent;
  cursor: default;
  align-items: center;
}

.char-media-portrait-badge {
  position: absolute;
  top: 3px;
  left: 3px;
  z-index: 2;
  font-size: 9px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.92);
  color: #fff;
  font-weight: 700;
  pointer-events: none;
}

.char-media-strip-root:not(.readonly) .char-media-chip,

.char-media-chip[type='button'] {

  cursor: pointer;

}

.char-media-chip:hover {

  border-color: rgba(59, 130, 246, 0.45);

}

.char-media-chip.active {

  border-color: rgba(59, 130, 246, 0.85);

  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.25);

}

.char-media-chip img {

  width: 52px;

  height: 52px;

  object-fit: cover;

  display: block;

}

.char-media-strip-root.compact .char-media-chip,

.char-media-strip-root.compact .char-media-chip img {

  width: 44px;

}

.char-media-strip-root.compact .char-media-chip img {

  height: 44px;

}

.char-media-chip-label {

  font-size: 9px;

  line-height: 1.2;

  text-align: center;

  color: var(--text-dim);

  padding: 0 2px 3px;

  word-break: break-all;

}

.char-media-chip.is-primary .char-media-chip-label { color: #2563eb; }

.char-media-chip.is-outfit-default .char-media-chip-label { color: #0f766e; font-weight: 600; }

.char-media-chip.is-outfit-candidate .char-media-chip-label { color: #7c3aed; }

.char-media-chip.is-transform .char-media-chip-label { color: #b45309; }

.char-media-more {

  align-self: center;

  font-size: 10px;

  color: var(--text-dim);

  padding: 0 4px;

}

.char-media-strip-root.landscape .char-outfit-grid,
.char-media-strip-root.landscape.compact .char-outfit-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.char-media-strip-root.landscape .char-outfit-card-cover {
  aspect-ratio: 16 / 9;
}

.char-media-strip-root.landscape .char-media-chip,
.char-media-strip-root.landscape .char-media-chip img {
  width: 76px;
}

.char-media-strip-root.landscape.compact .char-media-chip,
.char-media-strip-root.landscape.compact .char-media-chip img {
  width: 68px;
}

.char-media-strip-root.landscape .char-media-chip img {
  height: auto;
  aspect-ratio: 16 / 9;
}

</style>

