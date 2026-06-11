<template>
  <div v-if="pageLoading" class="studio-loading">
    <Loader2 :size="28" class="animate-spin" />
    <span>正在加载第 {{ episodeNumber }} 集…</span>
  </div>
  <div v-else-if="pageError" class="studio-loading">
    <span>{{ pageError }}</span>
    <div class="studio-loading-actions">
      <button type="button" class="btn" @click="refresh">重试</button>
      <button type="button" class="btn btn-primary" @click="navigateTo(`/drama/${dramaId}`)">返回项目</button>
    </div>
  </div>
  <div class="studio" v-else-if="drama">
    <header class="studio-topbar">
      <div class="studio-topbar-main">
        <button class="back-btn topbar-back" @click="navigateTo(`/drama/${dramaId}`)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          返回项目
        </button>
        <div class="studio-identity">
          <h1 class="studio-title">{{ drama.title }}</h1>
          <span class="studio-episode-chip">第 {{ episodeNumber }} 集</span>
          <div class="studio-meta-row">
            <span class="studio-meta-pill">{{ currentSubStageLabel }}</span>
            <span class="studio-meta-pill is-progress">{{ pipelineProgress }}/11</span>
            <span class="studio-meta-inline">{{ chars.length }} 角色 · {{ sbs.length }} 镜头</span>
          </div>
        </div>
      </div>

      <div class="studio-topbar-side">
        <div v-if="showImageSizeControl" class="studio-aspect-control">
          <span class="studio-aspect-label">画面比例</span>
          <div class="studio-aspect-options">
            <button
              v-for="opt in imageAspectOptions"
              :key="opt.value"
              type="button"
              :class="['studio-aspect-btn', { active: dramaImageAspect === opt.value }]"
              :disabled="imageAspectSaving"
              @click="setDramaImageAspect(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
          <span class="studio-aspect-size">{{ dramaImageSizeLabel }}</span>
        </div>
        <div class="studio-actions">
          <button class="btn" @click="refresh">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            刷新
          </button>
          <button class="btn btn-primary" @click="panel = mergeUrl ? 'export' : (sbs.length ? 'production' : 'script')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            {{ mergeUrl ? '查看成片' : (sbs.length ? '继续制作' : '开始制作') }}
          </button>
        </div>
      </div>
    </header>

    <div
      v-if="genTimer.activeList.length"
      class="studio-gen-banner"
      :class="{ 'studio-gen-banner-slow': genTimer.hasSlowTask }"
    >
      <Loader2 :size="13" class="animate-spin" />
      <span class="studio-gen-banner-main">{{ genTimer.activeList.length }} 项生成进行中</span>
      <span v-if="genTimer.primaryTask" class="studio-gen-banner-detail">
        {{ genTimer.primaryTask.label }} · {{ genTimer.statusText(genTimer.primaryTask.key) }}
      </span>
      <span v-if="genTimer.activeList.length > 1" class="studio-gen-banner-more">
        另有 {{ genTimer.activeList.length - 1 }} 项
      </span>
    </div>

    <div class="studio-body" :class="{ 'assistant-collapsed': !assistantOpen }">
    <!-- ========== LEFT SIDEBAR ========== -->
    <aside class="sidebar">
      <nav class="pipeline">
        <div
          v-for="section in sidebarSections"
          :key="section.id"
          class="pipe-section"
        >
          <div class="pipe-section-label">{{ section.label }}</div>
          <button
            type="button"
            v-for="item in section.items"
            :key="item.key"
            :class="['pipe-item pipe-item-sub', { active: activeSubStepKey === item.key, done: item.done }]"
            @click="goSubStep(item.key)"
          >
            <span class="pipe-icon" :class="item.done ? 'icon-done' : activeSubStepKey === item.key ? 'icon-active' : ''">
              <svg v-if="item.done" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <component v-else :is="item.icon" :size="11" />
            </span>
            <span class="pipe-copy">
              <span class="pipe-label">{{ item.label }}</span>
              <span v-if="item.desc" class="pipe-sub">{{ item.desc }}</span>
            </span>
          </button>
        </div>
      </nav>

      <!-- Bottom: Progress + Refresh -->
      <div class="sidebar-bottom">
        <div class="progress-wrap">
          <div class="progress-head">
            <span class="progress-label">制作进度</span>
            <span class="progress-val">{{ pipelineProgress }}/11</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: (pipelineProgress / 11 * 100) + '%' }"></div>
          </div>
        </div>
        <div class="sidebar-jumper" v-if="sidebarJumpSteps.length">
          <button
            v-for="step in sidebarJumpSteps"
            :key="step.key"
            :class="['sidebar-jump-dot', { active: activeSubStepKey === step.key, done: step.done }]"
            @click="goSubStep(step.key)"
            :title="step.label"
          ></button>
        </div>
        <button class="refresh-btn" @click="refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          刷新数据
        </button>
      </div>
    </aside>

    <!-- ========== MAIN CONTENT ========== -->
    <main class="main">
      <div v-if="activeSubSteps.length" class="stage-subnav">
        <button
          type="button"
          v-for="sub in activeSubSteps"
          :key="sub.key"
          :class="['stage-subnav-item', { active: activeSubStepKey === sub.key, done: sub.done }]"
          @click="goSubStep(sub.key)"
        >
          <span>{{ sub.label }}</span>
          <span v-if="sub.done" class="stage-subnav-dot"></span>
        </button>
      </div>

      <!-- ===== SCRIPT PANEL ===== -->
      <div v-if="panel === 'script'" class="content-panel">
        <!-- Step 0: Raw Content -->
        <div v-if="scriptStep === 0" class="step-editor">
          <div class="step-toolbar">
            <div class="toolbar-left">
              <div class="step-indicator">
                <span class="step-num">01</span>
                <span class="step-name">原始内容</span>
              </div>
            </div>
            <div class="toolbar-right">
              <span v-if="rawLen" class="char-count">{{ rawLen }} 字</span>
              <button class="btn btn-sm" @click="saveRaw(); toast.success('已保存')">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                保存
              </button>
            </div>
          </div>
          <textarea
            class="fill-textarea"
            v-model="localRaw"
            placeholder="粘贴小说原文、故事大纲或分镜描述..."
          />
        </div>

        <!-- Step 1: Rewrite -->
        <div v-else-if="scriptStep === 1" class="step-editor">
          <div class="step-toolbar">
            <div class="toolbar-left">
              <div class="step-indicator">
                <span class="step-num">02</span>
                <span class="step-name">AI 改写</span>
              </div>
            </div>
            <div class="toolbar-right">
              <span v-if="scriptLen" class="char-count">{{ scriptLen }} 字</span>
              <button v-if="rawContent" class="btn btn-sm" @click="skipRewrite">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M13 18l6-6-6-6"/></svg>
                跳过改写
              </button>
              <button v-if="scriptContent" class="btn btn-sm" @click="doRewrite" :disabled="assistantRunning">
                <Loader2 v-if="assistantRunning && assistantAgentType === 'script_rewriter'" :size="11" class="animate-spin" />
                <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                重新改写
              </button>
            </div>
          </div>

          <div v-if="!scriptContent && !assistantRunning" class="step-empty">
            <div class="empty-visual">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
            </div>
            <div class="empty-title">AI 改写为格式化剧本</div>
            <div class="empty-desc">你可以先用 AI 把原始内容整理成格式化剧本，也可以跳过这一步，直接使用原始内容继续提取角色与场景。</div>
            <div class="step-empty-actions">
              <button class="btn btn-primary" @click="doRewrite">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                开始改写
              </button>
              <button class="btn" @click="skipRewrite">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/><path d="M13 18l6-6-6-6"/></svg>
                跳过改写
              </button>
            </div>
          </div>
          <div v-else-if="assistantRunning && assistantAgentType === 'script_rewriter'" class="step-loading">
            <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
            <div class="loading-text">正在改写剧本...</div>
          </div>
          <textarea v-else class="fill-textarea" v-model="localScript" placeholder="格式化剧本内容..." />
        </div>

        <!-- Step 2: Extract -->
        <div v-else-if="scriptStep === 2" class="step-editor">
          <div class="step-toolbar">
            <div class="toolbar-left">
              <div class="step-indicator">
                <span class="step-num">03</span>
                <span class="step-name">提取角色与场景</span>
              </div>
            </div>
            <div class="toolbar-right">
              <span v-if="chars.length" class="char-count">{{ chars.length }} 角色 · {{ scenes.length }} 场景</span>
              <button class="btn btn-sm" @click="openManualEntity('character')">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                添加角色
              </button>
              <button class="btn btn-sm" @click="openManualEntity('scene')">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                添加场景
              </button>
              <button v-if="chars.length" class="btn btn-sm" @click="doExtract" :disabled="assistantRunning">
                <Loader2 v-if="assistantRunning && assistantAgentType === 'extractor'" :size="11" class="animate-spin" />
                <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                重新提取
              </button>
            </div>
          </div>

          <div v-if="!chars.length && !assistantRunning" class="step-empty">
            <div class="empty-visual">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <div class="empty-title">从剧本提取角色与场景</div>
            <div class="empty-desc">AI 自动分析剧本，提取角色信息和场景列表，与项目已有数据智能去重合并；也可手动添加</div>
            <div class="step-empty-actions">
              <button class="btn btn-primary" @click="doExtract">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                开始提取
              </button>
              <button class="btn btn-sm" @click="openManualEntity('character')">手动添加角色</button>
              <button class="btn btn-sm" @click="openManualEntity('scene')">手动添加场景</button>
            </div>
          </div>
          <div v-else-if="assistantRunning && assistantAgentType === 'extractor'" class="step-loading">
            <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
            <div class="loading-text">正在提取角色和场景...</div>
          </div>
          <div v-else class="extract-stage">
            <aside class="card extract-summary">
              <div class="extract-summary-kicker">Extraction Board</div>
              <div class="extract-summary-title">角色与场景结果</div>
              <div class="extract-summary-desc">从剧本里提取出的角色和场景已经入库。这里先确认命名、定位和描述是否可直接进入后续制作。</div>
              <div class="extract-summary-stats">
                <div class="extract-summary-stat">
                  <span>角色</span>
                  <strong>{{ chars.length }}</strong>
                </div>
                <div class="extract-summary-stat">
                  <span>场景</span>
                  <strong>{{ scenes.length }}</strong>
                </div>
              </div>
              <div class="extract-summary-note">如果角色描述过于简短，后续分配音色和生成形象时建议先补充人物特征。</div>
            </aside>

            <div class="card extract-card">
              <div class="extract-card-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>角色</span>
                <span class="tag tag-accent">{{ chars.length }}</span>
              </div>
              <div class="extract-list">
                <div v-for="c in chars" :key="c.id" class="extract-row">
                  <div class="char-avatar">{{ c.name?.[0] || '?' }}</div>
                  <div class="extract-info">
                    <div class="extract-name-row">
                      <div class="extract-name">{{ c.name }}</div>
                      <span class="tag">{{ c.role || '角色' }}</span>
                    </div>
                    <div class="extract-meta wrap">{{ c.description || c.appearance || c.personality || '暂无描述' }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="card extract-card" v-if="scenes.length">
              <div class="extract-card-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>场景</span>
                <span class="tag tag-accent">{{ scenes.length }}</span>
              </div>
              <div class="extract-list">
                <div v-for="s in scenes" :key="s.id" class="extract-row">
                  <div class="scene-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  </div>
                  <div class="extract-info">
                    <div class="extract-name-row">
                      <div class="extract-name">{{ s.location }}</div>
                      <span v-if="s.time" class="tag">{{ s.time }}</span>
                    </div>
                    <div class="extract-meta wrap">{{ s.description || s.time || '等待补充场景描述' }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 3: Voice Assignment -->
        <div v-else-if="scriptStep === 3" class="step-editor">
          <div class="step-toolbar">
            <div class="toolbar-left">
              <div class="step-indicator">
                <span class="step-num">04</span>
                <span class="step-name">分配音色</span>
              </div>
            </div>
            <div class="toolbar-right">
              <span v-if="charsVoiced" class="char-count">{{ charsVoiced }}/{{ chars.length }} 已分配</span>
              <span v-if="voiceSampleCount" class="char-count">{{ voiceSampleCount }}/{{ charsVoiced }} 试听文件</span>
              <button v-if="charsVoiced" class="btn btn-sm" @click="doVoice" :disabled="assistantRunning">
                <Loader2 v-if="assistantRunning && assistantAgentType === 'voice_assigner'" :size="11" class="animate-spin" />
                <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                重新分配
              </button>
              <button v-if="charsVoiced" class="btn btn-sm" :disabled="assistantRunning" @click="batchGenSamples">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19 5v14"/></svg>
                生成试听文件
              </button>
            </div>
          </div>

          <div v-if="!charsVoiced && !assistantRunning" class="step-empty">
            <div class="empty-visual">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            </div>
            <div class="empty-title">为角色分配合适的音色</div>
            <div class="empty-desc">AI 根据角色特征自动分配最匹配的 TTS 音色</div>
            <button class="btn btn-primary" @click="doVoice">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              AI 自动分配
            </button>
          </div>
          <div v-else-if="assistantRunning && assistantAgentType === 'voice_assigner'" class="step-loading">
            <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
            <div class="loading-text">正在分配音色...</div>
          </div>
          <div v-else class="voice-stage">
            <aside class="card voice-stage-panel">
              <div class="voice-stage-kicker">Voice Casting</div>
              <div class="voice-stage-title">角色声音分配台</div>
              <div class="voice-stage-desc">先为每个角色选择合适音色，再生成试听。音色标签会帮助你快速区分旁白、主角、反派和配角的表达方向。</div>
              <div class="voice-stage-stats">
                <div class="voice-stage-stat">
                  <span class="voice-stage-stat-label">已分配</span>
                  <strong>{{ charsVoiced }}/{{ chars.length }}</strong>
                </div>
                <div class="voice-stage-stat">
                  <span class="voice-stage-stat-label">试听文件</span>
                  <strong>{{ voiceSampleCount }}/{{ charsVoiced }}</strong>
                </div>
              </div>
              <div class="voice-library-meta">
                <span>音色库</span>
                <span>{{ voiceProfiles.length }} 条</span>
              </div>
              <div class="voice-library">
                <div v-for="voice in voiceProfiles" :key="voice.id" class="voice-library-item">
                  <div class="voice-library-head">
                    <span class="voice-library-name">{{ voice.label }}</span>
                    <span class="tag">{{ voice.gender }}</span>
                  </div>
                  <div class="voice-library-traits">{{ voice.traits }}</div>
                  <div class="voice-library-fit">{{ voice.suitable }}</div>
                </div>
              </div>
            </aside>

            <div class="voice-grid">
              <div v-for="c in chars" :key="c.id" class="card voice-card">
                <div class="voice-card-head">
                  <div class="voice-char">
                    <div class="char-avatar lg">{{ c.name?.[0] || '?' }}</div>
                    <div class="voice-name">
                      <div class="voice-name-row">
                        <div class="extract-name">{{ c.name }}</div>
                        <span class="tag" :class="(c.voice_style || c.voiceStyle) ? 'tag-success' : ''">{{ (c.voice_style || c.voiceStyle) ? '已分配' : '待分配' }}</span>
                      </div>
                      <div class="extract-meta">{{ c.role || '角色' }}</div>
                    </div>
                  </div>
                </div>

                <div class="voice-card-copy">
                  <div class="voice-card-text">{{ c.description || c.personality || c.appearance || '暂无角色描述，可根据人物定位手动挑选音色。' }}</div>
                </div>

                <div class="voice-select-block">
                  <span class="voice-block-label">选择音色</span>
                  <BaseSelect
                    :model-value="c.voice_style || c.voiceStyle || ''"
                    :options="voiceSelectOptions"
                    placeholder="选择音色"
                    searchable
                    style="width:100%"
                    @update:model-value="updateCharVoice(c.id, $event)"
                  />
                </div>

                <div v-if="getVoiceProfile(c.voice_style || c.voiceStyle)" class="voice-profile-card">
                  <div class="voice-profile-head">
                    <span class="voice-profile-name">{{ getVoiceProfile(c.voice_style || c.voiceStyle)?.label }}</span>
                    <span class="tag">{{ getVoiceProfile(c.voice_style || c.voiceStyle)?.gender }}</span>
                  </div>
                  <div class="voice-profile-traits">{{ getVoiceProfile(c.voice_style || c.voiceStyle)?.traits }}</div>
                  <div class="voice-profile-fit">{{ getVoiceProfile(c.voice_style || c.voiceStyle)?.suitable }}</div>
                </div>

                <div class="voice-actions-row">
                  <button class="btn btn-sm" :disabled="!(c.voice_style || c.voiceStyle) || assistantRunning" @click="genSample(c.id)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    {{ (c.voice_sample_url || c.voiceSampleUrl) ? '重新试听' : '生成试听' }}
                  </button>
                  <span class="dim" style="font-size:11px">{{ (c.voice_sample_url || c.voiceSampleUrl) ? '已生成声音样本，可直接播放' : '生成后可快速确认角色声音' }}</span>
                </div>

                <div v-if="c.voice_sample_url || c.voiceSampleUrl" class="voice-player">
                  <audio :src="'/' + (c.voice_sample_url || c.voiceSampleUrl)" controls preload="none" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 4: Storyboard / Shot Plans -->
        <div v-else-if="scriptStep === 4" class="step-editor">
          <div class="step-toolbar">
            <div class="toolbar-left">
              <div class="step-indicator">
                <span class="step-num">05</span>
                <span class="step-name">{{ useShotPlanWorkflow ? '镜头列表' : '分镜列表' }}</span>
              </div>
            </div>
            <div class="toolbar-right">
              <template v-if="useShotPlanWorkflow">
                <span v-if="shotPlans.length" class="char-count">{{ shotPlans.length }} 镜头 · {{ planTotalDuration.toFixed(1) }}s</span>
                <span v-if="newWorkflowClips.length" class="tag mono">{{ newWorkflowClips.length }} 片段</span>
                <button class="btn btn-sm" @click="importModalOpen = true">粘贴导入</button>
                <button
                  class="btn btn-sm btn-primary"
                  :disabled="generateLoading || assistantRunning"
                  @click="doGenerateShotPlansInternal"
                >
                  <Loader2 v-if="generateLoading || (assistantRunning && assistantAgentType === 'shot_plan_generator')" :size="11" class="animate-spin" />
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  {{ shotPlans.length ? '重新生成' : '内部分镜生成' }}
                </button>
                <button class="btn btn-sm" :disabled="!shotPlans.length" @click="doConfirmPlans">确认列表</button>
                <button class="btn btn-sm" :disabled="!shotPlans.length" @click="doAutoGroupClips">自动分组</button>
                <button class="btn btn-sm btn-primary" :disabled="!hasProductionClips" @click="goToProductionFromPlans">生成视频</button>
              </template>
              <template v-else>
                <span v-if="sbs.length" class="char-count">{{ sbs.length }} 镜头 · {{ totalDuration }}s</span>
                <button v-if="sbs.length" class="btn btn-sm" @click="addShot">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  添加
                </button>
                <template v-if="!sbs.length">
                  <span class="locked-config">视频模型 · {{ lockedVideoConfigLabel }}</span>
                </template>
                <button class="btn btn-sm" @click="importModalOpen = true">粘贴导入</button>
                <button class="btn btn-sm" :disabled="assistantRunning" @click="doBreakdown">
                  <Loader2 v-if="assistantRunning && assistantAgentType === 'storyboard_breaker'" :size="11" class="animate-spin" />
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  {{ sbs.length ? '重新拆解' : 'AI 拆解分镜' }}
                </button>
              </template>
            </div>
          </div>

          <!-- New workflow: shot plans + clips -->
          <div v-if="useShotPlanWorkflow && (generateLoading || (assistantRunning && assistantAgentType === 'shot_plan_generator'))" class="step-loading">
            <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
            <div class="loading-text">正在生成工业镜头列表...</div>
          </div>

          <div v-else-if="useShotPlanWorkflow && !shotPlans.length" class="step-empty">
            <div class="empty-visual">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
                <rect x="2" y="2" width="20" height="20" rx="2.5"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/>
              </svg>
            </div>
            <div class="empty-title">准备镜头列表</div>
            <div class="empty-desc">使用 AI 内部分镜生成，或粘贴 DeepSeek 输出的工业分镜脚本</div>
            <div class="locked-config-banner">当前集视频模型：{{ lockedVideoConfigLabel }}</div>
            <div class="step-empty-actions">
              <button class="btn btn-primary" :disabled="generateLoading" @click="doGenerateShotPlansInternal">
                <Loader2 v-if="generateLoading" :size="13" class="animate-spin" />
                内部分镜生成
              </button>
              <button class="btn" @click="importModalOpen = true">粘贴工业脚本</button>
            </div>
          </div>

          <div v-else-if="useShotPlanWorkflow" class="split-layout">
            <div class="shot-list">
              <div class="shot-list-head">
                <div>
                  <div class="shot-list-title">镜头序列</div>
                  <div class="shot-list-sub">审阅微镜头，确认后自动分组为视频片段</div>
                </div>
                <span class="tag mono">{{ planTotalDuration.toFixed(1) }}s</span>
              </div>
              <div class="shot-list-body">
                <div
                  v-for="plan in shotPlans"
                  :key="plan.id"
                  :class="['shot-item', { active: selectedPlan?.id === plan.id }]"
                  @click="selectedPlan = plan"
                >
                  <div class="shot-item-header">
                    <div class="shot-num">#{{ String(plan.shot_number || plan.shotNumber).padStart(3, '0') }}</div>
                    <span class="tag" style="font-size:10px">{{ planStatusLabel(plan) }}</span>
                    <span v-if="getPlanCharacterNames(plan).length" class="tag" style="font-size:10px">{{ getPlanCharacterNames(plan).join(' / ') }}</span>
                  </div>
                  <div class="shot-body">
                    <div class="shot-desc">{{ plan.title || plan.description || '无描述' }}</div>
                  </div>
                  <div class="shot-meta">
                    <span class="mono dim" style="font-size:10px">{{ plan.duration || 2 }}s</span>
                    <span class="shot-location">{{ getPlanSceneName(plan) }}</span>
                    <span v-if="plan.dialogue" class="shot-dialogue">{{ plan.dialogue }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="detail-panel">
              <div v-if="selectedPlan" class="detail-body">
                <div class="detail-head">
                  <div class="detail-head-copy">
                    <span class="detail-head-title">镜头 #{{ String(selectedPlan.shot_number || selectedPlan.shotNumber).padStart(3, '0') }}</span>
                    <span class="detail-head-sub">{{ selectedPlan.title || '未命名' }} · {{ selectedPlan.duration || 2 }}s</span>
                  </div>
                </div>
                <div class="detail-hero-text" style="margin-bottom:12px">{{ selectedPlan.description || selectedPlan.action || '暂无描述' }}</div>
                <div class="detail-status-row">
                  <span class="tag">{{ getPlanSceneName(selectedPlan) }}</span>
                  <span v-for="name in getPlanCharacterNames(selectedPlan)" :key="name" class="tag">{{ name }}</span>
                </div>
                <div v-if="selectedPlan.dialogue" class="voice-player" style="margin-top:12px">
                  <div class="dim" style="font-size:11px;margin-bottom:4px">台词 / 音效</div>
                  <div style="font-size:13px;line-height:1.5">{{ selectedPlan.dialogue }}</div>
                </div>

                <div v-if="newWorkflowClips.length" class="plan-clip-move-panel">
                  <div class="dim" style="font-size:11px;margin-bottom:8px">
                    当前片段：{{ getPlanClipLabel(selectedPlan) }} · 可移入其他片段（跨场景合并）
                  </div>
                  <div class="plan-clip-move-actions">
                    <button
                      v-for="(clip, i) in newWorkflowClips"
                      :key="clip.id"
                      class="btn btn-sm"
                      :class="{ 'btn-primary': isPlanInClip(selectedPlan, clip) }"
                      :disabled="clipMoveLoading || isPlanInClip(selectedPlan, clip)"
                      @click="movePlanToClip(selectedPlan, clip)"
                    >
                      {{ isPlanInClip(selectedPlan, clip) ? `已在 Clip ${i + 1}` : `移入 Clip ${i + 1}` }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="shot-clips-panel">
                <div class="shot-list-head">
                  <div>
                    <div class="shot-list-title">视频片段</div>
                    <div class="shot-list-sub">每个片段对应一次视频生成（12–15 秒）；选中镜头后可移入其他片段</div>
                  </div>
                </div>
                <div v-if="newWorkflowClips.length" class="shot-clips-list">
                  <div v-for="(clip, i) in newWorkflowClips" :key="clip.id" class="shot-clip-card card">
                    <div class="shot-clip-head">
                      <span class="mono">Clip {{ i + 1 }}</span>
                      <span class="tag">{{ clipDurationSum(clip).toFixed(1) }}s</span>
                      <span v-if="clipDurationSum(clip) > 15" class="tag tag-warn">超 15s</span>
                      <span class="tag" :class="(clip.prompt_status || clip.promptStatus) === 'expanded' ? 'tag-success' : ''">
                        {{ { expanded: '已展开', stale: '需更新', empty: '待展开' }[clip.prompt_status || clip.promptStatus] || '待展开' }}
                      </span>
                      <button
                        v-if="selectedPlan && !isPlanInClip(selectedPlan, clip)"
                        class="btn btn-sm ml-auto"
                        :disabled="clipMoveLoading"
                        @click="movePlanToClip(selectedPlan, clip)"
                      >
                        移入选中镜头
                      </button>
                    </div>
                    <div class="shot-desc">{{ clip.title || clip.description || '未命名片段' }}</div>
                    <div v-if="clip.shot_plans?.length" class="dim" style="font-size:11px;margin-top:6px">
                      含镜头 {{ clip.shot_plans.map(p => String(p.shot_number || p.shotNumber).padStart(3, '0')).join('、') }}
                    </div>
                  </div>
                </div>
                <div v-else class="dim" style="padding:16px;font-size:12px">暂无片段，点击「自动分组」按场景切分</div>
              </div>
            </div>
          </div>

          <div v-else-if="sbs.length" class="split-layout">
            <!-- Shot List -->
            <div class="shot-list">
              <div class="shot-list-head">
                <div>
                  <div class="shot-list-title">镜头序列</div>
                  <div class="shot-list-sub">按镜头顺序检查内容与素材状态</div>
                </div>
                <span class="tag mono">{{ totalDuration }}s</span>
              </div>
              <div class="shot-list-body">
                <div
                  v-for="(sb, i) in sbs"
                  :key="sb.id"
                  :class="['shot-item', { active: selectedSb?.id === sb.id }]"
                  @click="selectedSb = sb"
                >
                  <div class="shot-item-header">
                    <div class="shot-num">#{{ String(i+1).padStart(2,'0') }}</div>
                    <span class="tag" style="font-size:10px">{{ sb.shot_type || sb.shotType || '—' }}</span>
                    <span v-if="getStoryboardCharacterIds(sb).length" class="tag" style="font-size:10px">{{ getStoryboardCharacterIds(sb).length }} 角色</span>
                    <div class="shot-status">
                      <div v-if="sb.imageUrl || sb.composedImage || sb.firstFrameImage" class="shot-dot has-img" title="已生成图片"></div>
                      <div v-if="sb.videoUrl || sb.composedVideoUrl" class="shot-dot has-video" title="已生成视频"></div>
                      <div v-if="sb.dialogue" class="shot-dot has-dialogue" title="有对白"></div>
                    </div>
                  </div>
                  <div class="shot-body">
                    <div class="shot-desc">{{ sb.description || sb.title || '无描述' }}</div>
                  </div>
                  <div class="shot-meta">
                    <span class="mono dim" style="font-size:10px">{{ sb.duration || 10 }}s</span>
                    <span v-if="sb.location" class="shot-location">{{ sb.location }}</span>
                    <span v-if="getStoryboardCharacterNames(sb).length" class="shot-location">{{ getStoryboardCharacterNames(sb).join(' / ') }}</span>
                    <span v-if="sb.dialogue" class="shot-dialogue">{{ sb.dialogue }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Detail Panel -->
            <div class="detail-panel" v-if="selectedSb">
                <div class="detail-head">
                  <div class="detail-head-copy">
                    <span class="detail-head-title">镜头 #{{ sbs.indexOf(selectedSb) + 1 }}</span>
                  <span class="detail-head-sub">{{ selectedSb.title || `镜头 ${sbs.indexOf(selectedSb) + 1}` }} · {{ selectedSb.shot_type || selectedSb.shotType || '未设置景别' }}</span>
                  </div>
                  <span class="tag mono">{{ (selectedSb.duration || 10) }}s</span>
                  <button class="btn btn-ghost btn-icon ml-auto" style="color:var(--error)" @click="deleteShot(selectedSb)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                  </button>
              </div>
              <div class="detail-body">
                <div class="detail-hero">
                  <div class="detail-hero-copy">
                    <div class="detail-hero-label">镜头概览</div>
                    <div class="detail-hero-text">{{ selectedSb.description || selectedSb.title || '当前镜头还没有画面描述，建议先补充核心动作和构图。' }}</div>
                    <div class="detail-status-row">
                      <span class="tag">{{ getSceneName(selectedSb) }}</span>
                      <span class="tag">{{ selectedSb.angle || '未设角度' }}</span>
                      <span class="tag">{{ selectedSb.movement || '未设运镜' }}</span>
                      <span class="tag" :class="getFirstFrame(selectedSb) ? 'tag-success' : ''">首帧 {{ getFirstFrame(selectedSb) ? '已生成' : '待生成' }}</span>
                      <span class="tag" :class="getLastFrame(selectedSb) ? 'tag-success' : ''">尾帧 {{ getLastFrame(selectedSb) ? '已生成' : '待生成' }}</span>
                      <span class="tag" :class="hasVid(selectedSb) ? 'tag-success' : ''">视频 {{ hasVid(selectedSb) ? '已生成' : '待生成' }}</span>
                    </div>
                  </div>
                  <div class="detail-preview-grid">
                    <div class="detail-preview-card">
                      <div class="detail-preview-title">首帧</div>
                      <div class="detail-preview-media">
                        <img
                          v-if="getFirstFrame(selectedSb)"
                          :src="displayUrl(getFirstFrame(selectedSb))"
                          class="previewable-image"
                          @click.stop="openImageViewer(displayUrl(getFirstFrame(selectedSb)), `镜头 #${sbs.indexOf(selectedSb) + 1} 首帧`)"
                        />
                        <div v-else class="detail-preview-empty">待生成</div>
                      </div>
                    </div>
                    <div class="detail-preview-card">
                      <div class="detail-preview-title">尾帧</div>
                      <div class="detail-preview-media">
                        <img
                          v-if="getLastFrame(selectedSb)"
                          :src="displayUrl(getLastFrame(selectedSb))"
                          class="previewable-image"
                          @click.stop="openImageViewer(displayUrl(getLastFrame(selectedSb)), `镜头 #${sbs.indexOf(selectedSb) + 1} 尾帧`)"
                        />
                        <div v-else class="detail-preview-empty">待生成</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="detail-section">
                  <div class="detail-section-head">
                    <span class="detail-section-title">镜头结构</span>
                    <span class="detail-section-copy">景别、角度、运镜、场景绑定和时长</span>
                  </div>
                  <div class="field-grid field-grid-4">
                    <label class="field">
                      <span class="field-label">标题</span>
                      <input :value="selectedSb.title || ''" class="input"
                        @blur="updateField(selectedSb, 'title', $event.target.value)" placeholder="如：雪地逼近" />
                    </label>
                    <label class="field">
                      <span class="field-label">景别</span>
                      <input
                        list="shot-type-list"
                        :value="selectedSb.shot_type || selectedSb.shotType || ''"
                        class="input"
                        placeholder="选择或输入景别"
                        @change="updateField(selectedSb, 'shot_type', $event.target.value)"
                      />
                      <datalist id="shot-type-list">
                        <option v-for="t in shotTypes" :key="t" :value="t" />
                      </datalist>
                    </label>
                    <label class="field">
                      <span class="field-label">角度</span>
                      <input
                        list="shot-angle-list"
                        :value="selectedSb.angle || ''"
                        class="input"
                        placeholder="选择或输入角度"
                        @change="updateField(selectedSb, 'angle', $event.target.value)"
                      />
                      <datalist id="shot-angle-list">
                        <option v-for="t in shotAngles" :key="t" :value="t" />
                      </datalist>
                    </label>
                    <label class="field">
                      <span class="field-label">运镜</span>
                      <input
                        list="shot-movement-list"
                        :value="selectedSb.movement || ''"
                        class="input"
                        placeholder="选择或输入运镜"
                        @change="updateField(selectedSb, 'movement', $event.target.value)"
                      />
                      <datalist id="shot-movement-list">
                        <option v-for="t in shotMovements" :key="t" :value="t" />
                      </datalist>
                    </label>
                  </div>
                  <div class="field-grid field-grid-4">
                    <label class="field">
                      <span class="field-label">绑定角色</span>
                      <div class="role-pills">
                        <button
                          v-for="char in chars"
                          :key="char.id"
                          type="button"
                          :class="['role-pill', { active: isStoryboardCharacterSelected(selectedSb, char.id) }]"
                          @click="toggleStoryboardCharacter(selectedSb, char.id)"
                        >
                          {{ char.name }}
                        </button>
                        <span v-if="!chars.length" class="dim" style="font-size:12px">当前集还没有角色</span>
                      </div>
                    </label>
                    <label class="field">
                      <span class="field-label">绑定场景</span>
                      <select class="input" :value="selectedSb.scene_id || selectedSb.sceneId || ''"
                        @change="onStoryboardSceneChange(selectedSb, $event.target.value ? Number($event.target.value) : null)">
                        <option value="">未绑定场景</option>
                        <option v-for="scene in scenes" :key="scene.id" :value="scene.id">
                          {{ scene.location }} · {{ scene.time || '未设时间' }}
                        </option>
                      </select>
                    </label>
                    <label v-if="selectedSb.scene_id || selectedSb.sceneId" class="field">
                      <span class="field-label">场景视角</span>
                      <div class="scene-angle-options">
                        <button
                          v-for="img in getSceneImagesForStoryboard(selectedSb)"
                          :key="`${selectedSb.id}:scene:${img.angle_id}`"
                          type="button"
                          class="scene-angle-option"
                          :class="{
                            active: !img.readonly && isStoryboardSceneAngleSelected(selectedSb, img.angle_id),
                            missing: !img.url,
                            'scene-angle-blocking': img.readonly,
                          }"
                          :title="img.readonly ? `${img.label}（只读，点击预览）` : img.label"
                          @click="onStoryboardSceneImageClick(selectedSb, img)"
                        >
                          <img v-if="img.url" :src="displayUrl(img.url)" :alt="img.label" />
                          <span v-else class="scene-angle-empty">{{ img.label }}</span>
                          <span class="scene-angle-label">{{ img.label }}</span>
                        </button>
                      </div>
                    </label>
                    <label class="field">
                      <span class="field-label">地点</span>
                      <input :value="selectedSb.location || ''" class="input"
                        @blur="updateField(selectedSb, 'location', $event.target.value)" placeholder="场景地点" />
                    </label>
                    <label class="field">
                      <span class="field-label">时间</span>
                      <input :value="selectedSb.time || ''" class="input"
                        @blur="updateField(selectedSb, 'time', $event.target.value)" placeholder="如：深夜 / 清晨" />
                    </label>
                    <label class="field">
                      <span class="field-label">时长</span>
                      <input :value="selectedSb.duration || 10" class="input" type="number" min="1" max="60"
                        @blur="updateField(selectedSb, 'duration', Number($event.target.value))" />
                    </label>
                  </div>
                </div>
                <div class="detail-section">
                  <div class="detail-section-head">
                    <span class="detail-section-title">画面语义</span>
                    <span class="detail-section-copy">动作、结果、氛围和对白</span>
                  </div>
                  <div class="field-grid field-grid-2">
                    <label class="field">
                      <span class="field-label">动作</span>
                      <textarea :value="selectedSb.action || ''" class="textarea" rows="3"
                        @blur="updateField(selectedSb, 'action', $event.target.value)" placeholder="谁在做什么，表情和动作细节是什么" />
                    </label>
                    <label class="field">
                      <span class="field-label">结果</span>
                      <textarea :value="selectedSb.result || ''" class="textarea" rows="3"
                        @blur="updateField(selectedSb, 'result', $event.target.value)" placeholder="镜头结束时的状态变化或画面结果" />
                    </label>
                  </div>
                  <div class="field-grid field-grid-2">
                    <label class="field">
                      <span class="field-label">画面描述</span>
                      <textarea :value="selectedSb.description || ''" class="textarea" rows="4"
                        @blur="updateField(selectedSb, 'description', $event.target.value)" placeholder="描述画面内容..." />
                    </label>
                    <label class="field">
                      <span class="field-label">氛围</span>
                      <textarea :value="selectedSb.atmosphere || ''" class="textarea" rows="4"
                        @blur="updateField(selectedSb, 'atmosphere', $event.target.value)" placeholder="光线、色调、空气感、环境氛围" />
                    </label>
                  </div>
                  <label class="field">
                    <span class="field-label">对白 / 旁白</span>
                    <textarea :value="selectedSb.dialogue || ''" class="textarea" rows="3"
                      @blur="updateField(selectedSb, 'dialogue', $event.target.value)" placeholder="角色名：台词内容 或 旁白：内容" />
                  </label>
                </div>
                <div class="detail-section">
                <StoryboardBlockingPanel
                  :sb="selectedSb"
                  :frame-mode="frameMode"
                  :character-ids="getStoryboardCharacterIds(selectedSb)"
                  :layout="getBlockingLayout(selectedSb)"
                  :blocking-image="getBlockingImage(selectedSb) || ''"
                  :blocking-image-index="getBlockingVideoImageIndex(selectedSb)"
                  :pending="isPendingBlocking(selectedSb.id)"
                  :pending-first-frame="isPendingShotFrame(selectedSb.id, 'first_frame')"
                  :pending-last-frame="isPendingShotFrame(selectedSb.id, 'last_frame')"
                  :generate-disabled="blockingGenerateDisabled(selectedSb)"
                  :disable-reason="blockingDisableReason(selectedSb)"
                  :shot-mode-hint="getBlockingShotModeHint(selectedSb)"
                  :initial-prompt="getBlockingPromptDraft(selectedSb)"
                  :image-reference-supported="imageReferenceSupported"
                  :character-name="getCharacterName"
                  @entry-change="(charId, patch) => onBlockingEntryChange(selectedSb, charId, patch)"
                  @notes-blur="onBlockingNotesBlur(selectedSb, $event)"
                  @generate="genBlocking(selectedSb, $event)"
                  @gen-first="genFirstFrameFromBlocking(selectedSb, 'first_frame')"
                  @gen-last="genFirstFrameFromBlocking(selectedSb, 'last_frame')"
                  @clear="clearBlockingImage(selectedSb)"
                  @preview="openImageViewer(displayUrl(getBlockingImage(selectedSb)), `镜头 #${selectedSb.storyboard_number || selectedSb.storyboardNumber || sbs.indexOf(selectedSb) + 1} 站位图`)"
                />
                <GenerationTimer v-if="isPendingBlocking(selectedSb.id)" :task-key="blockingTimerKey(selectedSb.id)" />
                </div>
                <div class="detail-section">
                  <div class="detail-section-head">
                    <span class="detail-section-title">生成提示</span>
                    <span class="detail-section-copy">分别服务图片、视频、配乐和音效生成</span>
                  </div>
                  <label class="field">
                    <span class="field-label">静态画面提示词</span>
                    <textarea :value="selectedSb.image_prompt || selectedSb.imagePrompt || ''" class="textarea" rows="4"
                      @blur="updateField(selectedSb, 'image_prompt', $event.target.value)" placeholder="用于首帧、尾帧和镜头图片的单帧画面提示词" />
                  </label>
                  <label class="field">
                    <span class="field-label">视频提示词</span>
                    <textarea :value="selectedSb.video_prompt || selectedSb.videoPrompt || ''" class="textarea" rows="5"
                      @blur="updateField(selectedSb, 'video_prompt', $event.target.value)" placeholder="按 3 秒分段的视频提示词..." />
                  </label>
                  <div class="field-grid field-grid-2">
                    <label class="field">
                      <span class="field-label">配乐提示词</span>
                      <textarea :value="selectedSb.bgm_prompt || selectedSb.bgmPrompt || ''" class="textarea" rows="3"
                        @blur="updateField(selectedSb, 'bgm_prompt', $event.target.value)" placeholder="如：压抑低频弦乐，缓慢推进" />
                    </label>
                    <label class="field">
                      <span class="field-label">音效提示词</span>
                      <textarea :value="selectedSb.sound_effect || selectedSb.soundEffect || ''" class="textarea" rows="3"
                        @blur="updateField(selectedSb, 'sound_effect', $event.target.value)" placeholder="如：风雪声、脚踩积雪、衣料摩擦声" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="assistantRunning && (assistantAgentType === 'storyboard_breaker' || assistantAgentType === 'shot_plan_generator')" class="step-loading">
            <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
            <div class="loading-text">{{ assistantAgentType === 'shot_plan_generator' ? '正在生成工业镜头列表...' : '正在拆解分镜并生成提示词...' }}</div>
          </div>

          <div v-else class="step-empty">
            <div class="empty-visual">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
                <rect x="2" y="2" width="20" height="20" rx="2.5"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/>
              </svg>
            </div>
            <div class="empty-title">准备镜头列表</div>
            <div class="empty-desc">粘贴外部工业分镜脚本，或使用 AI 生成镜头列表；确认后分组生成视频</div>
            <div class="locked-config-banner">当前集视频模型：{{ lockedVideoConfigLabel }}</div>
            <div class="step-empty-actions">
              <button class="btn btn-primary" @click="importModalOpen = true">粘贴工业脚本</button>
              <button class="btn" :disabled="generateLoading || assistantRunning" @click="doGenerateShotPlansInternal">
                <Loader2 v-if="generateLoading" :size="13" class="animate-spin" />
                内部分镜生成
              </button>
              <button v-if="hasLegacyStoryboards" class="btn" :disabled="assistantRunning" @click="doBreakdown">
                <Loader2 v-if="assistantRunning && assistantAgentType === 'storyboard_breaker'" :size="13" class="animate-spin" />
                AI 拆解分镜（旧流程）
              </button>
            </div>
          </div>
        </div>

      </div>

      <!-- ===== PRODUCTION PANEL ===== -->
      <div v-else-if="panel === 'production'" class="content-panel">
        <!-- Guard: storyboard-dependent production steps -->
        <div v-if="productionPanelBlocked" class="step-empty" style="flex:1">
          <div class="empty-visual">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div class="empty-title">尚未准备就绪</div>
          <div class="empty-desc">{{ !scriptContent ? '请先完成剧本编写' : '可先 AI 拆解分镜，或直接手动添加镜头开始制作视频' }}</div>
          <div class="step-empty-actions">
            <button v-if="scriptContent && !sbs.length" class="btn btn-primary" @click="addShot({ openVideos: true })">手动添加镜头</button>
            <button class="btn" :class="{ 'btn-primary': !scriptContent }" @click="panel = 'script'">
              {{ !scriptContent ? '前往剧本' : '前往分镜拆解' }}
            </button>
          </div>
        </div>

        <template v-else>
          <div class="step-toolbar prod-toolbar">
            <div class="toolbar-left">
              <div class="step-indicator">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                <span class="step-name">制作工作台</span>
              </div>
            </div>
            <div class="prod-tabs">
              <button
                v-for="t in prodTabDefs"
                :key="t.id"
                :class="['prod-tab', { active: prodTab === t.id }]"
                @click="prodTab = t.id"
              >
                <component :is="t.icon" :size="11" />
                {{ t.label }}
                <span v-if="t.badge" class="prod-tab-badge">{{ t.badge }}</span>
              </button>
            </div>
          </div>

          <div v-if="genTimer.activeList.length" class="gen-timer-panel card">
            <div class="gen-timer-panel-head">
              <Loader2 :size="14" class="animate-spin" />
              <span>进行中的生成（{{ genTimer.activeList.length }}）</span>
            </div>
            <ul class="gen-timer-list">
              <li
                v-for="task in genTimer.activeList"
                :key="task.key"
                :class="{ 'gen-timer-item-slow': genTimer.isSlow(task.key) }"
              >
                <span class="gen-timer-label">{{ task.label }}</span>
                <span class="gen-timer-meta">{{ genTimer.statusText(task.key) }}</span>
              </li>
            </ul>
          </div>

          <!-- Sub: Characters -->
          <div v-if="prodTab === 'chars'" class="prod-content">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">{{ visualChars.length }} 个需生成形象角色</span>
              <span class="tag">{{ lockedImageConfigLabel }}</span>
              <span class="tag">{{ dramaImageAspectLabel }}</span>
              <span v-if="isSeedance2VideoActive" class="tag tag-warn">Seedance 2.0 勿用真人图</span>
              <span v-if="lockedImageConfigProvider && !imageReferenceSupported" class="tag tag-warn">当前图片模型不支持参考图生图</span>
              <span v-if="chars.length > visualChars.length" class="tag">旁白仅保留声音</span>
              <div class="ml-auto flex gap-1">
                <button class="btn btn-sm" @click="openManualEntity('character')">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  添加角色
                </button>
                <button class="btn btn-sm" :disabled="assistantRunning" @click="batchCharImages">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  批量生成
                </button>
              </div>
            </div>
            <div v-if="!chars.length" class="step-empty" style="padding: 28px 16px">
              <div class="empty-title">尚未提取角色</div>
              <div class="empty-desc">可 AI 从剧本提取，或手动添加角色后再生成形象。</div>
              <div class="step-empty-actions">
                <button type="button" class="btn btn-primary" @click="goSubStep('script:extract')">前往提取</button>
                <button type="button" class="btn btn-sm" @click="openManualEntity('character')">手动添加角色</button>
              </div>
            </div>
            <div v-else-if="!visualChars.length" class="step-empty" style="padding: 28px 16px">
              <div class="empty-title">无需生成形象</div>
              <div class="empty-desc">当前角色均为旁白/画外音，仅保留声音即可。</div>
            </div>
            <div v-else class="asset-grid">
              <div v-for="c in visualChars" :key="c.id" class="card asset-card">
                <div class="asset-cover">
                  <img
                    v-if="c.image_url || c.imageUrl"
                    :src="displayUrl(c.image_url || c.imageUrl)"
                    class="previewable-image"
                    @click.stop="openImageViewer(displayUrl(c.image_url || c.imageUrl), `${c.name} 角色形象`)"
                  />
                  <label v-else class="asset-cover-empty asset-cover-upload" :class="{ 'is-disabled': isPendingCharImage(c.id) || isPendingCharUpload(c.id) }">
                    <input type="file" accept="image/*" hidden :disabled="isPendingCharImage(c.id) || isPendingCharUpload(c.id)" @change="uploadCharImage(c.id, $event)" />
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <span class="asset-cover-upload-text">{{ isPendingCharUpload(c.id) ? '上传中…' : '点击上传形象' }}</span>
                  </label>
                  <span class="asset-cover-badge" :class="(c.image_url || c.imageUrl) ? 'is-ready' : (isPendingCharImage(c.id) ? 'is-pending' : '')">{{ (c.image_url || c.imageUrl) ? '已生成' : (isPendingCharImage(c.id) ? '生成中' : '待生成') }}</span>
                </div>
                <div class="asset-body">
                  <div class="asset-name">{{ c.name }}</div>
                  <div class="asset-meta dim">{{ c.role || '角色' }}</div>
                  <div v-if="getCharacterImages(c).length" class="char-image-variants">
                    <div
                      v-for="img in getCharacterImages(c)"
                      :key="`${c.id}:${img.url}`"
                      class="char-image-variant"
                    >
                      <button
                        type="button"
                        class="char-image-variant-thumb"
                        @click.stop="openImageViewer(displayUrl(img.url), `${c.name} · ${variantLabel(img)}`)"
                      >
                        <img :src="displayUrl(img.url)" :alt="variantLabel(img)" />
                      </button>
                      <span class="char-image-variant-label">{{ variantLabel(img) }}</span>
                    </div>
                  </div>
                  <div v-if="getCharacterOutfits(c).length" class="char-outfit-list">
                    <div v-for="outfit in getCharacterOutfits(c)" :key="outfit.outfit_id" class="char-outfit-block">
                      <div class="char-outfit-head">
                        <button
                          type="button"
                          class="char-outfit-thumb"
                          @click.stop="openImageViewer(displayUrl(outfit.url), `${c.name} · ${outfit.label}`)"
                        >
                          <img :src="displayUrl(outfit.url)" :alt="outfit.label" />
                        </button>
                        <span class="char-outfit-name">{{ outfit.label }}</span>
                      </div>
                      <div class="char-transform-row char-outfit-transform">
                        <span class="char-transform-label">Seedance</span>
                        <div class="char-transform-btns">
                          <template v-for="preset in CHARACTER_IMAGE_TRANSFORMS" :key="`${outfit.outfit_id}:${preset.id}`">
                            <button
                              type="button"
                              class="btn btn-sm char-transform-btn"
                              :title="charTransformTitle(c, preset, outfit.outfit_id)"
                              :disabled="charTransformDisabled(c, outfit.outfit_id)"
                              @click="transformCharImg(c.id, preset.id, preset.label, outfit.outfit_id)"
                            >
                              {{ isPendingCharTransform(c.id, preset.id, outfit.outfit_id) ? '转换中' : preset.label }}
                            </button>
                            <GenerationTimer
                              v-if="isPendingCharTransform(c.id, preset.id, outfit.outfit_id)"
                              :task-key="charTransformTimerKeyFor(c.id, preset.id, outfit.outfit_id)"
                            />
                          </template>
                        </div>
                      </div>
                    </div>
                  </div>
                  <label class="asset-prompt-field">
                    <span class="asset-prompt-label">图片提示词</span>
                    <textarea
                      :value="getCharImagePrompt(c)"
                      class="textarea asset-image-prompt"
                      rows="3"
                      @blur="onCharImagePromptBlur(c, $event)"
                    />
                  </label>
                </div>
                <div class="asset-foot asset-foot-col">
                  <div class="asset-foot-row">
                    <span :class="['dot', (c.image_url || c.imageUrl) && 'ok', isPendingCharImage(c.id) && 'pending']" />
                    <span class="dim" style="font-size:10px">{{ (c.image_url || c.imageUrl) ? '已生成' : (isPendingCharImage(c.id) ? '生成中' : '待生成') }}</span>
                    <div class="asset-foot-actions">
                      <button class="btn btn-sm" :disabled="isPendingCharImage(c.id)" @click="openAssetPicker('character', c.id)">人物资产</button>
                      <button class="btn btn-sm" :disabled="charOutfitDisabled(c)" @click="openAssetPicker('costume', c.id)">选服装换装</button>
                      <label class="btn btn-sm asset-upload-btn" :class="{ 'is-disabled': isPendingCharImage(c.id) || isPendingCharUpload(c.id) }">
                        <input type="file" accept="image/*" hidden :disabled="isPendingCharImage(c.id) || isPendingCharUpload(c.id)" @change="uploadCharImage(c.id, $event)" />
                        {{ isPendingCharUpload(c.id) ? '上传中' : '上传' }}
                      </label>
                      <button class="btn btn-sm btn-primary" :disabled="isPendingCharImage(c.id) || assistantRunning" @click="genCharImg(c.id)">{{ isPendingCharImage(c.id) ? '生成中' : 'AI 生成' }}</button>
                      <button type="button" class="btn btn-sm danger" @click="deleteCharacter(c)">删除</button>
                    </div>
                  </div>
                  <div class="char-transform-row">
                    <span class="char-transform-label">原图 Seedance</span>
                    <span class="dim char-transform-size-hint">按原图尺寸</span>
                    <div class="char-transform-btns">
                      <template v-for="preset in CHARACTER_IMAGE_TRANSFORMS" :key="preset.id">
                        <button
                          type="button"
                          class="btn btn-sm char-transform-btn"
                          :title="charTransformTitle(c, preset, 'primary')"
                          :disabled="charTransformDisabled(c, 'primary')"
                          @click="transformCharImg(c.id, preset.id, preset.label, 'primary')"
                        >
                          {{ isPendingCharTransform(c.id, preset.id, 'primary') ? '转换中' : preset.label }}
                        </button>
                        <GenerationTimer
                          v-if="isPendingCharTransform(c.id, preset.id, 'primary')"
                          :task-key="charTransformTimerKeyFor(c.id, preset.id, 'primary')"
                        />
                      </template>
                    </div>
                  </div>
                  <div v-if="!imageReferenceSupported" class="char-transform-note dim">{{ imageReferenceSupportHint() }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sub: Voice library -->
          <div v-else-if="prodTab === 'voices'" class="prod-content">
            <VoiceLibraryPanel :drama-id="dramaId" @change="voiceAssets = $event" />
          </div>

          <!-- Sub: Scenes -->
          <div v-else-if="prodTab === 'scenes'" class="prod-content">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">{{ scenes.length }} 个场景</span>
              <span class="tag">{{ lockedImageConfigLabel }}</span>
              <span class="tag">{{ dramaImageAspectLabel }}</span>
              <div class="ml-auto flex gap-1">
                <button class="btn btn-sm" @click="openManualEntity('scene')">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  添加场景
                </button>
                <button class="btn btn-sm" :disabled="assistantRunning" @click="batchSceneImages">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  批量生成
                </button>
              </div>
            </div>
            <div v-if="!scenes.length" class="step-empty" style="padding: 28px 16px">
              <div class="empty-title">尚未添加场景</div>
              <div class="empty-desc">可 AI 从剧本提取，或手动添加场景后再生成场景图。</div>
              <div class="step-empty-actions">
                <button type="button" class="btn btn-primary" @click="goSubStep('script:extract')">前往提取</button>
                <button type="button" class="btn btn-sm" @click="openManualEntity('scene')">手动添加场景</button>
              </div>
            </div>
            <div v-else class="asset-grid">
              <div v-for="s in scenes" :key="s.id" class="card asset-card">
                <div class="asset-cover wide">
                  <img
                    v-if="s.image_url || s.imageUrl"
                    :src="displayUrl(s.image_url || s.imageUrl)"
                    class="previewable-image"
                    @click.stop="openImageViewer(displayUrl(s.image_url || s.imageUrl), `${s.location} 场景图`)"
                  />
                  <label v-else class="asset-cover-empty asset-cover-upload" :class="{ 'is-disabled': isPendingSceneImage(s.id) || isPendingSceneUpload(s.id) }">
                    <input type="file" accept="image/*" hidden :disabled="isPendingSceneImage(s.id) || isPendingSceneUpload(s.id)" @change="uploadSceneImage(s.id, $event)" />
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    <span class="asset-cover-upload-text">{{ isPendingSceneUpload(s.id) ? '上传中…' : '点击上传场景图' }}</span>
                  </label>
                  <span class="asset-cover-badge" :class="(s.image_url || s.imageUrl) ? 'is-ready' : (isPendingSceneImage(s.id) ? 'is-pending' : '')">{{ (s.image_url || s.imageUrl) ? '已生成' : (isPendingSceneImage(s.id) ? '生成中' : '待生成') }}</span>
                </div>
                <div class="asset-body">
                  <div class="asset-name">{{ s.location }}</div>
                  <div class="asset-meta dim">{{ s.time || '—' }}</div>
                  <label class="asset-prompt-field">
                    <span class="asset-prompt-label">图片提示词</span>
                    <textarea
                      :value="getSceneImagePrompt(s)"
                      class="textarea asset-image-prompt"
                      rows="3"
                      @blur="onScenePromptBlur(s, $event)"
                    />
                  </label>
                </div>
                <div class="asset-foot asset-foot-col">
                  <div class="asset-foot-row">
                    <span :class="['dot', (s.image_url || s.imageUrl) && 'ok', isPendingSceneImage(s.id) && 'pending']" />
                    <span class="dim" style="font-size:10px">{{ (s.image_url || s.imageUrl) ? '已生成' : (isPendingSceneImage(s.id) ? '生成中' : '待生成') }}</span>
                    <div class="asset-foot-actions">
                      <button class="btn btn-sm" :disabled="isPendingSceneImage(s.id)" @click="openAssetPicker('scene', s.id)">资产库</button>
                      <label class="btn btn-sm asset-upload-btn" :class="{ 'is-disabled': isPendingSceneImage(s.id) || isPendingSceneUpload(s.id) }">
                        <input type="file" accept="image/*" hidden :disabled="isPendingSceneImage(s.id) || isPendingSceneUpload(s.id)" @change="uploadSceneImage(s.id, $event)" />
                        {{ isPendingSceneUpload(s.id) ? '上传中' : '上传' }}
                      </label>
                      <button class="btn btn-sm btn-primary" :disabled="isPendingSceneImage(s.id) || assistantRunning" @click="genSceneImg(s.id)">{{ isPendingSceneImage(s.id) ? '生成中' : 'AI 生成' }}</button>
                      <button type="button" class="btn btn-sm danger" @click="deleteScene(s)">删除</button>
                    </div>
                  </div>
                  <GenerationTimer v-if="isPendingSceneImage(s.id)" :task-key="sceneTimerKey(s.id)" />
                  <div v-if="s.image_url || s.imageUrl" class="char-transform-row">
                    <span class="char-transform-label">多角度</span>
                    <span class="dim char-transform-size-hint">基于主视角 · 6积分/张</span>
                    <div class="char-transform-btns">
                      <button
                        v-for="preset in SCENE_ANGLE_PRESETS"
                        :key="`${s.id}:${preset.id}`"
                        class="btn btn-sm"
                        :title="preset.description"
                        :disabled="sceneAngleDisabled(s)"
                        @click="genSceneAngle(s.id, preset.id, preset.label)"
                      >
                        {{ isPendingSceneAngle(s.id, preset.id) ? '生成中' : preset.label }}
                      </button>
                    </div>
                    <div class="char-transform-btns" style="margin-top:6px">
                      <button
                        class="btn btn-sm"
                        title="一键生成全部尚未生成的角度（跳过已有）"
                        :disabled="sceneAngleDisabled(s) || isPendingSceneAllAngles(s.id)"
                        @click="genSceneAllAngles(s.id)"
                      >
                        {{ isPendingSceneAllAngles(s.id) ? '批量生成中' : '一键全部角度' }}
                      </button>
                      <button
                        class="btn btn-sm"
                        title="一张图内拼接同场景多个机位视角"
                        :disabled="sceneAngleDisabled(s) || isPendingSceneAngle(s.id, SCENE_ANGLE_SHEET_ID)"
                        @click="genSceneAngleSheet(s.id)"
                      >
                        {{ isPendingSceneAngle(s.id, SCENE_ANGLE_SHEET_ID) ? '生成中' : SCENE_ANGLE_SHEET_LABEL }}
                      </button>
                    </div>
                    <div v-if="isPendingSceneAllAngles(s.id) || SCENE_ANGLE_PRESETS.some(p => isPendingSceneAngle(s.id, p.id)) || isPendingSceneAngle(s.id, SCENE_ANGLE_SHEET_ID)" class="scene-angle-timers">
                      <GenerationTimer
                        v-for="preset in SCENE_ANGLE_PRESETS.filter(p => isPendingSceneAngle(s.id, p.id))"
                        :key="`${s.id}:timer:${preset.id}`"
                        :task-key="sceneAngleTimerKeyFor(s.id, preset.id)"
                      />
                      <GenerationTimer
                        v-if="isPendingSceneAngle(s.id, SCENE_ANGLE_SHEET_ID)"
                        :task-key="sceneAngleTimerKeyFor(s.id, SCENE_ANGLE_SHEET_ID)"
                      />
                    </div>
                  </div>
                  <div v-if="listSceneImagesWithStoryboardBlockings(s, sbs, getBlockingImage).length > 1" class="scene-angle-preview-row">
                    <div
                      v-for="img in listSceneImagesWithStoryboardBlockings(s, sbs, getBlockingImage)"
                      :key="`${s.id}:preview:${img.angle_id}`"
                      class="scene-angle-preview-item"
                    >
                      <button
                        type="button"
                        class="scene-angle-preview"
                        @click="img.url && openImageViewer(displayUrl(img.url), `${s.location} · ${img.label}`)"
                      >
                        <img v-if="img.url" :src="displayUrl(img.url)" :alt="img.label" />
                        <span>{{ img.label }}</span>
                      </button>
                      <button
                        v-if="img.angle_id !== 'hero' && !img.readonly"
                        type="button"
                        class="btn btn-sm scene-angle-regen-btn"
                        :disabled="sceneAngleDisabled(s) || isPendingSceneAngle(s.id, img.angle_id)"
                        @click="openSceneAngleRegen(s, img)"
                      >
                        {{ isPendingSceneAngle(s.id, img.angle_id) ? '生成中' : '调整' }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sub: Fusion -->
          <div v-else-if="prodTab === 'fusion'" class="prod-content">
            <FusionImagePanel
              :drama-id="dramaId"
              :episode-id="epId"
              :image-config-id="lockedImageConfigId"
              :image-config-label="lockedImageConfigLabel"
              :image-reference-supported="imageReferenceSupported"
              :chars="chars"
              :scenes="scenes"
              :drama-props="dramaProps"
              @preview="(item) => openImageViewer(displayUrl(item.path), item.label || '融合生图')"
            />
          </div>

          <!-- Sub: Dubbing -->
          <div v-else-if="prodTab === 'dubbing'" class="prod-content">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">{{ ttsEligibleCount }} 条可生成配音</span>
              <span class="tag mono">{{ ttsGeneratedCount }}/{{ ttsEligibleCount }} 已生成</span>
              <span class="tag">{{ lockedAudioConfigLabel }}</span>
              <div class="ml-auto flex gap-1">
                <button class="btn btn-sm" :disabled="assistantRunning" @click="batchShotTTS">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                  批量生成
                </button>
              </div>
            </div>

            <div v-if="!ttsEligibleCount" class="step-empty" style="min-height:260px">
              <div class="empty-visual">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
              </div>
              <div class="empty-title">当前没有可生成的配音</div>
              <div class="empty-desc">先在分镜里填写“角色名：台词”或“旁白：文案”，这里就会出现待生成的语音镜头。</div>
            </div>

            <div v-else class="dub-grid">
                <div v-for="(sb, i) in sbs.filter(hasDialogue)" :key="sb.id" class="card dub-card">
                  <div class="dub-head">
                    <div class="dub-copy">
                    <div class="dub-title">
                      <span class="frame-num">#{{ String(sb.storyboard_number || sb.storyboardNumber || i + 1).padStart(2, '0') }}</span>
                      <span class="frame-badge">{{ getDialogueSpeaker(sb) }}</span>
                    </div>
                    <div class="dub-desc">{{ getDialogueText(sb) || '未填写文本' }}</div>
                    </div>
                    <span class="tag" :class="hasTTS(sb) ? 'tag-success' : ''">{{ hasTTS(sb) ? '已生成' : '待生成' }}</span>
                  </div>
                <div class="dub-meta">
                  <span class="dim">{{ sb.shot_type || sb.shotType || '未设景别' }}</span>
                  <span class="dim">{{ sb.duration || 10 }}s</span>
                  <span class="dim">{{ sb.location || '未设地点' }}</span>
                </div>
                <div class="dub-foot">
                  <audio v-if="hasTTS(sb)" :src="'/' + getTTSUrl(sb)" controls preload="none" class="dub-audio" />
                  <div v-else class="dim" style="font-size:12px">尚未生成语音文件</div>
                  <button class="btn btn-sm ml-auto" :disabled="assistantRunning" @click="genShotTTS(sb)">生成配音</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Sub: Shots -->
          <div v-else-if="prodTab === 'shots'" class="prod-content">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">{{ sbs.length }} 个镜头</span>
              <span class="tag mono">{{ shotImgCount }}/{{ sbs.length }} 已有帧图</span>
              <span class="tag mono">{{ blockingCount }}/{{ sbs.length }} 站位图</span>
              <span class="tag">{{ lockedImageConfigLabel }}</span>
              <span class="tag">{{ dramaImageAspectLabel }}</span>
              <div class="ml-auto flex gap-1">
                <BaseSelect v-model="frameMode" :options="frameModeOptions" placeholder="帧模式" searchable style="width:100px" />
                <button v-if="gridImagePath" class="btn btn-sm" @click="reopenGridPreview">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
                  查看当前宫格图
                </button>
                <button class="btn btn-primary btn-sm" @click="openGridTool">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  宫格图工具
                </button>
              </div>
            </div>

            <div v-if="gridHistory.length" class="grid-history-panel">
              <div v-if="gridImagePath" class="latest-grid-strip">
                <button class="latest-grid-strip-thumb" @click="openImageViewer(displayUrl(gridImagePath), '当前宫格图')">
                  <img :src="displayUrl(gridImagePath)" class="previewable-image" />
                </button>
                <div class="latest-grid-strip-copy">
                  <div class="latest-grid-strip-head">
                    <span class="tag mono">{{ gridActualLayout.rows }}x{{ gridActualLayout.cols }}</span>
                    <span class="tag" v-if="gridRecoveredMode">{{ gridRecoveredMode }}</span>
                  </div>
                  <div class="latest-grid-strip-title">当前宫格图</div>
                  <div class="latest-grid-strip-meta">
                    <span v-if="gridRecoveredAt">{{ gridRecoveredAt }}</span>
                    <span>可继续切割并分配</span>
                  </div>
                </div>
                <div class="latest-grid-strip-actions">
                  <button class="btn btn-sm" @click="reopenGridPreview">预览</button>
                  <button class="btn btn-primary btn-sm" @click="continueGridSplit">继续切割</button>
                </div>
              </div>
              <div class="grid-history-head">
                <div>
                  <div class="grid-history-title">历史宫格图</div>
                  <div class="grid-history-subtitle">按需展开切换不同宫格图，不默认占用第一屏</div>
                </div>
                <button class="btn btn-sm" @click="showAllGridHistory = !showAllGridHistory">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline :points="showAllGridHistory ? '18 15 12 9 6 15' : '6 9 12 15 18 9'"/></svg>
                  {{ showAllGridHistory ? '收起历史宫格图' : `展开全部 (${gridHistory.length})` }}
                </button>
              </div>
              <div v-if="showAllGridHistory" class="grid-history-list">
                <button
                  v-for="item in gridHistory"
                  :key="item.id"
                  :class="['grid-history-item', { active: item.localPath === gridImagePath }]"
                  @click="selectGridHistory(item)"
                >
                  <div class="grid-history-thumb">
                    <img :src="displayUrl(item.localPath)" class="previewable-image" />
                  </div>
                  <div class="grid-history-copy">
                    <div class="grid-history-tags">
                      <span class="tag mono">#{{ item.id }}</span>
                      <span class="tag mono">{{ item.layout.rows }}x{{ item.layout.cols }}</span>
                      <span class="tag">{{ item.modeLabel }}</span>
                    </div>
                    <div class="grid-history-meta">{{ item.createdAtLabel }}</div>
                  </div>
                </button>
              </div>
            </div>

            <div class="shots-workbench">
            <div class="frame-scroll">
              <div class="frame-grid">
                <div v-for="(sb, i) in sbs" :key="sb.id"
                  :class="['frame-row', 'card', { active: selectedSb?.id === sb.id }]"
                  @click="selectedSb = sb">
                  <!-- Info: number + type + desc -->
                  <div class="frame-info">
                    <div class="frame-top">
                      <span class="frame-num">#{{ String(i+1).padStart(2,'0') }}</span>
                      <span class="frame-badge">{{ sb.shot_type || sb.shotType || '—' }}</span>
                    </div>
                    <div class="frame-desc">{{ sb.description || sb.title || '—' }}</div>
                    <div class="frame-meta">
                      <span :class="['dot', getBlockingImage(sb) && 'ok', isPendingBlocking(sb.id) && 'pending']" />
                      <span class="dim" style="font-size:11px">站位</span>
                      <span :class="['dot', getFirstFrame(sb) && 'ok', isPendingShotFrame(sb.id, 'first_frame') && 'pending']" />
                      <span class="dim" style="font-size:11px">首帧</span>
                      <span v-if="frameMode === 'first_last'" style="display:flex;align-items:center;gap:4px">
                        <span :class="['dot', getLastFrame(sb) && 'ok', isPendingShotFrame(sb.id, 'last_frame') && 'pending']" />
                        <span class="dim" style="font-size:11px">尾帧</span>
                      </span>
                    </div>
                  </div>
                  <!-- Thumbnails -->
                  <div class="frame-thumbs">
                    <div class="frame-thumb-wrap">
                      <div
                        class="frame-thumb blocking-thumb"
                        @click.stop="onBlockingThumbClick(sb)"
                      >
                        <img
                          v-if="getBlockingImage(sb)"
                          :src="displayUrl(getBlockingImage(sb))"
                          class="previewable-image"
                          @click.stop="openImageViewer(displayUrl(getBlockingImage(sb)), `镜头 #${String(i + 1).padStart(2, '0')} 站位图`)"
                        />
                        <div v-else class="frame-thumb-empty">
                          <Loader2 v-if="isPendingBlocking(sb.id)" :size="14" class="animate-spin" />
                          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2l4 7H8l4-7z"/><path d="M4 14h16"/><path d="M6 18h12"/><path d="M8 22h8"/></svg>
                        </div>
                      </div>
                      <span class="frame-thumb-label">{{ isPendingBlocking(sb.id) ? '站位生成中' : (getBlockingImage(sb) ? '站位' : '站位·配置') }}</span>
                      <GenerationTimer v-if="isPendingBlocking(sb.id)" :task-key="blockingTimerKey(sb.id)" />
                    </div>
                    <div class="frame-thumb-wrap">
                      <div class="frame-thumb" @click.stop="!isPendingShotFrame(sb.id, 'first_frame') && genShotFrame(sb, 'first_frame')">
                        <img
                          v-if="getFirstFrame(sb)"
                          :src="displayUrl(getFirstFrame(sb))"
                          class="previewable-image"
                          @click.stop="openImageViewer(displayUrl(getFirstFrame(sb)), `镜头 #${String(i + 1).padStart(2, '0')} 首帧`)"
                        />
                        <div v-else class="frame-thumb-empty">
                          <Loader2 v-if="isPendingShotFrame(sb.id, 'first_frame')" :size="14" class="animate-spin" />
                          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </div>
                        <span v-if="getFirstFrame(sb)" class="frame-re">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        </span>
                      </div>
                      <span class="frame-thumb-label">{{ isPendingShotFrame(sb.id, 'first_frame') ? '首帧生成中' : '首帧' }}</span>
                      <GenerationTimer v-if="isPendingShotFrame(sb.id, 'first_frame')" :task-key="frameTimerKey(sb.id, 'first_frame')" />
                    </div>
                    <div v-if="frameMode === 'first_last'" class="frame-thumb-wrap">
                      <div class="frame-thumb" @click.stop="!isPendingShotFrame(sb.id, 'last_frame') && genShotFrame(sb, 'last_frame')">
                        <img
                          v-if="getLastFrame(sb)"
                          :src="displayUrl(getLastFrame(sb))"
                          class="previewable-image"
                          @click.stop="openImageViewer(displayUrl(getLastFrame(sb)), `镜头 #${String(i + 1).padStart(2, '0')} 尾帧`)"
                        />
                        <div v-else class="frame-thumb-empty">
                          <Loader2 v-if="isPendingShotFrame(sb.id, 'last_frame')" :size="14" class="animate-spin" />
                          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </div>
                        <span v-if="getLastFrame(sb)" class="frame-re">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        </span>
                      </div>
                      <span class="frame-thumb-label">{{ isPendingShotFrame(sb.id, 'last_frame') ? '尾帧生成中' : '尾帧' }}</span>
                      <GenerationTimer v-if="isPendingShotFrame(sb.id, 'last_frame')" :task-key="frameTimerKey(sb.id, 'last_frame')" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside v-if="selectedSb" class="shot-blocking-side card">
              <StoryboardBlockingPanel
                :sb="selectedSb"
                :shot-label="`镜头 #${String(sbs.indexOf(selectedSb) + 1).padStart(2, '0')}`"
                :frame-mode="frameMode"
                :character-ids="getStoryboardCharacterIds(selectedSb)"
                :layout="getBlockingLayout(selectedSb)"
                :blocking-image="getBlockingImage(selectedSb) || ''"
                :blocking-image-index="getBlockingVideoImageIndex(selectedSb)"
                :pending="isPendingBlocking(selectedSb.id)"
                :pending-first-frame="isPendingShotFrame(selectedSb.id, 'first_frame')"
                :pending-last-frame="isPendingShotFrame(selectedSb.id, 'last_frame')"
                :generate-disabled="blockingGenerateDisabled(selectedSb)"
                :disable-reason="blockingDisableReason(selectedSb)"
                :shot-mode-hint="getBlockingShotModeHint(selectedSb)"
                :initial-prompt="getBlockingPromptDraft(selectedSb)"
                :image-reference-supported="imageReferenceSupported"
                :character-name="getCharacterName"
                @entry-change="(charId, patch) => onBlockingEntryChange(selectedSb, charId, patch)"
                @notes-blur="onBlockingNotesBlur(selectedSb, $event)"
                @generate="genBlocking(selectedSb, $event)"
                @gen-first="genFirstFrameFromBlocking(selectedSb, 'first_frame')"
                @gen-last="genFirstFrameFromBlocking(selectedSb, 'last_frame')"
                @clear="clearBlockingImage(selectedSb)"
                @preview="openImageViewer(displayUrl(getBlockingImage(selectedSb)), `镜头 #${String(sbs.indexOf(selectedSb) + 1).padStart(2, '0')} 站位图`)"
              />
            </aside>
            <div v-else class="shot-blocking-side card shot-blocking-placeholder">
              <div class="shot-blocking-placeholder-title">站位图配置</div>
              <div class="dim">点击左侧镜头，在此配置角色站位并生成站位图</div>
            </div>
            </div>

            <!-- Grid Tool Dialog -->
            <div v-if="gridDialog" class="overlay" @click.self="gridDialog = false">
              <div class="card grid-tool">
                <div class="grid-tool-head">
                  <span style="font-size:15px;font-weight:600;font-family:var(--font-display)">宫格图工具</span>
                  <button class="btn btn-ghost btn-icon ml-auto" @click="gridDialog = false">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>

                <!-- Step 0: Config -->
                <div v-if="gridStep === 0" class="grid-tool-body">
                  <div class="grid-mode-tabs">
                    <button v-for="m in gridModes" :key="m.id"
                      :class="['grid-mode-tab', { active: gridMode === m.id }]"
                      @click="gridMode = m.id; gridSelected = []; gridSingleTarget = null; gridAssignmentsState = []">
                      <span style="font-weight:600">{{ m.label }}</span>
                      <span class="dim" style="font-size:11px">{{ m.desc }}</span>
                    </button>
                  </div>

                  <div class="grid-config">
                    <label class="field" style="flex:0 0 auto" v-if="gridMode !== 'multi_ref'">
                      <span class="field-label">宫格</span>
                      <BaseSelect v-model="gridLayout" :options="gridLayoutOptions" placeholder="宫格" style="width:90px" />
                    </label>
                    <div class="field" style="flex:1">
                      <span class="field-label">
                        {{ gridMode === 'multi_ref' ? '选择目标镜头' : '选择镜头' }}
                        <span class="dim" v-if="gridMode !== 'multi_ref'">(已选 {{ gridSelected.length }})</span>
                      </span>
                    </div>
                    <div style="align-self:flex-end" v-if="gridMode !== 'multi_ref'">
                      <button class="btn btn-sm" @click="gridSelectAll">{{ gridSelected.length === sbs.length ? '取消全选' : '全选' }}</button>
                    </div>
                  </div>

                  <div class="grid-pick-list">
                    <label v-for="(sb, i) in sbs" :key="sb.id"
                      :class="['grid-pick-item', { selected: gridMode === 'multi_ref' ? gridSingleTarget === sb.id : gridSelected.includes(sb.id) }]">
                      <input v-if="gridMode === 'multi_ref'" type="radio" :value="sb.id" v-model="gridSingleTarget" name="grid-target" />
                      <input v-else type="checkbox" :value="sb.id" v-model="gridSelected" />
                      <span class="mono" style="font-size:11px;width:28px">#{{ String(i+1).padStart(2,'0') }}</span>
                      <span class="truncate" style="flex:1;font-size:12px">{{ sb.description || sb.title || '—' }}</span>
                    </label>
                  </div>

                  <div class="grid-tool-foot">
                    <span v-if="gridCanStart" class="tag mono">{{ gridAutoLayout.rows }}x{{ gridAutoLayout.cols }} = {{ gridAutoLayout.rows * gridAutoLayout.cols }}格</span>
                    <span class="dim" style="font-size:11px">{{ gridPromptLoading ? gridPromptStatus : gridSummary }}</span>
                    <button class="btn btn-primary ml-auto" :disabled="!gridCanStart || gridPromptLoading" @click="generateGridPrompt">
                      <Loader2 v-if="gridPromptLoading" :size="12" class="animate-spin" />
                      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                      {{ gridPromptLoading ? '生成中' : '生成提示词' }}
                    </button>
                  </div>
                </div>

                <!-- Step 1: Prompt Preview -->
                <div v-else-if="gridStep === 1" class="grid-tool-body">
                  <div class="grid-prompt-summary">
                    <div class="grid-prompt-label">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      宫格图提示词
                      <span v-if="gridPromptSource" class="tag ml-8">{{ gridPromptSource === 'agent' ? 'AI生成' : '模板兜底' }}</span>
                    </div>
                    <div class="grid-prompt-text">{{ gridPromptText || '（等待生成）' }}</div>
                  </div>

                  <div class="grid-blank-preview" :style="gridBlankStyle">
                    <div v-for="(cell, i) in gridCellPrompts" :key="i" class="grid-blank-cell">
                      <div class="grid-blank-cell-index">#{{ cell.shot_number }} {{ {first_frame:'首帧',last_frame:'尾帧',reference:'参考'}[cell.frame_type] || '' }}</div>
                      <div class="grid-blank-cell-desc">{{ cell.prompt }}</div>
                    </div>
                    <div v-for="i in Math.max(0, (gridAutoLayout.rows * gridAutoLayout.cols) - gridCellPrompts.length)" :key="'empty-'+i" class="grid-blank-cell empty">
                      <div class="grid-blank-cell-index">空</div>
                      <div class="grid-blank-cell-desc">—</div>
                    </div>
                  </div>

                  <div class="grid-tool-foot">
                    <button class="btn" @click="gridStep = 0">上一步</button>
                    <button class="btn ml-auto" @click="generateGridPrompt" :disabled="gridPromptLoading">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                      重新生成
                    </button>
                    <button class="btn btn-primary" @click="startGridGen">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                      生成宫格图
                    </button>
                  </div>
                </div>

                <!-- Step 2: Generating -->
                <div v-else-if="gridStep === 2" class="grid-tool-body" style="align-items:center;justify-content:center;min-height:300px">
                  <Loader2 :size="28" class="animate-spin" style="color:var(--accent)" />
                  <div class="loading-text" style="margin-top:12px">宫格图生成中...</div>
                  <GenerationTimer :task-key="GRID_TIMER_KEY" />
                  <div class="dim" style="font-size:11px;margin-top:6px">{{ gridStatusText }}</div>
                </div>

                <!-- Step 3: Preview -->
                <div v-else-if="gridStep === 3" class="grid-tool-body grid-tool-body-preview">
                  <div class="grid-preview-layout">
                    <div class="grid-preview-pane">
                      <div class="grid-preview-wrap">
                        <div class="grid-preview-stage">
                          <img
                            :src="displayUrl(gridImagePath)"
                            class="grid-preview-img previewable-image"
                            @click.stop="openImageViewer(displayUrl(gridImagePath), '宫格图预览')"
                          />
                          <div class="grid-overlay" :style="gridOverlayStyle">
                            <button
                              v-for="(a, i) in gridAssignments"
                              :key="i"
                              type="button"
                              :class="['grid-overlay-cell', activeGridCell === i && 'active']"
                              @click="focusGridCell(i)"
                            >
                              <span class="grid-cell-label">{{ gridCellLabel(a) }}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      <div class="grid-adjust-summary">
                        <span class="tag mono">{{ gridActualLayout.rows }}x{{ gridActualLayout.cols }} = {{ gridActualLayout.rows * gridActualLayout.cols }}格</span>
                        <span class="dim" style="font-size:12px">{{ gridAssignedCount }}/{{ gridAssignments.length }} 格已分配</span>
                        <span class="tag" v-if="gridAssignedCount < gridAssignments.length">未分配格子会被忽略，不会写回分镜</span>
                      </div>
                    </div>
                    <div class="grid-assignment-pane">
                      <div class="grid-assign-head">
                        <div class="grid-assign-title">格子分配</div>
                        <div class="grid-assign-subtitle">切分后由你自己决定每格对应哪个分镜</div>
                      </div>
                      <div v-if="gridAssignmentTotalPages > 1" class="grid-assign-pagination">
                        <button class="btn btn-sm" :disabled="gridAssignmentPage === 0" @click="gridAssignmentPage--">上一页</button>
                        <span class="dim">第 {{ gridAssignmentPage + 1 }}/{{ gridAssignmentTotalPages }} 页</span>
                        <span class="dim">{{ gridAssignmentPageStart + 1 }}-{{ gridAssignmentPageEnd }} / {{ gridAssignments.length }}</span>
                        <button class="btn btn-sm ml-auto" :disabled="gridAssignmentPage >= gridAssignmentTotalPages - 1" @click="gridAssignmentPage++">下一页</button>
                      </div>
                      <div class="grid-assign-columns">
                        <span>格</span>
                        <span>镜头</span>
                        <span>类型</span>
                        <span>当前绑定</span>
                      </div>
                      <div class="grid-assign-info">
                        <div v-for="item in pagedGridAssignments" :key="item.index" :class="['grid-assign-row', activeGridCell === item.index && 'active']">
                          <span class="grid-assign-index">格{{ item.index + 1 }}</span>
                          <BaseSelect
                            :model-value="item.assignment.storyboard_id"
                            :options="gridAssignmentShotOptions"
                            placeholder="选择镜头"
                            @update:model-value="updateGridAssignment(item.index, 'storyboard_id', $event)"
                          />
                          <BaseSelect
                            :model-value="item.assignment.frame_type"
                            :options="gridFrameTypeOptions"
                            placeholder="帧类型"
                            style="width:100%"
                            @update:model-value="updateGridAssignment(item.index, 'frame_type', $event)"
                          />
                          <span class="grid-assign-bind">{{ gridCellTitle(item.assignment.storyboard_id) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="grid-tool-foot">
                    <button class="btn" @click="gridStep = 1">返回</button>
                    <button class="btn btn-primary ml-auto" @click="doGridSplit">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                      切分并分配
                    </button>
                  </div>
                </div>

                <!-- Step 4: Done -->
                <div v-else-if="gridStep === 4" class="grid-tool-body" style="align-items:center;justify-content:center;min-height:200px">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-dark)" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <div style="font-size:17px;font-weight:700;font-family:var(--font-display);margin-top:8px">分配完成</div>
                  <div class="dim" style="font-size:13px;margin-top:4px">{{ gridAssignedCount }} 格已分配</div>
                  <button class="btn btn-primary" style="margin-top:16px" @click="gridDialog = false; refresh()">关闭</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Sub: Videos -->
          <div v-else-if="prodTab === 'videos'" class="prod-content" :class="{ 'video-aspect-portrait': isPortraitDramaAspect }">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">{{ sbs.length }} 个镜头</span>
              <span class="tag mono">{{ shotVidCount }}/{{ sbs.length }} 已生成</span>
              <span class="tag">{{ lockedVideoConfigLabel }}</span>
              <span v-if="isChengmengVideoActive" class="tag tag-warn">800 积分/条（15 秒）</span>
              <span class="tag">{{ dramaImageAspectLabel }}</span>
              <div class="ml-auto flex gap-1">
                <button class="btn btn-sm" @click="addShot">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  添加镜头
                </button>
                <button class="btn btn-sm" :disabled="assistantRunning" @click="batchVideos">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                  批量视频
                </button>
              </div>
            </div>
            <div class="prod-grid prod-grid-video-shots" :class="{ 'prod-grid-portrait': isPortraitDramaAspect }">
              <div v-for="(sb, i) in sbs" :key="sb.id" class="card prod-card prod-card-lazy prod-card-video">
                <div class="prod-video-preview-shell">
                  <ProdVideoCover
                    v-if="hasVid(sb)"
                    :video-url="displayUrl(getVideoUrl(sb))"
                    :poster-url="getStoryboardCover(sb) ? gridUrl(getStoryboardCover(sb)) : ''"
                    :index-label="`#${String(i + 1).padStart(2, '0')}`"
                    :portrait="isPortraitDramaAspect"
                    compact
                    @expand="openVideoViewer(displayUrl(getVideoUrl(sb)), `镜头 #${String(i + 1).padStart(2, '0')} 视频预览`, getVideoUrl(sb))"
                  >
                    <template #badges>
                      <span v-if="hasComposed(sb)" class="prod-overlay-badge">已合成</span>
                    </template>
                  </ProdVideoCover>
                  <ProdVideoEmptyPreview
                    v-else
                    :cover-url="hasImg(sb) ? gridUrl(getStoryboardCover(sb)) : ''"
                    :index-label="`#${String(i + 1).padStart(2, '0')}`"
                    :portrait="isPortraitDramaAspect"
                    compact
                    @preview-cover="openImageViewer(displayUrl(getStoryboardCover(sb)), `镜头 #${String(i + 1).padStart(2, '0')} 参考图`)"
                  />
                  <div v-if="isPendingVideo(sb.id)" class="prod-video-generating">
                    <Loader2 :size="22" class="animate-spin prod-video-generating-icon" />
                    <span class="prod-video-generating-text">视频生成中</span>
                    <GenerationTimer :task-key="videoTimerKey(sb.id)" />
                  </div>
                </div>
                <div class="prod-info">
                  <div class="prod-desc truncate">{{ sb.description || sb.title || '—' }}</div>
                  <div class="prod-meta-line">{{ sb.shot_type || sb.shotType || '未设景别' }} · {{ sb.duration || 10 }}s</div>
                  <div class="prod-prompt-block">
                    <label class="prod-prompt-field prod-prompt-field-video">
                      <div class="prod-prompt-head">
                        <span class="prod-prompt-label">视频提示词</span>
                        <button type="button" class="prod-prompt-expand" @click="openVideoPromptEditor(sb, i)">
                          展开编辑 / AI 优化
                        </button>
                      </div>
                      <textarea
                        :value="sb.video_prompt || sb.videoPrompt || ''"
                        class="textarea prod-video-prompt"
                        placeholder="拆解分镜时生成，可在此微调后重新生成"
                        @blur="onVideoPromptBlur(sb, $event)"
                        @dblclick.prevent="openVideoPromptEditor(sb, i)"
                      />
                    </label>
                    <div class="prod-video-settings-row">
                      <div class="prod-setting-field prod-setting-duration">
                        <span class="prod-setting-label">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          时长
                        </span>
                        <div class="prod-duration-slider-box">
                          <div class="prod-duration-slider-wrap">
                            <input
                              type="range"
                              class="prod-duration-slider"
                              min="1"
                              max="15"
                              step="1"
                              :value="shotDurationValue(sb)"
                              :style="{ '--slider-progress': shotDurationProgress(sb) }"
                              @input="onVideoDurationInput(sb, $event)"
                            />
                          </div>
                          <span class="prod-duration-value">{{ shotDurationValue(sb) }}秒</span>
                        </div>
                      </div>
                      <div class="prod-setting-field prod-setting-resolution">
                        <span class="prod-setting-label">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                          分辨率
                        </span>
                        <div class="prod-resolution-box">
                          <span class="prod-resolution-value">{{ videoResolutionLabel }}</span>
                          <span class="prod-resolution-dot" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="prod-card-detail-toggle"
                    @click="toggleProdCardDetail(sb.id)"
                  >
                    <svg class="prod-card-detail-chevron" :class="{ open: isProdCardDetailOpen(sb.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                    {{ isProdCardDetailOpen(sb.id) ? '收起角色/参考配置' : '展开角色/参考配置' }}
                  </button>
                  <div
                    v-if="isProdCardDetailMounted(sb.id)"
                    v-show="isProdCardDetailOpen(sb.id)"
                    class="video-bind-panel"
                  >
                    <div class="video-bind-row">
                      <span class="prod-prompt-label">关联角色</span>
                      <div class="video-bind-pills">
                        <button
                          v-for="char in chars"
                          :key="char.id"
                          type="button"
                          :class="['role-pill', { active: isStoryboardCharacterSelected(sb, char.id) }]"
                          @click="toggleStoryboardCharacter(sb, char.id)"
                        >
                          {{ char.name }}
                        </button>
                        <span v-if="!chars.length" class="dim" style="font-size:11px">暂无角色，请先在剧本步骤提取</span>
                      </div>
                    </div>
                    <div v-if="getStoryboardCharacterIds(sb).length" class="video-char-image-panel">
                      <div class="video-bind-row">
                        <span class="prod-prompt-label">角色参考图</span>
                        <span class="dim video-char-image-hint">横向选择各角色造型</span>
                      </div>
                      <div class="video-char-image-strip">
                        <div
                          v-for="charId in getStoryboardCharacterIds(sb)"
                          :key="`char-img:${sb.id}:${charId}`"
                          class="video-char-image-segment"
                        >
                          <span class="video-char-image-name">{{ getCharacterName(charId) }}</span>
                          <div class="video-char-image-options">
                            <button
                              v-for="img in getCharacterImagesById(charId)"
                              :key="`${charId}:${img.url}`"
                              type="button"
                              class="video-char-image-option"
                              :class="{ active: isStoryboardCharacterImageSelected(sb, charId, img.url) }"
                              :title="variantLabel(img)"
                              @click="setStoryboardCharacterImage(sb, charId, img.url)"
                            >
                              <img :src="gridUrl(img.url)" :alt="variantLabel(img)" loading="lazy" decoding="async" />
                              <span>{{ variantLabel(img) }}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="video-bind-row">
                      <span class="prod-prompt-label">关联场景</span>
                      <select
                        class="input video-scene-select"
                        :value="sb.scene_id || sb.sceneId || ''"
                        @change="updateField(sb, 'scene_id', $event.target.value ? Number($event.target.value) : null)"
                      >
                        <option value="">未绑定场景</option>
                        <option v-for="scene in scenes" :key="scene.id" :value="scene.id">
                          {{ scene.location }} · {{ scene.time || '未设时间' }}
                        </option>
                      </select>
                    </div>
                    <div class="video-blocking-panel">
                      <div class="video-bind-row">
                        <span class="prod-prompt-label">站位图</span>
                        <span class="dim video-blocking-hint">3D 布局参考，需在 video_prompt 首行用「图片N是…」说明颜色与角色对应</span>
                      </div>
                      <div class="video-blocking-slot-row">
                        <button
                          type="button"
                          class="video-blocking-slot"
                          :class="{ pending: isPendingBlocking(sb.id), empty: !getBlockingImage(sb) }"
                          @click="getBlockingImage(sb) && openImageViewer(displayUrl(getBlockingImage(sb)), `镜头 #${String(i + 1).padStart(2, '0')} 站位图`)"
                        >
                          <img
                            v-if="getBlockingImage(sb)"
                            :src="gridUrl(getBlockingImage(sb))"
                            alt="站位图"
                            loading="lazy"
                            decoding="async"
                          />
                          <div v-else-if="isPendingBlocking(sb.id)" class="video-blocking-slot-empty">
                            <Loader2 :size="16" class="animate-spin" />
                            <span>生成中</span>
                            <GenerationTimer :task-key="blockingTimerKey(sb.id)" />
                          </div>
                          <div v-else class="video-blocking-slot-empty">
                            <span>尚未生成站位图</span>
                          </div>
                        </button>
                        <div class="video-blocking-side">
                          <div class="video-blocking-tags">
                            <span v-if="getBlockingVideoImageIndex(sb)" class="tag mono">图片{{ getBlockingVideoImageIndex(sb) }}</span>
                            <span v-if="getBlockingImage(sb)" class="tag">已生成</span>
                            <span v-else-if="isPendingBlocking(sb.id)" class="tag">生成中</span>
                            <span v-else class="tag">待生成</span>
                          </div>
                          <ul v-if="getBlockingColorLegend(sb).length" class="video-blocking-legend">
                            <li v-for="(line, li) in getBlockingColorLegend(sb)" :key="`${sb.id}:legend:${li}`">{{ line }}</li>
                          </ul>
                          <p v-else class="dim video-blocking-legend-empty">绑定角色后可在此查看颜色站位说明</p>
                          <pre v-if="getBlockingVideoPromptSnippet(sb)" class="video-blocking-snippet">{{ getBlockingVideoPromptSnippet(sb) }}</pre>
                          <div class="video-blocking-actions">
                            <button
                              type="button"
                              class="btn btn-sm btn-primary"
                              :disabled="blockingGenerateDisabled(sb)"
                              @click="genBlocking(sb)"
                            >
                              {{ isPendingBlocking(sb.id) ? '生成中…' : (getBlockingImage(sb) ? '重新生成' : '生成站位图') }}
                            </button>
                            <button
                              v-if="getBlockingImage(sb)"
                              type="button"
                              class="btn btn-sm"
                              :disabled="isPendingShotFrame(sb.id, 'first_frame') || !imageReferenceSupported"
                              @click="genFirstFrameFromBlocking(sb, 'first_frame')"
                            >
                              从站位图生成首帧
                            </button>
                            <GenerationTimer
                              v-if="isPendingShotFrame(sb.id, 'first_frame')"
                              :task-key="frameTimerKey(sb.id, 'first_frame')"
                            />
                            <button
                              v-if="getBlockingVideoPromptSnippet(sb)"
                              type="button"
                              class="btn btn-sm"
                              @click="copyBlockingVideoSnippet(sb)"
                            >
                              复制到 video_prompt
                            </button>
                            <button
                              type="button"
                              class="btn btn-sm"
                              @click="selectedSb = sb; prodTab = 'shots'"
                            >
                              去镜头页配置
                            </button>
                          </div>
                          <span v-if="blockingDisableReason(sb)" class="dim video-blocking-warn">{{ blockingDisableReason(sb) }}</span>
                        </div>
                      </div>
                    </div>
                    <div class="video-voice-panel">
                      <div class="video-ref-head">
                        <span class="prod-prompt-label">音色参考</span>
                        <span class="dim video-voice-hint">最多 3 个 · 3~10 秒 MP3</span>
                        <button type="button" class="btn btn-sm" @click="openVoiceRefPicker(sb)">从音色库选择</button>
                        <button type="button" class="btn btn-sm" @click="goSubStep('prod:voices')">管理音色库</button>
                      </div>
                      <div v-if="getStoryboardVoiceRefs(sb).length" class="video-voice-list">
                        <div
                          v-for="(voiceRef, vIdx) in getStoryboardVoiceRefs(sb)"
                          :key="voiceRef.path || vIdx"
                          class="video-voice-chip"
                        >
                          <span>{{ voiceRef.name }}</span>
                          <span v-if="voiceRef.duration" class="dim">{{ formatVoiceDuration(voiceRef.duration) }}</span>
                          <audio :src="'/' + normalizeMediaPath(voiceRef.path)" controls preload="none" />
                          <button type="button" class="video-ref-action danger" @click="removeStoryboardVoiceRef(sb, voiceRef)">移除</button>
                        </div>
                      </div>
                      <div v-else class="dim video-ref-empty-hint">未选择音色参考，可在音色库上传后在生成视频时使用</div>
                    </div>
                    <div class="video-ref-panel">
                      <div class="video-ref-head">
                        <span class="prod-prompt-label">
                          多模态参考
                          <span v-if="isSeedance2VideoActive" class="video-ref-hint">（将传入 Seedance 2.0）</span>
                        </span>
                        <label class="btn btn-sm video-ref-upload">
                          上传参考图
                          <input type="file" accept="image/*" hidden @change="uploadVideoReference(sb, $event)" />
                        </label>
                        <button type="button" class="btn btn-sm" @click="openVideoReferencePicker(sb)">
                          参考图库
                        </button>
                      </div>
                      <div class="video-ref-at-hint">
                        上传后按卡片「图N」在提示词写 <code>@图片N是参考图</code>；多张上传用 <code>@图片N是参考图2</code>
                      </div>
                      <div v-if="collectVideoReferencesExceptBlocking(sb).length" class="video-ref-list">
                        <div
                          v-for="mediaRef in collectVideoReferencesExceptBlocking(sb)"
                          :key="mediaRef.key"
                          class="video-ref-card"
                          :class="{ missing: mediaRef.missing }"
                        >
                          <div class="video-ref-card-media">
                            <button
                              v-if="mediaRef.url && mediaRef.type === 'image'"
                              type="button"
                              class="video-ref-thumb"
                              @click="openImageViewer(displayUrl(mediaRef.url), mediaRef.label)"
                            >
                              <img :src="gridUrl(mediaRef.url)" :alt="mediaRef.label" loading="lazy" decoding="async" />
                            </button>
                            <div v-else-if="mediaRef.type === 'audio' && mediaRef.url" class="video-ref-audio">
                              <audio :src="'/' + normalizeMediaPath(mediaRef.url)" controls preload="none" />
                            </div>
                            <div v-else class="video-ref-thumb video-ref-thumb-empty">{{ mediaRef.missing ? '待生成' : '无素材' }}</div>
                            <span v-if="mediaRef.displayImageIndex" class="video-ref-index">图{{ mediaRef.displayImageIndex }}</span>
                          </div>
                          <div class="video-ref-meta">
                            <span class="video-ref-label">{{ mediaRef.label }}</span>
                            <span class="video-ref-tag">{{ mediaRef.typeLabel }}</span>
                          </div>
                          <div class="video-ref-actions">
                            <template v-if="mediaRef.source === 'first_frame'">
                              <button type="button" class="video-ref-action" @click="genShotFrame(sb, 'first_frame')">更换</button>
                              <button type="button" class="video-ref-action danger" @click="clearVideoFrame(sb, 'first_frame')">删除</button>
                            </template>
                            <template v-else-if="mediaRef.source === 'last_frame'">
                              <button type="button" class="video-ref-action" @click="genShotFrame(sb, 'last_frame')">更换</button>
                              <button type="button" class="video-ref-action danger" @click="clearVideoFrame(sb, 'last_frame')">删除</button>
                            </template>
                            <template v-else-if="mediaRef.source === 'character'">
                              <button v-if="mediaRef.missing" type="button" class="video-ref-action" @click="genCharImg(mediaRef.charId)">生成</button>
                              <button type="button" class="video-ref-action danger" @click="removeVideoRefCharacter(sb, mediaRef.charId)">移除</button>
                            </template>
                            <template v-else-if="mediaRef.source === 'scene'">
                              <button v-if="mediaRef.missing" type="button" class="video-ref-action" @click="genSceneImg(mediaRef.sceneId)">生成</button>
                              <button type="button" class="video-ref-action danger" @click="removeVideoRefScene(sb)">解除</button>
                            </template>
                            <template v-else-if="mediaRef.source === 'reference'">
                              <button type="button" class="video-ref-action danger" @click="removeExtraReference(sb, mediaRef)">删除</button>
                            </template>
                            <template v-else-if="mediaRef.source === 'tts'">
                              <button type="button" class="video-ref-action" @click="genShotTTS(sb)">重生成</button>
                            </template>
                            <template v-else-if="mediaRef.source === 'voice'">
                              <button type="button" class="video-ref-action danger" @click="removeStoryboardVoiceRef(sb, { path: mediaRef.url, asset_id: mediaRef.assetId })">移除</button>
                            </template>
                          </div>
                        </div>
                      </div>
                      <div v-else class="dim video-ref-empty-hint">绑定角色/场景或生成首帧后，其余参考素材会显示在这里</div>
                    </div>
                  </div>
                  <div class="prod-dots">
                    <span :class="['dot', hasImg(sb) && 'ok']" /><span style="font-size:10px">图</span>
                    <span :class="['dot', hasVid(sb) && 'ok', isPendingVideo(sb.id) && 'pending']" /><span style="font-size:10px">{{ isPendingVideo(sb.id) ? '视频生成中' : '视频' }}</span>
                    <GenerationTimer v-if="isPendingVideo(sb.id)" :task-key="videoTimerKey(sb.id)" />
                  </div>
                  <div v-if="videoFailMessage(sb.id)" class="prod-error">{{ videoFailMessage(sb.id) }}</div>
                </div>
                <div class="prod-actions prod-actions-video">
                  <button
                    class="btn btn-sm prod-generate-btn"
                    :disabled="assistantRunning || (isPendingVideo(sb.id) && !isVideoGenerationSlow(sb.id))"
                    @click="genVid(sb)"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    {{ isPendingVideo(sb.id) && !isVideoGenerationSlow(sb.id) ? '生成中…' : (isPendingVideo(sb.id) ? '继续生成' : '生成视频') }}
                  </button>
                  <button
                    v-if="hasVid(sb)"
                    type="button"
                    class="btn btn-sm"
                    :disabled="videoDownloadShotId === sb.id"
                    @click="downloadStoryboardVideo(sb, i)"
                  >
                    {{ videoDownloadShotId === sb.id ? '下载中…' : '下载' }}
                  </button>
                  <button
                    v-if="hasVid(sb) || videoGenCount(sb.id) > 0"
                    type="button"
                    class="btn btn-sm prod-history-btn"
                    @click="openVideoHistory(sb, i)"
                  >
                    历史视频
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Sub: Compose -->
          <div v-else-if="prodTab === 'compose'" class="prod-content" :class="{ 'video-aspect-portrait': isPortraitDramaAspect }">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">{{ sbs.length }} 个镜头</span>
              <span class="tag mono">{{ composedCount }}/{{ sbs.length }} 已合成</span>
              <div class="ml-auto flex gap-1">
                <button class="btn btn-sm" :disabled="assistantRunning" @click="batchCompose">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  批量合成
                </button>
              </div>
            </div>
            <div class="prod-grid" :class="{ 'prod-grid-portrait': isPortraitDramaAspect }">
              <div v-for="(sb, i) in sbs" :key="sb.id" class="card prod-card prod-card-lazy">
                <ProdVideoCover
                  v-if="hasComposed(sb) || hasVid(sb)"
                  :video-url="hasComposed(sb) ? '/' + getComposedVideoUrl(sb) : displayUrl(getVideoUrl(sb))"
                  :poster-url="getStoryboardCover(sb) ? gridUrl(getStoryboardCover(sb)) : ''"
                  :index-label="`#${String(i + 1).padStart(2, '0')}`"
                  :portrait="isPortraitDramaAspect"
                  :show-play="false"
                >
                  <template #badges>
                    <span v-if="hasComposed(sb)" class="prod-overlay-badge">已合成</span>
                  </template>
                </ProdVideoCover>
                <ProdVideoEmptyPreview
                  v-else
                  :cover-url="hasImg(sb) ? gridUrl(getStoryboardCover(sb)) : ''"
                  :index-label="`#${String(i + 1).padStart(2, '0')}`"
                  :portrait="isPortraitDramaAspect"
                  :compact="false"
                  empty-title="暂无成片"
                  empty-hint="请先生成镜头视频"
                  @preview-cover="openImageViewer(displayUrl(getStoryboardCover(sb)), `镜头 #${String(i + 1).padStart(2, '0')} 参考图`)"
                />
                <div class="prod-info">
                  <div class="prod-desc truncate">{{ sb.description || sb.title || '—' }}</div>
                  <div class="prod-meta-line">{{ sb.shot_type || sb.shotType || '未设景别' }} · {{ sb.duration || 10 }}s</div>
                  <div class="prod-dots">
                    <span :class="['dot', hasVid(sb) && 'ok']" /><span style="font-size:10px">视频</span>
                    <span :class="['dot', hasTTS(sb) && 'ok']" /><span style="font-size:10px">配音</span>
                    <span :class="['dot', hasComposed(sb) && 'ok', isPendingCompose(sb.id) && 'pending']" /><span style="font-size:10px">{{ isPendingCompose(sb.id) ? '合成中' : '合成' }}</span>
                    <GenerationTimer v-if="isPendingCompose(sb.id)" :task-key="composeTimerKey(sb.id)" />
                  </div>
                  <div v-if="composeFailMessage(sb.id)" class="prod-error">{{ composeFailMessage(sb.id) }}</div>
                </div>
                <div class="prod-actions">
                  <button class="btn btn-sm" :disabled="!hasVid(sb) || isPendingCompose(sb.id) || assistantRunning" @click="doCompose(sb)">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    {{ isPendingCompose(sb.id) ? '合成中' : (hasComposed(sb) ? '重新合成' : '开始合成') }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Production Navigator -->
        </template>
      </div>

      <!-- ===== EXPORT PANEL ===== -->
      <div v-else class="content-panel">
        <div v-if="!sbs.length" class="step-empty" style="flex:1">
          <div class="empty-visual">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
          <div class="empty-title">尚未准备就绪</div>
          <div class="empty-desc">请先完成分镜和制作流程</div>
          <button class="btn btn-primary" @click="panel = 'script'">前往剧本</button>
        </div>
        <div v-else class="export-split">
          <div class="export-main">
            <template v-if="mergeUrl">
              <video :src="'/' + mergeUrl" controls class="export-video" />
              <div class="export-bar">
                <span class="tag tag-success">拼接完成</span>
                <span class="dim" style="font-size:12px">{{ sbs.length }} 镜头 · {{ totalDuration }}s</span>
                <a :href="'/' + mergeUrl" download class="btn btn-primary ml-auto">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  下载视频
                </a>
              </div>
            </template>
            <template v-else>
              <div class="step-empty">
                <div class="empty-visual">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                </div>
                <div class="empty-title">拼接全集视频</div>
                <div class="empty-desc">将 {{ composedCount }} 个已合成镜头拼接为完整视频</div>
                <button class="btn btn-primary" :disabled="composedCount === 0 || assistantRunning" @click="doMerge" style="margin-top:12px">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  开始拼接
                </button>
              </div>
            </template>
          </div>
          <div class="export-list">
            <div class="export-list-head">镜头概览</div>
            <div class="export-list-body">
              <div v-for="(sb, i) in sbs" :key="sb.id" class="exp-row">
                <span class="mono dim" style="font-size:10px">#{{ String(i+1).padStart(2,'0') }}</span>
                <span class="truncate" style="flex:1;font-size:11px">{{ sb.description || sb.title || '—' }}</span>
                <span :class="['dot', hasComposed(sb) && 'ok']" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="showBottomBubble" class="step-bubble">
        <button
          v-if="panel === 'script'"
          class="bubble-btn"
          :disabled="scriptStep === 0"
          @click="goPrevStep"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          {{ prevStepLabel || '上一步' }}
        </button>
        <button
          v-else-if="panel === 'production'"
          class="bubble-btn"
          :disabled="prodTabIdx === 0"
          @click="prodTabIdx = Math.max(0, prodTabIdx - 1)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          {{ prodTabDefs[Math.max(0, prodTabIdx - 1)]?.label || '上一步' }}
        </button>

        <div class="bubble-dots">
          <button
            v-for="step in bubbleSteps"
            :key="step.key"
            :class="['bubble-dot', { done: step.done, current: step.key === activeBubbleKey }]"
            @click="goSubStep(step.key)"
            :title="step.label"
          ></button>
        </div>

        <button
          v-if="panel === 'script'"
          class="bubble-btn primary"
          :disabled="!canGoNext"
          @click="goNextStep"
        >
          {{ nextStepLabel || '下一步' }}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
        <button
          v-else-if="panel === 'production'"
          class="bubble-btn primary"
          :disabled="panel === 'production' && prodTab === 'compose' && !canExport"
          @click="goNextProd"
        >
          {{ prodTabIdx < prodTabDefs.length - 1 ? (prodTabDefs[prodTabIdx + 1]?.label || '下一步') : '进入导出' }}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>

      <div v-if="imageViewer.open && imageViewer.src" class="overlay image-viewer-overlay" @click.self="closeImageViewer">
        <div class="card image-viewer-dialog">
          <div class="image-viewer-head">
            <div class="image-viewer-title">{{ imageViewer.title || '图片预览' }}</div>
            <button class="btn btn-ghost btn-icon" @click="closeImageViewer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="image-viewer-body">
            <img :src="imageViewer.src" :alt="imageViewer.title || '图片预览'" class="image-viewer-img" />
          </div>
        </div>
      </div>

      <div
        v-if="videoViewer.open && videoViewer.src"
        class="overlay image-viewer-overlay video-viewer-overlay"
        @mousedown="onVideoViewerOverlayMouseDown"
        @click="onVideoViewerOverlayClick"
      >
        <div class="card image-viewer-dialog video-viewer-dialog">
          <div class="image-viewer-head">
            <div class="image-viewer-title">{{ videoViewer.title || '视频预览' }}</div>
            <div class="image-viewer-actions">
              <button
                v-if="videoViewer.downloadRaw"
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="videoDownloading"
                @click="downloadCurrentVideo"
              >
                {{ videoDownloading ? '下载中…' : '下载视频' }}
              </button>
              <button class="btn btn-ghost btn-icon" @click="closeVideoViewer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="image-viewer-body video-viewer-body">
            <video
              ref="videoViewerEl"
              :src="videoViewer.src"
              class="video-viewer-player"
              controls
              autoplay
              playsinline
              @click.stop
            />
          </div>
        </div>
      </div>
    </main>

    <div v-if="importModalOpen" class="overlay" @click.self="importModalOpen = false">
      <div class="card import-script-dialog">
        <div class="image-viewer-head">
          <div class="image-viewer-title">粘贴工业分镜脚本</div>
          <button class="btn btn-ghost btn-icon" @click="importModalOpen = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <p class="dim" style="font-size:12px;margin:0 0 10px">
          请粘贴 <strong>DeepSeek 生成的完整工业分镜</strong>（镜头标题如「户部尚书跪地/为难」），
          <strong>不要</strong>粘贴「红果竖屏导演脚本提示词.txt」里的模板示例（「动作描述/角色标签」）。
        </p>
        <textarea v-model="importText" class="import-script-textarea" rows="16" placeholder="粘贴 模型结果.txt 或 DeepSeek 输出的工业分镜..." />
        <div class="import-script-actions">
          <button class="btn" @click="importModalOpen = false">取消</button>
          <button class="btn btn-primary" :disabled="importLoading" @click="doImportShotPlans">
            <Loader2 v-if="importLoading" :size="13" class="animate-spin" />
            导入
          </button>
        </div>
      </div>
    </div>

    <AssetPickerModal
      :open="assetPicker.open"
      :type="assetPicker.type"
      :drama-id="dramaId"
      :title="assetPickerTitle"
      :confirm-before-select="assetPicker.type === 'costume'"
      confirm-label="确认生成换装图"
      confirm-hint="将基于角色基准图（图1）与定稿服装（图2）生成换装图，默认修正为自然表情并替换破损服装"
      @close="closeAssetPicker"
      @select="applyPickedAsset"
    />

    <AssetPickerModal
      :key="videoRefPicker.key"
      :open="videoRefPicker.open"
      type="reference"
      title="从参考图库选择"
      @close="videoRefPicker.open = false"
      @select="applyVideoReferencePick"
    />

    <VoiceAssetPickerModal
      :open="voiceRefPicker.open"
      :voices="voiceAssets"
      :selected="voiceRefPicker.storyboard ? getStoryboardVoiceRefs(voiceRefPicker.storyboard) : []"
      @close="voiceRefPicker.open = false"
      @confirm="applyStoryboardVoiceRefs"
    />

    <SceneAngleRegenModal
      :open="sceneAngleRegen.open"
      :scene-location="sceneAngleRegen.sceneLocation"
      :angle-id="sceneAngleRegen.angleId"
      :angle-label="sceneAngleRegen.angleLabel"
      :image-url="sceneAngleRegen.imageUrl"
      :initial-prompt="sceneAngleRegen.prompt"
      :default-prompt="sceneAngleRegen.defaultPrompt"
      :disabled="isPendingSceneAngle(sceneAngleRegen.sceneId, sceneAngleRegen.angleId)"
      :is-sheet="sceneAngleRegen.isSheet"
      @close="closeSceneAngleRegen"
      @confirm="confirmSceneAngleRegen"
      @preview="openImageViewer($event, sceneAngleRegen.previewTitle)"
    />

    <VideoHistoryModal
      :open="videoHistory.open"
      :storyboard-id="videoHistory.storyboardId"
      :storyboard-title="videoHistory.title"
      :current-video-url="videoHistory.currentVideoUrl"
      @close="closeVideoHistory"
      @selected="applyVideoHistorySelection"
    />

    <VideoPromptEditorModal
      :open="videoPromptEditor.open"
      :storyboard-id="videoPromptEditor.storyboardId"
      :shot-label="videoPromptEditor.shotLabel"
      :initial-prompt="videoPromptEditor.initialPrompt"
      :video-model-label="lockedVideoConfigLabel"
      :context-lines="videoPromptEditor.contextLines"
      :prompt-send-limit="isChengmengVideoActive ? CHENGMENT_PROMPT_MAX_LENGTH : null"
      :prompt-reference-image-count="videoPromptEditorReferenceImageCount"
      @close="closeVideoPromptEditor"
      @saved="onVideoPromptEditorSaved"
    />

    <ManualEntityModal
      :open="manualEntity.open"
      :type="manualEntity.type"
      :drama-id="dramaId"
      :episode-id="epId"
      @close="closeManualEntity"
      @created="refresh"
    />

    <EpisodeAssistantPanel
      v-if="epId"
      v-model:input="assistantInput"
      :messages="assistantMessages"
      :running="assistantRunning"
      :loading-history="assistantLoadingHistory"
      :quick-chips="assistantQuickChips"
      :agent-type="assistantAgentType"
      :step-label="assistantStepLabel"
      :disabled="assistantDisabled"
      :collapsed="!assistantOpen"
      :selected-storyboard="assistantSelectedStoryboard"
      :characters="chars"
      :scenes="scenes"
      :storyboards="sbs"
      @send="(text) => assistantSend(text, refresh)"
      @stop="assistantStop"
      @clear="assistantClearHistory"
      @toggle="toggleAssistant"
      @navigate="onAssistantNavigate"
    />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { toast } from 'vue-sonner'
import {
  Users, MapPin, Video, ImageIcon, Layers, Mic2, FileText, FolderKanban, Clapperboard, Download, Loader2, Sparkles, Music,
} from 'lucide-vue-next'
import { dramaAPI, episodeAPI, storyboardAPI, characterAPI, sceneAPI, assetAPI, imageAPI, videoAPI, composeAPI, mergeAPI, gridAPI, aiConfigAPI, voicesAPI, uploadAPI } from '~/composables/useApi'
import { useEpisodeAssistant } from '~/composables/useEpisodeAssistant'
import BaseSelect from '~/components/BaseSelect.vue'
import AssetPickerModal from '~/components/AssetPickerModal.vue'
import SceneAngleRegenModal from '~/components/SceneAngleRegenModal.vue'
import VideoHistoryModal from '~/components/VideoHistoryModal.vue'
import VideoPromptEditorModal from '~/components/VideoPromptEditorModal.vue'
import ProdVideoCover from '~/components/ProdVideoCover.vue'
import ProdVideoEmptyPreview from '~/components/ProdVideoEmptyPreview.vue'
import ManualEntityModal from '~/components/ManualEntityModal.vue'
import StoryboardBlockingPanel from '~/components/StoryboardBlockingPanel.vue'
import FusionImagePanel from '~/components/FusionImagePanel.vue'
import VoiceLibraryPanel from '~/components/VoiceLibraryPanel.vue'
import VoiceAssetPickerModal from '~/components/VoiceAssetPickerModal.vue'
import { parseVoiceRefs, formatVoiceDuration, MAX_VOICE_REFS } from '~/utils/voice-refs.js'
import { buildOrderedVideoContentRefs, buildPromptOrderedDisplayItems, validatePromptImageRefs, formatPromptImageRefIssues, assignDisplayImageIndices } from '~/utils/video-ref-order.js'
import { removePromptImageLabel } from '~/utils/studio-video-refs.js'
import { CHENGMENT_PROMPT_MAX_LENGTH, countChengmengReferenceAudios, countChengmengReferenceImages, estimateChengmengPromptLength, formatVideoPromptOverLimitMessage } from '~/utils/chengmeng-prompt.js'
import { mediaDisplayUrl, mediaGridUrl, prefetchMediaUrls, normalizeMediaPath } from '~/utils/media-url.js'
import { buildVideoDownloadFilename, downloadMediaFile } from '~/utils/download-media.js'
import { CHARACTER_IMAGE_TRANSFORMS, supportsImageReference, imageReferenceSupportHint, resolveImageConfigModel } from '~/utils/character-image-transforms.js'
import { listCharacterImages, listCharacterOutfits, parseStoryboardCharacterImageRefs, resolveCharacterImageUrl, variantLabel, charTransformKey, charOutfitKey } from '~/utils/character-image-variants.js'
import {
  SCENE_ANGLE_PRESETS,
  SCENE_ANGLE_SHEET_ID,
  SCENE_ANGLE_SHEET_LABEL,
  buildSceneAnglePrompt,
  buildSceneAngleSheetPrompt,
  listSceneImages,
  listSceneImagesForStoryboard,
  listSceneImagesWithStoryboardBlockings,
  resolveSceneImageUrl,
  resolveSceneImageForStoryboard,
  sceneAngleKey,
  sceneAngleLabel,
} from '~/utils/scene-image-variants.js'
import {
  getBlockingImage,
  resolveBlockingLayout,
  updateBlockingLayoutEntry,
  blockingShotModeHint,
  getBlockingImageIndexFromPromptItems,
  buildBlockingColorLegend,
  buildBlockingVideoPromptSnippet,
} from '~/utils/blocking-layout.js'
import { formatImageGenerationError } from '~/utils/image-generation-error.js'
import { getCharacterImagePrompt, getSceneImagePrompt as resolveSceneImagePromptText } from '~/utils/image-prompt-templates.js'

definePageMeta({ layout: 'studio' })

const route = useRoute()
const dramaId = Number(route.params.id)
const episodeNumber = computed(() => Number(route.params.episodeNumber))

const drama = ref(null), episode = ref(null), chars = ref([]), scenes = ref([]), sbs = ref([]), mergeData = ref(null)
const shotPlans = ref([])
const clips = ref([])
const selectedPlan = ref(null)
const importModalOpen = ref(false)
const importText = ref('')
const importLoading = ref(false)
const generateLoading = ref(false)
const clipMoveLoading = ref(false)
const panel = ref('script')
const pageLoading = ref(true)
const pageError = ref('')

const localRaw = ref(''), localScript = ref('')
const rawContent = computed(() => episode.value?.content || '')
const scriptContent = computed(() => episode.value?.script_content || episode.value?.scriptContent || '')
const epId = computed(() => episode.value?.id || 0)
const rawLen = computed(() => localRaw.value.replace(/\s/g, '').length || 0)
const scriptLen = computed(() => localScript.value.replace(/\s/g, '').length || 0)
const charsVoiced = computed(() => chars.value.filter(c => c.voice_style || c.voiceStyle).length)
const voiceSampleCount = computed(() => chars.value.filter(c => c.voice_sample_url || c.voiceSampleUrl).length)
const composedCount = computed(() => sbs.value.filter(s => s.composed_video_url || s.composedVideoUrl).length)
const mergeUrl = computed(() => mergeData.value?.merged_url || mergeData.value?.mergedUrl || null)

const scriptStep = ref(0)
const prodTab = ref('chars')
const productionPanelBlocked = computed(() => {
  if (['chars', 'scenes', 'fusion'].includes(prodTab.value)) return false
  if (!scriptContent.value) return true
  if (useShotPlanWorkflow.value) return !hasProductionClips.value
  return !sbs.value.length
})

const hasLegacyStoryboards = computed(() =>
  sbs.value.some(sb => {
    const src = sb.clip_source || sb.clipSource
    return !src || src === 'legacy'
  }),
)
const useShotPlanWorkflow = computed(() => shotPlans.value.length > 0 || !hasLegacyStoryboards.value)
const hasProductionClips = computed(() => {
  if (useShotPlanWorkflow.value) {
    return sbs.value.some(sb => {
      const src = sb.clip_source || sb.clipSource
      return src && src !== 'legacy'
    })
  }
  return sbs.value.length > 0
})
const planTotalDuration = computed(() =>
  shotPlans.value.reduce((s, p) => s + (Number(p.duration) || 2), 0),
)
const newWorkflowClips = computed(() =>
  clips.value.length
    ? clips.value.filter(c => {
        const src = c.clip_source || c.clipSource
        return src && src !== 'legacy'
      })
    : sbs.value.filter(sb => {
        const src = sb.clip_source || sb.clipSource
        return src && src !== 'legacy'
      }),
)

const prodTabIdx = computed({
  get: () => prodTabDefs.value.findIndex(t => t.id === prodTab.value),
  set: (v) => { prodTab.value = prodTabDefs.value[v]?.id || 'chars' },
})
const frameMode = ref('first')
const fallbackVoiceProfiles = [
  { id: 'alloy', label: 'Alloy', gender: '中性', traits: '平衡、自然、克制', suitable: '通用叙述、旁白、需要稳定输出的角色' },
  { id: 'echo', label: 'Echo', gender: '男声', traits: '低沉、稳重、冷静', suitable: '成熟男性、父辈、旁白、压迫感角色' },
  { id: 'fable', label: 'Fable', gender: '男声', traits: '温暖、讲述感、表现力强', suitable: '男主、成长型角色、叙事担当' },
  { id: 'onyx', label: 'Onyx', gender: '男声', traits: '深沉、有力、权威', suitable: '反派、强势角色、掌控型人物' },
  { id: 'nova', label: 'Nova', gender: '女声', traits: '温柔、甜润、亲和', suitable: '女主、母亲、柔和配角' },
  { id: 'shimmer', label: 'Shimmer', gender: '女声', traits: '明亮、活泼、年轻', suitable: '少女、轻快角色、跳脱配角' },
]
const voiceProfiles = ref(fallbackVoiceProfiles)
const voiceAssets = ref([])
const voiceRefPicker = ref({ open: false, storyboard: null })
const voiceSelectOptions = computed(() => voiceProfiles.value.map(v => ({ label: `${v.label} · ${v.traits}`, value: v.id })))
const frameModeOptions = [{ label: '仅首帧', value: 'first' }, { label: '首尾帧', value: 'first_last' }]
const imageAspectOptions = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
]
const imageAspectSaving = ref(false)
const dramaImageAspect = computed(() => drama.value?.image_aspect_ratio || drama.value?.imageAspectRatio || '9:16')
const isPortraitDramaAspect = computed(() => dramaImageAspect.value !== '16:9')
const dramaImageSizeLabel = computed(() => (dramaImageAspect.value === '16:9' ? '1280×720' : '720×1280'))
const videoResolutionLabel = computed(() => '720p')
const dramaImageAspectLabel = computed(() => `${dramaImageAspect.value} · ${videoResolutionLabel.value}`)
// 画面比例影响图片/视频生成，团队普通成员也需可改（不限于管理员）
const showImageSizeControl = computed(() => panel.value === 'production')
const gridLayoutOptions = [
  { label: '2x2', value: '2x2' },
  { label: '3x3', value: '3x3' },
  { label: '4x4', value: '4x4' },
  { label: '5x5', value: '5x5' },
]
const imageConfigs = ref([])
const videoConfigs = ref([])
const audioConfigs = ref([])
const pendingCharImageIds = ref([])
const pendingCharUploadIds = ref([])
const pendingCharTransformKeys = ref([])
const pendingCharOutfitKeys = ref([])
const pendingSceneImageIds = ref([])
const pendingSceneUploadIds = ref([])
const pendingSceneAngleKeys = ref([])
const pendingShotFrameKeys = ref([])
const pendingBlockingIds = ref([])
const blockingAssistantMsgIds = ref({})
const pendingVideoIds = ref([])
const activeVideoGenerationByStoryboard = ref({})
const videoPollInFlight = ref({})
const pendingComposeIds = ref([])
const genTimer = useGenerationTimer()
const GRID_TIMER_KEY = 'grid:main'

function blockingTimerKey(id) { return `blocking:${id}` }
function frameTimerKey(id, frameType) { return `frame:${id}:${frameType}` }
function videoTimerKey(id) { return `video:${id}` }
function charTimerKey(id) { return `char:${id}` }
function charTransformTimerKey(key) { return `char-transform:${key}` }
function charOutfitTimerKey(key) { return `char-outfit:${key}` }
function sceneTimerKey(id) { return `scene:${id}` }
function sceneAngleTimerKey(key) { return `scene-angle:${key}` }
function composeTimerKey(id) { return `compose:${id}` }
function sceneAngleTimerKeyFor(sceneId, angleId) {
  return sceneAngleTimerKey(sceneAngleKey(sceneId, angleId))
}
function charTransformTimerKeyFor(charId, transformId, source = 'primary') {
  return charTransformTimerKey(charTransformKey(charId, transformId, source))
}

const failedVideoMessages = ref({})
const prodCardDetailOpen = ref({})
const prodCardDetailMounted = ref({})
const failedComposeMessages = ref({})
const imageViewer = ref({ open: false, src: '', title: '' })
const videoViewer = ref({ open: false, src: '', title: '', downloadRaw: '' })
const videoViewerEl = ref(null)
const videoViewerOverlayMouseDown = ref(false)
const videoDownloading = ref(false)
const videoDownloadShotId = ref(null)
const videoHistory = ref({ open: false, storyboardId: null, title: '', currentVideoUrl: '' })
const videoPromptEditor = ref({
  open: false,
  storyboardId: null,
  shotLabel: '',
  initialPrompt: '',
  contextLines: [],
})
const manualEntity = ref({ open: false, type: 'character' })
const videoGenCounts = ref({})
const assetPicker = ref({ open: false, type: 'character', targetId: null })
const videoRefPicker = ref({ open: false, sbId: null, key: 0 })
const sceneAnglePromptDrafts = ref({})
const blockingPromptDrafts = ref({})
const sceneAngleRegen = ref({
  open: false,
  sceneId: null,
  sceneLocation: '',
  angleId: '',
  angleLabel: '',
  imageUrl: '',
  prompt: '',
  defaultPrompt: '',
  previewTitle: '',
  isSheet: false,
})

const assetPickerTitle = computed(() => {
  if (assetPicker.value.type === 'scene') return '选择场景资产'
  if (assetPicker.value.type === 'costume') return '选择服装资产'
  return '选择人物资产'
})

function configLabel(config) {
  if (!config) return '未配置'
  let modelName = ''
  try { const m = JSON.parse(config.model || '[]'); modelName = Array.isArray(m) ? (m[0] || '') : (m || '') } catch { modelName = config.model || '' }
  return modelName ? `${config.name} · ${modelName} (${config.provider})` : `${config.name} (${config.provider})`
}

function isPendingCharImage(id) {
  return pendingCharImageIds.value.includes(id)
}

function isPendingCharUpload(id) {
  return pendingCharUploadIds.value.includes(id)
}

function isPendingCharTransform(charId, transformId, source = 'primary') {
  return pendingCharTransformKeys.value.includes(charTransformKey(charId, transformId, source))
}

function isPendingCharOutfit(charId, outfitKey) {
  return pendingCharOutfitKeys.value.includes(outfitKey)
}

function charHasImage(char) {
  return !!(char?.image_url || char?.imageUrl)
}

function charTransformDisabled(char, source = 'primary') {
  if (isPendingCharImage(char.id) || !imageReferenceSupported.value) return true
  if (source === 'primary') return !charHasImage(char)
  return !getCharacterOutfits(char).some(item => item.outfit_id === source)
}

function charOutfitDisabled(char) {
  return isPendingCharImage(char.id) || !charHasImage(char) || !imageReferenceSupported.value
}

function charTransformTitle(char, preset, source = 'primary') {
  if (source === 'primary' && !charHasImage(char)) return '请先生成或上传角色原图'
  if (source !== 'primary' && charTransformDisabled(char, source)) return '请先生成该套换装图'
  if (!imageReferenceSupported.value) return imageReferenceSupportHint()
  const scope = source === 'primary' ? '原图' : '该套服装'
  return `${preset.description}（基于${scope}生成变体，不覆盖原图）`
}

function openImageViewer(src, title = '') {
  if (!src) return
  imageViewer.value = { open: true, src, title }
}

function closeImageViewer() {
  imageViewer.value = { open: false, src: '', title: '' }
}

function openVideoViewer(src, title = '', downloadRaw = '') {
  if (!src) return
  videoViewer.value = { open: true, src, title, downloadRaw: downloadRaw || '' }
}

function closeVideoViewer() {
  if (videoViewerEl.value) videoViewerEl.value.pause()
  videoViewer.value = { open: false, src: '', title: '', downloadRaw: '' }
}

function storyboardVideoDownloadName(sb, index = null) {
  const num = index != null ? index + 1 : (sb?.storyboard_number ?? sb?.storyboardNumber)
  return buildVideoDownloadFilename({
    dramaTitle: drama.value?.title,
    episodeNumber: episodeNumber.value,
    storyboardNumber: num,
    title: sb?.title || sb?.description,
  })
}

async function downloadStoryboardVideo(sb, index = null) {
  const raw = getVideoUrl(sb)
  if (!raw || videoDownloadShotId.value != null) return
  videoDownloadShotId.value = sb.id
  try {
    await downloadMediaFile(raw, storyboardVideoDownloadName(sb, index))
    toast.success('开始下载')
  } catch (e) {
    toast.error(e?.message || '下载失败')
  } finally {
    videoDownloadShotId.value = null
  }
}

async function downloadCurrentVideo() {
  const raw = videoViewer.value.downloadRaw
  if (!raw || videoDownloading.value) return
  videoDownloading.value = true
  try {
    await downloadMediaFile(raw, buildVideoDownloadFilename({
      dramaTitle: drama.value?.title,
      episodeNumber: episodeNumber.value,
      title: videoViewer.value.title,
    }))
    toast.success('开始下载')
  } catch (e) {
    toast.error(e?.message || '下载失败')
  } finally {
    videoDownloading.value = false
  }
}

function onVideoViewerOverlayMouseDown(event) {
  videoViewerOverlayMouseDown.value = event.target === event.currentTarget
}

function onVideoViewerOverlayClick(event) {
  if (videoViewerOverlayMouseDown.value && event.target === event.currentTarget) {
    closeVideoViewer()
  }
  videoViewerOverlayMouseDown.value = false
}

function videoGenCount(storyboardId) {
  return videoGenCounts.value[storyboardId] || 0
}

function openVideoHistory(sb, index = null) {
  if (!sb?.id) return
  const idx = index != null ? index : sbs.value.findIndex(item => item.id === sb.id)
  const label = idx >= 0 ? `镜头 #${String(idx + 1).padStart(2, '0')} 视频历史` : '镜头视频历史'
  videoHistory.value = {
    open: true,
    storyboardId: sb.id,
    title: label,
    currentVideoUrl: getVideoUrl(sb) || '',
  }
}

function closeVideoHistory() {
  videoHistory.value = { ...videoHistory.value, open: false }
}

async function applyVideoHistorySelection(payload) {
  const { storyboardId, videoUrl } = payload || {}
  if (!storyboardId || !videoUrl) return
  try {
    await storyboardAPI.update(storyboardId, { video_url: videoUrl })
    toast.success('已切换当前视频')
    closeVideoHistory()
    await refresh()
    await loadVideoGenCounts()
  } catch (e) {
    toast.error(e.message || '切换视频失败')
  }
}

async function loadVideoGenCounts() {
  try {
    const rows = await videoAPI.list({ drama_id: dramaId })
    const counts = {}
    for (const row of rows || []) {
      const sid = row?.storyboard_id ?? row?.storyboardId
      if (!sid) continue
      counts[sid] = (counts[sid] || 0) + 1
    }
    videoGenCounts.value = counts
  } catch {
    videoGenCounts.value = {}
  }
}

function buildVideoPromptContextLines(sb) {
  if (!sb) return []
  const sceneId = sb.scene_id || sb.sceneId
  const scene = scenes.value.find(s => s.id === sceneId)
  return [
    sb.description || sb.title ? `描述：${sb.description || sb.title}` : '',
    sb.shot_type || sb.shotType ? `景别：${sb.shot_type || sb.shotType}` : '',
    sb.duration ? `时长：${sb.duration}s` : '',
    getStoryboardCharacterNames(sb).length ? `角色：${getStoryboardCharacterNames(sb).join('、')}` : '',
    scene?.location || sb.location ? `场景：${scene?.location || sb.location}` : '',
    sb.dialogue ? `对白：${sb.dialogue}` : '',
  ].filter(Boolean)
}

function openVideoPromptEditor(sb, index = null) {
  if (!sb?.id) return
  const idx = index != null ? index : sbs.value.findIndex(item => item.id === sb.id)
  videoPromptEditor.value = {
    open: true,
    storyboardId: sb.id,
    shotLabel: idx >= 0 ? `镜头 #${String(idx + 1).padStart(2, '0')}` : '镜头',
    initialPrompt: sb.video_prompt || sb.videoPrompt || '',
    contextLines: buildVideoPromptContextLines(sb),
  }
}

function closeVideoPromptEditor() {
  videoPromptEditor.value = { ...videoPromptEditor.value, open: false }
}

function openManualEntity(type) {
  manualEntity.value = { open: true, type }
}

function closeManualEntity() {
  manualEntity.value = { ...manualEntity.value, open: false }
}

function onVideoPromptEditorSaved(payload) {
  const { storyboardId, videoPrompt } = payload || {}
  const sb = sbs.value.find(item => item.id === storyboardId)
  if (sb) {
    sb.video_prompt = videoPrompt
    sb.videoPrompt = videoPrompt
    if (selectedSb.value?.id === storyboardId) {
      selectedSb.value.video_prompt = videoPrompt
      selectedSb.value.videoPrompt = videoPrompt
    }
  }
}

function openAssetPicker(type, targetId) {
  assetPicker.value = { open: true, type, targetId }
}

function closeAssetPicker() {
  assetPicker.value = { ...assetPicker.value, open: false }
}

async function applyPickedAsset(payload) {
  const asset = payload?.asset || payload
  const customPrompt = payload?.prompt
  const { type, targetId } = assetPicker.value
  if (!asset?.id || !targetId) return
  try {
    if (type === 'costume') {
      await generateCharOutfit(targetId, asset, customPrompt)
      closeAssetPicker()
      return
    }
    if (type === 'character') {
      await assetAPI.applyToCharacter(asset.id, targetId)
      const char = chars.value.find(item => item.id === targetId)
      const url = asset.url || asset.local_path || asset.localPath
      if (char && url) {
        char.image_url = url
        char.imageUrl = url
      }
      toast.success('已应用人物资产')
    } else {
      await assetAPI.applyToScene(asset.id, targetId)
      const scene = scenes.value.find(item => item.id === targetId)
      const url = asset.url || asset.local_path || asset.localPath
      if (scene && url) {
        scene.image_url = url
        scene.imageUrl = url
      }
      toast.success('已应用场景资产')
    }
    closeAssetPicker()
    await refresh()
  } catch (e) {
    toast.error(e?.message || '应用资产失败')
  }
}

function handleImageViewerKeydown(event) {
  if (event.key === 'Escape' && videoViewer.value.open) closeVideoViewer()
  if (event.key === 'Escape' && imageViewer.value.open) closeImageViewer()
}

onMounted(() => {
  window.addEventListener('keydown', handleImageViewerKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleImageViewerKeydown)
})

function isPendingSceneImage(id) {
  return pendingSceneImageIds.value.includes(id)
}

function isPendingSceneUpload(id) {
  return pendingSceneUploadIds.value.includes(id)
}

function framePendingKey(id, frameType) {
  return `${id}:${frameType}`
}

function isPendingShotFrame(id, frameType) {
  return pendingShotFrameKeys.value.includes(framePendingKey(id, frameType))
}

function isPendingBlocking(id) {
  return pendingBlockingIds.value.includes(id)
}

function getBlockingLayout(sb) {
  return resolveBlockingLayout(sb?.blocking_layout || sb?.blockingLayout, getStoryboardCharacterIds(sb))
}

function onBlockingEntryChange(sb, characterId, patch) {
  const layout = updateBlockingLayoutEntry(getBlockingLayout(sb), characterId, patch)
  sb.blocking_layout = layout
  sb.blockingLayout = layout
  storyboardAPI.update(sb.id, { blocking_layout: layout })
}

function onBlockingNotesBlur(sb, notes) {
  const layout = { ...getBlockingLayout(sb), notes: notes.trim() }
  sb.blocking_layout = layout
  sb.blockingLayout = layout
  storyboardAPI.update(sb.id, { blocking_layout: layout })
}

function blockingDisableReason(sb) {
  if (!sb || isPendingBlocking(sb.id)) return ''
  if (!getStoryboardCharacterIds(sb).length) return '请先在分镜中绑定角色（剧本 → 分镜列表）'
  if (!imageReferenceSupported.value) return imageReferenceSupportHint()
  const sceneId = sb.scene_id || sb.sceneId
  if (!sceneId) return '请先在分镜中绑定场景'
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!resolveSceneImageForStoryboard(scene, sb)) return '请先生成场景图，或在分镜中选择已有场景视角'
  const missingId = getStoryboardCharacterIds(sb).find(charId => {
    const char = chars.value.find(item => item.id === charId)
    return !resolveCharacterImageUrl(char, getStoryboardCharacterImageRefs(sb))
  })
  if (missingId) return `角色「${getCharacterName(missingId)}」缺少参考图，请先在角色图片页生成`
  return ''
}

function blockingGenerateDisabled(sb) {
  if (!sb) return true
  if (isPendingBlocking(sb.id)) return true
  return !!blockingDisableReason(sb)
}

function getBlockingShotModeHint(sb) {
  if (!sb) return ''
  return blockingShotModeHint(sb, getStoryboardCharacterIds(sb).length)
}

function getBlockingPromptDraft(sb) {
  if (!sb) return ''
  return blockingPromptDrafts.value[sb.id] || ''
}

async function genBlocking(sb, prompt) {
  const reason = blockingDisableReason(sb)
  if (reason) {
    toast.warning(reason)
    return
  }
  if (prompt?.trim()) blockingPromptDrafts.value[sb.id] = prompt.trim()
  const layout = getBlockingLayout(sb)
  if (!pendingBlockingIds.value.includes(sb.id)) pendingBlockingIds.value.push(sb.id)
  ensureAssistantVisible()
  const idx = shotIndex(sb)
  genTimer.startTask(blockingTimerKey(sb.id), `镜头 #${idx} 站位图`, 'image')
  const activity = await assistantRecordActivity(
    `为镜头 #${idx} 生成站位图`,
    '站位图生成中，请稍候…',
    [{
      kind: 'shot_blocking',
      id: sb.id,
      label: `镜头 #${idx} 站位图`,
      status: 'processing',
    }],
  )
  if (activity?.assistantMessageId) {
    blockingAssistantMsgIds.value = {
      ...blockingAssistantMsgIds.value,
      [sb.id]: activity.assistantMessageId,
    }
  }
  try {
    const res = await storyboardAPI.generateBlocking(sb.id, {
      blocking_layout: layout,
      ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
    })
    toast.success('站位图生成中…')
    pollBlockingGeneration(res?.image_generation_id, sb.id)
  } catch (e) {
    pendingBlockingIds.value = pendingBlockingIds.value.filter(item => item !== sb.id)
    genTimer.endTask(blockingTimerKey(sb.id))
    const msgId = blockingAssistantMsgIds.value[sb.id]
    if (msgId) {
      await assistantPatchActivity(msgId, {
        content: `站位图生成失败：${e?.message || '未知错误'}`,
        attachments: [{
          kind: 'shot_blocking',
          id: sb.id,
          label: `镜头 #${idx} 站位图`,
          status: 'failed',
        }],
      })
      const next = { ...blockingAssistantMsgIds.value }
      delete next[sb.id]
      blockingAssistantMsgIds.value = next
    }
    toast.error(e?.message || '站位图生成失败')
  }
}

async function pollBlockingGeneration(generationId, storyboardId) {
  if (!generationId) {
    pendingBlockingIds.value = pendingBlockingIds.value.filter(item => item !== storyboardId)
    genTimer.endTask(blockingTimerKey(storyboardId))
    return
  }
  const sbAtStart = sbs.value.find(item => item.id === storyboardId)
  const idxAtStart = sbAtStart ? shotIndex(sbAtStart) : storyboardId
  for (let i = 0; i < 120; i++) {
    await sleep(3000)
    try {
      const res = await imageAPI.get(generationId)
      await refresh()
      const sb = sbs.value.find(item => item.id === storyboardId)
      const idx = sb ? shotIndex(sb) : idxAtStart
      const msgId = blockingAssistantMsgIds.value[storyboardId]
      if (res?.status === 'completed') {
        pendingBlockingIds.value = pendingBlockingIds.value.filter(item => item !== storyboardId)
        genTimer.endTask(blockingTimerKey(storyboardId))
        if (msgId) {
          const blockingUrl = sb ? getBlockingImage(sb) : null
          await assistantPatchActivity(msgId, {
            content: '站位图已生成。',
            attachments: [{
              kind: 'shot_blocking',
              id: storyboardId,
              label: `镜头 #${idx} 站位图`,
              status: 'ready',
              url: blockingUrl ? `/${normalizeMediaPath(blockingUrl)}` : null,
            }],
          })
          const next = { ...blockingAssistantMsgIds.value }
          delete next[storyboardId]
          blockingAssistantMsgIds.value = next
        }
        toast.success('站位图已更新')
        return
      }
      if (res?.status === 'failed') {
        pendingBlockingIds.value = pendingBlockingIds.value.filter(item => item !== storyboardId)
        genTimer.endTask(blockingTimerKey(storyboardId))
        const errText = formatImageGenerationError(res?.error_msg || res?.errorMsg || '站位图生成失败')
        if (msgId) {
          await assistantPatchActivity(msgId, {
            content: `站位图生成失败：${errText}`,
            attachments: [{
              kind: 'shot_blocking',
              id: storyboardId,
              label: `镜头 #${idx} 站位图`,
              status: 'failed',
            }],
          })
          const next = { ...blockingAssistantMsgIds.value }
          delete next[storyboardId]
          blockingAssistantMsgIds.value = next
        }
        toast.error(errText)
        return
      }
    } catch {}
  }
  pendingBlockingIds.value = pendingBlockingIds.value.filter(item => item !== storyboardId)
  genTimer.endTask(blockingTimerKey(storyboardId))
  const msgId = blockingAssistantMsgIds.value[storyboardId]
  if (msgId) {
    await assistantPatchActivity(msgId, {
      content: '站位图生成超时，请稍后刷新查看。',
      attachments: [{
        kind: 'shot_blocking',
        id: storyboardId,
        label: `镜头 #${idxAtStart} 站位图`,
        status: 'failed',
      }],
    })
    const next = { ...blockingAssistantMsgIds.value }
    delete next[storyboardId]
    blockingAssistantMsgIds.value = next
  }
  toast.warning('站位图生成超时，请稍后刷新查看')
}

async function clearBlockingImage(sb) {
  sb.blocking_image = null
  sb.blockingImage = null
  try {
    await storyboardAPI.update(sb.id, { blocking_image: null })
    toast.success('已删除站位图')
  } catch (e) {
    toast.error(e?.message || '删除失败')
  }
}

async function genFirstFrameFromBlocking(sb, frameType = 'first_frame') {
  if (!getBlockingImage(sb)) {
    toast.warning('请先生成场景站位图')
    return
  }
  if (!imageReferenceSupported.value) {
    toast.error(imageReferenceSupportHint())
    return
  }
  const key = framePendingKey(sb.id, frameType)
  const label = frameType === 'first_frame' ? '首帧' : '尾帧'
  if (!pendingShotFrameKeys.value.includes(key)) pendingShotFrameKeys.value.push(key)
  genTimer.startTask(frameTimerKey(sb.id, frameType), `镜头 #${shotIndex(sb)} ${label}`, 'image')
  try {
    const res = await storyboardAPI.generateFrameFromBlocking(sb.id, { frame_type: frameType })
    toast.success(`从站位图生成${label}中…`)
    pollShotFrameGeneration(res?.image_generation_id, sb.id, frameType, key)
  } catch (e) {
    pendingShotFrameKeys.value = pendingShotFrameKeys.value.filter(item => item !== key)
    genTimer.endTask(frameTimerKey(sb.id, frameType))
    toast.error(e?.message || `从站位图生成${label}失败`)
  }
}

async function pollShotFrameGeneration(generationId, storyboardId, frameType, pendingKey) {
  if (!generationId) {
    pendingShotFrameKeys.value = pendingShotFrameKeys.value.filter(item => item !== pendingKey)
    genTimer.endTask(frameTimerKey(storyboardId, frameType))
    return
  }
  const label = frameType === 'first_frame' ? '首帧' : '尾帧'
  for (let i = 0; i < 120; i++) {
    await sleep(3000)
    try {
      const res = await imageAPI.get(generationId)
      await refresh()
      if (res?.status === 'completed') {
        pendingShotFrameKeys.value = pendingShotFrameKeys.value.filter(item => item !== pendingKey)
        genTimer.endTask(frameTimerKey(storyboardId, frameType))
        toast.success(`${label}已更新`)
        return
      }
      if (res?.status === 'failed') {
        pendingShotFrameKeys.value = pendingShotFrameKeys.value.filter(item => item !== pendingKey)
        genTimer.endTask(frameTimerKey(storyboardId, frameType))
        toast.error(formatImageGenerationError(res?.error_msg || res?.errorMsg || `${label}生成失败`))
        return
      }
    } catch {}
  }
  pendingShotFrameKeys.value = pendingShotFrameKeys.value.filter(item => item !== pendingKey)
  genTimer.endTask(frameTimerKey(storyboardId, frameType))
  toast.warning(`${label}生成超时，请稍后刷新查看`)
}

function onBlockingThumbClick(sb) {
  selectedSb.value = sb
  if (getBlockingImage(sb)) {
    openImageViewer(
      displayUrl(getBlockingImage(sb)),
      `镜头 #${String(sbs.value.indexOf(sb) + 1).padStart(2, '0')} 站位图`,
    )
  }
}

function isPendingVideo(id) {
  return pendingVideoIds.value.includes(id)
}

function isVideoGenerationSlow(storyboardId) {
  return genTimer.isSlow(videoTimerKey(storyboardId))
}

function isActiveVideoGeneration(storyboardId, generationId) {
  if (!generationId) return true
  return activeVideoGenerationByStoryboard.value[storyboardId] === generationId
}

function clearActiveVideoGeneration(storyboardId, generationId) {
  if (!isActiveVideoGeneration(storyboardId, generationId)) return
  const next = { ...activeVideoGenerationByStoryboard.value }
  delete next[storyboardId]
  activeVideoGenerationByStoryboard.value = next
}

function videoFailMessage(id) {
  return failedVideoMessages.value[id] || ''
}

function isProdCardDetailOpen(id) {
  return !!prodCardDetailOpen.value[id]
}

function isProdCardDetailMounted(id) {
  return !!prodCardDetailMounted.value[id]
}

function toggleProdCardDetail(id) {
  const next = !prodCardDetailOpen.value[id]
  prodCardDetailOpen.value = {
    ...prodCardDetailOpen.value,
    [id]: next,
  }
  if (next) {
    prodCardDetailMounted.value = {
      ...prodCardDetailMounted.value,
      [id]: true,
    }
  }
}

function isPendingCompose(id) {
  return pendingComposeIds.value.includes(id)
}

function composeFailMessage(id) {
  return failedComposeMessages.value[id] || ''
}

function isNarratorCharacter(char) {
  const text = `${char?.name || ''} ${char?.role || ''}`.toLowerCase()
  return text.includes('旁白') || text.includes('narrator') || text.includes('画外音')
}

const visualChars = computed(() => chars.value.filter(c => !isNarratorCharacter(c)))

const lockedImageConfigId = computed(() => episode.value?.image_config_id || episode.value?.imageConfigId || null)
const lockedVideoConfigId = computed(() => episode.value?.video_config_id || episode.value?.videoConfigId || null)
const resolvedVideoConfig = computed(() => {
  if (lockedVideoConfigId.value) {
    const cfg = videoConfigs.value.find(c => c.id === lockedVideoConfigId.value)
    if (cfg) return cfg
  }
  const active = [...videoConfigs.value]
    .filter(c => c.is_active !== false)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
  return active[0] || null
})
const lockedAudioConfigId = computed(() => episode.value?.audio_config_id || episode.value?.audioConfigId || null)
const lockedAudioProvider = computed(() => audioConfigs.value.find(c => c.id === lockedAudioConfigId.value)?.provider || '')
const resolvedImageConfig = computed(() => {
  const byEpisode = imageConfigs.value.find(c => c.id === lockedImageConfigId.value)
  if (byEpisode) return byEpisode
  const active = [...imageConfigs.value]
    .filter(c => c.is_active !== false)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
  return active[0] || null
})
const lockedImageConfigLabel = computed(() => configLabel(resolvedImageConfig.value))
const lockedImageConfigProvider = computed(() => resolvedImageConfig.value?.provider || '')
const imageReferenceSupported = computed(() =>
  supportsImageReference(lockedImageConfigProvider.value, resolveImageConfigModel(resolvedImageConfig.value)),
)
const lockedVideoConfigLabel = computed(() => {
  const cfg = resolvedVideoConfig.value
  if (!cfg) return '未配置'
  const prefix = lockedVideoConfigId.value ? '' : '默认 · '
  return prefix + configLabel(cfg)
})
const isChengmengVideoActive = computed(() => resolvedVideoConfig.value?.provider === 'chengmeng')

const videoPromptEditorReferenceImageCount = computed(() => {
  const sb = sbs.value.find(item => item.id === videoPromptEditor.value.storyboardId)
  if (!sb) return 0
  return countChengmengReferenceImages(buildVideoContentRefs(sb))
})
const isSeedance2VideoActive = computed(() => {
  const cfg = resolvedVideoConfig.value
  if (!cfg) return false
  if (cfg.provider === 'chengmeng') return true
  let model = ''
  try {
    const parsed = JSON.parse(cfg.model || '[]')
    model = Array.isArray(parsed) ? (parsed[0] || '') : (parsed || cfg.model || '')
  } catch {
    model = cfg.model || ''
  }
  const lower = String(model).toLowerCase()
  return lower.includes('seedance-2-0') || lower.includes('seedance-2.0') || lower.includes('seedance 2')
})
const lockedAudioConfigLabel = computed(() => configLabel(audioConfigs.value.find(c => c.id === lockedAudioConfigId.value)))

// Grid tool state
const gridDialog = ref(false)
const gridStep = ref(0)
const gridLayout = ref('3x3')
const gridMode = ref('first_frame')
const gridSelected = ref([])
const gridSingleTarget = ref(null)
const gridGenId = ref(null)
const gridImagePath = ref('')
const gridStatusText = ref('')
const gridActualLayout = ref({ rows: 3, cols: 3 })
const gridRecoveredAt = ref('')
const gridRecoveredMode = ref('')
const gridPromptText = ref('')
const gridCellPrompts = ref([])
const gridPromptSource = ref('')
const gridPromptLoading = ref(false)
const gridPromptStatus = ref('')
const gridAssignmentsState = ref([])
const gridActiveShotIds = ref([])
const gridHistory = ref([])
const showAllGridHistory = ref(false)
const activeGridCell = ref(0)
const gridAssignmentPage = ref(0)
const gridStorageKey = computed(() => `huobao:grid:${dramaId}:${epId.value || episodeNumber.value}`)

const gridModes = [
  { id: 'first_frame', label: '首帧', desc: '每格=一个镜头的首帧' },
  { id: 'first_last', label: '首尾帧', desc: '每镜头占一行：左首帧，右尾帧' },
  { id: 'multi_ref', label: '多参考', desc: '所有格子=同一镜头的参考图' },
]

const gridLayoutShape = computed(() => {
  const [rows, cols] = String(gridLayout.value || '3x3').split('x').map(Number)
  return {
    rows: rows || 3,
    cols: cols || 3,
  }
})
const gridTotalCells = computed(() => {
  return gridLayoutShape.value.rows * gridLayoutShape.value.cols
})

const gridCanStart = computed(() => {
  if (gridMode.value === 'multi_ref') return !!gridSingleTarget.value
  return gridSelected.value.length > 0
})

const gridSummary = computed(() => {
  if (gridMode.value === 'multi_ref') {
    const idx = sbs.value.findIndex(s => s.id === gridSingleTarget.value) + 1
    return gridSingleTarget.value ? `${gridLayoutShape.value.rows}x${gridLayoutShape.value.cols} 参考图 → 镜头 #${idx}` : '请选择一个镜头'
  }
  if (!gridSelected.value.length) return '请选择镜头'
  const count = gridSelected.value.length
  if (gridMode.value === 'first_last') {
    const { rows, cols } = gridLayoutShape.value
    return `${count} 个镜头 → ${rows}x${cols} 宫格（按首尾帧风格生成，切分后再手动分配）`
  }
  const { rows, cols } = gridLayoutShape.value
  const cells = rows * cols
  return `${count} 个镜头 → ${rows}x${cols} 宫格（先生成宫格图，切分后再手动分配）`
})

function createGridAssignments() {
  return Array.from({ length: gridActualLayout.value.rows * gridActualLayout.value.cols }, () => ({
    storyboard_id: null,
    frame_type: 'first_frame',
  }))
}

const gridAssignments = computed(() => gridAssignmentsState.value)
const gridAssignableShotIds = computed(() => {
  const assignedIds = [...new Set(gridAssignments.value.map(item => item?.storyboard_id).filter(Boolean))]
  const ids = Array.isArray(gridActiveShotIds.value) && gridActiveShotIds.value.length
    ? gridActiveShotIds.value
    : assignedIds.length
      ? assignedIds
    : gridMode.value === 'multi_ref'
      ? (gridSingleTarget.value ? [gridSingleTarget.value] : [])
      : gridSelected.value.length
        ? [...gridSelected.value]
        : sbs.value.map(s => s.id)
  return ids.filter(id => sbs.value.some(s => s.id === id))
})
const gridAssignmentShotOptions = computed(() => [
  { label: '未分配', value: null },
  ...gridAssignableShotIds.value.map((id) => {
    const index = sbs.value.findIndex(s => s.id === id) + 1
    const sb = sbs.value.find(s => s.id === id)
    return {
      label: `#${String(index).padStart(2, '0')} ${sb?.title || sb?.description || '镜头'}`,
      value: id,
    }
  }),
])
const gridFrameTypeOptions = computed(() => {
  return [
    { label: '首帧', value: 'first_frame' },
    { label: '尾帧', value: 'last_frame' },
    { label: '参考图', value: 'reference' },
  ]
})
const gridAssignedCount = computed(() => gridAssignments.value.filter(item => !!item.storyboard_id).length)
const gridAssignmentPageSize = computed(() => {
  if (gridAssignments.value.length >= 25) return 8
  if (gridAssignments.value.length >= 16) return 10
  if (gridAssignments.value.length >= 9) return 9
  return Math.max(1, gridAssignments.value.length || 1)
})
const gridAssignmentTotalPages = computed(() => Math.max(1, Math.ceil(gridAssignments.value.length / gridAssignmentPageSize.value)))
const gridAssignmentPageStart = computed(() => gridAssignmentPage.value * gridAssignmentPageSize.value)
const gridAssignmentPageEnd = computed(() => Math.min(gridAssignments.value.length, gridAssignmentPageStart.value + gridAssignmentPageSize.value))
const pagedGridAssignments = computed(() => {
  return gridAssignments.value
    .slice(gridAssignmentPageStart.value, gridAssignmentPageEnd.value)
    .map((assignment, offset) => ({
      assignment,
      index: gridAssignmentPageStart.value + offset,
    }))
})

function resetGridAssignments() {
  gridAssignmentsState.value = createGridAssignments()
  activeGridCell.value = 0
  gridAssignmentPage.value = 0
}

function gridCellLabel(a) {
  if (!a?.storyboard_id) return '未分配'
  const idx = sbs.value.findIndex(s => s.id === a.storyboard_id) + 1
  const suffix = { first_frame: '首', last_frame: '尾', reference: '参' }[a.frame_type] || ''
  return `#${idx}${suffix ? ` ${suffix}` : ''}`
}

function gridCellTitle(id) {
  if (!id) return '未分配'
  const idx = sbs.value.findIndex(s => s.id === id) + 1
  const sb = sbs.value.find(s => s.id === id)
  return `#${String(idx).padStart(2, '0')} ${sb?.title || sb?.description || '镜头'}`
}

function updateGridAssignment(index, field, value) {
  const next = [...gridAssignmentsState.value]
  next[index] = { ...next[index], [field]: value }
  gridAssignmentsState.value = next
  activeGridCell.value = index
  if (gridImagePath.value) persistGridImagePath(gridImagePath.value)
}

function focusGridCell(index) {
  activeGridCell.value = index
  gridAssignmentPage.value = Math.floor(index / gridAssignmentPageSize.value)
}

const gridOverlayStyle = computed(() => {
  const { rows, cols } = gridActualLayout.value
  return { 'grid-template-columns': `repeat(${cols}, 1fr)`, 'grid-template-rows': `repeat(${rows}, 1fr)` }
})

const gridAutoLayout = computed(() => {
  return gridLayoutShape.value
})

const gridBlankStyle = computed(() => {
  const { rows, cols } = gridAutoLayout.value
  return { 'grid-template-columns': `repeat(${cols}, 1fr)`, 'grid-template-rows': `repeat(${rows}, 1fr)` }
})

// Production step helpers
function prodStepDone(id) {
  if (id === 'chars') return !!visualCharTotal.value && charImgCount.value === visualCharTotal.value
  if (id === 'scenes') return !!scenes.value.length && sceneImgCount.value === scenes.value.length
  if (id === 'dubbing') return !!sbs.value.length && (!ttsEligibleCount.value || ttsGeneratedCount.value === ttsEligibleCount.value)
  if (id === 'shots') return !!sbs.value.length && shotImgCount.value === sbs.value.length
  if (id === 'videos') return !!sbs.value.length && shotVidCount.value === sbs.value.length
  if (id === 'compose') return !!sbs.value.length && composedCount.value === sbs.value.length
  return false
}
const canExport = computed(() => !!sbs.value.length && composedCount.value === sbs.value.length)
function goNextProd() {
  if (prodTabIdx.value < prodTabDefs.value.length - 1) {
    prodTabIdx.value++
  } else {
    panel.value = 'export'
  }
}

// Script step navigation
const stepLabels = ['原始内容', 'AI 改写', '提取', '音色', '分镜']
const prevStepLabel = computed(() => scriptStep.value > 0 ? stepLabels[scriptStep.value - 1] : '')
const nextStepLabel = computed(() => {
  if (scriptStep.value === 4) return '进入制作'
  return stepLabels[scriptStep.value + 1] || ''
})
const canGoNext = computed(() => {
  if (scriptStep.value === 0) return !!localRaw.value.trim()
  if (scriptStep.value === 1) return !!localScript.value.trim() || !!scriptContent.value
  if (scriptStep.value === 2) return chars.value.length > 0
  if (scriptStep.value === 3) return charsVoiced.value > 0
  if (scriptStep.value === 4) return sbs.value.length > 0
  return false
})
function goPrevStep() { if (scriptStep.value > 0) scriptStep.value-- }
function goNextStep() {
  if (scriptStep.value === 0 && localRaw.value.trim()) { saveRaw() }
  if (scriptStep.value === 1 && localScript.value.trim()) { saveScr() }
  if (scriptStep.value === 4) { panel.value = 'production'; return }
  if (canGoNext.value) scriptStep.value++
}

function gridSelectAll() {
  if (gridSelected.value.length === sbs.value.length) gridSelected.value = []
  else gridSelected.value = sbs.value.map(s => s.id)
}

function openGridTool() {
  gridStep.value = 0
  gridSelected.value = []
  gridSingleTarget.value = null
  gridActiveShotIds.value = []
  gridPromptText.value = ''
  gridCellPrompts.value = []
  gridPromptSource.value = ''
  gridPromptStatus.value = ''
  gridAssignmentsState.value = []
  gridDialog.value = true
}

function persistGridImagePath(value) {
  if (typeof window === 'undefined') return
  if (!value) {
    window.localStorage.removeItem(gridStorageKey.value)
    return
  }
  const current = restoreGridState() || {}
  const entries = current.entries || {}
  entries[value] = {
    generationId: gridGenId.value,
    layout: gridActualLayout.value,
    shotIds: gridActiveShotIds.value,
    assignments: gridAssignmentsState.value,
    recoveredAt: gridRecoveredAt.value,
    recoveredMode: gridRecoveredMode.value,
  }
  const payload = {
    activeImagePath: value,
    entries,
  }
  window.localStorage.setItem(gridStorageKey.value, JSON.stringify(payload))
}

function restoreGridState() {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(gridStorageKey.value)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return { activeImagePath: raw, entries: { [raw]: {} } }
  }
}

function applyGridState(imagePath, meta = {}) {
  gridImagePath.value = imagePath || ''
  gridGenId.value = meta.generationId || meta.id || null
  if (meta.layout?.rows && meta.layout?.cols) gridActualLayout.value = meta.layout
  if (Array.isArray(meta.shotIds)) gridActiveShotIds.value = meta.shotIds
  else gridActiveShotIds.value = []
  if (Array.isArray(meta.assignments)) gridAssignmentsState.value = meta.assignments
  else gridAssignmentsState.value = []
  gridRecoveredAt.value = meta.recoveredAt || meta.createdAtLabel || ''
  gridRecoveredMode.value = meta.recoveredMode || meta.modeLabel || ''
}

function selectGridHistory(item) {
  const cached = restoreGridState()
  const cachedEntry = cached?.entries?.[item.localPath] || {}
  applyGridState(item.localPath, {
    ...item,
    ...cachedEntry,
    generationId: cachedEntry.generationId || item.id,
    recoveredAt: cachedEntry.recoveredAt || item.createdAtLabel,
    recoveredMode: cachedEntry.recoveredMode || item.modeLabel,
  })
  if (!gridAssignmentsState.value.length) resetGridAssignments()
  persistGridImagePath(item.localPath)
}

function reopenGridPreview() {
  if (!gridImagePath.value) {
    openGridTool()
    return
  }
  gridDialog.value = true
  if (!gridAssignmentsState.value.length) resetGridAssignments()
  gridStep.value = 3
}

function parseGridLayoutFromFrameType(value) {
  const match = String(value || '').match(/grid_[^_]+_(\d+)x(\d+)$/)
  if (!match) return null
  return { rows: Number(match[1]) || 3, cols: Number(match[2]) || 3 }
}

function continueGridSplit() {
  if (!gridImagePath.value) {
    toast.warning('还没有可继续切割的宫格图')
    return
  }
  if (!gridAssignmentsState.value.length) resetGridAssignments()
  gridDialog.value = true
  gridStep.value = 3
}

function getGridPromptShotIds() {
  if (gridMode.value === 'multi_ref') return gridSingleTarget.value ? [gridSingleTarget.value] : []
  if (gridMode.value === 'first_last') return [...gridSelected.value]
  return gridSelected.value.slice(0, gridTotalCells.value)
}

async function generateGridPrompt() {
  if (!gridCanStart.value) {
    toast.warning('请先选择镜头')
    return
  }
  gridPromptLoading.value = true
  gridPromptStatus.value = '正在调用 AI 生成宫格提示词...'
  gridPromptText.value = ''
  gridCellPrompts.value = []
  gridPromptSource.value = ''
  try {
    const shotIds = getGridPromptShotIds()
    const { rows, cols } = gridAutoLayout.value

    const res = await gridAPI.prompt({
      storyboard_ids: shotIds,
      drama_id: dramaId,
      episode_id: epId.value,
      rows,
      cols,
      mode: gridMode.value,
    })

    gridPromptText.value = res?.grid_prompt || ''
    gridCellPrompts.value = Array.isArray(res?.cell_prompts) ? res.cell_prompts : []
    gridPromptSource.value = res?.source || ''

    if (gridPromptText.value) {
      resetGridAssignments()
      gridPromptStatus.value = gridPromptSource.value === 'agent' ? 'AI 提示词已生成' : '已使用模板提示词'
      gridStep.value = 1
    } else {
      gridPromptStatus.value = ''
      toast.error('提示词生成失败')
    }
  } catch (e) {
    gridPromptStatus.value = ''
    toast.error(e?.message || '生成提示词失败')
  } finally {
    gridPromptLoading.value = false
  }
}

async function startGridGen() {
  let rows, cols, ids
  if (gridMode.value === 'multi_ref') {
    rows = gridAutoLayout.value.rows; cols = gridAutoLayout.value.cols; ids = [gridSingleTarget.value]
  } else {
    rows = gridAutoLayout.value.rows; cols = gridAutoLayout.value.cols; ids = gridSelected.value.slice(0, gridTotalCells.value)
    if (gridMode.value === 'first_last') ids = [...gridSelected.value]
  }
  gridActiveShotIds.value = ids.filter(Boolean)
  gridActualLayout.value = { rows, cols }
  if (!gridAssignmentsState.value.length) resetGridAssignments()
  gridStep.value = 2
  gridStatusText.value = '提交生成请求...'
  genTimer.startTask(GRID_TIMER_KEY, '宫格图', 'image')
  try {
    const res = await gridAPI.generate({
      storyboard_ids: ids,
      drama_id: dramaId,
      rows,
      cols,
      mode: gridMode.value,
      custom_prompt: gridPromptText.value || undefined,
    })
    gridGenId.value = res.image_generation_id
    gridActualLayout.value = res.grid || { rows, cols }
    gridStatusText.value = '等待图片生成...'
    pollGridStatus()
  } catch (e) {
    genTimer.endTask(GRID_TIMER_KEY)
    toast.error(e.message)
    gridStep.value = 0
  }
}

async function pollGridStatus() {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const res = await gridAPI.status(gridGenId.value)
      gridStatusText.value = `状态: ${res.status}`
      if (res.status === 'completed' && res.local_path) {
        gridImagePath.value = res.local_path
        gridGenId.value = gridGenId.value || res.id || null
        persistGridImagePath(res.local_path)
        gridStep.value = 3
        genTimer.endTask(GRID_TIMER_KEY)
        return
      }
      if (res.status === 'failed') {
        genTimer.endTask(GRID_TIMER_KEY)
        toast.error(res.error_msg || '生成失败')
        gridStep.value = 0
        return
      }
    } catch {}
  }
  genTimer.endTask(GRID_TIMER_KEY)
  toast.error('生成超时'); gridStep.value = 0
}

async function loadLatestGridImage() {
  try {
    const rows = await imageAPI.list({ drama_id: dramaId })
    const list = Array.isArray(rows) ? rows : []
    const grids = list
      .filter((row) => row?.status === 'completed' && String(row?.frame_type || row?.frameType || '').startsWith('grid_') && (row?.local_path || row?.localPath))
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
      .map((row) => {
        const frameType = String(row?.frame_type || row?.frameType || '')
        const parsedLayout = parseGridLayoutFromFrameType(frameType) || { rows: 3, cols: 3 }
        return {
          id: row.id,
          localPath: row?.local_path || row?.localPath || '',
          layout: parsedLayout,
          modeLabel: frameType.replace(/^grid_/, '').replace(/_/g, ' · '),
          createdAtLabel: row?.created_at || row?.createdAt || '',
        }
      })

    gridHistory.value = grids

    const cached = restoreGridState()
    const preferredPath = cached?.activeImagePath && grids.some(item => item.localPath === cached.activeImagePath)
      ? cached.activeImagePath
      : grids[0]?.localPath
    const current = grids.find(item => item.localPath === preferredPath)
    if (current) {
      const cachedEntry = cached?.entries?.[current.localPath] || {}
      applyGridState(current.localPath, {
        ...current,
        ...cachedEntry,
        generationId: cachedEntry.generationId || current.id,
        recoveredAt: cachedEntry.recoveredAt || current.createdAtLabel,
        recoveredMode: cachedEntry.recoveredMode || current.modeLabel,
      })
      if (!gridAssignmentsState.value.length) resetGridAssignments()
      persistGridImagePath(current.localPath)
      return
    }
  } catch {}

  const cached = restoreGridState()
  if (cached?.activeImagePath) {
    const cachedEntry = cached?.entries?.[cached.activeImagePath] || {}
    applyGridState(cached.activeImagePath, {
      ...cachedEntry,
      recoveredAt: cachedEntry.recoveredAt || '',
      recoveredMode: cachedEntry.recoveredMode || '',
    })
  }
}

async function doGridSplit() {
  const { rows, cols } = gridActualLayout.value
  try {
    const assignments = gridAssignments.value
      .filter(item => !!item.storyboard_id)
      .map(item => ({ storyboard_id: item.storyboard_id, frame_type: item.frame_type }))
    if (!assignments.length) {
      toast.warning('请至少分配一个格子')
      return
    }
    await gridAPI.split({ image_generation_id: gridGenId.value, rows, cols, assignments })
    persistGridImagePath(gridImagePath.value)
    gridStep.value = 4
    toast.success('切分分配完成')
  } catch (e) {
    toast.error(e.message)
  }
}

const charImgCount = computed(() => visualChars.value.filter(c => c.image_url || c.imageUrl).length)
const sceneImgCount = computed(() => scenes.value.filter(s => s.image_url || s.imageUrl).length)
const ttsEligibleCount = computed(() => sbs.value.filter(s => hasDialogue(s)).length)
const ttsGeneratedCount = computed(() => sbs.value.filter(s => hasDialogue(s) && hasTTS(s)).length)
const shotImgCount = computed(() => sbs.value.filter(s => s.first_frame_image || s.firstFrameImage || s.last_frame_image || s.lastFrameImage || s.composed_image || s.composedImage).length)
const blockingCount = computed(() => sbs.value.filter(s => getBlockingImage(s)).length)
const shotVidCount = computed(() => sbs.value.filter(s => s.video_url || s.videoUrl).length)
const visualCharTotal = computed(() => visualChars.value.length)

const dramaProps = computed(() => drama.value?.props || [])

const prodTabDefs = computed(() => [
  { id: 'chars', label: '角色形象', icon: Users, badge: visualCharTotal.value ? `${charImgCount.value}/${visualCharTotal.value}` : '' },
  { id: 'voices', label: '音色库', icon: Music, badge: voiceAssets.value.length ? String(voiceAssets.value.length) : '' },
  { id: 'scenes', label: '场景图片', icon: MapPin, badge: sceneImgCount.value ? `${sceneImgCount.value}/${scenes.value.length}` : '' },
  { id: 'fusion', label: '融合生图', icon: Sparkles, badge: '' },
  { id: 'dubbing', label: '配音生成', icon: Mic2, badge: '' },
  { id: 'shots', label: '镜头图片', icon: ImageIcon, badge: shotImgCount.value ? `${shotImgCount.value}/${sbs.value.length}` : '' },
  { id: 'videos', label: '视频生成', icon: Video, badge: shotVidCount.value ? `${shotVidCount.value}/${sbs.value.length}` : '' },
  { id: 'compose', label: '视频合成', icon: Layers, badge: composedCount.value ? `${composedCount.value}/${sbs.value.length}` : '' },
])

const mainStageDefs = [
  { id: 'script', label: '剧本', desc: '内容改写与整理', icon: FileText },
  { id: 'assets', label: '资产', desc: '角色、场景与音色', icon: FolderKanban },
  { id: 'storyboard', label: '分镜', desc: '镜头制作与合成', icon: Clapperboard },
  { id: 'export', label: '导出', desc: '拼接与成片输出', icon: Download },
]

const sidebarSections = computed(() => ([
  {
    id: 'script',
    label: '剧本',
    items: [
      { key: 'script:raw', label: '原始内容', desc: '', icon: FileText, done: !!rawContent.value },
      { key: 'script:rewrite', label: 'AI 改写', desc: '', icon: FileText, done: !!scriptContent.value },
      { key: 'script:extract', label: '提取', desc: '', icon: Users, done: !!chars.value.length },
      { key: 'script:voice', label: '音色', desc: '', icon: Mic2, done: !!chars.value.length && charsVoiced.value === chars.value.length },
      { key: 'script:storyboard', label: '分镜', desc: '', icon: Clapperboard, done: !!sbs.value.length },
    ],
  },
  {
    id: 'production',
    label: '制作',
    items: [
      { key: 'prod:chars', label: '角色形象', desc: '', icon: Users, done: prodStepDone('chars') },
      { key: 'prod:voices', label: '音色库', desc: '', icon: Music, done: voiceAssets.value.length > 0 },
      { key: 'prod:scenes', label: '场景图片', desc: '', icon: MapPin, done: prodStepDone('scenes') },
      { key: 'prod:fusion', label: '融合生图', desc: '', icon: Sparkles, done: false },
      { key: 'prod:dubbing', label: '配音生成', desc: '', icon: Mic2, done: prodStepDone('dubbing') },
      { key: 'prod:shots', label: '镜头图片', desc: '', icon: ImageIcon, done: prodStepDone('shots') },
      { key: 'prod:videos', label: '视频生成', desc: '', icon: Video, done: prodStepDone('videos') },
      { key: 'prod:compose', label: '视频合成', desc: '', icon: Layers, done: prodStepDone('compose') },
    ],
  },
  {
    id: 'export',
    label: '导出',
    items: [
      { key: 'export:merge', label: '拼接导出', desc: '', icon: Download, done: !!mergeUrl.value },
    ],
  },
]))

const activeMainStage = computed(() => {
  if (panel.value === 'export') return 'export'
  if (panel.value === 'production') {
    return ['chars', 'scenes', 'fusion', 'voices'].includes(prodTab.value) ? 'assets' : 'storyboard'
  }
  if (scriptStep.value <= 1) return 'script'
  if (scriptStep.value <= 3) return 'assets'
  return 'storyboard'
})

function mainStageDone(stageId) {
  if (stageId === 'script') return !!scriptContent.value
  if (stageId === 'assets') {
    const charsReady = !!chars.value.length && charsVoiced.value === chars.value.length
    const charImagesReady = prodStepDone('chars')
    const sceneImagesReady = prodStepDone('scenes')
    return charsReady && charImagesReady && sceneImagesReady
  }
  if (stageId === 'storyboard') {
    if (!sbs.value.length) return false
    const ttsReady = !ttsEligibleCount.value || ttsGeneratedCount.value === ttsEligibleCount.value
    return ttsReady
      && shotImgCount.value === sbs.value.length
      && shotVidCount.value === sbs.value.length
      && composedCount.value === sbs.value.length
  }
  if (stageId === 'export') return !!mergeUrl.value
  return false
}

function goMainStage(stageId) {
  if (stageId === 'script') {
    panel.value = 'script'
    scriptStep.value = Math.min(scriptStep.value, 1)
    return
  }
  if (stageId === 'assets') {
    const hasAssetWorkspace = !!visualCharTotal.value || !!scenes.value.length
    const hasPendingAssetGeneration = (visualCharTotal.value && charImgCount.value < visualCharTotal.value)
      || (scenes.value.length && sceneImgCount.value < scenes.value.length)
    if (panel.value === 'production' || hasPendingAssetGeneration || hasAssetWorkspace) {
      panel.value = 'production'
      prodTab.value = ['chars', 'scenes', 'fusion'].includes(prodTab.value) ? prodTab.value : 'chars'
      return
    }
    panel.value = 'script'
    scriptStep.value = chars.value.length ? 3 : 2
    return
  }
  if (stageId === 'storyboard') {
    if (panel.value === 'production') {
      prodTab.value = ['dubbing', 'shots', 'videos', 'compose'].includes(prodTab.value) ? prodTab.value : 'dubbing'
      return
    }
    panel.value = 'script'
    scriptStep.value = 4
    return
  }
  panel.value = 'export'
}

const activeSubSteps = computed(() => {
  if (activeMainStage.value === 'script') {
    return [
      { key: 'script:raw', label: '原始内容', done: !!rawContent.value },
      { key: 'script:rewrite', label: 'AI 改写', done: !!scriptContent.value },
    ]
  }
  if (activeMainStage.value === 'assets') {
    return [
      { key: 'script:extract', label: '提取角色场景', done: !!chars.value.length },
      { key: 'script:voice', label: '分配音色', done: !!chars.value.length && charsVoiced.value === chars.value.length },
      { key: 'prod:chars', label: '角色形象', done: prodStepDone('chars') },
      { key: 'prod:voices', label: '音色库', done: voiceAssets.value.length > 0 },
      { key: 'prod:scenes', label: '场景图片', done: prodStepDone('scenes') },
      { key: 'prod:fusion', label: '融合生图', done: false },
    ]
  }
  if (activeMainStage.value === 'storyboard') {
    const assetSteps = chars.value.length
      ? [
          { key: 'prod:chars', label: '角色形象', done: prodStepDone('chars') },
          { key: 'prod:voices', label: '音色库', done: voiceAssets.value.length > 0 },
          { key: 'prod:scenes', label: '场景图片', done: prodStepDone('scenes') },
          { key: 'prod:fusion', label: '融合生图', done: false },
        ]
      : []
    return [
      { key: 'script:storyboard', label: '分镜拆解', done: !!sbs.value.length },
      ...assetSteps,
      { key: 'prod:dubbing', label: '配音生成', done: !ttsEligibleCount.value || ttsGeneratedCount.value === ttsEligibleCount.value },
      { key: 'prod:shots', label: '镜头图片', done: !!sbs.value.length && shotImgCount.value === sbs.value.length },
      { key: 'prod:videos', label: '视频生成', done: !!sbs.value.length && shotVidCount.value === sbs.value.length },
      { key: 'prod:compose', label: '视频合成', done: !!sbs.value.length && composedCount.value === sbs.value.length },
    ]
  }
  return [
    { key: 'export:merge', label: '拼接导出', done: !!mergeUrl.value },
  ]
})

const activeSubStepKey = computed(() => {
  if (panel.value === 'script') {
    if (scriptStep.value === 0) return 'script:raw'
    if (scriptStep.value === 1) return 'script:rewrite'
    if (scriptStep.value === 2) return 'script:extract'
    if (scriptStep.value === 3) return 'script:voice'
    return 'script:storyboard'
  }
  if (panel.value === 'production') return `prod:${prodTab.value}`
  return 'export:merge'
})

const sidebarJumpSteps = computed(() => {
  const section = sidebarSections.value.find((item) => item.items.some(step => step.key === activeSubStepKey.value))
  return section?.items || []
})

const bubbleSteps = computed(() => {
  if (panel.value === 'script') {
    return [
      { key: 'script:raw', label: '原始内容', done: !!rawContent.value },
      { key: 'script:rewrite', label: 'AI 改写', done: !!scriptContent.value },
      { key: 'script:extract', label: '提取', done: !!chars.value.length },
      { key: 'script:voice', label: '音色', done: !!chars.value.length && charsVoiced.value === chars.value.length },
      { key: 'script:storyboard', label: '分镜', done: !!sbs.value.length },
    ]
  }
  if (panel.value === 'production') {
    return prodTabDefs.value.map(step => ({
      key: `prod:${step.id}`,
      label: step.label,
      done: prodStepDone(step.id),
    }))
  }
  return []
})

const activeBubbleKey = computed(() => {
  if (panel.value === 'script') return activeSubStepKey.value
  if (panel.value === 'production') return `prod:${prodTab.value}`
  return ''
})

const showBottomBubble = computed(() => panel.value === 'script' || panel.value === 'production')

function goSubStep(key) {
  if (key.startsWith('script:')) {
    panel.value = 'script'
    const stepMap = {
      'script:raw': 0,
      'script:rewrite': 1,
      'script:extract': 2,
      'script:voice': 3,
      'script:storyboard': 4,
    }
    scriptStep.value = stepMap[key] ?? 0
  } else if (key.startsWith('prod:')) {
    panel.value = 'production'
    prodTab.value = key.replace('prod:', '')
  } else {
    panel.value = 'export'
  }
  nextTick(() => {
    if (typeof document === 'undefined') return
    document.querySelector('.main')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

const pipelineProgress = computed(() => {
  let p = 0
  if (rawContent.value) p++
  if (scriptContent.value) p++
  if (chars.value.length) p++
  if (charsVoiced.value) p++
  if (sbs.value.length) p++
  if (sbs.value.length && (!ttsEligibleCount.value || ttsGeneratedCount.value === ttsEligibleCount.value)) p++
  if (sbs.value.some(s => s.composed_image || s.composedImage)) p++
  if (sbs.value.some(s => s.video_url || s.videoUrl)) p++
  if (sbs.value.length && composedCount.value === sbs.value.length) p++
  if (mergeUrl.value) p++
  return p
})

const currentStageLabel = computed(() => {
  if (panel.value === 'script') return `剧本阶段 · ${stepLabels[scriptStep.value]}`
  if (panel.value === 'production') return `制作阶段 · ${prodTabDefs.value[prodTabIdx.value]?.label || '制作'}`
  return mergeUrl.value ? '导出阶段 · 成片已生成' : '导出阶段 · 等待拼接'
})

const currentMainStageLabel = computed(() => {
  const current = mainStageDefs.find(stage => stage.id === activeMainStage.value)
  return current?.label || '工作台'
})

const currentSubStageLabel = computed(() => {
  const current = activeSubSteps.value.find(step => step.key === activeSubStepKey.value)
  return current?.label || currentStageLabel.value
})

function updateCharVoice(charId, voiceId) {
  characterAPI.update(charId, { voice_style: voiceId, voice_provider: lockedAudioProvider.value || undefined })
  const c = chars.value.find(ch => ch.id === charId)
  if (c) {
    c.voice_style = voiceId
    c.voiceStyle = voiceId
    c.voice_provider = lockedAudioProvider.value || ''
    c.voiceProvider = lockedAudioProvider.value || ''
    c.voice_sample_url = ''
    c.voiceSampleUrl = ''
  }
}
function getVoiceProfile(voiceId) {
  return voiceProfiles.value.find(v => v.id === voiceId) || null
}
const totalDuration = computed(() => sbs.value.reduce((s, sb) => s + (sb.duration || 10), 0))

const selectedSb = ref(null)

const assistantSelectedStoryboard = computed(() => {
  const sb = selectedSb.value
  if (!sb?.id) return null
  const index = sbs.value.findIndex(item => item.id === sb.id)
  return {
    id: sb.id,
    index: index >= 0 ? index + 1 : 0,
    title: sb.title || sb.description || '',
  }
})

const assistantOpen = ref(true)
if (import.meta.client) {
  const saved = localStorage.getItem('huobao-assistant-open')
  if (saved === '0') assistantOpen.value = false
}
function toggleAssistant() {
  assistantOpen.value = !assistantOpen.value
  if (import.meta.client) {
    localStorage.setItem('huobao-assistant-open', assistantOpen.value ? '1' : '0')
  }
}
function ensureAssistantVisible() {
  if (!assistantOpen.value) {
    assistantOpen.value = true
    if (import.meta.client) localStorage.setItem('huobao-assistant-open', '1')
  }
}
function sendAssistant(message, onAfterRefresh) {
  if (assistantRunning.value) {
    toast.warning('助手正在执行中')
    return
  }
  ensureAssistantVisible()
  assistantSend(message, () => {
    refresh()
    onAfterRefresh?.()
  })
}
function shotIndex(sb) {
  const idx = sbs.value.findIndex(s => s.id === sb.id)
  return idx >= 0 ? idx + 1 : sb.storyboard_number || sb.storyboardNumber || sb.id
}
function onAssistantNavigate(att) {
  ensureAssistantVisible()
  if (att.kind === 'character' && att.id) {
    panel.value = 'production'
    prodTab.value = 'chars'
    return
  }
  if (att.kind === 'scene' && att.id) {
    panel.value = 'production'
    prodTab.value = 'scenes'
    return
  }
  if (att.kind === 'merge') {
    panel.value = 'export'
    return
  }
  const sb = sbs.value.find(item => item.id === att.id)
  if (!sb) return
  selectedSb.value = sb
  panel.value = 'production'
  if (att.kind === 'shot_video') prodTab.value = 'videos'
  else if (att.kind === 'shot_compose') prodTab.value = 'compose'
  else prodTab.value = 'shots'
}

const assistantContext = computed(() => ({
  dramaId,
  stepKey: activeSubStepKey.value,
  stepLabel: currentSubStageLabel.value,
  selectedStoryboard: assistantSelectedStoryboard.value,
}))

const {
  messages: assistantMessages,
  running: assistantRunning,
  loadingHistory: assistantLoadingHistory,
  input: assistantInput,
  agentType: assistantAgentType,
  stepLabel: assistantStepLabel,
  quickChips: assistantQuickChips,
  disabled: assistantDisabled,
  send: assistantSend,
  recordActivity: assistantRecordActivity,
  patchActivity: assistantPatchActivity,
  clearHistory: assistantClearHistory,
  stop: assistantStop,
} = useEpisodeAssistant(epId, activeSubStepKey, assistantContext)

const shotTypes = [
  '大远景', '远景', '全景', '中景', '中近景', '近景', '特写', '大特写',
  '双人镜头', '三人镜头', '群像', '背影', '侧面', '正面', '俯视', '仰视',
  '过肩', '主观视角', '航拍', '运动镜头',
]
const shotAngles = ['平视', '仰视', '俯视', '侧拍', '背拍', '斜侧', '主观视角', '过肩']
const shotMovements = ['固定', '推镜', '拉镜', '摇镜', '移镜', '跟拍', '升降', '手持', '环绕']

function updateField(sb, field, value) {
  const current = sb[field] ?? sb[toCamel(field)]
  if (JSON.stringify(current) === JSON.stringify(value)) return
  sb[field] = value
  const camelField = toCamel(field)
  if (camelField !== field) sb[camelField] = value
  const payload = { [field]: value }
  if (field === 'reference_images' && Array.isArray(value)) {
    payload.reference_images = value
  }
  if (field === 'character_image_refs' && value && typeof value === 'object') {
    payload.character_image_refs = value
  }
  storyboardAPI.update(sb.id, payload)
}

async function setDramaImageAspect(value) {
  if (value === dramaImageAspect.value) return
  imageAspectSaving.value = true
  try {
    await dramaAPI.update(dramaId, { image_aspect_ratio: value })
    if (drama.value) {
      drama.value.image_aspect_ratio = value
      drama.value.imageAspectRatio = value
    }
    toast.success(`画面比例已设为 ${value}（图片与视频）`)
  } catch (e) {
    toast.error(e?.message || '保存比例失败')
  } finally {
    imageAspectSaving.value = false
  }
}

function getCharImagePrompt(c) {
  return getCharacterImagePrompt(c)
}

async function onCharImagePromptBlur(c, event) {
  const value = String(event.target.value || '').trim()
  const current = String(c.image_prompt || c.imagePrompt || '').trim()
  if (value === current) return
  c.image_prompt = value
  c.imagePrompt = value
  try {
    await characterAPI.update(c.id, { image_prompt: value })
  } catch (e) {
    toast.error(e?.message || '保存角色提示词失败')
  }
}

function getSceneImagePrompt(s) {
  return resolveSceneImagePromptText(s)
}

async function onScenePromptBlur(s, event) {
  const value = String(event.target.value || '').trim()
  if (value === String(s.prompt || '').trim()) return
  s.prompt = value
  try {
    await sceneAPI.update(s.id, { prompt: value })
  } catch (e) {
    toast.error(e?.message || '保存场景提示词失败')
  }
}

function onVideoPromptBlur(sb, event) {
  updateField(sb, 'video_prompt', event.target.value)
}

function onVideoDurationBlur(sb, event) {
  const n = Number(event.target.value)
  if (!Number.isFinite(n) || n <= 0) return
  updateField(sb, 'duration', n)
}

function onVideoDurationInput(sb, event) {
  onVideoDurationBlur(sb, event)
}

function shotDurationValue(sb) {
  const n = Number(sb?.duration)
  return Number.isFinite(n) && n > 0 ? n : 5
}

function shotDurationProgress(sb) {
  const val = shotDurationValue(sb)
  return `${((val - 1) / 14) * 100}%`
}

function toCamel(field) {
  return field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function getStoryboardCharacterIds(sb) {
  return sb?.character_ids || sb?.characterIds || []
}

function getStoryboardCharacterNames(sb) {
  const ids = getStoryboardCharacterIds(sb)
  return chars.value.filter(char => ids.includes(char.id)).map(char => char.name)
}

function isStoryboardCharacterSelected(sb, charId) {
  return getStoryboardCharacterIds(sb).includes(charId)
}

function toggleStoryboardCharacter(sb, charId) {
  const currentIds = getStoryboardCharacterIds(sb)
  if (currentIds.includes(charId)) {
    removeVideoRefCharacter(sb, charId)
    return
  }
  updateField(sb, 'character_ids', [...currentIds, charId])
}

function getSceneName(sb) {
  const sceneId = sb?.scene_id || sb?.sceneId
  if (!sceneId) return '未绑定场景'
  const scene = scenes.value.find(s => s.id === sceneId)
  return scene ? `${scene.location} · ${scene.time || '未设时间'}` : `场景 #${sceneId}`
}

async function deleteShot(sb) {
  if (!confirm('确定删除此镜头？')) return
  const idx = sbs.value.indexOf(sb)
  await storyboardAPI.del(sb.id)
  await refresh()
  if (sbs.value.length) selectedSb.value = sbs.value[Math.min(idx, sbs.value.length - 1)]
  else selectedSb.value = null
}

const scriptSteps = computed(() => {
  const hasScript = !!scriptContent.value
  const hasChars = chars.value.length > 0 && hasScript
  const hasVoice = charsVoiced.value > 0 && hasChars
  const hasPlans = shotPlans.value.length > 0 || sbs.value.length > 0
  return [
    { label: '原始内容', state: rawContent.value ? 'done' : 'active', spinning: false },
    { label: 'AI 改写', state: hasScript ? 'done' : (rawContent.value ? 'active' : ''), spinning: assistantRunning.value && assistantAgentType.value === 'script_rewriter' },
    { label: '提取', state: hasChars ? 'done' : (hasScript ? 'active' : ''), spinning: assistantRunning.value && assistantAgentType.value === 'extractor' },
    { label: '音色', state: hasVoice ? 'done' : (hasChars ? 'active' : ''), spinning: assistantRunning.value && assistantAgentType.value === 'voice_assigner' },
    { label: '分镜', state: hasPlans ? 'done' : (hasVoice ? 'active' : ''), spinning: (assistantRunning.value && (assistantAgentType.value === 'storyboard_breaker' || assistantAgentType.value === 'shot_plan_generator')) || generateLoading.value },
  ]
})

watch(rawContent, v => { localRaw.value = v }, { immediate: true })
watch(scriptContent, v => { localScript.value = v }, { immediate: true })

async function refresh(options = {}) {
  const { restoreVideoPending = false } = options
  if (!drama.value) pageLoading.value = true
  pageError.value = ''
  const preservedPanel = panel.value
  const preservedProdTab = prodTab.value
  const preservedScriptStep = scriptStep.value
  try {
    drama.value = await dramaAPI.get(dramaId)
    const ep = drama.value.episodes?.find(e => Number(e.episode_number ?? e.episodeNumber) === episodeNumber.value)
    if (!ep) {
      pageError.value = `未找到第 ${episodeNumber.value} 集`
      drama.value = null
      return
    }
    episode.value = ep
    try { chars.value = await episodeAPI.characters(ep.id) } catch { chars.value = [] }
    try { scenes.value = await episodeAPI.scenes(ep.id) } catch { scenes.value = [] }
    sbs.value = await episodeAPI.storyboards(ep.id)
    try { shotPlans.value = await episodeAPI.shotPlans(ep.id) } catch { shotPlans.value = [] }
    try { clips.value = await episodeAPI.clips(ep.id) } catch { clips.value = [] }
    if (shotPlans.value.length) {
      selectedPlan.value = selectedPlan.value?.id
        ? (shotPlans.value.find(p => p.id === selectedPlan.value.id) || shotPlans.value[0])
        : shotPlans.value[0]
    } else {
      selectedPlan.value = null
    }
    pendingVideoIds.value = pendingVideoIds.value.filter(id => sbs.value.some(s => s.id === id))
    await prefetchMediaUrls(collectDisplayMediaPaths(), { force: true })
    await loadVideoGenCounts()
    await loadVoiceAssets()
    if (restoreVideoPending) await restorePendingVideoGenerations()
    if (sbs.value.length) {
      if (selectedSb.value?.id) {
        selectedSb.value = sbs.value.find(sb => sb.id === selectedSb.value.id) || sbs.value[0]
      } else {
        selectedSb.value = sbs.value[0]
      }
    } else {
      selectedSb.value = null
    }

    const epHasContent = !!(episode.value?.content)
    const epHasScript = !!(episode.value?.script_content || episode.value?.scriptContent)
    const epHasSbs = sbs.value.length > 0

    if (preservedPanel === 'production') {
      panel.value = preservedPanel
      prodTab.value = preservedProdTab
    } else if (preservedPanel === 'export') {
      panel.value = 'export'
    } else {
      panel.value = 'script'
      if (preservedScriptStep <= 4 && preservedScriptStep >= 0 && preservedPanel === 'script') {
        scriptStep.value = preservedScriptStep
      } else if (epHasSbs) scriptStep.value = 4
      else if (epHasScript && chars.value.some(c => c.voice_style || c.voiceStyle)) scriptStep.value = 3
      else if (epHasScript && chars.value.length) scriptStep.value = 2
      else if (epHasScript || epHasContent) scriptStep.value = 1
      else scriptStep.value = 0
    }
    await loadLatestGridImage()
  } catch (e) {
    pageError.value = e.message || '加载失败'
    if (!drama.value) drama.value = null
  } finally {
    pageLoading.value = false
  }
  try { mergeData.value = await mergeAPI.status(epId.value) } catch {}
}

function saveRaw() { episodeAPI.update(epId.value, { content: localRaw.value }); episode.value.content = localRaw.value }
function saveScr() { episodeAPI.update(epId.value, { script_content: localScript.value }); episode.value.script_content = localScript.value }
function doRewrite() {
  saveRaw()
  sendAssistant('请读取原始内容并改写为格式化剧本，然后保存', refresh)
}
function skipRewrite() {
  const raw = (localRaw.value || rawContent.value || '').trim()
  if (!raw) {
    toast.warning('请先填写原始内容')
    return
  }
  localScript.value = raw
  saveScr()
  toast.success('已跳过 AI 改写，当前将直接使用原始内容')
  scriptStep.value = 2
}
function doExtract() { saveScr(); sendAssistant('请从当前集剧本中提取本集出现的角色和场景，提取时自动与项目已有数据进行去重合并', refresh) }
function doVoice() { sendAssistant('请为当前集关联的所有角色分配合适的音色', refresh) }
async function batchGenSamples() {
  const pending = chars.value.filter(c => (c.voice_style || c.voiceStyle) && !(c.voice_sample_url || c.voiceSampleUrl))
  if (!pending.length) {
    toast.info(charsVoiced.value ? '所有角色的试听文件已生成' : '请先分配音色')
    return
  }
  const list = pending.map(c => `「${c.name}」(character_id=${c.id})`).join('、')
  sendAssistant(`请为以下角色逐个生成音色试听，调用 generate_voice_sample：${list}`, refresh)
}
function doBreakdown() {
  const cfg = resolvedVideoConfig.value
  const label = cfg ? `${cfg.name} (${cfg.provider})` : '默认'
  sendAssistant(
    `请拆解分镜并生成 video_prompt。必须输出工业级 video_prompt（首行「图片1是…，图片2是…」自然语言引用，禁止 @图片 + 多个【镜头 NNN】子块，每块约 2 秒，含景别/运镜/打光/表演/台词口型细则/AI 补充提示词），默认 MS/MCU 面部完整入镜，ECU 仅末块钩子，禁止连续特写裁脸。禁止简写为 0-3秒 时间轴。本集视频模型为 ${label}，单条 storyboard 最长 15 秒，duration 等于子块时长之和。`,
    refresh,
  )
}

function getPlanCharacterNames(plan) {
  const ids = plan?.character_ids || []
  return ids.map(id => chars.value.find(c => c.id === id)?.name).filter(Boolean)
}

function getPlanSceneName(plan) {
  const sceneId = plan?.scene_id
  if (!sceneId) return plan?.location ? `${plan.location}${plan.time ? ` · ${plan.time}` : ''}` : '未绑定场景'
  const scene = scenes.value.find(s => s.id === sceneId)
  return scene ? `${scene.location} · ${scene.time || '未设时间'}` : `场景 #${sceneId}`
}

function planStatusLabel(plan) {
  return plan?.status === 'confirmed' ? '已确认' : '草稿'
}

async function doGenerateShotPlansInternal() {
  if (!scriptContent.value) {
    toast.warning('请先完成剧本编写')
    return
  }
  generateLoading.value = true
  try {
    const res = await episodeAPI.generateShotPlans(epId.value)
    shotPlans.value = res.shot_plans || []
    clips.value = res.clips || []
    await refresh()
    toast.success(`已生成 ${res.plan_count} 个镜头${res.clip_count ? `，${res.clip_count} 个视频片段` : ''}`)
    if (res.warning) toast.warning(res.warning)
  } catch (e) {
    toast.error(e.message || '生成失败')
  } finally {
    generateLoading.value = false
  }
}

async function doImportShotPlans() {
  const text = importText.value.trim()
  if (!text) {
    toast.warning('请粘贴工业分镜脚本')
    return
  }
  importLoading.value = true
  try {
    const res = await episodeAPI.importShotPlans(epId.value, text)
    shotPlans.value = res.shot_plans || []
    clips.value = res.clips || []
    await refresh()
    importModalOpen.value = false
    importText.value = ''
    toast.success(`已导入 ${res.plan_count} 个镜头${res.clip_count ? `，${res.clip_count} 个视频片段` : ''}`)
    if (res.warning) toast.warning(res.warning)
  } catch (e) {
    toast.error(e.message || '导入失败')
  } finally {
    importLoading.value = false
  }
}

async function doConfirmPlans() {
  try {
    await episodeAPI.confirmShotPlans(epId.value)
    await refresh()
    toast.success('镜头列表已确认')
  } catch (e) {
    toast.error(e.message || '确认失败')
  }
}

async function doAutoGroupClips() {
  try {
    const res = await episodeAPI.autoGroupClips(epId.value)
    clips.value = res.clips || []
    await refresh()
    toast.success(`已生成 ${res.clip_count} 个视频片段`)
  } catch (e) {
    toast.error(e.message || '分组失败')
  }
}

function isPlanInClip(plan, clip) {
  if (!plan || !clip?.shot_plans?.length) return false
  return clip.shot_plans.some(p => p.id === plan.id)
}

function getPlanClipLabel(plan) {
  if (!plan) return '未分组'
  const idx = newWorkflowClips.value.findIndex(c => isPlanInClip(plan, c))
  return idx >= 0 ? `Clip ${idx + 1}` : '未分组'
}

function clipDurationSum(clip) {
  if (!clip?.shot_plans?.length) return Number(clip?.duration) || 0
  return clip.shot_plans.reduce((s, p) => s + (Number(p.duration) || 2), 0)
}

async function movePlanToClip(plan, clip) {
  if (!plan?.id || !clip?.id || isPlanInClip(plan, clip)) return
  clipMoveLoading.value = true
  try {
    const res = await episodeAPI.movePlanToClip(epId.value, plan.id, clip.id)
    clips.value = res.clips || []
    await refresh()
    toast.success(`镜头 #${String(plan.shot_number || plan.shotNumber).padStart(3, '0')} 已移入 ${clip.title || '目标片段'}`)
  } catch (e) {
    toast.error(e.message || '移动失败')
  } finally {
    clipMoveLoading.value = false
  }
}

function goToProductionFromPlans() {
  if (!hasProductionClips.value) {
    toast.warning('请先自动分组生成视频片段')
    return
  }
  panel.value = 'production'
  prodTab.value = 'videos'
}
function genSample(id) {
  const char = chars.value.find(c => c.id === id)
  if (!char) return
  sendAssistant(`请为角色「${char.name}」（character_id=${id}）生成音色试听，调用 generate_voice_sample`, refresh)
}
async function addShot(options = {}) {
  try {
    const nextNum = sbs.value.length + 1
    await storyboardAPI.create({
      episode_id: epId.value,
      storyboard_number: nextNum,
      title: `镜头 ${nextNum}`,
      duration: 10,
    })
    toast.success(`已添加镜头 #${String(nextNum).padStart(2, '0')}`)
    await refresh()
    if (options.openVideos) prodTab.value = 'videos'
  } catch (e) {
    toast.error(e?.message || '添加镜头失败')
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function watchAsyncResult(check, attempts = 24, delay = 2500, onComplete) {
  void (async () => {
    for (let i = 0; i < attempts; i++) {
      await sleep(delay)
      await refresh()
      if (check()) {
        onComplete?.(true)
        return
      }
    }
    onComplete?.(false)
  })()
}

function genCharImg(id) {
  const char = chars.value.find(c => c.id === id)
  if (!char) return
  if (!isPendingCharImage(id)) pendingCharImageIds.value.push(id)
  const timerKey = charTimerKey(id)
  genTimer.startTask(timerKey, `角色「${char.name}」形象`, 'image')
  sendAssistant(`请为角色「${char.name}」（character_id=${id}）生成图片，直接调用 generate_character_image`, () => {
    watchAsyncResult(() => {
      const target = chars.value.find(c => c.id === id)
      const done = !!(target?.image_url || target?.imageUrl)
      if (done) pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== id)
      return done
    }, 36, () => genTimer.endTask(timerKey))
  })
}

async function uploadCharImage(charId, event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  if (isPendingCharUpload(charId)) return
  pendingCharUploadIds.value.push(charId)
  try {
    const res = await characterAPI.uploadImage(charId, file)
    const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
    if (!path) throw new Error('上传失败')
    const ossWarning = res?.oss_warning || res?.ossWarning
    toast.success(ossWarning ? '角色形象已上传（OSS 同步稍后重试）' : '角色形象已上传')
    if (ossWarning) toast.warning(`云端同步未成功：${ossWarning}`)
    await refresh()
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    pendingCharUploadIds.value = pendingCharUploadIds.value.filter(item => item !== charId)
    if (event?.target) event.target.value = ''
  }
}

async function generateCharOutfit(charId, asset, customPrompt) {
  const char = chars.value.find(item => item.id === charId)
  if (!char) return
  if (!charHasImage(char)) {
    toast.warning('请先生成或上传角色基准图')
    return
  }
  if (!imageReferenceSupported.value) {
    toast.error(imageReferenceSupportHint())
    return
  }
  const outfitKey = charOutfitKey(charId, `asset_${asset.id}`)
  if (!isPendingCharImage(charId)) pendingCharImageIds.value.push(charId)
  if (!isPendingCharOutfit(charId, outfitKey)) pendingCharOutfitKeys.value.push(outfitKey)
  const timerKey = charOutfitTimerKey(outfitKey)
  genTimer.startTask(timerKey, `角色换装「${asset.name}」`, 'image')
  try {
    const payload = {
      episode_id: epId.value,
      costume_asset_id: asset.id,
      label: asset.name,
    }
    if (customPrompt?.trim()) payload.prompt = customPrompt.trim()
    const res = await characterAPI.generateOutfit(charId, payload)
    toast.success(`「${asset.name}」换装生成中…`)
    pollCharImageGeneration(res?.image_generation_id, charId, null, outfitKey)
  } catch (e) {
    pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== charId)
    pendingCharOutfitKeys.value = pendingCharOutfitKeys.value.filter(item => item !== outfitKey)
    genTimer.endTask(timerKey)
    toast.error(e?.message || '换装生成失败')
  }
}

async function pollCharImageGeneration(generationId, charId, transformKey, outfitKey) {
  if (!generationId) {
    genTimer.endTask(charTimerKey(charId))
    if (transformKey) genTimer.endTask(charTransformTimerKey(transformKey))
    if (outfitKey) genTimer.endTask(charOutfitTimerKey(outfitKey))
    return
  }
  for (let i = 0; i < 120; i++) {
    await sleep(3000)
    try {
      const res = await imageAPI.get(generationId)
      await refresh()
      if (res?.status === 'completed') {
        pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== charId)
        if (transformKey) {
          pendingCharTransformKeys.value = pendingCharTransformKeys.value.filter(item => item !== transformKey)
        }
        if (outfitKey) {
          pendingCharOutfitKeys.value = pendingCharOutfitKeys.value.filter(item => item !== outfitKey)
        }
        genTimer.endTask(charTimerKey(charId))
        if (transformKey) genTimer.endTask(charTransformTimerKey(transformKey))
        if (outfitKey) genTimer.endTask(charOutfitTimerKey(outfitKey))
        toast.success(outfitKey ? '换装图已添加' : transformKey ? '角色变体图已添加' : '角色图已更新')
        return
      }
      if (res?.status === 'failed') {
        pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== charId)
        if (transformKey) {
          pendingCharTransformKeys.value = pendingCharTransformKeys.value.filter(item => item !== transformKey)
        }
        if (outfitKey) {
          pendingCharOutfitKeys.value = pendingCharOutfitKeys.value.filter(item => item !== outfitKey)
        }
        genTimer.endTask(charTimerKey(charId))
        if (transformKey) genTimer.endTask(charTransformTimerKey(transformKey))
        if (outfitKey) genTimer.endTask(charOutfitTimerKey(outfitKey))
        toast.error(res?.error_msg || res?.errorMsg || '图片生成失败')
        return
      }
    } catch {}
  }
  pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== charId)
  if (transformKey) {
    pendingCharTransformKeys.value = pendingCharTransformKeys.value.filter(item => item !== transformKey)
  }
  if (outfitKey) {
    pendingCharOutfitKeys.value = pendingCharOutfitKeys.value.filter(item => item !== outfitKey)
  }
  genTimer.endTask(charTimerKey(charId))
  if (transformKey) genTimer.endTask(charTransformTimerKey(transformKey))
  if (outfitKey) genTimer.endTask(charOutfitTimerKey(outfitKey))
  toast.warning('图片生成超时，请稍后刷新查看')
}

async function transformCharImg(charId, transformType, label, source = 'primary') {
  const char = chars.value.find(c => c.id === charId)
  if (!char) return
  if (charTransformDisabled(char, source)) {
    toast.warning(source === 'primary' ? '请先生成或上传角色原图' : '请先生成该套换装图')
    return
  }
  if (!imageReferenceSupported.value) {
    toast.error(imageReferenceSupportHint())
    return
  }
  const key = charTransformKey(charId, transformType, source)
  if (!isPendingCharImage(charId)) pendingCharImageIds.value.push(charId)
  if (!isPendingCharTransform(charId, transformType, source)) pendingCharTransformKeys.value.push(key)
  const timerKey = charTransformTimerKey(key)
  genTimer.startTask(timerKey, `角色「${char.name}」${label}`, 'image')
  try {
    const res = await characterAPI.transformImage(charId, epId.value, transformType, source === 'primary' ? undefined : source)
    toast.success(`${label} 转换中…`)
    pollCharImageGeneration(res?.image_generation_id, charId, key)
  } catch (e) {
    pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== charId)
    pendingCharTransformKeys.value = pendingCharTransformKeys.value.filter(item => item !== key)
    genTimer.endTask(timerKey)
    toast.error(e?.message || '转换失败')
  }
}
function batchCharImages() {
  const ids = visualChars.value.filter(c => !(c.image_url || c.imageUrl)).map(c => c.id)
  if (!ids.length) { toast.info('所有角色图片已生成'); return }
  pendingCharImageIds.value = [...new Set([...pendingCharImageIds.value, ...ids])]
  ids.forEach((id) => {
    const char = chars.value.find(c => c.id === id)
    genTimer.startTask(charTimerKey(id), `角色「${char?.name || id}」形象`, 'image')
  })
  sendAssistant(`请为当前集以下尚未生成图片的角色批量生成图片，调用 batch_generate_character_images，character_ids=[${ids.join(',')}]`, () => {
    watchAsyncResult(() => ids.every(id => {
      const char = chars.value.find(c => c.id === id)
      const done = !!(char?.image_url || char?.imageUrl)
      if (done) pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== id)
      return done
    }), 36, () => ids.forEach(id => genTimer.endTask(charTimerKey(id))))
  })
}
function genSceneImg(id) {
  const scene = scenes.value.find(s => s.id === id)
  if (!scene) return
  if (!isPendingSceneImage(id)) pendingSceneImageIds.value.push(id)
  const timerKey = sceneTimerKey(id)
  genTimer.startTask(timerKey, `场景「${scene.location}」主视角`, 'image')
  sendAssistant(`请为场景「${scene.location}」（scene_id=${id}）生成图片，直接调用 generate_scene_image`, () => {
    watchAsyncResult(() => {
      const target = scenes.value.find(s => s.id === id)
      const done = !!(target?.image_url || target?.imageUrl)
      if (done) pendingSceneImageIds.value = pendingSceneImageIds.value.filter(item => item !== id)
      return done
    }, 36, () => genTimer.endTask(timerKey))
  })
}

async function deleteCharacter(char) {
  const name = char?.name || `角色#${char?.id}`
  if (!confirm(`确定删除角色「${name}」？\n将从项目中移除，资产库中对应条目也会隐藏。`)) return
  try {
    await characterAPI.del(char.id)
    chars.value = chars.value.filter(c => c.id !== char.id)
    toast.success(`已删除角色「${name}」`)
  } catch (e) {
    toast.error(e?.message || '删除失败')
  }
}

async function deleteScene(scene) {
  const label = scene?.location || `场景#${scene?.id}`
  if (!confirm(`确定删除场景「${label}」？\n将从项目中移除，资产库中对应条目也会隐藏。`)) return
  try {
    await sceneAPI.del(scene.id)
    scenes.value = scenes.value.filter(s => s.id !== scene.id)
    toast.success(`已删除场景「${label}」`)
  } catch (e) {
    toast.error(e?.message || '删除失败')
  }
}

async function uploadSceneImage(sceneId, event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.warning('请选择图片文件')
    return
  }
  if (isPendingSceneUpload(sceneId)) return
  pendingSceneUploadIds.value.push(sceneId)
  try {
    const res = await sceneAPI.uploadImage(sceneId, file)
    const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
    if (!path) throw new Error('上传失败')
    toast.success('场景图已上传')
    await refresh()
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    pendingSceneUploadIds.value = pendingSceneUploadIds.value.filter(item => item !== sceneId)
    if (event?.target) event.target.value = ''
  }
}

function isPendingSceneAngle(sceneId, angleId) {
  return pendingSceneAngleKeys.value.includes(sceneAngleKey(sceneId, angleId))
}

function isPendingSceneAllAngles(sceneId) {
  return SCENE_ANGLE_PRESETS.some(preset => isPendingSceneAngle(sceneId, preset.id))
}

function sceneAngleDisabled(scene) {
  if (!imageReferenceSupported.value) return true
  if (!(scene?.image_url || scene?.imageUrl)) return true
  return isPendingSceneImage(scene.id)
}

function getSceneImagesForStoryboard(sb) {
  const sceneId = sb?.scene_id || sb?.sceneId
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return []
  return listSceneImagesForStoryboard(scene, sb, getBlockingImage)
}

function onStoryboardSceneImageClick(sb, img) {
  if (!img?.url) return
  if (img.readonly || img.angle_id === 'blocking' || String(img.angle_id).startsWith('blocking:')) {
    openImageViewer(displayUrl(img.url), `${img.label || '站位图'}`)
    return
  }
  setStoryboardSceneAngle(sb, img.angle_id)
}

function isStoryboardSceneAngleSelected(sb, angleId) {
  const current = sb?.scene_angle_id || sb?.sceneAngleId || 'hero'
  return current === angleId
}

function setStoryboardSceneAngle(sb, angleId) {
  const img = getSceneImagesForStoryboard(sb).find(item => item.angle_id === angleId)
  if (!img?.url) {
    toast.warning(`请先生成「${sceneAngleLabel(angleId)}」场景图`)
    return
  }
  sb.scene_angle_id = angleId
  sb.sceneAngleId = angleId
  storyboardAPI.update(sb.id, { scene_angle_id: angleId })
}

function onStoryboardSceneChange(sb, sceneId) {
  updateField(sb, 'scene_id', sceneId)
  const nextAngle = 'hero'
  sb.scene_angle_id = sceneId ? nextAngle : null
  sb.sceneAngleId = sceneId ? nextAngle : null
  storyboardAPI.update(sb.id, { scene_id: sceneId, scene_angle_id: sceneId ? nextAngle : null })
}

async function genSceneAngle(sceneId, angleId, label, prompt) {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return
  if (sceneAngleDisabled(scene)) {
    if (!imageReferenceSupported.value) toast.error(imageReferenceSupportHint())
    else toast.warning('请先生成场景主视角图')
    return
  }
  const key = sceneAngleKey(sceneId, angleId)
  if (!isPendingSceneAngle(sceneId, angleId)) pendingSceneAngleKeys.value.push(key)
  genTimer.startTask(sceneAngleTimerKey(key), `场景「${scene.location}」· ${label}`, 'image')
  try {
    const payload = {
      episode_id: epId.value,
      angle_id: angleId,
    }
    if (prompt?.trim()) payload.prompt = prompt.trim()
    const res = await sceneAPI.generateAngle(sceneId, payload)
    toast.success(`「${label}」场景图生成中…`)
    pollSceneAngleGeneration(res?.image_generation_id, sceneId, key)
  } catch (e) {
    pendingSceneAngleKeys.value = pendingSceneAngleKeys.value.filter(item => item !== key)
    genTimer.endTask(sceneAngleTimerKey(key))
    toast.error(e?.message || '场景多角度生成失败')
  }
}

async function genSceneAllAngles(sceneId) {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return
  if (sceneAngleDisabled(scene)) {
    if (!imageReferenceSupported.value) toast.error(imageReferenceSupportHint())
    else toast.warning('请先生成场景主视角图')
    return
  }
  if (isPendingSceneAllAngles(sceneId)) return
  try {
    const res = await sceneAPI.generateAllAngles(sceneId, {
      episode_id: epId.value,
      skip_existing: true,
    })
    const items = res?.items || []
    if (!items.length) {
      toast.info(res?.message || '全部角度已存在，无需重复生成')
      return
    }
    for (const item of items) {
      const key = sceneAngleKey(sceneId, item.angle_id)
      if (!isPendingSceneAngle(sceneId, item.angle_id)) pendingSceneAngleKeys.value.push(key)
      genTimer.startTask(sceneAngleTimerKey(key), `场景「${scene.location}」· ${sceneAngleLabel(item.angle_id)}`, 'image')
      pollSceneAngleGeneration(item.image_generation_id, sceneId, key)
    }
    const failed = res?.failed || []
    if (failed.length) {
      toast.warning(`已提交 ${items.length} 张，${failed.length} 张失败（已退积分）`)
    } else {
      toast.success(`开始生成 ${items.length} 张场景角度图…`)
    }
  } catch (e) {
    toast.error(e?.message || '场景全部角度生成失败')
  }
}

async function genSceneAngleSheet(sceneId, prompt) {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return
  if (sceneAngleDisabled(scene)) {
    if (!imageReferenceSupported.value) toast.error(imageReferenceSupportHint())
    else toast.warning('请先生成场景主视角图')
    return
  }
  const key = sceneAngleKey(sceneId, SCENE_ANGLE_SHEET_ID)
  if (!isPendingSceneAngle(sceneId, SCENE_ANGLE_SHEET_ID)) pendingSceneAngleKeys.value.push(key)
  genTimer.startTask(sceneAngleTimerKey(key), `场景「${scene.location}」· ${SCENE_ANGLE_SHEET_LABEL}`, 'image')
  try {
    const payload = { episode_id: epId.value }
    if (prompt?.trim()) payload.prompt = prompt.trim()
    const res = await sceneAPI.generateAngleSheet(sceneId, payload)
    toast.success(`${SCENE_ANGLE_SHEET_LABEL}生成中…`)
    pollSceneAngleGeneration(res?.image_generation_id, sceneId, key)
  } catch (e) {
    pendingSceneAngleKeys.value = pendingSceneAngleKeys.value.filter(item => item !== key)
    genTimer.endTask(sceneAngleTimerKey(key))
    toast.error(e?.message || '场景多视角拼板生成失败')
  }
}

function openSceneAngleRegen(scene, img) {
  if (!scene || !img?.angle_id || img.angle_id === 'hero') return
  const key = sceneAngleKey(scene.id, img.angle_id)
  const isSheet = img.angle_id === SCENE_ANGLE_SHEET_ID
  const defaultPrompt = isSheet
    ? buildSceneAngleSheetPrompt(scene)
    : buildSceneAnglePrompt(scene, img.angle_id)
  sceneAngleRegen.value = {
    open: true,
    sceneId: scene.id,
    sceneLocation: scene.location,
    angleId: img.angle_id,
    angleLabel: img.label || sceneAngleLabel(img.angle_id),
    imageUrl: img.url || '',
    prompt: sceneAnglePromptDrafts.value[key] || defaultPrompt,
    defaultPrompt,
    previewTitle: `${scene.location} · ${img.label || sceneAngleLabel(img.angle_id)}`,
    isSheet,
  }
}

function closeSceneAngleRegen() {
  sceneAngleRegen.value.open = false
}

async function confirmSceneAngleRegen(prompt) {
  const { sceneId, angleId, angleLabel, isSheet } = sceneAngleRegen.value
  if (!sceneId || !angleId) return
  const key = sceneAngleKey(sceneId, angleId)
  sceneAnglePromptDrafts.value[key] = prompt
  sceneAngleRegen.value.open = false
  if (isSheet) await genSceneAngleSheet(sceneId, prompt)
  else await genSceneAngle(sceneId, angleId, angleLabel, prompt)
}

async function pollSceneAngleGeneration(generationId, sceneId, pendingKey) {
  if (!generationId) {
    pendingSceneAngleKeys.value = pendingSceneAngleKeys.value.filter(item => item !== pendingKey)
    genTimer.endTask(sceneAngleTimerKey(pendingKey))
    return
  }
  for (let i = 0; i < 120; i++) {
    await sleep(3000)
    try {
      const res = await imageAPI.get(generationId)
      await refresh()
      if (res?.status === 'completed') {
        pendingSceneAngleKeys.value = pendingSceneAngleKeys.value.filter(item => item !== pendingKey)
        genTimer.endTask(sceneAngleTimerKey(pendingKey))
        toast.success('场景多角度图已更新')
        return
      }
      if (res?.status === 'failed') {
        pendingSceneAngleKeys.value = pendingSceneAngleKeys.value.filter(item => item !== pendingKey)
        genTimer.endTask(sceneAngleTimerKey(pendingKey))
        toast.error(res?.error_msg || res?.errorMsg || '场景多角度生成失败')
        return
      }
    } catch {}
  }
  pendingSceneAngleKeys.value = pendingSceneAngleKeys.value.filter(item => item !== pendingKey)
  genTimer.endTask(sceneAngleTimerKey(pendingKey))
  toast.warning('场景多角度生成超时，请稍后刷新查看')
}
function batchSceneImages() {
  const ids = scenes.value.filter(s => !(s.image_url || s.imageUrl)).map(s => s.id)
  if (!ids.length) { toast.info('所有场景图片已生成'); return }
  pendingSceneImageIds.value = [...new Set([...pendingSceneImageIds.value, ...ids])]
  ids.forEach((id) => {
    const scene = scenes.value.find(s => s.id === id)
    genTimer.startTask(sceneTimerKey(id), `场景「${scene?.location || id}」主视角`, 'image')
  })
  sendAssistant(`请为当前集以下尚未生成图片的场景批量生成图片，调用 batch_generate_scene_images，scene_ids=[${ids.join(',')}]`, () => {
    watchAsyncResult(() => ids.every(id => {
      const scene = scenes.value.find(s => s.id === id)
      const done = !!(scene?.image_url || scene?.imageUrl)
      if (done) pendingSceneImageIds.value = pendingSceneImageIds.value.filter(item => item !== id)
      return done
    }), 36, () => ids.forEach(id => genTimer.endTask(sceneTimerKey(id))))
  })
}

const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

function getDialogueSpeakerRaw(sb) {
  const dialogue = sb?.dialogue?.trim() || ''
  const match = dialogue.match(/^(.+?)[:：]/)
  return match ? match[1].replace(/[（(].+?[)）]/g, '').trim() : ''
}

function getDialogueText(sb) {
  const dialogue = sb?.dialogue?.trim() || ''
  return dialogue ? dialogue.replace(/^.+?[:：]\s*/, '').trim() : ''
}

function isTTSIgnorable(sb) {
  const speaker = getDialogueSpeakerRaw(sb)
  const text = getDialogueText(sb)
  if (!sb?.dialogue?.trim()) return true
  if (speaker && IGNORE_TTS_SPEAKERS.test(speaker)) return true
  if (!text) return true
  if (IGNORE_TTS_TEXT.test(text)) return true
  return false
}

function hasDialogue(sb) { return !isTTSIgnorable(sb) }
function hasTTS(sb) { return !!(sb?.tts_audio_url || sb?.ttsAudioUrl) }
function getTTSUrl(sb) { return sb?.tts_audio_url || sb?.ttsAudioUrl || '' }
function getDialogueSpeaker(sb) {
  const speaker = getDialogueSpeakerRaw(sb)
  if (!speaker) return '旁白'
  return speaker
}
function genShotTTS(sb) {
  sendAssistant(`请为镜头 #${shotIndex(sb)}（storyboard_id=${sb.id}）生成配音，调用 generate_shot_tts`, refresh)
}
function batchShotTTS() {
  const pending = sbs.value.filter(sb => hasDialogue(sb) && !hasTTS(sb))
  if (!pending.length) {
    toast.info(ttsEligibleCount.value ? '所有镜头配音已生成' : '当前没有可生成的对白或旁白')
    return
  }
  sendAssistant('请为所有有对白但尚未生成配音的镜头批量生成 TTS，调用 batch_generate_shot_tts', refresh)
}

function getFirstFrame(s) { return s?.first_frame_image || s?.firstFrameImage || null }
function getLastFrame(s) { return s?.last_frame_image || s?.lastFrameImage || null }
function getStoryboardCover(s) { return s?.composed_image || s?.composedImage || getFirstFrame(s) || getLastFrame(s) || null }
function getVideoUrl(s) { return s?.video_url || s?.videoUrl || null }
function getComposedVideoUrl(s) { return s?.composed_video_url || s?.composedVideoUrl || null }
function hasImg(s) { return !!getStoryboardCover(s) }
function hasVid(s) { return !!getVideoUrl(s) }
function hasComposed(s) { return !!getComposedVideoUrl(s) }

function getCharacterImages(char) {
  return listCharacterImages(char)
}

function getCharacterOutfits(char) {
  return listCharacterOutfits(char)
}

function getCharacterImagesById(charId) {
  const char = chars.value.find(item => item.id === charId)
  return char ? getCharacterImages(char) : []
}

function getCharacterName(charId) {
  return chars.value.find(item => item.id === charId)?.name || `角色#${charId}`
}

function getStoryboardCharacterImageRefs(sb) {
  return parseStoryboardCharacterImageRefs(sb)
}

function isStoryboardCharacterImageSelected(sb, charId, url) {
  const refs = getStoryboardCharacterImageRefs(sb)
  const char = chars.value.find(item => item.id === charId)
  const normalized = normalizeMediaPath(url)
  const selected = refs[charId]
  if (selected) return normalizeMediaPath(selected) === normalized
  return normalizeMediaPath(resolveCharacterImageUrl(char, {})) === normalized
}

function setStoryboardCharacterImage(sb, charId, url) {
  const refs = { ...getStoryboardCharacterImageRefs(sb) }
  const char = chars.value.find(item => item.id === charId)
  const normalized = normalizeMediaPath(url)
  const primary = normalizeMediaPath(resolveCharacterImageUrl(char, {}))
  if (primary === normalized) delete refs[charId]
  else refs[charId] = normalized
  updateField(sb, 'character_image_refs', refs)
}

function getShotReferenceImages(sb) {
  const refs = []
  const pushRef = (value) => {
    if (!value || refs.includes(value) || refs.length >= 6) return
    refs.push(value)
  }
  const sceneId = sb?.scene_id || sb?.sceneId
  const scene = scenes.value.find(item => item.id === sceneId)
  pushRef(scene?.image_url || scene?.imageUrl)
  const characterImageRefs = getStoryboardCharacterImageRefs(sb)
  for (const charId of getStoryboardCharacterIds(sb)) {
    const char = chars.value.find(item => item.id === charId)
    pushRef(char ? resolveCharacterImageUrl(char, characterImageRefs) : null)
  }
  for (const ref of getRefs(sb)) {
    pushRef(ref)
  }
  const first = getFirstFrame(sb)
  const last = getLastFrame(sb)
  pushRef(first)
  pushRef(last)
  return refs.filter(Boolean).slice(0, 6)
}

function buildShotImagePrompt(sb, frameType) {
  const title = sb.title || ''
  const description = sb.image_prompt || sb.imagePrompt || sb.description || ''
  const shotType = sb.shot_type || sb.shotType || ''
  const angle = sb.angle || ''
  const movement = sb.movement || ''
  const location = sb.location || getSceneName(sb)
  const time = sb.time || ''
  const charactersText = getStoryboardCharacterNames(sb).join('、')
  const action = sb.action || ''
  const atmosphere = sb.atmosphere || ''
  const frameHint = frameType === 'first_frame'
    ? '生成这个镜头的起始关键帧，突出建立关系和动作开始瞬间'
    : '生成这个镜头的结束关键帧，突出动作结束、情绪落点或结果状态'

  return [
    title ? `镜头标题：${title}` : '',
    description ? `画面描述：${description}` : '',
    shotType ? `景别：${shotType}` : '',
    angle ? `机位：${angle}` : '',
    movement ? `运镜：${movement}` : '',
    charactersText ? `角色：${charactersText}` : '',
    location ? `地点：${location}` : '',
    time ? `时间：${time}` : '',
    action ? `动作：${action}` : '',
    atmosphere ? `氛围：${atmosphere}` : '',
    frameHint,
  ].filter(Boolean).join('；')
}

function genShotFrame(sb, frameType) {
  const key = framePendingKey(sb.id, frameType)
  const label = frameType === 'first_frame' ? '首帧' : '尾帧'
  if (!pendingShotFrameKeys.value.includes(key)) pendingShotFrameKeys.value.push(key)
  const timerKey = frameTimerKey(sb.id, frameType)
  genTimer.startTask(timerKey, `镜头 #${shotIndex(sb)} ${label}`, 'image')
  sendAssistant(`请为镜头 #${shotIndex(sb)}（storyboard_id=${sb.id}）生成${label}，调用 generate_shot_frame，frame_type=${frameType}`, () => {
    watchAsyncResult(() => {
      const target = sbs.value.find(s => s.id === sb.id)
      const done = frameType === 'first_frame' ? !!getFirstFrame(target) : !!getLastFrame(target)
      if (done) pendingShotFrameKeys.value = pendingShotFrameKeys.value.filter(item => item !== key)
      return done
    }, 36, () => genTimer.endTask(timerKey))
  })
}

function getRefs(sb) {
  const raw = sb.reference_images || sb.referenceImages
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function collectDisplayMediaPaths() {
  const paths = []
  const push = (v) => { if (v) paths.push(v) }
  for (const c of chars.value) {
    push(c.image_url || c.imageUrl || c.local_path || c.localPath)
    for (const img of listCharacterImages(c)) push(img.url)
    for (const outfit of listCharacterOutfits(c.reference_images || c.referenceImages)) {
      push(outfit.url)
      for (const v of Object.values(outfit.variants || {})) push(v?.url)
    }
  }
  for (const s of scenes.value) {
    push(s.image_url || s.imageUrl || s.local_path || s.localPath)
    for (const img of listSceneImages(s)) push(img.url)
  }
  for (const sb of sbs.value) {
    push(sb.composed_image || sb.composedImage)
    push(sb.first_frame_image || sb.firstFrameImage)
    push(sb.last_frame_image || sb.lastFrameImage)
    push(sb.blocking_image || sb.blockingImage)
    push(getStoryboardCover(sb))
    for (const ref of getRefs(sb)) push(ref)
  }
  if (gridImagePath.value) push(gridImagePath.value)
  return paths
}

function displayUrl(raw) {
  return mediaDisplayUrl(raw)
}

function gridUrl(raw) {
  return mediaGridUrl(raw)
}

function videoRefHelpers() {
  return {
    getRefs,
    getFirstFrame,
    getLastFrame,
    getBlockingImage,
    getStoryboardCharacterIds,
    getCharacterImageRefs: getStoryboardCharacterImageRefs,
    resolveSceneImage: (scene, sb) => resolveSceneImageForStoryboard(scene, sb),
    getTTSUrl,
    getVoiceRefs: getStoryboardVoiceRefs,
    frameMode: frameMode.value,
  }
}

function collectVideoReferences(sb) {
  const prompt = sb.video_prompt || sb.videoPrompt || ''
  return buildPromptOrderedDisplayItems(sb, prompt, chars.value, scenes.value, videoRefHelpers())
}

function collectVideoReferencesExceptBlocking(sb) {
  return assignDisplayImageIndices(
    collectVideoReferences(sb).filter(ref => ref.source !== 'blocking'),
  )
}

function getBlockingColorLegend(sb) {
  if (!sb) return []
  return buildBlockingColorLegend(getBlockingLayout(sb), getCharacterName)
}

function getBlockingVideoPromptSnippet(sb) {
  if (!sb) return ''
  return buildBlockingVideoPromptSnippet(
    getBlockingLayout(sb),
    getCharacterName,
    getBlockingVideoImageIndex(sb),
  )
}

async function copyBlockingVideoSnippet(sb) {
  const text = getBlockingVideoPromptSnippet(sb)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制站位说明，可粘贴到 video_prompt 首行')
  } catch {
    toast.error('复制失败')
  }
}

function getBlockingVideoImageIndex(sb) {
  return getBlockingImageIndexFromPromptItems(collectVideoReferences(sb))
}

function getStoryboardVoiceRefs(sb) {
  return parseVoiceRefs(sb?.voice_refs ?? sb?.voiceRefs)
}

async function loadVoiceAssets() {
  try {
    const rows = await assetAPI.list({ drama_id: dramaId, type: 'voice' })
    voiceAssets.value = Array.isArray(rows) ? rows : []
  } catch {
    voiceAssets.value = []
  }
}

function openVoiceRefPicker(sb) {
  voiceRefPicker.value = { open: true, storyboard: sb }
}

async function applyStoryboardVoiceRefs(refs) {
  const sb = voiceRefPicker.value.storyboard
  if (!sb) return
  const next = (refs || []).slice(0, MAX_VOICE_REFS)
  sb.voice_refs = next
  sb.voiceRefs = next
  try {
    await storyboardAPI.update(sb.id, { voice_refs: next })
    toast.success(next.length ? `已绑定 ${next.length} 个音色参考` : '已清空音色参考')
  } catch (e) {
    toast.error(e?.message || '保存音色参考失败')
  }
}

async function removeStoryboardVoiceRef(sb, ref) {
  const path = normalizeMediaPath(ref?.path || ref?.url)
  const next = getStoryboardVoiceRefs(sb).filter(item => normalizeMediaPath(item.path) !== path)
  sb.voice_refs = next
  sb.voiceRefs = next
  try {
    await storyboardAPI.update(sb.id, { voice_refs: next })
    toast.success('已移除音色参考')
  } catch (e) {
    toast.error(e?.message || '移除失败')
  }
}

function buildVideoContentRefs(sb) {
  const prompt = sb.video_prompt || sb.videoPrompt || ''
  return buildOrderedVideoContentRefs(sb, prompt, chars.value, scenes.value, videoRefHelpers())
}

async function removeVideoRefCharacter(sb, charId) {
  const char = chars.value.find(item => item.id === charId)
  const nextIds = getStoryboardCharacterIds(sb).filter(id => id !== charId)
  const refs = { ...getStoryboardCharacterImageRefs(sb) }
  delete refs[charId]
  let prompt = sb.video_prompt || sb.videoPrompt || ''
  if (char?.name) prompt = removePromptImageLabel(prompt, null, char.name)

  sb.character_ids = nextIds
  sb.characterIds = nextIds
  sb.character_image_refs = refs
  sb.characterImageRefs = refs
  const promptChanged = prompt !== (sb.video_prompt || sb.videoPrompt || '')
  if (promptChanged) {
    sb.video_prompt = prompt
    sb.videoPrompt = prompt
  }

  try {
    const payload = { character_ids: nextIds, character_image_refs: refs }
    if (promptChanged) payload.video_prompt = prompt
    await storyboardAPI.update(sb.id, payload)
    toast.success('已移除角色绑定')
  } catch (e) {
    toast.error(e?.message || '移除失败')
  }
}

async function removeVideoRefScene(sb) {
  const sceneId = sb.scene_id || sb.sceneId
  const scene = scenes.value.find(item => item.id === sceneId)
  let prompt = sb.video_prompt || sb.videoPrompt || ''
  if (scene?.location) prompt = removePromptImageLabel(prompt, null, scene.location)
  prompt = removePromptImageLabel(prompt, null, '场景')

  sb.scene_id = null
  sb.sceneId = null
  const promptChanged = prompt !== (sb.video_prompt || sb.videoPrompt || '')
  if (promptChanged) {
    sb.video_prompt = prompt
    sb.videoPrompt = prompt
  }

  try {
    const payload = { scene_id: null }
    if (promptChanged) payload.video_prompt = prompt
    await storyboardAPI.update(sb.id, payload)
    toast.success('已解除场景绑定')
  } catch (e) {
    toast.error(e?.message || '解除失败')
  }
}

async function removeExtraReference(sb, ref) {
  const url = ref?.url ?? ref
  const normalized = normalizeMediaPath(url)
  const prevRefs = getRefs(sb)
  const next = prevRefs.filter(item => normalizeMediaPath(item) !== normalized)
  if (next.length === prevRefs.length) return

  let prompt = sb.video_prompt || sb.videoPrompt || ''
  const label = ref?.promptLabel || ref?.label
  if (ref?.imageIndex || label) {
    prompt = removePromptImageLabel(prompt, ref?.imageIndex || null, label)
  }
  const refIdx = prevRefs.findIndex(item => normalizeMediaPath(item) === normalized)
  if (refIdx >= 0) {
    const refLabel = prevRefs.length > 1 ? `参考图${refIdx + 1}` : '参考图'
    prompt = removePromptImageLabel(prompt, null, refLabel)
  }

  sb.reference_images = next
  sb.referenceImages = JSON.stringify(next)
  const promptChanged = prompt !== (sb.video_prompt || sb.videoPrompt || '')
  if (promptChanged) {
    sb.video_prompt = prompt
    sb.videoPrompt = prompt
  }

  try {
    const payload = { reference_images: next }
    if (promptChanged) payload.video_prompt = prompt
    await storyboardAPI.update(sb.id, payload)
    toast.success('已删除参考图')
  } catch (e) {
    toast.error(e?.message || '删除失败')
  }
}

function parseGenerationStartedAt(row) {
  const raw = row?.created_at || row?.createdAt
  if (!raw) return Date.now()
  const ts = new Date(raw).getTime()
  return Number.isFinite(ts) ? ts : Date.now()
}

async function restorePendingVideoGenerations() {
  try {
    const rows = await videoAPI.list({ drama_id: dramaId })
    const latestByStoryboard = new Map()
    for (const row of rows || []) {
      const storyboardId = row?.storyboard_id ?? row?.storyboardId
      const status = row?.status
      if (!storyboardId || !['processing', 'pending'].includes(status)) continue
      const existing = latestByStoryboard.get(storyboardId)
      if (!existing || row.id > existing.id) latestByStoryboard.set(storyboardId, row)
    }

    for (const [storyboardId, row] of latestByStoryboard.entries()) {
      if (!sbs.value.some(sb => sb.id === storyboardId)) continue
      const generationId = row.id
      const pollKey = `${storyboardId}:${generationId}`
      if (videoPollInFlight.value[pollKey]) continue

      if (!pendingVideoIds.value.includes(storyboardId)) {
        pendingVideoIds.value = [...pendingVideoIds.value, storyboardId]
      }
      activeVideoGenerationByStoryboard.value = {
        ...activeVideoGenerationByStoryboard.value,
        [storyboardId]: generationId,
      }

      const sb = sbs.value.find(item => item.id === storyboardId)
      const timerKey = videoTimerKey(storyboardId)
      if (!genTimer.hasTask(timerKey)) {
        genTimer.startTask(
          timerKey,
          `镜头 #${shotIndex(sb)} 视频`,
          'video',
          parseGenerationStartedAt(row),
        )
      }

      pollVideoGeneration(generationId, storyboardId, getVideoUrl(sb) || '')
    }
  } catch {
    // ignore restore errors
  }
}

async function clearVideoFrame(sb, frameType) {
  const field = frameType === 'first_frame' ? 'first_frame_image' : 'last_frame_image'
  const camel = toCamel(field)
  sb[field] = null
  sb[camel] = null
  try {
    await storyboardAPI.update(sb.id, { [field]: null })
    toast.success(frameType === 'first_frame' ? '已删除首帧' : '已删除尾帧')
  } catch (e) {
    toast.error(e?.message || '删除失败')
  }
}

async function uploadVideoReference(sb, event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  try {
    const res = await uploadAPI.image(file, dramaId)
    const path = normalizeMediaPath(res?.path || res?.url || res?.local_path || res?.localPath)
    if (!path) throw new Error('上传失败')
    const next = [...getRefs(sb), path]
    sb.reference_images = next
    sb.referenceImages = JSON.stringify(next)
    await storyboardAPI.update(sb.id, { reference_images: next })
    if (!res?.oss_url && !res?.ossUrl) await prefetchMediaUrls([path])
    toast.success('参考图已添加并入库')
  } catch (e) {
    toast.error(e?.message || '上传失败')
  } finally {
    if (event?.target) event.target.value = ''
  }
}

function openVideoReferencePicker(sb) {
  videoRefPicker.value = { open: true, sbId: sb.id, key: videoRefPicker.value.key + 1 }
}

async function applyVideoReferencePick(item) {
  const sb = sbs.value.find(row => row.id === videoRefPicker.value.sbId)
  videoRefPicker.value.open = false
  if (!sb) return
  const asset = item?.asset || item
  const path = normalizeMediaPath(asset?.url || asset?.local_path || asset?.localPath)
  if (!path) {
    toast.error('参考图无效')
    return
  }
  const refs = getRefs(sb)
  if (refs.some(ref => normalizeMediaPath(ref) === path)) {
    toast.info('该参考图已在列表中')
    return
  }
  try {
    const next = [...refs, path]
    sb.reference_images = next
    sb.referenceImages = JSON.stringify(next)
    await storyboardAPI.update(sb.id, { reference_images: next })
    await prefetchMediaUrls([path])
    toast.success('已添加参考图')
  } catch (e) {
    toast.error(e?.message || '添加失败')
  }
}

async function genVid(sb) {
  const prompt = (sb.video_prompt || sb.videoPrompt || '').trim()
  if (!prompt) {
    toast.warning('请先填写视频提示词')
    return
  }
  const refIssues = validatePromptImageRefs(prompt, sb, chars.value, scenes.value, videoRefHelpers())
  if (refIssues.length) {
    toast.error(formatPromptImageRefIssues(refIssues))
    return
  }
  const contentRefs = buildVideoContentRefs(sb)
  if (isChengmengVideoActive.value) {
    const imageCount = countChengmengReferenceImages(contentRefs)
    const audioCount = countChengmengReferenceAudios(contentRefs)
    const sendLength = estimateChengmengPromptLength(prompt, imageCount, 0, audioCount)
    if (sendLength > CHENGMENT_PROMPT_MAX_LENGTH) {
      toast.error(formatVideoPromptOverLimitMessage(sendLength))
      return
    }
  }
  const params = {
    storyboard_id: sb.id,
    drama_id: dramaId,
    prompt,
    duration: Number(sb.duration || 10),
    aspect_ratio: (contentRefs.length && isSeedance2VideoActive.value && !isChengmengVideoActive.value)
      ? 'adaptive'
      : dramaImageAspect.value,
  }
  if (contentRefs.length) {
    params.content_refs = contentRefs
  } else {
    const first = getFirstFrame(sb)
    const last = getLastFrame(sb)
    const refs = getRefs(sb)
    if (first && last) {
      Object.assign(params, { reference_mode: 'first_last', first_frame_url: first, last_frame_url: last })
    } else if (refs.length || first) {
      Object.assign(params, { reference_mode: 'multiple', reference_image_urls: [first, ...refs].filter(Boolean) })
    } else if (first) {
      Object.assign(params, { reference_mode: 'single', image_url: first })
    }
  }

  try {
    delete failedVideoMessages.value[sb.id]
    const isRetry = isPendingVideo(sb.id) && isVideoGenerationSlow(sb.id)
    if (!isPendingVideo(sb.id)) pendingVideoIds.value.push(sb.id)
    genTimer.startTask(videoTimerKey(sb.id), `镜头 #${shotIndex(sb)} 视频`, 'video')
    const generation = await videoAPI.generate(params)
    const generationId = generation?.id ?? generation?.generation_id
    const baselineVideoUrl = getVideoUrl(sb) || ''
    if (generationId) {
      activeVideoGenerationByStoryboard.value = {
        ...activeVideoGenerationByStoryboard.value,
        [sb.id]: generationId,
      }
    }
    toast.success(isRetry ? '已重新提交视频生成' : '视频生成中')
    await refresh()
    pollVideoGeneration(generationId, sb.id, baselineVideoUrl)
  } catch (e) {
    pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== sb.id)
    clearActiveVideoGeneration(sb.id, activeVideoGenerationByStoryboard.value[sb.id])
    genTimer.endTask(videoTimerKey(sb.id))
    toast.error(e.message)
  }
}

async function finishStaleVideoGeneration(storyboardId) {
  await loadVideoGenCounts()
  toast.info('上一份视频已生成完成，可在「历史视频」中查看')
}

async function pollVideoGeneration(generationId, storyboardId, baselineVideoUrl = '') {
  const pollKey = `${storyboardId}:${generationId || 'none'}`
  if (videoPollInFlight.value[pollKey]) return
  videoPollInFlight.value = { ...videoPollInFlight.value, [pollKey]: true }
  try {
  if (!generationId) {
    watchAsyncResult(() => {
      const target = sbs.value.find(s => s.id === storyboardId)
      const currentUrl = getVideoUrl(target) || ''
      const done = !!currentUrl && currentUrl !== baselineVideoUrl
      if (done && isActiveVideoGeneration(storyboardId, generationId)) {
        pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
        clearActiveVideoGeneration(storyboardId, generationId)
      }
      return done
    }, 60, 4000, () => {
      if (isActiveVideoGeneration(storyboardId, generationId)) genTimer.endTask(videoTimerKey(storyboardId))
    })
    return
  }
  for (let i = 0; i < 300; i++) {
    await sleep(5000)
    try {
      const res = await videoAPI.get(generationId)
      await refresh()
      if (res?.status === 'completed') {
        if (!isActiveVideoGeneration(storyboardId, generationId)) {
          await finishStaleVideoGeneration(storyboardId)
          return
        }
        pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
        clearActiveVideoGeneration(storyboardId, generationId)
        genTimer.endTask(videoTimerKey(storyboardId))
        delete failedVideoMessages.value[storyboardId]
        await loadVideoGenCounts()
        toast.success('视频生成完成')
        return
      }
      if (res?.status === 'failed') {
        if (!isActiveVideoGeneration(storyboardId, generationId)) return
        pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
        clearActiveVideoGeneration(storyboardId, generationId)
        genTimer.endTask(videoTimerKey(storyboardId))
        failedVideoMessages.value = {
          ...failedVideoMessages.value,
          [storyboardId]: res?.error_msg || res?.errorMsg || '视频生成失败',
        }
        toast.error(failedVideoMessages.value[storyboardId])
        return
      }
    } catch {}
  }
  if (!isActiveVideoGeneration(storyboardId, generationId)) return
  pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
  clearActiveVideoGeneration(storyboardId, generationId)
  genTimer.endTask(videoTimerKey(storyboardId))
  toast.warning('视频生成超时，可继续生成；若上一份完成可在历史视频中查看')
  } finally {
    const next = { ...videoPollInFlight.value }
    delete next[pollKey]
    videoPollInFlight.value = next
  }
}
function doCompose(sb) {
  delete failedComposeMessages.value[sb.id]
  if (!isPendingCompose(sb.id)) pendingComposeIds.value.push(sb.id)
  genTimer.startTask(composeTimerKey(sb.id), `镜头 #${shotIndex(sb)} 合成`, 'compose')
  sendAssistant(`请合成镜头 #${shotIndex(sb)}（storyboard_id=${sb.id}），调用 compose_shot`, () => {
    pendingComposeIds.value = pendingComposeIds.value.filter(item => item !== sb.id)
    genTimer.endTask(composeTimerKey(sb.id))
  })
}
function batchVideos() {
  const pendingIds = sbs.value.filter(s => !hasVid(s)).map(s => s.id)
  if (!pendingIds.length) {
    toast.info('所有镜头视频已生成')
    return
  }
  pendingVideoIds.value = [...new Set([...pendingVideoIds.value, ...pendingIds])]
  pendingIds.forEach((id) => {
    const sb = sbs.value.find(s => s.id === id)
    genTimer.startTask(videoTimerKey(id), `镜头 #${sb ? shotIndex(sb) : id} 视频`, 'video')
  })
  sendAssistant('请为所有尚无视频的镜头批量生成视频，调用 batch_generate_shot_videos', () => {
    watchAsyncResult(() => pendingIds.every(id => {
      const target = sbs.value.find(s => s.id === id)
      const done = !!hasVid(target)
      if (done) pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== id)
      return done
    }), 80, 4000, () => pendingIds.forEach(id => genTimer.endTask(videoTimerKey(id))))
  })
}
function batchCompose() {
  sendAssistant('请合成当前集所有已有视频的镜头，调用 compose_all_shots', () => {
    pendingComposeIds.value = [...new Set(sbs.value.filter(sb => hasVid(sb)).map(sb => sb.id))]
    pollComposeStatus()
  })
}
function doMerge() {
  sendAssistant('请拼接本集所有已合成镜头为成片，调用 merge_episode', () => {
    const poll = setInterval(async () => {
      try { mergeData.value = await mergeAPI.status(epId.value) } catch {}
      if (mergeData.value?.status === 'completed' || mergeData.value?.status === 'failed') {
        clearInterval(poll)
        mergeData.value.status === 'completed' ? toast.success('拼接完成') : toast.error('拼接失败')
      }
    }, 3000)
  })
}

async function pollComposeStatus() {
  for (let i = 0; i < 120; i++) {
    await sleep(3000)
    try {
      const res = await composeAPI.status(epId.value)
      await refresh()
      const items = Array.isArray(res?.items) ? res.items : []
      const processingIds = items.filter(item => item.status === 'compose_processing').map(item => item.id)
      const prevIds = new Set(pendingComposeIds.value)
      pendingComposeIds.value = processingIds
      for (const id of processingIds) {
        if (!prevIds.has(id)) {
          const sb = sbs.value.find(s => s.id === id)
          genTimer.startTask(composeTimerKey(id), `镜头 #${sb ? shotIndex(sb) : id} 合成`, 'compose')
        }
      }
      for (const id of prevIds) {
        if (!processingIds.includes(id)) genTimer.endTask(composeTimerKey(id))
      }

      const failedItems = items.filter(item => item.status === 'compose_failed')
      if (failedItems.length) {
        const next = { ...failedComposeMessages.value }
        failedItems.forEach((item) => {
          next[item.id] = item.error_msg || item.errorMsg || '视频合成失败'
        })
        failedComposeMessages.value = next
      }

      if (!processingIds.length) {
        if (failedItems.length) toast.error(`有 ${failedItems.length} 个镜头合成失败`)
        else toast.success('批量合成完成')
        return
      }
    } catch {}
  }
  pendingComposeIds.value.forEach(id => genTimer.endTask(composeTimerKey(id)))
}
async function loadConfigs() {
  try {
    const [imgCfgs, vidCfgs, audCfgs] = await Promise.all([
      aiConfigAPI.list('image'),
      aiConfigAPI.list('video'),
      aiConfigAPI.list('audio'),
    ])
    imageConfigs.value = imgCfgs || []
    videoConfigs.value = vidCfgs || []
    audioConfigs.value = audCfgs || []
  } catch (e) { console.error('Failed to load AI configs', e) }
}

function inferVoiceGender(name, desc = []) {
  const text = `${name} ${Array.isArray(desc) ? desc.join(' ') : ''}`
  if (/[男|青年|大爷|学长|boy|man|male]/i.test(text)) return '男声'
  if (/[女|少女|御姐|奶奶|girl|woman|female]/i.test(text)) return '女声'
  return '中性'
}

function mapVoiceProfile(v) {
  const desc = Array.isArray(v.description) ? v.description : []
  return {
    id: v.voice_id,
    label: v.voice_name || v.voice_id,
    gender: inferVoiceGender(v.voice_name || v.voice_id, desc),
    traits: desc.length ? desc.slice(0, 2).join('、') : `${v.language || '多语言'}音色`,
    suitable: desc.length > 2 ? desc.slice(2).join('、') : `${v.language || '通用'}角色`,
  }
}

async function loadVoices() {
  try {
    const provider = lockedAudioProvider.value || 'minimax'
    const rows = await voicesAPI.list(provider)
    voiceProfiles.value = rows?.length ? rows.map(mapVoiceProfile) : fallbackVoiceProfiles
  } catch (e) {
    console.error('Failed to load voices', e)
    voiceProfiles.value = fallbackVoiceProfiles
  }
}

watch([lockedAudioConfigId, audioConfigs], () => { loadVoices() }, { deep: true })
onMounted(() => { refresh({ restoreVideoPending: true }); loadConfigs(); loadVoices() })

watch(() => route.params.episodeNumber, () => {
  panel.value = 'script'
  prodTab.value = 'chars'
  scriptStep.value = 0
  episode.value = null
  refresh()
})
</script>

<style scoped>
.studio-loading {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-2);
  font-size: 14px;
  background: var(--bg-base);
}
.studio-loading-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

/* ===== Studio Layout ===== */
.studio {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  padding: 14px;
  gap: 12px;
  background:
    radial-gradient(circle at top left, rgba(255,255,255,0.7), transparent 28%),
    linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0)),
    var(--bg-base);
}

.studio-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 18px;
  background: var(--bg-0);
  border: 1px solid rgba(27, 41, 64, 0.08);
  box-shadow: 0 14px 36px rgba(20, 32, 54, 0.07), 0 3px 10px rgba(20, 32, 54, 0.04);
}

.studio-gen-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(240, 247, 255, 0.92);
  border: 1px solid rgba(59, 130, 246, 0.18);
  font-size: 12px;
  color: var(--text-2);
}
.studio-gen-banner-slow {
  background: rgba(255, 248, 230, 0.95);
  border-color: color-mix(in srgb, var(--warning, #e6a700) 35%, transparent);
}
.studio-gen-banner-main {
  font-weight: 600;
  color: var(--text-1);
}
.studio-gen-banner-detail,
.studio-gen-banner-more {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
}
.studio-gen-banner-slow .studio-gen-banner-detail {
  color: var(--warning, #e6a700);
}

.studio-topbar-main,
.sidebar,
.main {
  background: var(--bg-0);
  border: 1px solid rgba(27, 41, 64, 0.08);
  box-shadow: 0 18px 48px rgba(20, 32, 54, 0.08), 0 4px 14px rgba(20, 32, 54, 0.05);
}

.studio-topbar-main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  box-shadow: none;
  backdrop-filter: none;
  background: transparent;
  min-width: 0;
}

.topbar-back {
  width: auto;
  min-width: 76px;
  padding: 0 8px;
  height: 28px;
  border-radius: 999px;
  white-space: nowrap;
  font-size: 11px;
}

.studio-identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.studio-overline {
  display: none;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
}

.studio-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.studio-title {
  font-size: 14px;
  line-height: 1;
  letter-spacing: -0.04em;
  white-space: nowrap;
}

.studio-episode-chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: rgba(19, 51, 121, 0.08);
  color: var(--accent-text);
  font-size: 9px;
  font-weight: 700;
}

.studio-meta-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  min-width: 0;
}

.studio-meta-pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(18, 25, 42, 0.05);
  color: var(--text-2);
  font-size: 8px;
  font-weight: 600;
  white-space: nowrap;
}

.studio-meta-pill.is-stage {
  background: rgba(19, 51, 121, 0.08);
  color: var(--accent-text);
}
.studio-meta-pill.is-progress {
  background: rgba(53, 95, 206, 0.1);
  color: var(--accent-text);
}
.studio-meta-inline {
  font-size: 9px;
  color: var(--text-2);
  font-weight: 600;
  white-space: nowrap;
}

.studio-topbar-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.studio-aspect-control {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(18, 25, 42, 0.04);
  border: 1px solid rgba(18, 25, 42, 0.08);
}

.studio-aspect-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}

.studio-aspect-options {
  display: flex;
  gap: 4px;
}

.studio-aspect-btn {
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 11px;
  color: var(--text-2);
  cursor: pointer;
}

.studio-aspect-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.studio-aspect-size {
  font-size: 10px;
  color: var(--text-3);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.studio-actions {
  display: flex;
  gap: 6px;
}
.studio-topbar .btn {
  height: 28px;
  padding: 0 10px;
  font-size: 11px;
  white-space: nowrap;
}

.studio-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) minmax(0, 320px);
  gap: 10px;
  min-height: 0;
  flex: 1;
}
.studio-body.assistant-collapsed {
  grid-template-columns: 260px minmax(0, 1fr);
}

/* ===== Sidebar ===== */
.sidebar {
  width: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  border-radius: 28px;
  -webkit-font-smoothing: auto;
}
.back-btn {
  width: 40px; height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(27, 41, 64, 0.1); border-radius: 14px;
  background: rgba(255,255,255,0.8); color: #121212;
  cursor: pointer; transition: all 0.15s;
  box-shadow: var(--shadow-xs);
}
.back-btn:hover { background: #fff; color: var(--text-0); }

/* Pipeline Nav */
.pipeline { flex: 1; overflow-y: auto; padding: 16px 14px 12px; display: flex; flex-direction: column; gap: 12px; }
.pipe-section { display: flex; flex-direction: column; gap: 4px; }
.pipe-section-label {
  font-size: 12px; font-weight: 800; color: #0a0a0a;
  text-transform: uppercase; letter-spacing: 0.05em;
  padding: 2px 8px 4px;
}
.pipe-item {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  padding: 9px 12px;
  border-radius: 17px;
  font-size: 14px; font-weight: 700;
  background: none; border: 1px solid transparent; color: #0a0a0a; cursor: pointer;
  transition: background 0.14s, color 0.14s, border-color 0.14s, box-shadow 0.14s;
  width: 100%; text-align: left;
  position: relative;
  z-index: 1;
}
.pipe-item:hover { background: rgba(255,255,255,0.3); color: #0a0a0a; }
.pipe-item.active {
  background: rgba(255,255,255,0.94);
  color: #0a0a0a;
  border-color: rgba(27, 41, 64, 0.05);
  box-shadow: 0 8px 18px rgba(19, 33, 56, 0.045);
}
.pipe-item.done { color: var(--accent-text); }
.pipe-item-sub {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  padding: 9px 12px;
  position: relative;
  min-height: 46px;
}

.pipe-item-sub:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 18px;
  top: 25px;
  bottom: -7px;
  width: 1px;
  background: rgba(27, 41, 64, 0.07);
  pointer-events: none;
}

.pipe-icon {
  width: 20px; height: 20px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: #f5f7fb; border: 1px solid rgba(18,25,42,0.12);
  color: #0a0a0a; flex-shrink: 0; transition: all 0.15s;
  position: relative;
  z-index: 1;
}
.pipe-item.active .pipe-icon { background: rgba(19, 51, 121, 0.1); border-color: rgba(19, 51, 121, 0.16); color: var(--accent-text); }
.pipe-item.done .pipe-icon { background: var(--accent-dark); border-color: var(--accent-dark); color: #fff; }
.icon-active { background: var(--accent-dark) !important; border-color: var(--accent-dark) !important; color: #fff !important; }
.icon-done { background: var(--accent-dark) !important; border-color: var(--accent-dark) !important; color: #fff !important; }

.pipe-label { flex: 1; font-size: 14px; font-weight: 700; line-height: 1.35; }
.pipe-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pipe-sub {
  font-size: 11px;
  line-height: 1.35;
  color: #2e2e2e;
  font-weight: 600;
}
.pipe-badge {
  font-size: 9px; font-weight: 700; padding: 1px 5px;
  border-radius: 99px; background: var(--bg-3); color: var(--text-1);
  font-family: var(--font-mono);
}
.pipe-badge.badge-done { background: var(--accent-bg); color: var(--accent-text); }
.pipe-spinner { width: 10px; height: 10px; border: 1.5px solid var(--accent-bg); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }

/* Sidebar Bottom */
.sidebar-bottom {
  padding: 12px 14px 14px;
  border-top: 1px solid rgba(27, 41, 64, 0.08);
  display: flex; flex-direction: column; gap: 8px;
  flex-shrink: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.72));
}
.sidebar-jumper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 3px 0 2px;
}
.sidebar-jump-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: none;
  background: rgba(53, 95, 206, 0.28);
  cursor: pointer;
  transition: transform 0.14s, background 0.14s, box-shadow 0.14s;
}
.sidebar-jump-dot:hover {
  transform: scale(1.08);
}
.sidebar-jump-dot.active {
  background: var(--accent-dark);
  box-shadow: 0 0 0 2px rgba(76, 125, 255, 0.14);
}
.sidebar-jump-dot.done {
  background: var(--accent-dark);
}
.sidebar-jump-dot.active.done {
  background: #1e3f8a;
}
.progress-wrap { display: flex; flex-direction: column; gap: 5px; }
.progress-head { display: flex; justify-content: space-between; }
.progress-label { font-size: 12px; color: #0a0a0a; font-weight: 700; }
.progress-val { font-size: 12px; color: #0a0a0a; font-family: var(--font-mono); font-weight: 700; }
.progress-track { height: 6px; background: rgba(194, 207, 227, 0.92); border-radius: 99px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent-gradient); border-radius: 99px; transition: width 0.5s var(--ease-out); }
.refresh-btn {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px; font-size: 13px; font-weight: 700; color: #0a0a0a;
  background: #fff; border: 1px solid rgba(27, 41, 64, 0.08); border-radius: 999px;
  cursor: pointer; transition: all 0.15s;
}
.refresh-btn:hover { background: #fff; color: #0a0a0a; }

/* ===== Main Content ===== */
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; min-height: 0; border-radius: 30px; }
.content-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; min-height: 0; }
.stage-subnav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
  background: linear-gradient(180deg, rgba(255,255,255,0.86), rgba(255,255,255,0.52));
  overflow-x: auto;
  flex-shrink: 0;
}
.stage-subnav-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid rgba(27, 41, 64, 0.08);
  background: #fff;
  color: #0a0a0a;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}
.stage-subnav-item:hover {
  background: #fff;
  color: #0a0a0a;
}
.stage-subnav-item.active {
  background: rgba(19, 51, 121, 0.1);
  border-color: rgba(19, 51, 121, 0.16);
  color: #1e3f8a;
}
.stage-subnav-item.done {
  color: var(--accent-text);
}
.stage-subnav-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--accent-dark);
  box-shadow: 0 0 0 4px rgba(76, 125, 255, 0.12);
}

/* Toolbar */
.step-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; border-bottom: 1px solid rgba(27, 41, 64, 0.08);
  background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(255,255,255,0.42)); flex-shrink: 0;
}
.prod-toolbar { background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(255,255,255,0.42)); }
.toolbar-left { display: flex; align-items: center; gap: 8px; flex: 1; }
.toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.step-indicator { display: flex; align-items: center; gap: 8px; }
.step-num {
  width: 26px; height: 26px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(19, 51, 121, 0.08);
  font-family: var(--font-mono); font-size: 10px; font-weight: 800; color: var(--accent-text); letter-spacing: 0.05em;
}
.step-name { font-size: 13px; font-weight: 700; color: var(--text-1); font-family: var(--font-display); }
.char-count { font-size: 11px; color: var(--text-3); font-family: var(--font-mono); }

/* Editor Area */
.step-editor { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.fill-textarea {
  flex: 1; border: none; border-radius: 0; padding: 26px 28px;
  font-size: 13.5px; line-height: 1.9; resize: none; outline: none;
  font-family: var(--font-body); background: linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.12)); color: var(--text-0);
}
.fill-textarea:focus { box-shadow: none; }

/* Step Empty State */
.step-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; min-height: 300px; gap: 10px; padding: 46px;
  animation: fadeIn 0.3s var(--ease-out);
}
.empty-visual {
  width: 72px; height: 72px; border-radius: 22px;
  background: rgba(255,255,255,0.8); color: var(--accent);
  border: 1px solid rgba(27, 41, 64, 0.08);
  box-shadow: var(--shadow-sm);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 8px;
}
.empty-title { font-size: 22px; font-weight: 700; font-family: var(--font-display); color: var(--text-0); }
.empty-desc { font-size: 13px; color: var(--text-2); max-width: 420px; text-align: center; line-height: 1.8; }
.step-empty-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }

/* Step Loading */
.step-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 12px;
}
.loading-text { font-size: 13px; color: var(--text-2); }

/* Step Navigator Bubble */
.step-bubble {
  position: static;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.58));
  border-top: 1px solid rgba(27, 41, 64, 0.08);
  margin-top: auto;
}
.bubble-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 500;
  border: 1px solid rgba(27, 41, 64, 0.08); background: rgba(255,255,255,0.84); color: var(--text-2); cursor: pointer;
  transition: all 0.15s; white-space: nowrap;
}
.bubble-btn:hover:not(:disabled) { background: #fff; color: var(--text-0); }
.bubble-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.bubble-btn.primary { margin-left: auto; background: linear-gradient(135deg, #557ff4, #345fcc); color: #fff; box-shadow: 0 6px 16px rgba(53, 95, 206, 0.2); border-color: transparent; }
.bubble-btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
.bubble-btn.primary:disabled { filter: none; box-shadow: none; opacity: 0.5; }
.bubble-dots { display: flex; gap: 7px; padding: 0 4px; }
.bubble-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: rgba(53, 95, 206, 0.28); cursor: pointer; transition: all 0.15s;
  border: none;
}
.bubble-dot.done { background: var(--accent-dark); }
.bubble-dot.current { background: var(--accent-dark); transform: scale(1.2); box-shadow: 0 0 0 2px rgba(76, 125, 255, 0.14); }

/* Extract grid */
.extract-stage { flex: 1; min-height: 0; overflow: hidden; padding: 12px 16px; display: grid; grid-template-columns: 280px minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }
.extract-summary { padding: 16px; display: flex; flex-direction: column; gap: 14px; align-self: stretch; position: sticky; top: 0; max-height: 100%; }
.extract-summary-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
.extract-summary-title { font-size: 20px; line-height: 1.05; font-family: var(--font-display); color: var(--text-0); }
.extract-summary-desc { font-size: 12px; color: var(--text-2); line-height: 1.7; }
.extract-summary-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.extract-summary-stat { padding: 10px 12px; border-radius: 14px; background: rgba(19, 51, 121, 0.05); border: 1px solid rgba(19, 51, 121, 0.08); display: flex; flex-direction: column; gap: 4px; }
.extract-summary-stat span { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; }
.extract-summary-stat strong { font-size: 18px; color: var(--text-0); font-family: var(--font-display); }
.extract-summary-note { padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.56); border: 1px solid rgba(27, 41, 64, 0.08); font-size: 11px; line-height: 1.7; color: var(--text-2); }
.extract-card { overflow: hidden; min-height: 0; display: flex; flex-direction: column; }
.extract-card-head {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 14px; font-size: 12px; font-weight: 600;
  border-bottom: 1px solid var(--border); background: var(--bg-1);
  color: var(--text-1);
}
.extract-list { padding: 8px 14px; flex: 1; min-height: 0; overflow-y: auto; }
.extract-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
.extract-row + .extract-row { border-top: 1px solid var(--border); }
.char-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--accent-bg); color: var(--accent-text);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; flex-shrink: 0;
}
.scene-icon {
  width: 30px; height: 30px; border-radius: 6px;
  background: var(--bg-2); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); flex-shrink: 0;
}
.extract-info { min-width: 0; }
.extract-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.extract-name { font-size: 13px; font-weight: 600; }
.extract-meta { font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.extract-meta.wrap { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

/* Voice grid */
.voice-stage { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 12px; }
.voice-stage-panel {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-self: start;
  position: sticky;
  top: 0;
  min-height: 0;
  max-height: calc(100vh - 210px);
  overflow: hidden;
}
.voice-stage-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
.voice-stage-title { font-size: 20px; line-height: 1.05; font-family: var(--font-display); color: var(--text-0); }
.voice-stage-desc { font-size: 12px; color: var(--text-2); line-height: 1.7; }
.voice-stage-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.voice-stage-stat { padding: 10px 12px; border-radius: 14px; background: rgba(19, 51, 121, 0.05); border: 1px solid rgba(19, 51, 121, 0.08); display: flex; flex-direction: column; gap: 3px; }
.voice-stage-stat-label { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; }
.voice-stage-stat strong { font-size: 18px; color: var(--text-0); font-family: var(--font-display); }
.voice-library-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}
.voice-library {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}
.voice-library-item { padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.56); border: 1px solid rgba(27, 41, 64, 0.08); display: flex; flex-direction: column; gap: 4px; }
.voice-library-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.voice-library-name { font-size: 13px; font-weight: 700; color: var(--text-0); }
.voice-library-traits { font-size: 11px; color: var(--text-1); }
.voice-library-fit { font-size: 10px; color: var(--text-3); line-height: 1.5; }

.voice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; align-content: start; }
.voice-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; border-radius: 22px; min-height: 0; }
.voice-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.voice-char { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.voice-name { min-width: 0; flex: 1; }
.voice-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.voice-card-copy { min-height: 58px; }
.voice-card-text { font-size: 12px; line-height: 1.7; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.voice-select-block { display: flex; flex-direction: column; gap: 6px; }
.voice-block-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
.voice-profile-card { padding: 12px; border-radius: 16px; background: linear-gradient(135deg, rgba(19, 51, 121, 0.08), rgba(255,255,255,0.78)); border: 1px solid rgba(19, 51, 121, 0.1); display: flex; flex-direction: column; gap: 4px; }
.voice-profile-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.voice-profile-name { font-size: 13px; font-weight: 700; color: var(--accent-text); }
.voice-profile-traits { font-size: 11px; color: var(--text-1); }
.voice-profile-fit { font-size: 10px; color: var(--text-2); line-height: 1.5; }
.voice-actions-row { display: flex; align-items: center; gap: 8px; }
.voice-player audio { width: 100%; height: 30px; border-radius: var(--radius); }
.char-avatar.lg { width: 38px; height: 38px; font-size: 16px; }

/* Split layout (storyboard) */
.split-layout { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.shot-list { width: 296px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--border); background: var(--bg-0); }
.shot-list-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 12px 10px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.06);
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(10px);
}
.shot-list-title { font-size: 13px; font-weight: 700; color: var(--text-0); }
.shot-list-sub { margin-top: 3px; font-size: 11px; color: var(--text-3); line-height: 1.45; }
.shot-list-body { padding: 6px; }
.shot-clips-panel { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
.shot-clips-list { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.shot-clip-card { padding: 10px 12px; }
.shot-clip-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.plan-clip-move-panel { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.plan-clip-move-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.import-script-dialog {
  width: min(720px, 92vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
.import-script-textarea {
  width: 100%;
  min-height: 320px;
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-0);
}
.import-script-actions { display: flex; justify-content: flex-end; gap: 8px; }
.shot-item {
  position: relative; padding: 10px 11px; cursor: pointer;
  border: 1px solid transparent; border-left: 3px solid transparent;
  transition: all 0.15s;
  display: flex; flex-direction: column; gap: 5px;
  border-radius: 14px;
}
.shot-item + .shot-item { margin-top: 6px; }
.shot-item:hover { background: var(--bg-hover); border-color: rgba(27, 41, 64, 0.06); }
.shot-item.active {
  background: var(--bg-0);
  border-left-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent-glow);
  z-index: 1;
}
.shot-item-header { display: flex; align-items: center; gap: 8px; }
.shot-num {
  font-size: 11px; font-family: var(--font-mono); font-weight: 700;
  color: var(--accent); background: var(--accent-bg);
  padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
  letter-spacing: 0.03em;
}
.shot-item.active .shot-num { background: var(--accent); color: #fff; }
.shot-status { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
.shot-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--bg-3); flex-shrink: 0; }
.shot-dot.has-img { background: var(--accent-dark); }
.shot-dot.has-video { background: var(--info); }
.shot-dot.has-dialogue { background: var(--warning); }
.shot-body { }
.shot-desc { font-size: 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--text-1); }
.shot-item.active .shot-desc { color: var(--text-0); }
.shot-meta { display: flex; align-items: center; gap: 6px; }
.shot-location {
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shot-dialogue {
  font-size: 10px; color: var(--text-3); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding-left: 2px; border-left: 2px solid var(--border);
  padding-left: 6px;
}

.detail-panel { flex: 1; display: flex; flex-direction: column; overflow-y: auto; min-width: 0; }
.detail-head { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.detail-head-copy { display: flex; flex-direction: column; gap: 2px; }
.detail-head-title { font-size: 14px; font-weight: 700; color: var(--text-0); }
.detail-head-sub { font-size: 11px; color: var(--text-3); }
.detail-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.detail-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(220px, 0.9fr);
  gap: 12px;
  padding: 12px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(20,39,82,0.08), rgba(255,255,255,0.68));
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.detail-hero-copy { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.detail-hero-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--text-3);
}
.detail-hero-text { font-size: 13px; color: var(--text-1); line-height: 1.7; }
.detail-status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.detail-preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.detail-preview-card { display: flex; flex-direction: column; gap: 6px; }
.detail-preview-title { font-size: 11px; font-weight: 700; color: var(--text-2); }
.detail-preview-media {
  position: relative; aspect-ratio: 16/9; overflow: hidden;
  border-radius: 14px; background: rgba(18,25,42,0.08);
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.detail-preview-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.detail-preview-empty {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: var(--text-3); font-size: 12px;
}
.detail-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255,255,255,0.72);
  border: 1px solid rgba(27, 41, 64, 0.08);
}
.detail-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.detail-section-title { font-size: 12px; font-weight: 700; color: var(--text-0); }
.detail-section-copy { font-size: 11px; color: var(--text-3); }

/* Field */
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 12px; font-weight: 500; color: var(--text-1); }
.field-row { display: flex; gap: 12px; }
.field-grid { display: grid; gap: 12px; }
.field-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.field-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.locked-config {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(19, 51, 121, 0.08);
  border: 1px solid rgba(19, 51, 121, 0.12);
  color: var(--text-1);
  font-size: 11px;
  font-weight: 600;
}
.locked-config-banner {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-2);
}
.role-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.role-pill {
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(27, 41, 64, 0.12);
  background: rgba(255,255,255,0.86);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.role-pill:hover { border-color: var(--accent); color: var(--text-0); }
.role-pill.active {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
  box-shadow: 0 8px 18px rgba(29, 77, 176, 0.18);
}

/* Production tabs */
.prod-tabs { display: flex; gap: 0; background: var(--bg-2); border-radius: var(--radius); padding: 2px; }
.gen-timer-panel {
  margin: 10px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  background: var(--bg-2);
}
.gen-timer-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 8px;
}
.gen-timer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gen-timer-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-1);
}
.gen-timer-item-slow {
  border: 1px solid color-mix(in srgb, var(--warning, #e6a700) 40%, transparent);
}
.gen-timer-label {
  color: var(--text-1);
  font-weight: 500;
}
.gen-timer-meta {
  color: var(--text-3);
  font-family: var(--font-mono);
}
.gen-timer-item-slow .gen-timer-meta {
  color: var(--warning, #e6a700);
}
.scene-angle-timers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}
.prod-tab {
  display: flex; align-items: center; gap: 4px; padding: 6px 12px; font-size: 12px;
  border: none; background: transparent; color: var(--text-2); cursor: pointer;
  border-radius: calc(var(--radius) - 2px); transition: all 0.15s; font-weight: 500;
}
.prod-tab:hover { color: var(--text-0); }
.prod-tab.active { background: var(--bg-0); color: var(--text-0); font-weight: 600; box-shadow: var(--shadow-xs); }
.prod-tab-badge { font-size: 10px; font-family: var(--font-mono); padding: 0 4px; background: var(--bg-3); border-radius: 99px; }
.prod-tab.active .prod-tab-badge { background: var(--accent-bg); color: var(--accent-text); }

/* Production content */
.prod-content { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.prod-section-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.dub-grid { display: flex; flex-direction: column; gap: 10px; }
.dub-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; border-radius: 20px; background: linear-gradient(180deg, rgba(255,255,255,0.74), rgba(248,251,255,0.58)); }
.dub-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.dub-copy { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.dub-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dub-desc { font-size: 13px; line-height: 1.6; color: var(--text-1); }
.dub-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11px; }
.dub-foot { display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(27, 41, 64, 0.08); }
.dub-audio { flex: 1; min-width: 0; height: 30px; }

/* Asset grid */
.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
.asset-card {
  display: flex; flex-direction: column; overflow: hidden;
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
}
.asset-card:hover { transform: translateY(-2px); box-shadow: 0 16px 30px rgba(20, 32, 54, 0.08); }
.asset-cover { position: relative; aspect-ratio: 1; background: var(--bg-2); overflow: hidden; }
.asset-cover.wide { aspect-ratio: 16/9; }
.asset-cover img { width: 100%; height: 100%; object-fit: cover; }
.previewable-image { cursor: zoom-in; transition: transform 0.18s var(--ease-out), filter 0.18s var(--ease-out); }
.previewable-image:hover { transform: scale(1.015); filter: saturate(1.04); }
.asset-cover-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(7,11,21,0.58);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}
.asset-cover-badge.is-ready {
  background: rgba(36, 125, 72, 0.92);
}
.asset-cover-badge.is-pending {
  background: rgba(19, 51, 121, 0.92);
}
.asset-cover-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-3); }
.asset-cover-upload {
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  transition: background 0.18s var(--ease-out), color 0.18s var(--ease-out);
}
.asset-cover-upload:hover:not(.is-disabled) {
  background: rgba(19, 51, 121, 0.06);
  color: var(--accent);
}
.asset-cover-upload.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.asset-cover-upload-text {
  font-size: 11px;
  font-weight: 600;
}
.asset-body { padding: 8px 10px; }
.asset-name { font-size: 13px; font-weight: 600; }
.asset-meta { font-size: 11px; }
.asset-prompt-field { display: block; margin-top: 8px; }
.asset-prompt-label {
  display: block;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  margin-bottom: 4px;
}
.asset-image-prompt {
  font-size: 11px;
  line-height: 1.45;
  min-height: 56px;
  resize: vertical;
}
.asset-foot { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-top: 1px solid var(--border); }
.asset-foot-col { flex-direction: column; align-items: stretch; gap: 6px; }
.asset-foot-row { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px; width: 100%; }
.asset-foot-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  flex: 1 1 140px;
  min-width: 0;
}
.asset-upload-btn {
  position: relative;
  cursor: pointer;
  margin: 0;
}
.asset-upload-btn.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
.char-transform-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  flex-wrap: wrap;
}
.char-transform-label {
  font-size: 10px;
  color: var(--text-dim);
  flex-shrink: 0;
}
.char-transform-size-hint { font-size: 9px; flex-shrink: 0; }
.char-transform-note { font-size: 10px; line-height: 1.4; }
.char-transform-btns { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.char-transform-btn { font-size: 10px; padding: 2px 8px; }
.char-image-variants {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.char-image-variant { display: flex; flex-direction: column; gap: 2px; width: 56px; }
.char-image-variant-thumb {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.char-image-variant-thumb img { width: 56px; height: 56px; object-fit: cover; display: block; }
.char-image-variant-label { font-size: 9px; color: var(--text-dim); text-align: center; line-height: 1.2; }
.char-outfit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.char-outfit-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  background: var(--bg-2);
}
.char-outfit-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.char-outfit-thumb {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  padding: 0;
  background: none;
  cursor: pointer;
}
.char-outfit-thumb img { width: 48px; height: 48px; object-fit: cover; display: block; }
.char-outfit-name { font-size: 11px; font-weight: 600; }
.char-outfit-transform { margin-top: 0; padding-top: 0; border-top: none; }

.blocking-empty { font-size: 12px; padding: 8px 0; }
.blocking-layout-grid { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.blocking-layout-row {
  display: grid;
  grid-template-columns: 88px 1fr 1fr;
  gap: 8px;
  align-items: center;
}
.blocking-char-name { font-size: 12px; font-weight: 600; }
.blocking-select { font-size: 12px; padding: 6px 8px; min-height: 32px; }
.blocking-preview-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 10px;
}
.blocking-preview {
  width: 160px;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-2);
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
}
.blocking-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.blocking-preview-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-dim);
  padding: 8px;
  text-align: center;
}
.blocking-actions { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.blocking-hint { font-size: 11px; line-height: 1.4; max-width: 280px; }

.scene-angle-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.scene-angle-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 72px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-1);
  cursor: pointer;
}
.scene-angle-option.active { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(76, 125, 255, 0.25); }
.scene-angle-option.scene-angle-blocking { border-style: dashed; }
.scene-angle-option.missing { opacity: 0.55; }
.scene-angle-option img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; }
.scene-angle-empty { font-size: 10px; color: var(--text-dim); min-height: 40px; display: flex; align-items: center; justify-content: center; text-align: center; }
.scene-angle-label { font-size: 10px; font-weight: 600; text-align: center; }
.scene-angle-preview-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.scene-angle-preview-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 64px;
}
.scene-angle-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.scene-angle-preview img { width: 64px; height: 36px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border); }
.scene-angle-preview span { font-size: 10px; color: var(--text-dim); text-align: center; }
.scene-angle-regen-btn {
  width: 100%;
  padding: 2px 4px;
  font-size: 10px;
  line-height: 1.2;
}
.video-char-image-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0 4px;
  border-top: 1px dashed var(--border);
}
.video-char-image-hint { font-size: 10px; }
.video-char-image-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 14px;
}
.video-char-image-segment {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.video-char-image-name {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-2);
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(76, 125, 255, 0.08);
  border: 1px solid rgba(76, 125, 255, 0.14);
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.video-char-image-options {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  min-width: 0;
  padding-bottom: 2px;
}
.video-char-image-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 52px;
  flex-shrink: 0;
  padding: 3px;
  border: 1.5px solid rgba(27, 41, 64, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.88);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.video-char-image-option:hover {
  border-color: rgba(76, 125, 255, 0.35);
  transform: translateY(-1px);
}
.video-char-image-option.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(76, 125, 255, 0.14);
}
.video-char-image-option img { width: 44px; height: 44px; object-fit: cover; border-radius: 7px; }
.video-char-image-option span {
  font-size: 9px;
  color: var(--text-3);
  text-align: center;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-warn { color: #b45309; border-color: rgba(180, 83, 9, 0.35); background: rgba(251, 191, 36, 0.08); }

/* Frame grid */
.shots-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  gap: 12px;
  align-items: start;
}
.shot-blocking-side {
  padding: 14px;
  position: sticky;
  top: 12px;
}
.shot-blocking-placeholder {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 180px;
  justify-content: center;
  font-size: 12px;
  line-height: 1.5;
}
.shot-blocking-placeholder-title {
  font-size: 13px;
  font-weight: 700;
}
.frame-grid { display: flex; flex-direction: column; gap: 8px; }
.frame-row {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px; cursor: pointer;
  border-radius: var(--radius-lg);
  transition: all 0.15s;
  border: 1.5px solid transparent;
}
.frame-row:hover { background: var(--bg-0); border-color: var(--border); }
.frame-row.active {
  background: var(--bg-0);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.frame-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.frame-top { display: flex; align-items: center; gap: 8px; }
.frame-num {
  font-size: 13px; font-family: var(--font-mono); font-weight: 800;
  color: var(--accent);
}
.frame-badge {
  font-size: 11px; font-weight: 600; padding: 2px 8px;
  border-radius: 20px;
  background: var(--accent-bg); color: var(--accent);
  border: 1px solid var(--accent-glow);
  white-space: nowrap;
}
.frame-desc {
  font-size: 12px; line-height: 1.5; color: var(--text-1);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.frame-thumb.blocking-thumb { border-color: rgba(76, 125, 255, 0.18); }
.frame-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.frame-thumbs { display: flex; gap: 8px; flex-shrink: 0; }
.frame-thumb-wrap { display: flex; flex-direction: column; gap: 3px; align-items: center; }
.frame-thumb-label { font-size: 10px; font-weight: 600; color: var(--text-3); }
.frame-thumb {
  position: relative; width: 130px; aspect-ratio: 16/9;
  border-radius: 6px; overflow: hidden;
  background: var(--bg-2); cursor: pointer;
  transition: all 0.15s; border: 1.5px solid var(--border);
}
.frame-thumb:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.frame-thumb img { width: 100%; height: 100%; object-fit: cover; }
.frame-thumb-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-3); }
.frame-re {
  position: absolute; top: 3px; right: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: rgba(0,0,0,0.5); color: #fff;
  display: none; align-items: center; justify-content: center;
}
.frame-thumb:hover .frame-re { display: flex; }
.frame-scroll { flex: 1; overflow-y: auto; padding: 10px 12px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bg-3); flex-shrink: 0; }
.dot.ok { background: var(--accent-dark); }
.dot.pending {
  background: var(--accent-dark);
  box-shadow: 0 0 0 3px rgba(76, 125, 255, 0.14);
}

/* Prod grid */
.prod-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.prod-grid-wide { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.prod-grid-portrait { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.prod-grid-video-shots {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.prod-card-video {
  border: 1px solid rgba(27, 41, 64, 0.08);
  box-shadow: 0 8px 24px rgba(20, 32, 54, 0.05);
}
.prod-card {
  display: flex; flex-direction: column; overflow: hidden;
  transition: box-shadow 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,251,255,0.82));
}
.prod-card-lazy {
  content-visibility: auto;
  contain-intrinsic-size: auto 560px;
  contain: layout style paint;
}
.prod-grid-video-shots .prod-card-lazy {
  contain-intrinsic-size: auto 760px;
}
@media (hover: hover) and (pointer: fine) {
  .prod-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 16px 30px rgba(20, 32, 54, 0.08);
    transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
  }
}
.prod-cover { position: relative; aspect-ratio: 16/9; background: var(--bg-2); overflow: hidden; }
.prod-video-preview-shell {
  position: relative;
}
.prod-video-generating {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  text-align: center;
  background: linear-gradient(180deg, rgba(219, 234, 254, 0.82), rgba(191, 219, 254, 0.92));
  backdrop-filter: blur(3px);
  pointer-events: none;
}
.prod-video-generating-icon {
  color: var(--accent-dark);
}
.prod-video-generating-text {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-dark);
}
.prod-video-generating :deep(.gen-timer) {
  margin-top: 0;
  color: rgba(37, 99, 235, 0.82);
}
.prod-cover img { width: 100%; height: 100%; object-fit: cover; }
.prod-video { width: 100%; height: 100%; object-fit: cover; background: #000; display: block; }
.video-aspect-portrait .prod-cover { aspect-ratio: 9 / 16; }
.video-aspect-portrait .prod-video,
.video-aspect-portrait .prod-cover img { object-fit: contain; }
.prod-card-detail-toggle {
  margin-top: 10px;
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid rgba(27, 41, 64, 0.1);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.prod-card-detail-toggle:hover {
  border-color: rgba(76, 125, 255, 0.28);
  background: rgba(76, 125, 255, 0.06);
  color: var(--accent-dark);
}
.prod-card-detail-chevron {
  flex-shrink: 0;
  transition: transform 0.18s var(--ease-out);
}
.prod-card-detail-chevron.open {
  transform: rotate(180deg);
}
.prod-grid-wide.prod-grid-portrait { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.video-aspect-portrait .video-blocking-slot { width: 88px; aspect-ratio: 9 / 16; }
.video-aspect-portrait .video-ref-thumb,
.video-aspect-portrait .video-ref-thumb-empty,
.video-aspect-portrait .video-ref-audio { aspect-ratio: 9 / 16; }
.prod-cover-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-3); }
.prod-idx {
  position: absolute; top: 5px; left: 5px; font-size: 10px; font-weight: 700;
  font-family: var(--font-mono); background: rgba(0,0,0,0.5); color: #fff; padding: 1px 5px; border-radius: 3px;
}
.prod-overlay-badge {
  position: absolute; bottom: 5px; right: 5px; font-size: 10px; font-weight: 600;
  background: var(--accent-dark); color: #fff; padding: 1px 5px; border-radius: 3px;
}
.prod-info { padding: 10px 12px 8px; }
.prod-desc { font-size: 12px; line-height: 1.4; }
.prod-meta-line { margin-top: 5px; font-size: 10px; color: var(--text-3); }
.prod-dots { display: flex; align-items: center; gap: 4px; margin-top: 5px; color: var(--text-3); }
.prod-error {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--error);
}
.prod-prompt-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.prod-prompt-field,
.prod-duration-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prod-prompt-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
}
.prod-prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.prod-prompt-expand {
  flex-shrink: 0;
  border: 0;
  background: rgba(76, 125, 255, 0.08);
  color: var(--accent-dark);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}
.prod-prompt-expand:hover {
  background: rgba(76, 125, 255, 0.14);
  transform: translateY(-1px);
}
.prod-video-prompt {
  font-size: 13px;
  line-height: 1.6;
  min-height: 230px;
  height: 230px;
  resize: vertical;
  border-radius: 12px;
  border-color: rgba(27, 41, 64, 0.1);
  background: rgba(255, 255, 255, 0.9);
}
.prod-video-settings-row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  gap: 10px;
}
.prod-setting-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.prod-setting-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
}
.prod-duration-slider-box,
.prod-resolution-box {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid rgba(27, 41, 64, 0.08);
  background: rgba(255, 255, 255, 0.88);
}
.prod-duration-slider-box {
  background: rgba(76, 125, 255, 0.05);
  border-color: rgba(76, 125, 255, 0.12);
}
.prod-duration-slider-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 20px;
}
.prod-duration-slider {
  width: 100%;
  height: 20px;
  appearance: none;
  background: transparent;
  cursor: pointer;
  --slider-progress: 0%;
}
.prod-duration-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    #4c7dff 0%,
    #4c7dff var(--slider-progress),
    rgba(76, 125, 255, 0.16) var(--slider-progress),
    rgba(76, 125, 255, 0.16) 100%
  );
}
.prod-duration-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border-radius: 50%;
  border: 2px solid #4c7dff;
  background: #fff;
  box-shadow: 0 2px 8px rgba(76, 125, 255, 0.25);
  cursor: grab;
}
.prod-duration-slider:active::-webkit-slider-thumb {
  cursor: grabbing;
  transform: scale(1.06);
}
.prod-duration-slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(76, 125, 255, 0.16);
}
.prod-duration-slider::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: #4c7dff;
}
.prod-duration-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #4c7dff;
  background: #fff;
  box-shadow: 0 2px 8px rgba(76, 125, 255, 0.25);
  cursor: grab;
}
.prod-duration-value {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 800;
  color: var(--accent-dark);
  font-family: var(--font-mono);
}
.prod-resolution-value {
  flex: 1;
  font-size: 13px;
  font-weight: 800;
  color: #7c3aed;
  font-family: var(--font-mono);
}
.prod-resolution-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.14);
}
.prod-duration-field .input {
  width: 88px;
}
.video-bind-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.video-bind-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.video-bind-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.video-scene-select {
  width: 100%;
  font-size: 12px;
}
.video-blocking-panel {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed rgba(27, 41, 64, 0.1);
}
.video-blocking-hint {
  font-size: 11px;
  line-height: 1.4;
}
.video-blocking-slot-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.video-blocking-slot {
  width: 132px;
  aspect-ratio: 16 / 9;
  flex-shrink: 0;
  padding: 0;
  border: 1px dashed rgba(76, 125, 255, 0.35);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-2);
  cursor: pointer;
}
.video-blocking-slot.empty {
  cursor: default;
}
.video-blocking-slot.pending {
  border-style: solid;
  border-color: rgba(76, 125, 255, 0.25);
}
.video-blocking-slot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.video-blocking-slot-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-dim);
  padding: 6px;
  text-align: center;
}
.video-blocking-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.video-blocking-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.video-blocking-legend {
  margin: 0;
  padding-left: 14px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-2);
}
.video-blocking-legend-empty {
  margin: 0;
  font-size: 11px;
}
.video-blocking-snippet {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  font-size: 10px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-1);
}
.video-blocking-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.video-blocking-warn {
  font-size: 11px;
  line-height: 1.4;
  color: var(--warning);
}
.video-ref-panel {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(27, 41, 64, 0.12);
}
.video-voice-panel {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(27, 41, 64, 0.12);
}
.video-voice-hint {
  font-size: 11px;
}
.video-voice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.video-voice-chip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-2);
  font-size: 12px;
}
.video-voice-chip audio {
  flex: 1 1 180px;
  min-width: 160px;
  height: 28px;
}
.video-ref-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.video-ref-hint {
  font-weight: 400;
  color: var(--text-3);
  margin-left: 4px;
}
.video-ref-upload {
  position: relative;
  cursor: pointer;
}
.video-ref-at-hint {
  margin-top: 8px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-3);
}
.video-ref-at-hint code {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(27, 41, 64, 0.06);
  color: var(--text-2);
}
.video-ref-list {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scroll-snap-type: x proximity;
}
.video-ref-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 128px;
  padding: 8px;
  border-radius: 14px;
  border: 1px solid rgba(27, 41, 64, 0.1);
  background: rgba(255, 255, 255, 0.82);
  scroll-snap-align: start;
}
.video-ref-card.missing {
  border-style: dashed;
}
.video-ref-card-media {
  position: relative;
}
.video-ref-card-media .video-ref-index {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
}
.video-ref-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-2);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.video-ref-thumb:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(20, 32, 54, 0.12);
}
.video-ref-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.video-ref-thumb-empty,
.video-ref-audio {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  background: var(--bg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-3);
  overflow: hidden;
}
.video-ref-audio audio {
  width: calc(100% - 8px);
}
.video-ref-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(76, 125, 255, 0.12);
  color: var(--accent-dark);
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
}
.video-ref-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.video-ref-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.video-ref-tag {
  font-size: 10px;
  color: var(--text-3);
}
.video-ref-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.video-ref-action {
  border: 1px solid rgba(27, 41, 64, 0.12);
  background: #fff;
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.15s;
}
.video-ref-action:hover {
  border-color: rgba(76, 125, 255, 0.35);
  background: rgba(76, 125, 255, 0.08);
  color: var(--accent-dark);
  transform: translateY(-1px);
}
.video-ref-action.danger {
  color: #dc2626;
  background: rgba(254, 242, 242, 0.95);
  border-color: rgba(239, 68, 68, 0.18);
}
.video-ref-action.danger:hover {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(254, 226, 226, 0.95);
  color: #b91c1c;
}
.video-ref-empty-hint {
  font-size: 11px;
  line-height: 1.5;
}
.prod-actions { display: flex; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid rgba(27, 41, 64, 0.08); }
.prod-actions .btn { flex: 1; justify-content: center; }
.prod-actions-video {
  padding: 10px 12px 12px;
  background: rgba(248, 251, 255, 0.72);
  display: flex;
  gap: 8px;
}
.prod-generate-btn {
  flex: 1;
  min-height: 38px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(135deg, #ff8a4c, #ffb347);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 8px 20px rgba(255, 138, 76, 0.28);
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
}
.prod-history-btn {
  flex-shrink: 0;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(27, 41, 64, 0.12);
  background: rgba(255, 255, 255, 0.92);
  color: var(--text-2);
  font-weight: 600;
  transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.15s;
}
.prod-history-btn:hover {
  border-color: rgba(76, 125, 255, 0.28);
  background: rgba(76, 125, 255, 0.06);
  color: var(--accent-dark);
  transform: translateY(-1px);
}
.prod-generate-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(255, 138, 76, 0.34);
}
.prod-generate-btn:disabled {
  opacity: 0.55;
  box-shadow: none;
}
.prod-cover-clickable { cursor: pointer; }
.prod-cover-clickable:hover .prod-video { opacity: 0.92; }

/* Image viewer */
.image-viewer-overlay {
  z-index: 120;
  padding: 28px;
  background: rgba(18, 24, 34, 0.68);
  backdrop-filter: blur(10px);
}
.image-viewer-dialog {
  width: min(1100px, calc(100vw - 56px));
  max-height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,251,255,0.92));
}
.image-viewer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
}
.image-viewer-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1);
  font-family: var(--font-display);
}
.image-viewer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.image-viewer-body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
  min-height: 0;
}
.image-viewer-img {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 140px);
  border-radius: 18px;
  box-shadow: 0 18px 48px rgba(8, 14, 24, 0.22);
  background: rgba(255,255,255,0.9);
}
.video-viewer-overlay {
  z-index: 121;
}
.video-viewer-dialog {
  width: min(920px, calc(100vw - 56px));
}
.video-viewer-body {
  background: #0f141c;
  padding: 16px;
}
.video-viewer-player {
  display: block;
  width: 100%;
  max-height: calc(100vh - 160px);
  border-radius: 14px;
  background: #000;
  object-fit: contain;
}

/* Grid tool dialog */
.grid-tool { width: min(1320px, calc(100vw - 40px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; animation: scaleIn 0.2s var(--ease-out); }
.grid-tool-head { display: flex; align-items: center; gap: 8px; padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.grid-tool-body { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.grid-tool-body-preview { overflow: hidden; min-height: 0; padding-bottom: 10px; }
.grid-tool-foot { display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); margin-top: 4px; }
.grid-preview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.72fr) minmax(340px, 400px);
  gap: 14px;
  min-height: 0;
  flex: 1;
  align-items: start;
}
.grid-preview-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.grid-assignment-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(27, 41, 64, 0.08);
  border-radius: 18px;
  background: rgba(255,255,255,0.66);
  overflow: hidden;
  max-height: min(70vh, 840px);
}
.grid-assign-head {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
  background: linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.72));
}
.grid-assign-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-0);
  font-family: var(--font-display);
}
.grid-assign-subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-3);
}
.grid-assign-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
  background: rgba(255,255,255,0.86);
}
.grid-assign-columns {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 96px minmax(0, 1fr);
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
  background: rgba(246, 248, 252, 0.92);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Prompt preview */
.grid-prompt-summary { background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; }
.grid-prompt-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 6px; }
.grid-prompt-text { font-size: 12px; color: var(--text-1); line-height: 1.7; }

.grid-blank-preview {
  display: grid;
  gap: 4px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
  padding: 8px;
  min-height: 200px;
}
.grid-blank-cell {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 70px;
}
.grid-blank-cell.empty { opacity: 0.4; }
.grid-blank-cell-index { font-size: 10px; font-weight: 700; color: var(--accent); font-family: var(--font-mono); }
.grid-blank-cell-desc { font-size: 11px; color: var(--text-2); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.grid-mode-tabs { display: flex; gap: 6px; }
.grid-mode-tab { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); background: var(--bg-0); cursor: pointer; transition: all 0.15s; text-align: left; }
.grid-mode-tab:hover { border-color: var(--border-strong); }
.grid-mode-tab.active { border-color: var(--accent); background: var(--accent-bg); }
.grid-config { display: flex; gap: 12px; align-items: flex-end; }
.grid-pick-list { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; }
.grid-pick-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; transition: background 0.1s; }
.grid-pick-item:hover { background: var(--bg-hover); }
.grid-pick-item.selected { background: var(--accent-bg); }
.grid-pick-item input { accent-color: var(--accent); }
.grid-preview-wrap {
  border-radius: var(--radius);
  overflow: auto;
  border: 1px solid var(--border);
  background: rgba(14, 19, 28, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  max-height: min(70vh, 860px);
  padding: 10px;
}
.grid-preview-stage {
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: auto;
  line-height: 0;
}
.grid-preview-img {
  display: block;
  width: auto;
  max-width: 100%;
  max-height: min(66vh, 820px);
  object-fit: contain;
}
.grid-overlay { position: absolute; inset: 0; display: grid; }
.grid-overlay-cell {
  border: 1px dashed rgba(255,255,255,0.42);
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  padding: 4px 6px;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.grid-overlay-cell.active {
  background: rgba(255,255,255,0.08);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.28);
}
.grid-cell-label { font-size: 10px; font-weight: 700; color: #fff; background: rgba(0,0,0,0.5); padding: 1px 5px; border-radius: 3px; }
.grid-adjust-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 2px; }
.grid-assign-info {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 4px 12px 10px;
}
.grid-assign-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 112px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed rgba(27, 41, 64, 0.08);
}
.grid-assign-row.active {
  background: rgba(32, 86, 190, 0.05);
  border-radius: 12px;
  padding-left: 6px;
  padding-right: 6px;
}
.grid-assign-row:last-child { border-bottom: 0; }
.grid-assign-index {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
  font-family: var(--font-mono);
}
.grid-assign-bind {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.45;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-history-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px 12px;
  border: 1px solid rgba(27, 41, 64, 0.08);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.64));
}
.grid-history-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.grid-history-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-0);
  font-family: var(--font-display);
}
.grid-history-subtitle {
  font-size: 11px;
  color: var(--text-3);
}
.grid-history-list {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(160px, 182px);
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.grid-history-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(27, 41, 64, 0.08);
  border-radius: 16px;
  background: rgba(255,255,255,0.78);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.grid-history-item:hover {
  border-color: rgba(33, 88, 255, 0.18);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}
.grid-history-item.active {
  border-color: rgba(33, 88, 255, 0.26);
  background: linear-gradient(180deg, rgba(244,248,255,0.96), rgba(255,255,255,0.86));
  box-shadow: 0 14px 28px rgba(33, 88, 255, 0.12);
}
.grid-history-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(27, 41, 64, 0.08);
  background: rgba(14, 19, 28, 0.05);
}
.grid-history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.grid-history-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.grid-history-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.grid-history-meta {
  font-size: 10.5px;
  color: var(--text-3);
  line-height: 1.45;
  word-break: break-word;
}

.latest-grid-strip {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid rgba(27, 41, 64, 0.08);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(255,255,255,0.84), rgba(255,255,255,0.62));
}
.latest-grid-strip-thumb {
  width: 72px;
  height: 48px;
  padding: 0;
  border: 1px solid rgba(27, 41, 64, 0.08);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(14, 19, 28, 0.06);
  cursor: zoom-in;
  box-shadow: none;
}
.latest-grid-strip-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.latest-grid-strip-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.latest-grid-strip-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.latest-grid-strip-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-0);
  font-family: var(--font-display);
}
.latest-grid-strip-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--text-3);
}
.latest-grid-strip-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* Export */
.export-split { flex: 1; display: flex; min-height: 0; }
.export-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px; }
.export-video { max-width: 720px; width: 100%; border-radius: var(--radius-lg); background: #000; }
.export-bar { display: flex; align-items: center; gap: 12px; margin-top: 16px; width: 100%; max-width: 720px; }
.export-list { width: 240px; flex-shrink: 0; border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
.export-list-head { padding: 11px 14px; font-size: 11px; font-weight: 700; color: var(--text-3); border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.06em; }
.export-list-body { flex: 1; overflow-y: auto; padding: 6px; }
.exp-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius); }
.exp-row:hover { background: var(--bg-hover); }

/* Shared */
.dim { color: var(--text-3); }

@media (max-width: 1240px) {
  .studio-body {
    grid-template-columns: 1fr;
  }

  .assistant-panel {
    max-height: 420px;
    order: 3;
  }

  .studio-topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .studio-topbar-side {
    justify-content: space-between;
  }

  .split-layout,
  .export-split {
    flex-direction: column;
  }

  .sidebar {
    max-height: 340px;
  }

  .shot-list,
  .export-list {
    width: 100%;
  }

  .detail-panel {
    min-height: 420px;
  }

  .field-grid-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .image-viewer-overlay {
    padding: 16px;
  }

  .image-viewer-dialog {
    width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
  }

  .grid-tool {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
  }

  .grid-preview-layout {
    grid-template-columns: 1fr;
  }

  .grid-preview-wrap,
  .grid-preview-img {
    max-height: 42vh;
  }

  .grid-assignment-pane {
    max-height: 42vh;
  }

  .grid-assign-columns {
    display: none;
  }

  .grid-assign-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
}

@media (max-width: 860px) {
  .studio {
    padding: 12px;
    gap: 12px;
  }

  .studio-topbar-main {
    align-items: flex-start;
  }

  .studio-topbar-side,
  .studio-actions {
    flex-wrap: wrap;
  }

  .toolbar-right,
  .step-bubble,
  .export-bar {
    flex-wrap: wrap;
  }

  .extract-grid,
  .voice-grid,
  .asset-grid,
  .prod-grid,
  .prod-grid-video-shots {
    grid-template-columns: 1fr;
  }

  .prod-video-settings-row {
    grid-template-columns: 1fr;
  }

  .voice-stage {
    grid-template-columns: 1fr;
  }

  .extract-stage {
    grid-template-columns: 1fr;
  }

  .extract-summary {
    position: static;
  }

  .voice-stage-panel {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .frame-row {
    flex-direction: column;
    align-items: stretch;
  }

  .shots-workbench {
    grid-template-columns: 1fr;
  }

  .shot-blocking-side {
    position: static;
  }

  .detail-hero {
    grid-template-columns: 1fr;
  }

  .field-grid-2,
  .field-grid-4 {
    grid-template-columns: 1fr;
  }

  .frame-thumbs {
    width: 100%;
  }

  .frame-thumb {
    width: 100%;
  }

  .latest-grid-strip {
    grid-template-columns: 1fr;
  }

  .grid-history-list {
    grid-auto-columns: minmax(148px, 168px);
  }

  .latest-grid-strip-thumb {
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
  }

  .latest-grid-strip-actions {
    justify-content: flex-start;
  }
}
</style>
