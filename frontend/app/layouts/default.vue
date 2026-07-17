<template>
  <div class="shell">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <button class="brand" @click="navigateTo('/')">
          <div class="brand-mark">
            <img v-if="showBrandImage" :src="brandLogo" alt="红果短剧" class="brand-logo" @error="showBrandImage = false" />
            <span v-else class="brand-fallback">红</span>
          </div>
          <div class="brand-text">
            <span class="brand-name">红果短剧</span>
            <span class="brand-sub">Hongguo Shorts</span>
          </div>
        </button>
      </div>

      <nav class="header-nav">
        <NuxtLink to="/" class="nav-link" :class="{ active: route.path === '/' }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          <span>项目</span>
        </NuxtLink>
        <NuxtLink to="/canvas" class="nav-link" :class="{ active: route.path.startsWith('/canvas') }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
          <span>画布</span>
        </NuxtLink>
        <NuxtLink to="/assets" class="nav-link" :class="{ active: route.path.startsWith('/assets') }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <path d="M3 14h7v7H3z"/><path d="M14 14h7v7h-7z"/>
          </svg>
          <span>资产库</span>
        </NuxtLink>
        <div
          ref="videoNavRef"
          class="nav-dropdown"
          :class="{ open: videoMenuOpen, active: isVideoRoute }"
        >
          <button
            type="button"
            class="nav-link nav-dropdown-trigger"
            :class="{ active: isVideoRoute }"
            aria-haspopup="menu"
            :aria-expanded="videoMenuOpen"
            @click="toggleVideoMenu"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <span>视频生成</span>
            <svg class="nav-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div v-if="videoMenuOpen" class="nav-dropdown-menu" role="menu">
            <NuxtLink
              v-for="item in videoNavItems"
              :key="item.to"
              :to="item.to"
              class="nav-dropdown-item"
              :class="{ active: route.path === item.to }"
              role="menuitem"
              @click="videoMenuOpen = false"
            >
              <span class="nav-dropdown-item-label">{{ item.label }}</span>
              <span v-if="item.refHint" class="nav-dropdown-item-ref">{{ item.refHint }}</span>
            </NuxtLink>
          </div>
        </div>
        <div
          ref="toolboxNavRef"
          class="nav-dropdown"
          :class="{ open: toolboxMenuOpen, active: isToolboxRoute }"
        >
          <button
            type="button"
            class="nav-link nav-dropdown-trigger"
            :class="{ active: isToolboxRoute }"
            aria-haspopup="menu"
            :aria-expanded="toolboxMenuOpen"
            @click="toggleToolboxMenu"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
            <span>工具箱</span>
            <svg class="nav-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div v-if="toolboxMenuOpen" class="nav-dropdown-menu" role="menu">
            <NuxtLink
              v-for="item in toolboxNavItems"
              :key="item.to"
              :to="item.to"
              class="nav-dropdown-item"
              :class="{ active: route.path === item.to || route.path.startsWith(item.to + '/') }"
              role="menuitem"
              @click="toolboxMenuOpen = false"
            >
              <span class="nav-dropdown-item-label">{{ item.label }}</span>
              <span v-if="item.refHint" class="nav-dropdown-item-ref">{{ item.refHint }}</span>
            </NuxtLink>
          </div>
        </div>
        <NuxtLink to="/images" class="nav-link" :class="{ active: route.path.startsWith('/images') }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
          </svg>
          <span>图片生成</span>
        </NuxtLink>
        <NuxtLink to="/activity" class="nav-link" :class="{ active: route.path === '/activity' }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span>工作记录</span>
        </NuxtLink>
        <NuxtLink v-if="isAdmin || canManageTeam" to="/settings" class="nav-link" :class="{ active: route.path === '/settings' }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>{{ isAdmin ? '设置' : '团队' }}</span>
        </NuxtLink>
      </nav>

      <div class="header-right">
        <div v-if="teams.length" class="team-switcher">
          <label class="team-switcher-label">团队</label>
          <select
            class="team-select"
            :value="activeTeamId ?? ''"
            @change="onTeamChange"
          >
            <option v-for="t in teams" :key="t.id" :value="t.id">
              {{ t.name }}（{{ t.member_count }}人）
            </option>
          </select>
        </div>
        <div v-if="user" class="user-menu">
          <NuxtLink
            v-if="!rechargeEnabled"
            to="/activity?tab=credits"
            class="credits-badge"
            title="积分明细"
          >
            <span class="credits-label">积分</span>
            <span class="credits-value">{{ creditsBalance }}</span>
          </NuxtLink>
          <div
            v-else
            ref="creditsMenuRef"
            class="credits-dropdown"
            :class="{ open: creditsMenuOpen, active: isCreditsRoute }"
          >
            <button
              type="button"
              class="credits-badge credits-dropdown-trigger"
              aria-haspopup="menu"
              :aria-expanded="creditsMenuOpen"
              title="积分菜单"
              @click="toggleCreditsMenu"
            >
              <span class="credits-label">积分</span>
              <span class="credits-value">{{ creditsBalance }}</span>
              <svg class="credits-dropdown-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div v-if="creditsMenuOpen" class="credits-dropdown-menu" role="menu">
              <NuxtLink
                to="/activity?tab=credits"
                class="credits-dropdown-item"
                :class="{ active: route.path === '/activity' && route.query.tab === 'credits' }"
                role="menuitem"
                @click="closeCreditsMenu"
              >
                <span class="credits-dropdown-item-label">积分明细</span>
                <span class="credits-dropdown-item-ref">查看充值与消耗记录</span>
              </NuxtLink>
              <NuxtLink
                to="/recharge"
                class="credits-dropdown-item"
                :class="{ active: route.path === '/recharge' }"
                role="menuitem"
                @click="closeCreditsMenu"
              >
                <span class="credits-dropdown-item-label">充值积分</span>
                <span class="credits-dropdown-item-ref">微信扫码支付</span>
              </NuxtLink>
            </div>
          </div>
          <span class="user-name">{{ user.display_name || user.username }}</span>
          <span v-if="isAdmin" class="tag tag-accent">管理员</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="logout">退出</button>
        </div>
        <div class="film-strip">
          <span class="film-frame"></span>
          <span class="film-frame"></span>
          <span class="film-frame"></span>
        </div>
      </div>
    </header>

    <main class="content">
      <slot />
    </main>
  </div>
</template>

<script setup>
import brandLogo from '~/assets/huobao-logo.png'
import { buildVideoNavItems } from '~/constants/video-channels.js'
import { buildToolboxNavItems } from '~/constants/toolbox-items.js'

const route = useRoute()
const showBrandImage = ref(true)
const { user, isAdmin, init, logout } = useAuth()
const { teams, activeTeamId, selectTeam, canManageTeam, loadActiveTeamMembers } = useTeam()
const { rechargeEnabled } = useRechargeAccess()

const videoMenuOpen = ref(false)
const videoNavRef = ref(null)
const toolboxMenuOpen = ref(false)
const toolboxNavRef = ref(null)
const creditsMenuOpen = ref(false)
const creditsMenuRef = ref(null)

const isVideoRoute = computed(() => route.path === '/videos' || route.path.startsWith('/videos/'))
const isCreditsRoute = computed(() => {
  if (route.path === '/activity' && route.query.tab === 'credits') return true
  return rechargeEnabled.value && route.path === '/recharge'
})

const videoNavItems = computed(() => buildVideoNavItems(true))
const toolboxNavItems = computed(() => buildToolboxNavItems({ isAdmin: isAdmin.value }))
const isToolboxRoute = computed(() => toolboxNavItems.value.some(
  item => route.path === item.to || route.path.startsWith(item.to + '/'),
))

function toggleVideoMenu() {
  videoMenuOpen.value = !videoMenuOpen.value
  if (videoMenuOpen.value) {
    creditsMenuOpen.value = false
    toolboxMenuOpen.value = false
  }
}

function closeVideoMenu() {
  videoMenuOpen.value = false
}

function toggleToolboxMenu() {
  toolboxMenuOpen.value = !toolboxMenuOpen.value
  if (toolboxMenuOpen.value) {
    videoMenuOpen.value = false
    creditsMenuOpen.value = false
  }
}

function closeToolboxMenu() {
  toolboxMenuOpen.value = false
}

function toggleCreditsMenu() {
  creditsMenuOpen.value = !creditsMenuOpen.value
  if (creditsMenuOpen.value) {
    videoMenuOpen.value = false
    toolboxMenuOpen.value = false
  }
}

function closeCreditsMenu() {
  creditsMenuOpen.value = false
}

function onDocumentClick(event) {
  const target = event.target
  if (videoMenuOpen.value) {
    const el = videoNavRef.value
    if (el && !el.contains(target)) closeVideoMenu()
  }
  if (toolboxMenuOpen.value) {
    const el = toolboxNavRef.value
    if (el && !el.contains(target)) closeToolboxMenu()
  }
  if (creditsMenuOpen.value) {
    const el = creditsMenuRef.value
    if (el && !el.contains(target)) closeCreditsMenu()
  }
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') {
    closeVideoMenu()
    closeToolboxMenu()
    closeCreditsMenu()
  }
}

watch(() => route.path, () => {
  closeVideoMenu()
  closeToolboxMenu()
  closeCreditsMenu()
})
watch(() => route.query.tab, () => closeCreditsMenu())

function onTeamChange(e) {
  const id = Number(e.target.value)
  if (!id) return
  selectTeam(id)
  if (route.path === '/') window.location.reload()
  else navigateTo('/')
}

const creditsBalance = computed(() => {
  const value = user.value?.credits_balance
  return Number.isFinite(value) ? value : '—'
})

onMounted(async () => {
  await init()
  await loadActiveTeamMembers()
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<style scoped>
.shell {
  display: flex; flex-direction: column;
  height: 100vh; overflow: hidden;
  background: var(--bg-base);
}

/* === Header === */
.header {
  display: flex; align-items: center;
  height: 56px; flex-shrink: 0;
  padding: 0 24px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border);
  gap: 32px;
}

.header-left { display: flex; align-items: center; }

.brand {
  display: flex; align-items: center; gap: 10px;
  background: none; border: none; cursor: pointer; padding: 0;
  text-decoration: none; border-radius: var(--radius);
  transition: opacity 0.15s;
}
.brand:hover { opacity: 0.75; }
.brand-mark {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-2); border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
}
.brand-logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
}
.brand-fallback {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--accent-text);
  line-height: 1;
}
.brand-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1; }
.brand-name {
  font-family: var(--font-display);
  font-size: 15px; font-weight: 700;
  color: var(--text-0);
  letter-spacing: -0.01em;
}
.brand-sub {
  font-size: 10px; font-weight: 500;
  color: var(--text-2); margin-top: 1px;
  letter-spacing: 0.04em;
}

/* Nav */
.header-nav { display: flex; gap: 4px; flex: 1; }
.nav-link {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 15px; border-radius: var(--radius);
  font-size: 15px; font-weight: 600;
  color: var(--text-0); text-decoration: none;
  transition: all 0.18s var(--ease-out);
  border: 1px solid transparent;
}
.nav-link:hover {
  background: var(--bg-hover); color: var(--text-0);
  border-color: var(--border);
}
.nav-link.active {
  background: var(--accent-bg);
  color: var(--accent-text);
  border-color: rgba(76,125,255,0.18);
  font-weight: 600;
}

.nav-dropdown {
  position: relative;
}
.nav-dropdown-trigger {
  cursor: pointer;
  font: inherit;
}
.nav-dropdown-chevron {
  opacity: 0.55;
  transition: transform 0.18s var(--ease-out);
}
.nav-dropdown.open .nav-dropdown-chevron {
  transform: rotate(180deg);
}
.nav-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 100;
  min-width: 220px;
  padding: 6px;
  border-radius: calc(var(--radius) + 2px);
  border: 1px solid var(--border);
  background: var(--bg-1);
  box-shadow: var(--shadow-card, 0 8px 24px rgba(0, 0, 0, 0.12));
}
.nav-dropdown-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--radius);
  text-decoration: none;
  color: var(--text-0);
  transition: background 0.15s;
}
.nav-dropdown-item:hover {
  background: var(--bg-hover);
}
.nav-dropdown-item.active {
  background: var(--accent-bg);
  color: var(--accent-text);
}
.nav-dropdown-item-label {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.nav-dropdown-item-ref {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.nav-dropdown-item.active .nav-dropdown-item-ref {
  color: var(--accent-text);
  opacity: 0.75;
}

.header-right { display: flex; align-items: center; gap: 16px; margin-left: auto; }
.team-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
}
.team-switcher-label {
  font-size: 11px;
  color: var(--text-1);
  font-weight: 600;
  flex-shrink: 0;
}
.team-select {
  min-width: 120px;
  max-width: 180px;
  padding: 5px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 12px;
}
.user-menu {
  display: flex;
  align-items: center;
  gap: 8px;
}
.credits-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  text-decoration: none;
  color: inherit;
}
.credits-dropdown { position: relative; }
.credits-dropdown-trigger {
  cursor: pointer;
  font: inherit;
}
.credits-dropdown.open .credits-badge,
.credits-badge:hover { border-color: var(--accent); }
.credits-dropdown.active .credits-badge {
  border-color: rgba(76,125,255,0.35);
  background: var(--accent-bg);
}
.credits-dropdown-chevron {
  opacity: 0.55;
  transition: transform 0.18s var(--ease-out);
}
.credits-dropdown.open .credits-dropdown-chevron {
  transform: rotate(180deg);
}
.credits-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 100;
  min-width: 200px;
  padding: 6px;
  border-radius: calc(var(--radius) + 2px);
  border: 1px solid var(--border);
  background: var(--bg-1);
  box-shadow: var(--shadow-card, 0 8px 24px rgba(0, 0, 0, 0.12));
}
.credits-dropdown-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--radius);
  text-decoration: none;
  color: var(--text-0);
  transition: background 0.15s;
}
.credits-dropdown-item:hover { background: var(--bg-hover); }
.credits-dropdown-item.active {
  background: var(--accent-bg);
  color: var(--accent-text);
}
.credits-dropdown-item-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}
.credits-dropdown-item-ref {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.35;
}
.credits-dropdown-item.active .credits-dropdown-item-ref {
  color: var(--accent-text);
  opacity: 0.8;
}
.credits-label { font-size: 11px; color: var(--text-1); font-weight: 600; }
.credits-value { font-size: 12px; font-weight: 700; color: var(--accent-text); }
.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-0);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Film strip decoration */
.film-strip {
  display: flex; align-items: center; gap: 3px;
  padding: 6px 10px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.film-frame {
  width: 8px; height: 10px;
  background: var(--bg-3);
  border-radius: 1.5px;
  transition: background 0.2s;
}
.film-frame:nth-child(2) { background: var(--accent); opacity: 0.6; }
.film-frame:nth-child(3) { opacity: 0.3; }

/* Content */
.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Nuxt 页面根节点需参与 flex 高度链；滚动交给 .page / .studio-feed 自身 */
.content > * {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
}

/* 设置页为左右分栏，须覆盖上方通用 column 规则（否则侧栏与内容会纵向堆叠） */
.content > :deep(.settings-layout) {
  flex: 1 1 auto;
  flex-direction: row;
  align-items: stretch;
  min-height: 0;
  width: 100%;
  max-height: none;
}
</style>
