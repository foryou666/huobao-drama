<template>
  <div class="bgm-page">
    <section class="bgm-hero">
      <div class="bgm-hero-glow" aria-hidden="true" />
      <div class="bgm-hero-inner">
        <p class="bgm-brand">影光工场 · BGM</p>
        <h1 class="bgm-title">背景音乐生成</h1>
        <p class="bgm-lead">用一句话描述情绪与场景，生成可试听的短剧配乐；每次生成附带订单编号与授权证书。</p>

        <div class="bgm-member">
          <div class="bgm-member-item">
            <span class="bgm-member-k">用户名</span>
            <strong>{{ memberProfile.username }}</strong>
          </div>
          <div class="bgm-member-item">
            <span class="bgm-member-k">用户等级</span>
            <strong>{{ memberProfile.member_level }}</strong>
          </div>
          <div class="bgm-member-item bgm-member-wide">
            <span class="bgm-member-k">等级有效期</span>
            <strong>{{ memberProfile.member_level_period }}</strong>
          </div>
        </div>

        <div class="bgm-composer">
          <textarea
            v-model="prompt"
            class="bgm-prompt"
            rows="4"
            :maxlength="promptMaxLength"
            :placeholder="customMode
              ? (instrumental ? '纯音乐：填写风格/场景描述' : '自定义模式：填写歌词（可用 [Verse] [Chorus] 等结构标签）')
              : '例：紧张悬疑氛围，低沉弦乐与轻打击，适合短剧追债对峙，纯器乐'"
          />
          <div class="bgm-prompt-meta">
            <span>{{ prompt.length }}/{{ promptMaxLength }}</span>
            <span v-if="serverState === 'unconfigured'" class="bgm-warn">MiniMax 未配置</span>
            <span v-else-if="serverState === 'checking'">检查配置…</span>
          </div>

          <div class="bgm-styles" :class="{ 'is-open': stylesOpen }">
            <button type="button" class="bgm-styles-toggle" @click="stylesOpen = !stylesOpen">
              <span class="bgm-styles-toggle-main">
                <span class="bgm-styles-toggle-title">风格标签</span>
                <span class="bgm-styles-toggle-path">{{ stylePathLabel }}</span>
                <span v-if="selectedStyleLabel" class="bgm-styles-toggle-pick">{{ selectedStyleLabel }}</span>
              </span>
              <span class="bgm-styles-toggle-action">{{ stylesOpen ? '收起' : '展开' }}</span>
            </button>

            <div v-show="stylesOpen" class="bgm-styles-panel">
              <div class="bgm-style-nav">
                <div class="bgm-style-tabs" role="tablist" aria-label="一级分类">
                  <button
                    v-for="region in styleCatalog"
                    :key="region.id"
                    type="button"
                    class="bgm-style-tab"
                    :class="{ active: activeRegionId === region.id }"
                    @click="activeRegionId = region.id"
                  >
                    {{ region.label }}
                  </button>
                </div>
                <div v-if="activeRegionGroups.length" class="bgm-style-groups" role="tablist" aria-label="二级分类">
                  <button
                    v-for="group in activeRegionGroups"
                    :key="group.id"
                    type="button"
                    class="bgm-style-group"
                    :class="{ active: activeGroupId === group.id }"
                    @click="activeGroupId = group.id"
                  >
                    {{ group.label }}
                  </button>
                </div>
              </div>
              <div class="bgm-style-chips">
                <button
                  v-for="chip in visibleStyleChips"
                  :key="chip.id"
                  type="button"
                  class="bgm-chip"
                  :class="{ active: activeStyles.includes(chip.id) }"
                  :title="chip.text"
                  @click="toggleStyle(chip)"
                >
                  {{ chip.label }}
                </button>
              </div>
            </div>
          </div>

          <div class="bgm-controls">
            <label class="bgm-toggle">
              <input v-model="instrumental" type="checkbox" />
              <span>纯音乐 BGM</span>
            </label>
            <label class="bgm-toggle">
              <input v-model="customMode" type="checkbox" />
              <span>自定义歌词</span>
            </label>
            <select v-model="version" class="bgm-select" title="MiniMax 模型">
              <option v-for="v in versions" :key="v" :value="v">{{ versionLabel(v) }}</option>
            </select>
          </div>

          <div v-if="customMode" class="bgm-custom">
            <input v-model="title" class="bgm-input" type="text" placeholder="曲目标题（可选）" />
            <input v-model="style" class="bgm-input" type="text" placeholder="风格标签，如 cinematic, suspense" />
          </div>

          <label class="bgm-agree">
            <input v-model="agreeTerms" type="checkbox" />
            <span>
              我已阅读并同意
              <NuxtLink to="/music/user-agreement" target="_blank">《用户协议》</NuxtLink>
              与
              <NuxtLink to="/music/ownership" target="_blank">《权属声明》</NuxtLink>
            </span>
          </label>

          <div class="bgm-actions">
            <button type="button" class="btn" :disabled="loading" @click="reload">
              {{ loading ? '刷新中…' : '刷新作品' }}
            </button>
            <button
              type="button"
              class="bgm-generate"
              :disabled="generating || !canGenerate"
              @click="generate"
            >
              <span class="bgm-generate-icon" aria-hidden="true">✦</span>
              {{ generating ? '生成中…' : '生成背景音乐' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="bgm-gallery">
      <div class="bgm-gallery-head">
        <h2>我的作品 / 订单记录</h2>
        <p>每条记录含订单编号；完成后可查看授权证书</p>
      </div>

      <div v-if="loading && !items.length" class="bgm-empty">加载中…</div>
      <div v-else-if="!items.length" class="bgm-empty">
        还没有作品。在上方写下灵感，点「生成背景音乐」开始。
      </div>

      <div v-else class="bgm-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="bgm-card"
          :class="statusClass(item.status)"
        >
          <div class="bgm-card-cover" aria-hidden="true">
            <div class="bgm-wave">
              <span v-for="n in 12" :key="n" />
            </div>
            <span class="bgm-card-status">{{ statusLabel(item.status) }}</span>
          </div>

          <div class="bgm-card-body">
            <div class="bgm-card-top">
              <h3>{{ item.title || `配乐 #${item.id}` }}</h3>
              <div class="bgm-card-tags">
                <span v-if="item.order_no" class="bgm-mini bgm-order">{{ item.order_no }}</span>
                <span v-if="item.version" class="bgm-mini">{{ item.version }}</span>
                <span v-if="item.instrumental" class="bgm-mini">纯音乐</span>
                <span v-if="item.duration_sec" class="bgm-mini">{{ formatSec(item.duration_sec) }}</span>
                <button
                  v-if="item.status === 'completed'"
                  type="button"
                  class="bgm-cert-btn"
                  :disabled="certLoadingId === item.id"
                  @click="openCertificate(item)"
                >
                  {{ certLoadingId === item.id ? '加载中…' : '授权证书' }}
                </button>
                <button
                  v-if="isAdmin && item.status === 'failed'"
                  type="button"
                  class="bgm-delete"
                  :disabled="deletingId === item.id"
                  @click="removeFailed(item)"
                >
                  {{ deletingId === item.id ? '删除中…' : '删除' }}
                </button>
              </div>
            </div>
            <p class="bgm-card-prompt">{{ item.prompt }}</p>
            <p v-if="item.error_msg" class="bgm-card-error">{{ item.error_msg }}</p>

            <div class="bgm-visibility">
              <span class="bgm-visibility-label">可见范围</span>
              <div v-if="isAdmin" class="bgm-visibility-opts" role="group" aria-label="可见范围">
                <button
                  v-for="opt in visibilityOptions"
                  :key="opt.value"
                  type="button"
                  class="bgm-visibility-btn"
                  :class="{ active: (item.visibility || 'public') === opt.value }"
                  :disabled="visibilitySavingId === item.id"
                  @click="changeVisibility(item, opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
              <span v-else class="bgm-visibility-readonly">{{ visibilityLabel(item.visibility) }}</span>
            </div>

            <div v-if="item.clips?.length" class="bgm-clips">
              <div v-for="(clip, idx) in item.clips" :key="idx" class="bgm-clip">
                <div class="bgm-clip-head">
                  <strong>候选 {{ idx + 1 }}{{ clip.title ? ` · ${clip.title}` : '' }}</strong>
                  <span v-if="clip.duration">{{ formatSec(clip.duration) }}</span>
                </div>
                <audio
                  v-if="clip.audio_url || clip.audio_path"
                  :src="mediaDisplayUrl(clip.audio_url || `/${clip.audio_path}`)"
                  controls
                  preload="none"
                  class="bgm-audio"
                />
              </div>
            </div>
            <audio
              v-else-if="item.audio_url"
              :src="mediaDisplayUrl(item.audio_url)"
              controls
              preload="none"
              class="bgm-audio"
            />
          </div>
        </article>
      </div>
    </section>

    <footer class="bgm-footer">
      <p class="bgm-footer-note">生成即产生订单与权属记录。使用前请阅读相关协议。</p>
      <nav class="bgm-footer-links">
        <NuxtLink
          v-for="link in agreementLinks"
          :key="link.to"
          :to="link.to"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>
    </footer>

    <div
      v-if="certificate"
      class="bgm-cert-overlay"
      @click.self="certificate = null"
    >
      <div class="bgm-cert-modal">
        <MusicLicenseCertificate
          :cert="certificate"
          @close="certificate = null"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { musicSunoAPI } from '~/composables/useApi'
import { useAuth } from '~/composables/useAuth'
import { mediaDisplayUrl } from '~/utils/media-url.js'
import {
  MUSIC_STYLE_CATALOG,
  flattenMusicStyleChips,
} from '~/constants/music-style-chips.js'
import {
  MUSIC_AGREEMENT_LINKS,
  MUSIC_MEMBER_LEVEL_END,
  MUSIC_MEMBER_LEVEL_START,
  musicMemberLevelPeriodLabel,
} from '~/constants/music-license.js'
import { toast } from 'vue-sonner'

const { isAdmin, user } = useAuth()
const deletingId = ref(null)
const visibilitySavingId = ref(null)
const certLoadingId = ref(null)
const certificate = ref(null)
const agreeTerms = ref(false)
const agreementLinks = MUSIC_AGREEMENT_LINKS

const memberProfile = computed(() => {
  const username = user.value?.display_name || user.value?.username || '未登录'
  return {
    username,
    member_level: '付费会员',
    member_level_start: MUSIC_MEMBER_LEVEL_START,
    member_level_end: MUSIC_MEMBER_LEVEL_END,
    member_level_period: musicMemberLevelPeriodLabel(),
  }
})

const visibilityOptions = [
  { value: 'private', label: '本人可见' },
  { value: 'team', label: '团队可见' },
  { value: 'public', label: '全站可见' },
]

const styleCatalog = MUSIC_STYLE_CATALOG
const allStyleChips = flattenMusicStyleChips(MUSIC_STYLE_CATALOG)
const activeRegionId = ref(styleCatalog[0]?.id || 'domestic')
const activeGroupId = ref(styleCatalog[0]?.groups?.[0]?.id || 'modern')
const activeStyles = ref([])
const stylesOpen = ref(true)

const loading = ref(false)
const generating = ref(false)
const items = ref([])
const prompt = ref('')
const title = ref('')
const style = ref('')
const version = ref('music-3.0')
const versions = ref(['music-3.0', 'music-2.6', 'music-3.0-free', 'music-2.6-free'])
const versionLabels = ref({
  'music-3.0': 'Music 3.0（推荐）',
  'music-2.6': 'Music 2.6',
  'music-3.0-free': 'Music 3.0 限免',
  'music-2.6-free': 'Music 2.6 限免',
})
const instrumental = ref(true)
const customMode = ref(false)
const serverState = ref('checking')
let pollTimer = null

const promptMaxLength = computed(() => (
  customMode.value && !instrumental.value ? 3500 : 2000
))

const canGenerate = computed(() =>
  prompt.value.trim().length > 0
  && serverState.value === 'ready'
  && agreeTerms.value,
)

function versionLabel(id) {
  return versionLabels.value[id] || id
}

const activeRegionGroups = computed(() =>
  styleCatalog.find(r => r.id === activeRegionId.value)?.groups || [],
)

const visibleStyleChips = computed(() => {
  const group = activeRegionGroups.value.find(g => g.id === activeGroupId.value)
  return group?.chips || []
})

const stylePathLabel = computed(() => {
  const region = styleCatalog.find(r => r.id === activeRegionId.value)
  const group = activeRegionGroups.value.find(g => g.id === activeGroupId.value)
  return [region?.label, group?.label].filter(Boolean).join(' / ')
})

const selectedStyleLabel = computed(() => {
  const id = activeStyles.value[0]
  if (!id) return ''
  return allStyleChips.find(c => c.id === id)?.label || ''
})

watch(activeRegionId, () => {
  const groups = activeRegionGroups.value
  if (!groups.some(g => g.id === activeGroupId.value)) {
    activeGroupId.value = groups[0]?.id || ''
  }
})

function applySelectedPrompts() {
  const texts = allStyleChips
    .filter(c => activeStyles.value.includes(c.id))
    .map(c => c.text)
  if (!texts.length) return
  let next = texts.join('；')
  if (instrumental.value && !/纯器乐|instrumental/i.test(next)) {
    next = `${next}${/[a-z]/i.test(next) ? ', instrumental' : '，纯器乐'}`
  }
  const maxLen = promptMaxLength.value
  if (next.length > maxLen) next = next.slice(0, maxLen)
  // 空提示词，或仍是由标签生成的短内容时，直接写入内置提示词
  if (!prompt.value.trim() || !customMode.value) {
    prompt.value = next
  }
}

function toggleStyle(chip) {
  const idx = activeStyles.value.indexOf(chip.id)
  if (idx >= 0) {
    activeStyles.value.splice(idx, 1)
  } else {
    // 单选写入更稳：点标签即用该标签完整内置提示词
    activeStyles.value = [chip.id]
  }
  applySelectedPrompts()
}

function formatSec(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return ''
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

function statusLabel(status) {
  const map = {
    pending: '排队中',
    processing: '生成中',
    completed: '可试听',
    failed: '失败',
  }
  return map[status] || status || '未知'
}

function statusClass(status) {
  if (status === 'completed') return 'is-ok'
  if (status === 'failed') return 'is-err'
  return 'is-pending'
}

async function checkStatus() {
  try {
    const res = await musicSunoAPI.status()
    serverState.value = res?.state || 'unconfigured'
  } catch {
    serverState.value = 'unconfigured'
  }
}

async function reload() {
  loading.value = true
  try {
    const res = await musicSunoAPI.list({ limit: 50 })
    items.value = res.items || []
    ensurePolling()
  } catch (err) {
    toast.error(err?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function openCertificate(item) {
  if (!item?.id || item.status !== 'completed' || certLoadingId.value) return
  certLoadingId.value = item.id
  try {
    const res = await musicSunoAPI.certificate(item.id)
    certificate.value = res
  } catch (err) {
    toast.error(err?.message || '加载授权证书失败')
  } finally {
    certLoadingId.value = null
  }
}

function hasActiveJobs() {
  return items.value.some(i => i.status === 'pending' || i.status === 'processing')
}

function ensurePolling() {
  if (hasActiveJobs()) {
    if (!pollTimer) {
      pollTimer = setInterval(() => { reloadQuiet() }, 4000)
    }
  } else if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function reloadQuiet() {
  try {
    const res = await musicSunoAPI.list({ limit: 50 })
    items.value = res.items || []
    ensurePolling()
  } catch { /* ignore */ }
}

async function generate() {
  if (!canGenerate.value || generating.value) return
  generating.value = true
  try {
    if (!agreeTerms.value) {
      toast.warning('请先勾选同意《用户协议》与《权属声明》')
      return
    }
    const res = await musicSunoAPI.generate({
      prompt: prompt.value.trim(),
      title: title.value.trim() || undefined,
      style: style.value.trim() || undefined,
      version: version.value,
      instrumental: instrumental.value,
      custom: customMode.value,
      agree_terms: true,
    })
    items.value = [res, ...items.value.filter(i => i.id !== res.id)]
    toast.success(res?.order_no
      ? `已提交（订单 ${res.order_no}），完成后可出具授权证书`
      : '已提交，完成后可出具授权证书')
    ensurePolling()
  } catch (err) {
    toast.error(err?.message || '提交失败')
  } finally {
    generating.value = false
  }
}

async function removeFailed(item) {
  if (!isAdmin.value || item?.status !== 'failed' || deletingId.value) return
  if (!window.confirm(`确认删除失败配乐 #${item.id}？`)) return
  deletingId.value = item.id
  try {
    await musicSunoAPI.delete(item.id)
    items.value = items.value.filter(i => i.id !== item.id)
    toast.success(`已删除 #${item.id}`)
  } catch (err) {
    toast.error(err?.message || '删除失败')
  } finally {
    deletingId.value = null
  }
}

function visibilityLabel(value) {
  return visibilityOptions.find(o => o.value === value)?.label
    || visibilityOptions.find(o => o.value === 'public').label
}

async function changeVisibility(item, visibility) {
  if (!isAdmin.value || !item?.id || visibilitySavingId.value) return
  if ((item.visibility || 'public') === visibility) return
  visibilitySavingId.value = item.id
  try {
    const res = await musicSunoAPI.setVisibility(item.id, visibility)
    const next = res?.visibility || visibility
    items.value = items.value.map(i => (i.id === item.id ? { ...i, ...res, visibility: next } : i))
    toast.success(`已设为${visibilityLabel(next)}`)
  } catch (err) {
    toast.error(err?.message || '设置失败')
  } finally {
    visibilitySavingId.value = null
  }
}

onMounted(async () => {
  try {
    const meta = await musicSunoAPI.meta()
    if (Array.isArray(meta?.versions) && meta.versions.length) {
      versions.value = meta.versions
    }
    if (meta?.version_labels && typeof meta.version_labels === 'object') {
      versionLabels.value = { ...versionLabels.value, ...meta.version_labels }
    }
    if (meta?.default_version) version.value = meta.default_version
  } catch { /* ignore */ }
  await checkStatus()
  await reload()
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style scoped>
.bgm-agree {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 2px 4px;
  font-size: 13px;
  color: var(--bgm-muted);
  cursor: pointer;
}
.bgm-agree input { margin-top: 2px; }
.bgm-agree a {
  color: var(--bgm-accent-deep);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.bgm-order {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: -0.02em;
}
.bgm-cert-btn {
  border: 1px solid rgba(47, 109, 246, 0.35);
  background: rgba(47, 109, 246, 0.08);
  color: var(--bgm-accent-deep);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}
.bgm-cert-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.bgm-footer {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 24px 48px;
  text-align: center;
}
.bgm-footer-note {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--bgm-muted);
}
.bgm-footer-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
}
.bgm-footer-links a {
  color: var(--bgm-accent-deep);
  font-size: 13px;
  text-decoration: none;
}
.bgm-footer-links a:hover { text-decoration: underline; }

.bgm-cert-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(12, 18, 30, 0.55);
  backdrop-filter: blur(4px);
  overflow: auto;
  padding: 20px 12px 32px;
}
.bgm-cert-modal {
  width: max-content;
  max-width: none;
  margin: 0 auto;
  background: #f4f1ea;
  border-radius: 14px;
  padding: 14px 14px 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
}

.bgm-page {
  --bgm-ink: #152033;
  --bgm-muted: #5b6b84;
  --bgm-line: rgba(40, 64, 104, 0.14);
  --bgm-panel: rgba(255, 255, 255, 0.82);
  --bgm-accent: #2f6df6;
  --bgm-accent-deep: #1f4fc0;
  /* layout 的 .content > * 是 flex column + max-height:100%；必须自身滚动，否则 hero 被压扁裁掉输入区 */
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  color: var(--bgm-ink);
}

.bgm-hero {
  position: relative;
  flex: 0 0 auto;
  overflow: visible;
  padding: 48px 24px 36px;
  background:
    radial-gradient(1200px 420px at 18% -10%, rgba(79, 140, 255, 0.28), transparent 55%),
    radial-gradient(900px 360px at 88% 0%, rgba(120, 180, 255, 0.18), transparent 50%),
    linear-gradient(180deg, #eef4ff 0%, #f7f9fc 55%, #f3f6fb 100%);
  border-bottom: 1px solid var(--bgm-line);
}

.bgm-hero-glow {
  position: absolute;
  inset: auto 10% -40% 10%;
  height: 220px;
  background: radial-gradient(ellipse at center, rgba(47, 109, 246, 0.16), transparent 70%);
  pointer-events: none;
  animation: bgm-pulse 6s ease-in-out infinite;
}

.bgm-hero-inner {
  position: relative;
  max-width: 880px;
  margin: 0 auto;
}

.bgm-brand {
  font-family: var(--font-display);
  font-size: 13px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--bgm-accent-deep);
  margin-bottom: 10px;
}

.bgm-title {
  font-family: var(--font-display);
  font-size: clamp(36px, 5vw, 52px);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
}

.bgm-lead {
  font-size: 16px;
  color: var(--bgm-muted);
  margin: 0 0 20px;
  max-width: 36em;
}

.bgm-member {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 22px;
}
.bgm-member-item {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--bgm-line);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bgm-member-k {
  font-size: 12px;
  color: var(--bgm-muted);
}
.bgm-member-item strong {
  font-size: 14px;
  font-weight: 650;
  word-break: break-all;
}
@media (max-width: 720px) {
  .bgm-member { grid-template-columns: 1fr; }
}

.bgm-composer {
  background: var(--bgm-panel);
  border: 1px solid var(--bgm-line);
  border-radius: 22px;
  padding: 18px 18px 16px;
  box-shadow: 0 18px 48px rgba(60, 90, 140, 0.12);
  backdrop-filter: blur(10px);
  animation: bgm-rise 0.55s ease-out both;
}

.bgm-prompt {
  width: 100%;
  border: none;
  resize: vertical;
  min-height: 110px;
  font-size: 16px;
  line-height: 1.55;
  color: var(--bgm-ink);
  background: transparent;
  font-family: var(--font-body);
  outline: none;
}

.bgm-prompt-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--bgm-muted);
  margin: 4px 0 14px;
}

.bgm-warn { color: #c0392b; }

.bgm-styles {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 12px;
  border: 1px solid var(--bgm-line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.55);
  overflow: hidden;
}

.bgm-styles-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  color: var(--bgm-ink);
}

.bgm-styles-toggle:hover {
  background: rgba(47, 109, 246, 0.04);
}

.bgm-styles-toggle-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bgm-styles-toggle-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--bgm-ink);
}

.bgm-styles-toggle-path {
  font-size: 12px;
  color: var(--bgm-muted);
}

.bgm-styles-toggle-pick {
  font-size: 12px;
  color: var(--bgm-accent-deep);
  background: rgba(47, 109, 246, 0.1);
  border-radius: 999px;
  padding: 2px 8px;
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bgm-styles-toggle-action {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--bgm-accent-deep);
  font-weight: 600;
}

.bgm-styles-panel {
  padding: 0 10px 10px;
  border-top: 1px solid var(--bgm-line);
}

.bgm-style-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 8px 0 6px;
}

.bgm-style-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: #eaf0fa;
  flex-shrink: 0;
}

.bgm-style-tab {
  border: none;
  background: transparent;
  color: var(--bgm-muted);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.bgm-style-tab.active {
  background: #fff;
  color: var(--bgm-accent-deep);
  box-shadow: 0 1px 3px rgba(40, 64, 104, 0.1);
}

.bgm-style-groups {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  overflow-x: auto;
  min-width: 0;
  scrollbar-width: none;
}

.bgm-style-groups::-webkit-scrollbar { display: none; }

.bgm-style-group {
  border: 1px solid transparent;
  background: transparent;
  color: var(--bgm-muted);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.bgm-style-group:hover {
  color: var(--bgm-ink);
  background: rgba(255, 255, 255, 0.7);
}

.bgm-style-group.active {
  color: var(--bgm-accent-deep);
  background: rgba(47, 109, 246, 0.1);
  border-color: rgba(47, 109, 246, 0.28);
  font-weight: 600;
}

.bgm-style-chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.bgm-chip {
  border: 1px solid var(--bgm-line);
  background: #fff;
  color: var(--bgm-ink);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.bgm-chip:hover {
  border-color: rgba(47, 109, 246, 0.35);
}

.bgm-chip.active {
  background: rgba(47, 109, 246, 0.1);
  border-color: rgba(47, 109, 246, 0.45);
  color: var(--bgm-accent-deep);
  font-weight: 600;
}

.bgm-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  margin-bottom: 12px;
}

.bgm-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--bgm-muted);
  cursor: pointer;
}

.bgm-select,
.bgm-input {
  height: 36px;
  border: 1px solid var(--bgm-line);
  border-radius: 10px;
  padding: 0 12px;
  background: #fff;
  color: var(--bgm-ink);
  font-size: 13px;
}

.bgm-custom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.bgm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  align-items: center;
  padding-top: 4px;
}

.bgm-generate {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 999px;
  padding: 12px 22px;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6b9bff 0%, #2f6df6 48%, #1f4fc0 100%);
  box-shadow: 0 10px 24px rgba(47, 109, 246, 0.28);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}

.bgm-generate:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(47, 109, 246, 0.34);
}

.bgm-generate:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.bgm-generate-icon {
  display: inline-block;
  animation: bgm-spark 2.4s ease-in-out infinite;
}

.bgm-gallery {
  flex: 0 0 auto;
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  padding: 36px 24px 64px;
}

.bgm-gallery-head {
  margin-bottom: 20px;
}

.bgm-gallery-head h2 {
  font-family: var(--font-display);
  font-size: 28px;
  margin: 0 0 6px;
}

.bgm-gallery-head p {
  margin: 0;
  color: var(--bgm-muted);
  font-size: 14px;
}

.bgm-empty {
  border: 1px dashed var(--bgm-line);
  border-radius: 16px;
  padding: 36px 20px;
  text-align: center;
  color: var(--bgm-muted);
  background: rgba(255, 255, 255, 0.55);
}

.bgm-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.bgm-card {
  display: grid;
  grid-template-columns: 132px 1fr;
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--bgm-line);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(60, 90, 140, 0.08);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.bgm-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 30px rgba(60, 90, 140, 0.12);
}

.bgm-card-cover {
  position: relative;
  min-height: 160px;
  background:
    linear-gradient(160deg, rgba(47, 109, 246, 0.9), rgba(24, 48, 96, 0.92)),
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.25), transparent 45%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.bgm-card.is-err .bgm-card-cover {
  background: linear-gradient(160deg, #a85a6a, #5a2a36);
}

.bgm-card.is-pending .bgm-card-cover {
  background: linear-gradient(160deg, #6f86ad, #364866);
}

.bgm-wave {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 42px;
}

.bgm-wave span {
  width: 4px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.85);
  animation: bgm-bar 1.2s ease-in-out infinite;
}

.bgm-wave span:nth-child(odd) { height: 18px; animation-delay: 0.05s; }
.bgm-wave span:nth-child(even) { height: 32px; animation-delay: 0.18s; }
.bgm-wave span:nth-child(3n) { height: 24px; animation-delay: 0.3s; }

.bgm-card-status {
  position: absolute;
  left: 10px;
  bottom: 10px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 999px;
  padding: 3px 8px;
}

.bgm-card-body {
  padding: 14px 16px 16px;
  min-width: 0;
}

.bgm-card-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 6px;
}

.bgm-card-top h3 {
  margin: 0;
  font-size: 16px;
  font-family: var(--font-display);
}

.bgm-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.bgm-mini {
  font-size: 11px;
  color: var(--bgm-muted);
  background: #f1f5fb;
  border-radius: 999px;
  padding: 2px 8px;
}

.bgm-delete {
  border: 1px solid rgba(192, 57, 43, 0.35);
  background: #fff5f4;
  color: #c0392b;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
  line-height: 1.4;
}

.bgm-delete:hover:not(:disabled) {
  background: #fde8e6;
}

.bgm-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.bgm-card-prompt {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--bgm-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bgm-card-error {
  margin: 0 0 8px;
  color: #c0392b;
  font-size: 12px;
}

.bgm-visibility {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}

.bgm-visibility-label {
  font-size: 12px;
  color: var(--bgm-muted);
  flex-shrink: 0;
}

.bgm-visibility-opts {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: #f1f5fb;
}

.bgm-visibility-btn {
  border: none;
  background: transparent;
  color: var(--bgm-muted);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.3;
}

.bgm-visibility-btn:hover:not(:disabled) {
  color: var(--bgm-ink);
  background: rgba(255, 255, 255, 0.7);
}

.bgm-visibility-btn.active {
  background: #fff;
  color: var(--bgm-accent-deep);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(40, 64, 104, 0.12);
}

.bgm-visibility-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.bgm-visibility-readonly {
  font-size: 12px;
  color: var(--bgm-ink);
  background: #f1f5fb;
  border-radius: 999px;
  padding: 4px 10px;
}

.bgm-clips {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bgm-clip-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--bgm-muted);
  margin-bottom: 4px;
}

.bgm-audio {
  width: 100%;
  height: 36px;
}

@keyframes bgm-rise {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes bgm-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.98); }
  50% { opacity: 1; transform: scale(1.02); }
}

@keyframes bgm-spark {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.9; }
  50% { transform: scale(1.15) rotate(12deg); opacity: 1; }
}

@keyframes bgm-bar {
  0%, 100% { transform: scaleY(0.55); }
  50% { transform: scaleY(1); }
}

@media (max-width: 860px) {
  .bgm-grid { grid-template-columns: 1fr; }
  .bgm-card { grid-template-columns: 1fr; }
  .bgm-card-cover { min-height: 120px; }
  .bgm-custom { grid-template-columns: 1fr; }
  .bgm-actions { flex-direction: column-reverse; align-items: stretch; }
  .bgm-generate { justify-content: center; }
}
</style>
