<template>
  <div class="settings-layout">
    <aside class="settings-nav">
      <div class="nav-group">
        <div class="nav-group-label">基础</div>
        <button v-for="t in baseTabs" :key="t.id" :class="['nav-item', { active: tab === t.id }]" @click="tab = t.id">
          <component :is="t.icon" :size="14" />
          {{ t.label }}
        </button>
      </div>
      <div v-if="isAdmin" class="nav-advanced">
        <label class="advanced-toggle">
          <span>Agent 高级配置</span>
          <input type="checkbox" v-model="showAdvanced" />
          <span class="advanced-slider"></span>
        </label>
        <p class="advanced-note">仅展开 Agent 配置与 Skills。工作台功能和分镜字段保持默认可见。</p>
      </div>
      <div v-if="showAdvanced && isAdmin" class="nav-group">
        <div class="nav-group-label">高级</div>
        <button v-for="t in advancedTabs" :key="t.id" :class="['nav-item', { active: tab === t.id }]" @click="tab = t.id">
          <component :is="t.icon" :size="14" />
          {{ t.label }}
        </button>
      </div>
    </aside>

    <div class="settings-content">

      <!-- ===== AI 服务配置 ===== -->
      <div v-if="tab === 'ai' && isAdmin" class="settings-scroll">
        <div class="settings-head">
          <div class="settings-brand">
            <div class="settings-brand-mark">
              <img v-if="showBrandImage" :src="brandLogo" alt="红果短剧" class="settings-brand-logo" @error="showBrandImage = false" />
              <span v-else class="settings-brand-fallback">红</span>
            </div>
            <div class="settings-brand-copy">
              <div class="settings-brand-kicker">Hongguo Shorts</div>
              <div class="settings-brand-name">红果短剧</div>
            </div>
          </div>
          <h2 class="settings-title">AI 服务配置</h2>
          <p class="settings-desc">先用推荐模板快速落配置，再按服务类型微调。工作台创建集时会锁定所选图片、视频和音频能力。</p>
        </div>
        <section class="setup-panel card">
          <div class="setup-panel-head">
            <div>
              <div class="setup-kicker">Quick Setup</div>
              <div class="setup-title">红果推荐配置</div>
              <div class="setup-desc">一键写入文本、图片、视频、音频四类推荐配置，适合作为开箱默认方案。</div>
            </div>
            <button class="btn btn-primary" @click="presetDialog = true">
              <Sparkles :size="14" /> 红果一键配置
            </button>
          </div>
          <div class="preset-grid">
            <article v-for="preset in huobaoPresetCards" :key="`${preset.serviceType}-${preset.model}`" class="preset-card">
              <div class="preset-card-top">
                <span class="preset-service">{{ preset.label }}</span>
                <span class="tag tag-accent">{{ preset.provider }}</span>
              </div>
              <div class="preset-model mono">{{ preset.model }}</div>
              <div class="preset-base mono">{{ preset.baseUrl }}</div>
            </article>
          </div>
        </section>
        <section class="setup-panel card">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-title">快捷模板</div>
              <div class="setup-desc">选择服务类型后，直接用模板填充推荐的 `provider / base URL / model`。</div>
            </div>
          </div>
          <div class="template-row">
            <button
              v-for="st in serviceTypes"
              :key="st.type"
              class="template-type-chip"
              @click="startAddCfg(st.type)"
            >
              {{ st.label }}
            </button>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">通道4</div>
              <div class="setup-title">即梦 Session</div>
              <div class="setup-desc">
                jimeng.jianying.com Cookie 鉴权，仅管理员在此配置。用户视频页不会展示 Session 内容。
                <a href="https://jimeng.jianying.com" target="_blank" rel="noopener">打开即梦</a>
              </div>
              <div class="setup-desc jimeng-cookie-hint">
                须粘贴<strong>完整 Cookie</strong>（含 sessionid、_tea_web_id、uid_tt 等），只填 sessionid 易触发「疑似异常行为」。
                服务器需安装 Chromium（<code>cd backend && npx playwright-core install chromium</code>）用于 Seedance 视频签名。
                复制方法：F12 → <strong>Network（网络）</strong> → 在即梦页随便点一下（如刷新）→ 选中任意 <code>jimeng.jianying.com</code> 请求
                → Headers → Request Headers → 找到 <code>Cookie:</code> → 右键该行值 → Copy value，粘贴到下方。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="jimengHasValidSession ? 'tag-accent' : ''">{{ jimengSessionStatusLabel }}</span>
              <span v-if="jimengSessions.length" class="mono dim">{{ jimengSessions.length }} 个 Session</span>
            </div>
          </div>
          <div v-if="jimengSessions.length" class="jimeng-session-list">
            <div
              v-for="item in jimengSessions"
              :key="item.id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.label || '未命名' }}</span>
                <span class="mono dim">{{ item.session_id_masked }}</span>
                <span class="tag" :class="item.valid ? 'tag-accent' : ''">{{ item.valid ? '有效' : '无效' }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  v-if="!item.is_active"
                  type="button"
                  class="btn btn-sm"
                  :disabled="jimengSessionSaving"
                  @click="activateJimengSession(item.id)"
                >
                  设为当前
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="jimengSessionSaving"
                  @click="validateJimengSessionItem(item.id)"
                >
                  验证
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="jimengSessionSaving"
                  @click="removeJimengSession(item.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <div v-else class="setup-desc dim" style="margin-top: 12px;">尚未保存任何 Session</div>
          <textarea
            v-model="jimengSessionInput"
            class="jimeng-session-input"
            rows="3"
            placeholder="粘贴 Cookie 或 sessionid，保存为新 Session…"
          />
          <div class="jimeng-session-actions">
            <input v-model="jimengSessionLabel" class="jimeng-session-label" type="text" placeholder="备注（可选）" />
            <button type="button" class="btn btn-sm btn-primary" :disabled="jimengSessionSaving || !jimengSessionInput.trim()" @click="saveJimengSession">
              {{ jimengSessionSaving ? '保存中…' : '添加 Session' }}
            </button>
            <button
              v-if="jimengSessions.length"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="jimengSessionSaving"
              @click="clearJimengSession"
            >
              清除全部
            </button>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">通道5</div>
              <div class="setup-title">豆包培训 Session</div>
              <div class="setup-desc">
                doubao.com Cookie 鉴权，用于内部培训练手。每账号每日 {{ doubaoTrainingDailyQuota }} 次免费额度，生成后自动叠加培训标识。
                <a href="https://www.doubao.com/chat/create-video" target="_blank" rel="noopener">打开豆包</a>
              </div>
              <div class="setup-desc jimeng-cookie-hint">
                复制方法：F12 → <strong>Network（网络）</strong> → 在豆包页刷新 → 选中 <code>www.doubao.com</code> 请求
                → Headers → Request Headers → <code>Cookie:</code> → Copy value，粘贴到下方。
                可添加多个账号，系统自动轮换有剩余额度的 Session。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="doubaoTrainingHasValidSession ? 'tag-accent' : ''">{{ doubaoTrainingSessionStatusLabel }}</span>
              <span v-if="doubaoTrainingSessions.length" class="mono dim">{{ doubaoTrainingSessions.length }} 个 Session</span>
            </div>
          </div>
          <div v-if="doubaoTrainingSessions.length" class="jimeng-session-list">
            <div
              v-for="item in doubaoTrainingSessions"
              :key="item.id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.label || '未命名' }}</span>
                <span class="mono dim">{{ item.session_id_masked }}</span>
                <span class="tag">{{ item.quota?.remaining_today ?? '?' }}/{{ item.quota?.daily_quota ?? doubaoTrainingDailyQuota }} 次</span>
                <span class="tag" :class="item.valid ? 'tag-accent' : ''">{{ item.valid ? '有效' : '无效' }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  v-if="!item.is_active"
                  type="button"
                  class="btn btn-sm"
                  :disabled="doubaoTrainingSessionSaving"
                  @click="activateDoubaoTrainingSession(item.id)"
                >
                  设为当前
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="doubaoTrainingSessionSaving"
                  @click="validateDoubaoTrainingSessionItem(item.id)"
                >
                  验证
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="doubaoTrainingSessionSaving"
                  @click="removeDoubaoTrainingSession(item.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <div v-else class="setup-desc dim" style="margin-top: 12px;">尚未保存任何 Session</div>
          <textarea
            v-model="doubaoTrainingSessionInput"
            class="jimeng-session-input"
            rows="3"
            placeholder="粘贴 Cookie 或 sessionid，保存为新 Session…"
          />
          <div class="jimeng-session-actions">
            <input v-model="doubaoTrainingSessionLabel" class="jimeng-session-label" type="text" placeholder="备注（可选，如：培训账号1）" />
            <button type="button" class="btn btn-sm btn-primary" :disabled="doubaoTrainingSessionSaving || !doubaoTrainingSessionInput.trim()" @click="saveDoubaoTrainingSession">
              {{ doubaoTrainingSessionSaving ? '保存中…' : '添加 Session' }}
            </button>
            <button
              v-if="doubaoTrainingSessions.length"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="doubaoTrainingSessionSaving"
              @click="clearDoubaoTrainingSession"
            >
              清除全部
            </button>
          </div>
        </section>
        <div class="sections">
          <section v-for="st in serviceTypes" :key="st.type">
            <div class="section-head">
              <div>
                <span class="section-title">{{ st.label }}</span>
                <div class="section-subtitle">{{ serviceMeta[st.type].desc }}</div>
              </div>
              <span v-if="countActive(st.type)" class="tag tag-accent">{{ countActive(st.type) }} 已启用</span>
              <button class="btn btn-ghost btn-sm ml-auto" @click="startAddCfg(st.type)"><Plus :size="13" /> 添加</button>
            </div>
            <div class="config-list">
              <div v-for="c in byType(st.type)" :key="c.id" class="card config-row">
                <div class="config-info">
                  <div class="config-main">
                    <div class="config-line">
                      <span class="config-provider">{{ providerLabel(c.provider) }}</span>
                      <span class="config-name">{{ c.name || `${providerLabel(c.provider)}-${c.service_type}` }}</span>
                    </div>
                    <span class="config-model mono truncate">{{ fmtModel(c.model) }}</span>
                    <span class="config-base mono truncate">{{ displayBaseUrl(c.provider, c.base_url) }}</span>
                  </div>
                </div>
                <span :class="['tag', c.api_key ? 'tag-success' : 'tag-error']">{{ c.api_key ? '已配置' : '无密钥' }}</span>
                <button class="btn btn-ghost btn-sm" @click="testExistingCfg(c)">测试</button>
                <label class="toggle"><input type="checkbox" :checked="c.is_active" @change="toggleCfg(c)"><span /></label>
                <button class="btn btn-ghost btn-icon" @click="startEditCfg(c)"><Pencil :size="13" /></button>
                <button class="btn btn-ghost btn-icon" @click="delCfg(c.id)"><Trash2 :size="13" /></button>
              </div>
              <p v-if="!byType(st.type).length" class="config-empty">暂无配置</p>
            </div>
          </section>
        </div>
      </div>

      <!-- ===== Agent 配置 ===== -->
      <div v-else-if="tab === 'agents' && isAdmin" class="settings-scroll">
        <div class="settings-head">
          <div class="settings-brand">
            <div class="settings-brand-mark">
              <img v-if="showBrandImage" :src="brandLogo" alt="红果短剧" class="settings-brand-logo" @error="showBrandImage = false" />
              <span v-else class="settings-brand-fallback">红</span>
            </div>
            <div class="settings-brand-copy">
              <div class="settings-brand-kicker">Hongguo Shorts</div>
              <div class="settings-brand-name">红果短剧</div>
            </div>
          </div>
          <h2 class="settings-title">Agent 配置</h2>
          <p class="settings-desc">高级区只保留 Agent 运行配置。这里可以调整模型、提示词和参数，保存后立即生效。</p>
        </div>
        <div class="agent-list">
          <div v-for="a in agentDefs" :key="a.type" class="card agent-card">
            <div class="agent-card-head" @click="toggleAgentEdit(a.type)">
              <div class="agent-type-badge">{{ a.icon }}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px">{{ a.label }}</div>
                <div class="dim" style="font-size:12px">{{ a.type }}</div>
              </div>
              <span v-if="getAgentCfg(a.type)" class="tag tag-success">已配置</span>
              <span v-else class="tag">默认</span>
              <ChevronDown :size="14" :style="{ transform: editingAgent === a.type ? 'rotate(180deg)' : '', transition: '0.2s' }" />
            </div>
            <div v-if="editingAgent === a.type" class="agent-card-body">
              <label class="field">
                <span class="field-label">模型 <span class="dim">(留空使用 AI 服务默认)</span></span>
                <BaseSelect v-model="agentForm.model" :options="textModelSelectOptions" placeholder="— 使用 AI 服务默认 —" searchable />
              </label>
              <div class="field-row">
                <label class="field">
                  <span class="field-label">Temperature</span>
                  <input v-model.number="agentForm.temperature" class="input" type="number" min="0" max="2" step="0.1" />
                </label>
                <label class="field">
                  <span class="field-label">Max Tokens</span>
                  <input v-model.number="agentForm.max_tokens" class="input" type="number" min="100" max="32768" />
                </label>
              </div>
              <label class="field">
                <span class="field-label">System Prompt</span>
                <textarea v-model="agentForm.system_prompt" class="textarea" rows="12" placeholder="Agent 系统提示词..." />
              </label>
              <div class="agent-card-foot">
                <button class="btn btn-ghost btn-sm" @click="resetAgentPrompt(a.type)">恢复默认</button>
                <span v-if="agentSaved === a.type" class="tag tag-success" style="margin-left:8px">
                  <Check :size="10" /> 已保存
                </span>
                <button class="btn btn-primary btn-sm ml-auto" :disabled="agentSaving" @click="saveAgentCfg(a.type)">
                  <Loader2 v-if="agentSaving" :size="12" class="animate-spin" />
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== Skills 编辑 ===== -->
      <div v-else-if="tab === 'skills' && isAdmin" class="skills-layout">
        <!-- Agent 左侧列表 -->
        <aside class="skills-agent-list">
          <div class="skills-agent-title">Agent 列表</div>
          <button
            v-for="a in agentDefs"
            :key="a.type"
            :class="['skills-agent-item', { active: selectedAgent === a.type }]"
            @click="selectAgent(a.type)"
          >
            <span class="agent-type-badge">{{ a.icon }}</span>
            <span class="skills-agent-label">{{ a.label }}</span>
            <span v-if="agentSkillCount(a.type) > 0" class="skill-count-badge">{{ agentSkillCount(a.type) }}</span>
          </button>
        </aside>

        <!-- Skill 管理右侧主区域 -->
        <div class="settings-scroll skills-main">
          <div class="settings-head">
            <div class="settings-brand">
              <div class="settings-brand-mark">
                <img v-if="showBrandImage" :src="brandLogo" alt="红果短剧" class="settings-brand-logo" @error="showBrandImage = false" />
                <span v-else class="settings-brand-fallback">红</span>
              </div>
              <div class="settings-brand-copy">
                <div class="settings-brand-kicker">Hongguo Shorts</div>
                <div class="settings-brand-name">红果短剧</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="agent-type-badge" style="width:32px;height:32px;font-size:16px">{{ selectedAgentIcon }}</span>
              <div>
                <h2 class="settings-title" style="margin:0">{{ selectedAgentLabel }}</h2>
                <div class="dim" style="font-size:12px">{{ selectedAgentType }} — Skills</div>
              </div>
            </div>
            <p class="settings-desc" style="margin-top:10px">Skills 仅作为 Agent 的高级提示词层使用，不影响工作台常规功能入口。</p>
            <button class="btn btn-primary btn-sm" @click="startAddSkill">
              <Plus :size="13" /> 新增 Skill
            </button>
          </div>

          <!-- 无 skill 提示 -->
          <div v-if="!currentSkills.length" class="step-empty" style="padding:48px 24px">
            <div class="empty-visual">
              <FileText :size="28" />
            </div>
            <div class="empty-title">暂无 Skill</div>
            <div class="empty-desc">点击右上角「新增 Skill」创建第一个提示词文件</div>
          </div>

          <!-- Skill 列表 -->
          <div class="skill-list" v-else>
            <div v-for="s in currentSkills" :key="s.id" class="card skill-card">
              <div class="skill-card-head" @click="toggleSkillEdit(s.id)">
                <FileText :size="14" style="color:var(--accent);flex-shrink:0" />
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:13px">{{ s.name }}</div>
                  <div class="dim" style="font-size:11px">{{ s.description }}</div>
                </div>
                <button class="btn btn-ghost btn-icon" style="margin-right:4px" @click.stop="deleteSkill(s.id)">
                  <Trash2 :size="13" />
                </button>
                <ChevronDown :size="14" :style="{ transform: editingSkill === s.id ? 'rotate(180deg)' : '', transition: '0.2s' }" />
              </div>
              <div v-if="editingSkill === s.id" class="skill-card-body">
                <textarea
                  v-model="skillContent"
                  class="textarea mono"
                  rows="20"
                  style="font-size:12px;line-height:1.6"
                  placeholder="编写 SKILL.md 内容..."
                />
                <div class="skill-card-foot">
                  <span class="dim" style="font-size:11px">skills/{{ selectedAgentType }}/{{ s.id }}/SKILL.md</span>
                  <span v-if="skillSaved === s.id" class="tag tag-success" style="margin-left:8px">
                    <Check :size="10" /> 已保存
                  </span>
                  <button class="btn btn-primary btn-sm ml-auto" :disabled="skillSaving" @click="saveSkill(s.id)">
                    <Loader2 v-if="skillSaving" :size="12" class="animate-spin" />
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== 积分管理 ===== -->
      <div v-if="tab === 'credits' && isAdmin" class="settings-scroll">
        <div class="settings-head">
          <h2 class="settings-title">积分管理</h2>
          <p class="settings-desc">配置各操作的积分单价，并为团队成员充值。后续可按 1 元 = 100 积分 对接充值。</p>
        </div>
        <section class="setup-panel card">
          <div class="setup-title">视频通道对照</div>
          <p class="dim setup-pricing-hint">以下对照表仅管理员可见，说明顶部导航通道名与实际服务商、积分定价项的对应关系。</p>
          <table class="user-table video-channel-guide-table">
            <thead>
              <tr>
                <th>导航名</th>
                <th>实际通道</th>
                <th>上游 / 说明</th>
                <th>积分定价项</th>
                <th>计费</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in videoChannelGuide" :key="row.navLabel">
                <td class="mono">{{ row.navLabel }}</td>
                <td>
                  {{ row.internalName }}
                  <span v-if="row.adminOnly" class="tag tag-accent">管理员入口</span>
                </td>
                <td class="dim">{{ row.upstream }} · {{ row.features }}</td>
                <td class="dim">{{ row.pricingLabels }}</td>
                <td>{{ row.billing }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section v-if="chengmengPricingGroups.length" class="setup-panel card">
          <div class="setup-title">橙盟模型（通道1）</div>
          <p class="dim setup-pricing-hint">每个上游 model_id 可单独启用或禁用；<strong>禁用后前台通道1页不再显示该模型</strong>（默认定价项仍保留，重新启用后可继续调价）。在「AI 服务」中刷新橙盟配置可同步新模型定价项。</p>
          <table class="user-table aistarslab-pricing-table">
            <thead>
              <tr><th>模型</th><th>单价</th><th>启用</th><th></th></tr>
            </thead>
            <tbody>
              <tr
                v-for="group in chengmengPricingGroups"
                :key="`cm-${group.modelId}`"
                :class="{ 'aistarslab-pricing-model-disabled': !group.enabled }"
              >
                <td>
                  <span class="tag tag-accent">model {{ group.modelId }}</span>
                  <span class="aistarslab-pricing-channel-title">{{ group.title }}</span>
                  <div v-for="item in group.items" :key="item.action" class="dim mono aistarslab-pricing-action">{{ item.action }}</div>
                </td>
                <td>
                  <div v-for="item in group.items" :key="`${item.action}-cost`" class="pricing-input-row">
                    <input v-model.number="item.cost" class="input input-sm pricing-cost-input" type="number" min="0" step="1" :disabled="!group.enabled" />
                    <span class="dim pricing-unit">{{ pricingUnit(item.action) }}</span>
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn btn-sm"
                    :class="group.enabled ? 'btn-primary' : 'btn-ghost'"
                    :disabled="chengmengModelSaving === group.modelId"
                    @click="toggleChengmengModel(group)"
                  >
                    {{ chengmengModelSaving === group.modelId ? '保存中…' : (group.enabled ? '已启用' : '已禁用') }}
                  </button>
                </td>
                <td>
                  <button
                    v-for="item in group.items"
                    :key="`${item.action}-save`"
                    type="button"
                    class="btn btn-sm"
                    :disabled="!group.enabled"
                    @click="savePricing(item)"
                  >
                    保存
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <section v-if="aistarslabPricingGroups.length" class="setup-panel card">
          <div class="setup-title">Seedance VIP 线路（通道3）</div>
          <p class="dim setup-pricing-hint">每条线路可单独启用或禁用；<strong>禁用后前台通道3页不再显示该线路</strong>（默认定价项仍保留，重新启用后可继续调价）。</p>
          <table class="user-table aistarslab-pricing-table">
            <thead>
              <tr><th>线路</th><th>模型定价</th><th>单价</th><th>启用</th><th></th></tr>
            </thead>
            <tbody>
              <template v-for="group in aistarslabPricingGroups" :key="`ch-${group.channel}`">
                <tr class="aistarslab-pricing-channel-row">
                  <td colspan="2">
                    <span class="tag tag-accent">线路 {{ group.channel }}</span>
                    <span class="aistarslab-pricing-channel-title">{{ group.title }}</span>
                    <span class="dim">（{{ group.items.length }} 个模型）</span>
                  </td>
                  <td></td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-sm"
                      :class="group.enabled ? 'btn-primary' : 'btn-ghost'"
                      :disabled="aistarslabChannelSaving === group.channel"
                      @click="toggleAistarslabChannel(group)"
                    >
                      {{ aistarslabChannelSaving === group.channel ? '保存中…' : (group.enabled ? '已启用' : '已禁用') }}
                    </button>
                  </td>
                  <td></td>
                </tr>
                <tr v-for="item in group.items" :key="item.action" :class="{ 'aistarslab-pricing-model-disabled': !group.enabled }">
                  <td></td>
                  <td>
                    <div>{{ item.label }}</div>
                    <div class="dim mono aistarslab-pricing-action">{{ item.action }}</div>
                  </td>
                  <td>
                    <div class="pricing-input-row">
                      <input v-model.number="item.cost" class="input input-sm pricing-cost-input" type="number" min="0" step="1" :disabled="!group.enabled" />
                      <span class="dim pricing-unit">{{ pricingUnit(item.action) }}</span>
                    </div>
                  </td>
                  <td></td>
                  <td>
                    <button type="button" class="btn btn-sm" :disabled="!group.enabled" @click="savePricing(item)">保存</button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </section>
        <section v-if="jimengPricingItems.length" class="setup-panel card">
          <div class="setup-title">Seedance 通道4（即梦）</div>
          <p class="dim setup-pricing-hint">前台仅展示 Seedance 2.0 Fast VIP / 2.0 VIP 两档；Session 由管理员在「AI 服务」中配置，用户可直接使用当前启用 Session 生成。</p>
          <table class="user-table">
            <thead>
              <tr><th>模型</th><th>单价</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="item in jimengPricingItems" :key="item.action">
                <td>
                  <div>{{ item.label }}</div>
                  <div class="dim mono aistarslab-pricing-action">{{ item.action }}</div>
                </td>
                <td>
                  <div class="pricing-input-row">
                    <input v-model.number="item.cost" class="input input-sm pricing-cost-input" type="number" min="0" step="1" />
                    <span class="dim pricing-unit">{{ pricingUnit(item.action) }}</span>
                  </div>
                </td>
                <td>
                  <button type="button" class="btn btn-sm" @click="savePricing(item)">保存</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="setup-panel card">
          <div class="setup-title">操作定价</div>
          <p class="dim setup-pricing-hint">seedance通道2 相关项填<strong>每秒</strong>积分；seedance通道1/3/4 与 grok视频 填<strong>每条</strong>积分。「Seedance 2.0 VIP」为用户扣费单价（按条），与上游成本无关。通道1 各模型见上方「橙盟模型（通道1）」；通道3 各线路×模型定价见上方表格；通道4 见上方「Seedance 通道4」。</p>
          <table class="user-table">
            <thead>
              <tr><th>操作</th><th>说明</th><th>单价</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="item in generalCreditPricing" :key="item.action">
                <td>{{ item.label }}</td>
                <td class="dim">{{ item.description }}</td>
                <td>
                  <div class="pricing-input-row">
                    <input v-model.number="item.cost" class="input input-sm pricing-cost-input" type="number" min="0" step="1" />
                    <span class="dim pricing-unit">{{ pricingUnit(item.action) }}</span>
                  </div>
                </td>
                <td><button type="button" class="btn btn-sm" @click="savePricing(item)">保存</button></td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="setup-panel card">
          <div class="setup-title">为用户充值</div>
          <form class="user-create-form" @submit.prevent="grantCredits">
            <select v-model.number="grantForm.user_id" class="input" required>
              <option :value="null" disabled>选择用户</option>
              <option v-for="u in teamUsers" :key="u.id" :value="u.id">{{ u.display_name || u.username }}（{{ u.credits_balance ?? 0 }} 积分）</option>
            </select>
            <input v-model.number="grantForm.amount" class="input" type="number" min="1" step="1" placeholder="充值积分" required />
            <input v-model="grantForm.summary" class="input" placeholder="备注（可选）" />
            <button type="submit" class="btn btn-primary">充值</button>
          </form>
        </section>
      </div>

      <!-- ===== 团队管理 ===== -->
      <div v-if="tab === 'team'" class="settings-scroll">
        <div class="settings-head">
          <h2 class="settings-title">团队管理</h2>
          <p class="settings-desc">
            创建或切换团队后，新建项目与新建用户会归属当前团队。
            <span v-if="activeTeam">当前：{{ activeTeam.name }}（{{ teamRoleLabel(activeTeam.role) }}）</span>
          </p>
        </div>

        <section class="setup-panel card">
          <div class="setup-title">新建团队</div>
          <p class="setup-desc">创建后你将成为团队所有者，可在顶栏切换团队。</p>
          <form class="user-create-form team-name-form" @submit.prevent="createTeam">
            <input v-model="newTeamName" class="input" placeholder="团队名称" required />
            <button type="submit" class="btn btn-primary" :disabled="creatingTeam">
              {{ creatingTeam ? '创建中…' : '创建团队' }}
            </button>
          </form>
        </section>

        <section v-if="activeTeam && canRenameTeam" class="setup-panel card">
          <div class="setup-title">重命名当前团队</div>
          <form class="user-create-form team-name-form" @submit.prevent="renameTeam">
            <input v-model="renameTeamName" class="input" placeholder="团队名称" required />
            <button type="submit" class="btn" :disabled="renamingTeam || !renameTeamName.trim() || renameTeamName.trim() === activeTeam.name">
              {{ renamingTeam ? '保存中…' : '保存名称' }}
            </button>
          </form>
        </section>

        <section v-if="canManageMembers" class="setup-panel card">
          <div class="setup-title">添加成员</div>
          <p class="setup-desc">将已有账号加入当前团队「{{ activeTeam?.name || '—' }}」。</p>
          <form class="user-create-form team-member-form" @submit.prevent="addTeamMember">
            <input v-model="memberForm.username" class="input" placeholder="用户名" required />
            <select v-model="memberForm.role" class="input">
              <option value="member">成员</option>
              <option value="admin">团队管理员</option>
            </select>
            <button type="submit" class="btn btn-primary">添加</button>
          </form>
        </section>

        <section v-if="canManageMembers" class="setup-panel card">
          <div class="setup-title">团队成员</div>
          <table class="user-table">
            <thead>
              <tr><th>用户名</th><th>显示名</th><th>团队角色</th><th>平台角色</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="m in teamMembers" :key="m.user_id">
                <td>{{ m.username }}</td>
                <td>{{ m.display_name }}</td>
                <td>
                  <select
                    v-if="canEditMember(m)"
                    :value="m.role"
                    class="input input-sm"
                    @change="updateMemberRole(m, $event)"
                  >
                    <option value="owner">所有者</option>
                    <option value="admin">管理员</option>
                    <option value="member">成员</option>
                  </select>
                  <span v-else class="tag">{{ teamRoleLabel(m.role) }}</span>
                </td>
                <td><span class="tag">{{ m.platform_role === 'admin' ? '平台管理员' : '用户' }}</span></td>
                <td>
                  <button
                    v-if="canRemoveMember(m)"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    @click="removeMember(m)"
                  >移除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-else-if="activeTeam" class="setup-panel card">
          <div class="setup-title">团队成员</div>
          <p class="setup-desc dim">仅团队管理员可添加或移除成员。请联系团队所有者或管理员。</p>
        </section>
      </div>

      <!-- ===== 用户管理 ===== -->
      <div v-if="tab === 'users' && isAdmin" class="settings-scroll">
        <div class="settings-head">
          <h2 class="settings-title">用户管理</h2>
          <p class="settings-desc">创建团队成员账号。普通用户可制作项目；管理员可修改全局设置。</p>
        </div>
        <section class="setup-panel card">
          <div class="setup-title">新建用户</div>
          <form class="user-create-form" @submit.prevent="createTeamUser">
            <input v-model="userForm.username" class="input" placeholder="用户名" required />
            <input v-model="userForm.display_name" class="input" placeholder="显示名称" />
            <input v-model="userForm.password" class="input" type="password" placeholder="密码（至少 6 位）" required />
            <select v-model="userForm.role" class="input">
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
            <button type="submit" class="btn btn-primary">创建</button>
          </form>
        </section>
        <section class="setup-panel card">
          <div class="setup-title">已有用户</div>
          <table class="user-table">
            <thead>
              <tr><th>用户名</th><th>显示名</th><th>角色</th><th>积分</th><th>最近登录</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in teamUsers" :key="u.id">
                <td>{{ u.username }}</td>
                <td>{{ u.display_name }}</td>
                <td><span class="tag">{{ u.role === 'admin' ? '管理员' : '用户' }}</span></td>
                <td class="mono">{{ u.credits_balance ?? 0 }}</td>
                <td class="dim mono">{{ u.last_login_at ? fmtUserTime(u.last_login_at) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>

    <!-- AI Config Dialog -->
    <div v-if="cfgDialog" class="overlay" @click.self="cfgDialog = false">
      <form class="modal card config-modal" @submit.prevent="saveCfg">
        <div class="config-modal-head">
          <div>
            <div class="setup-kicker">{{ cfgEditId ? 'Edit Config' : 'New Config' }}</div>
            <h2 class="modal-title">{{ cfgEditId ? '编辑服务配置' : `添加${serviceMeta[cfgForm.service_type].label}服务` }}</h2>
            <div class="modal-note">推荐先选择模板，系统会自动填入更合理的 `Base URL` 与默认模型。</div>
          </div>
          <span class="tag tag-accent">{{ serviceMeta[cfgForm.service_type].label }}</span>
        </div>
        <div class="preset-picker">
          <button
            v-for="preset in presetsByType(cfgForm.service_type)"
            :key="`${cfgForm.service_type}-${preset.provider}`"
            type="button"
            class="preset-pill"
            @click="applyProviderPreset(cfgForm.service_type, preset.provider)"
          >
            {{ preset.label }}
          </button>
        </div>
        <label class="field">
          <span class="field-label">配置名称</span>
          <input v-model="cfgForm.name" class="input" placeholder="如 红果默认图像服务" />
        </label>
        <label class="field"><span class="field-label">服务商</span>
          <BaseSelect v-model="cfgForm.provider" :options="providerSelectOptions" placeholder="选择服务商" searchable />
        </label>
        <label class="field">
          <span class="field-label">优先级</span>
          <input v-model.number="cfgForm.priority" class="input" type="number" min="0" max="999" />
          <span class="field-hint">数值越高越优先。工作台默认会优先使用同类型里优先级最高的启用配置。</span>
        </label>
        <label class="field">
          <span class="field-label">API Key</span>
          <input v-model="cfgForm.api_key" class="input" type="password" :placeholder="cfgForm.provider?.startsWith('ali') ? 'sk-...（百炼控制台 API Key）' : 'sk-...'" />
          <span v-if="aliProviderHint" class="field-hint">{{ aliProviderHint }} · <a href="https://help.aliyun.com/zh/model-studio/get-api-key" target="_blank" rel="noopener">获取 API Key</a> · <a href="https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope" target="_blank" rel="noopener">OpenAI 兼容说明</a></span>
          <span v-if="chengmengProviderHint" class="field-hint">{{ chengmengProviderHint }} · <a href="https://chengmeng.site/docu" target="_blank" rel="noopener">API 文档</a></span>
          <span v-if="aistarslabProviderHint" class="field-hint">
            {{ aistarslabProviderHint }}
            · <a href="https://my.feishu.cn/wiki/JP5HwMT3Vi67HDkpxgbcgQWVnYd" target="_blank" rel="noopener">接口文档</a>
          </span>
          <div v-if="showChengmengRemotePanel" class="aistarslab-remote-panel">
            <div class="aistarslab-remote-head">
              <span class="aistarslab-remote-title">可用模型与积分定价项</span>
              <button type="button" class="btn btn-ghost btn-sm" :disabled="chengmengRemoteLoading" @click="loadChengmengRemoteConfig">
                {{ chengmengRemoteLoading ? '加载中…' : '刷新' }}
              </button>
            </div>
            <p v-if="!cfgForm.api_key?.trim() || cfgForm.api_key === '********'" class="field-hint">
              填写 API Key 后将自动拉取可用模型；各模型积分可在「积分」页单独配置。
            </p>
            <p v-else-if="chengmengRemoteError" class="aistarslab-remote-error">{{ chengmengRemoteError }}</p>
            <p v-else-if="chengmengRemoteLoading && !chengmengRemoteModels.length" class="field-hint dim">正在拉取模型列表…</p>
            <div v-else-if="chengmengRemoteModels.length" class="aistarslab-remote-body">
              <p v-if="chengmengRemoteMeta" class="field-hint dim">{{ chengmengRemoteMeta }}</p>
              <ul class="aistarslab-remote-models">
                <li v-for="model in chengmengRemoteModels" :key="model.id">
                  <code>{{ model.model_id }}</code>
                  <span>{{ model.label }}</span>
                  <span class="dim">group {{ model.group_id }}</span>
                  <span class="dim">{{ formatChengmengModelPrice(model) }}</span>
                  <span class="dim mono">{{ model.credit_action }}</span>
                  <span v-if="model.default_option" class="tag">默认</span>
                </li>
              </ul>
            </div>
          </div>
          <div v-if="showAistarslabRemotePanel" class="aistarslab-remote-panel">
            <div class="aistarslab-remote-head">
              <span class="aistarslab-remote-title">可用线路与模型</span>
              <button type="button" class="btn btn-ghost btn-sm" :disabled="aistarslabRemoteLoading" @click="loadAistarslabRemoteConfig">
                {{ aistarslabRemoteLoading ? '加载中…' : '刷新' }}
              </button>
            </div>
            <p v-if="!cfgForm.api_key?.trim() || cfgForm.api_key === '********'" class="field-hint">
              填写 API Key 后将自动拉取可用模型。
            </p>
            <p v-else-if="aistarslabRemoteError" class="aistarslab-remote-error">{{ aistarslabRemoteError }}</p>
            <p v-else-if="aistarslabRemoteLoading && !aistarslabRemoteChannels.length" class="field-hint dim">正在拉取模型列表…</p>
            <div v-else-if="aistarslabRemoteChannels.length" class="aistarslab-remote-body">
              <p v-if="aistarslabRemoteMeta" class="field-hint dim">{{ aistarslabRemoteMeta }}</p>
              <div v-for="channel in aistarslabRemoteChannels" :key="channel.channel" class="aistarslab-remote-channel">
                <div class="aistarslab-remote-channel-head">
                  <span class="tag tag-accent">线路 {{ channel.channel }}</span>
                  <strong>{{ channel.title }}</strong>
                  <span v-if="channel.default_option" class="tag">推荐</span>
                </div>
                <p v-if="channel.description" class="dim aistarslab-remote-desc">{{ channel.description }}</p>
                <p class="dim aistarslab-remote-meta-line">
                  {{ channel.seconds_min }}–{{ channel.seconds_max }} 秒 · {{ (channel.aspect_ratios || []).join(' / ') }}
                </p>
                <ul class="aistarslab-remote-models">
                  <li v-for="model in channel.models" :key="`${channel.channel}-${model.model}`">
                    <code>{{ model.model }}</code>
                    <span>{{ model.label }}</span>
                    <span class="dim">{{ formatAistarslabModelPrice(model, channel) }}</span>
                    <code v-if="model.credit_action" class="dim">{{ model.credit_action }}</code>
                    <span v-if="model.default_option" class="tag">默认</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </label>
        <label v-if="cfgForm.provider !== 'aistarslab'" class="field"><span class="field-label">Base URL</span><input v-model="cfgForm.base_url" class="input" placeholder="https://..." /></label>
        <p v-else class="field-hint dim">Base URL 由系统自动配置，无需填写。</p>
        <div v-if="cfgForm.provider !== 'aistarslab'" class="endpoint-hint">
          <span class="dim">实际端点前缀：</span>
          <span class="mono">{{ endpointHint }}</span>
        </div>
        <label class="field">
          <span class="field-label">模型（逗号分隔）</span>
          <input v-model="cfgForm.modelStr" class="input" :placeholder="modelInputPlaceholder" />
          <span v-if="modelFieldHint" class="field-hint">
            {{ modelFieldHint.summary }}
            <template v-if="modelFieldHint.docUrl">
              · <a :href="modelFieldHint.docUrl" target="_blank" rel="noopener">{{ modelFieldHint.docLabel }}</a>
            </template>
            <template v-if="modelFieldHint.extraUrl">
              · <a :href="modelFieldHint.extraUrl" target="_blank" rel="noopener">{{ modelFieldHint.extraLabel }}</a>
            </template>
          </span>
        </label>
        <div v-if="cfgTestResult" class="test-result" :class="{ ok: cfgTestResult.reachable, bad: !cfgTestResult.reachable }">
          <div class="test-result-head">
            <span class="tag" :class="cfgTestResult.reachable ? 'tag-success' : 'tag-error'">{{ cfgTestResult.status || 'ERROR' }}</span>
            <span>{{ cfgTestResult.message }}</span>
          </div>
          <div class="mono test-result-url">{{ cfgTestResult.method }} {{ cfgTestResult.url }}</div>
          <div v-if="cfgTestResult.response_preview" class="mono test-result-preview">{{ cfgTestResult.response_preview }}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" :disabled="cfgTesting" @click="testDraftCfg">
            <Loader2 v-if="cfgTesting" :size="12" class="animate-spin" />
            <span v-else>测试配置</span>
          </button>
          <button type="button" class="btn" @click="cfgDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    </div>

    <!-- Hongguo Preset Dialog -->
    <div v-if="presetDialog" class="overlay" @click.self="presetDialog = false">
      <form class="modal card config-modal" @submit.prevent="applyHuobaoPreset">
        <div class="config-modal-head">
          <div>
            <div class="setup-kicker">Hongguo Preset</div>
            <h2 class="modal-title">红果一键配置</h2>
            <div class="modal-note">按红果推荐链路自动创建或更新 4 条服务配置，并同时初始化 5 个 Agent 的默认模型。</div>
          </div>
          <span class="tag tag-success">推荐</span>
        </div>
        <div class="huobao-grid">
          <label class="field">
            <span class="field-label">API Key <span class="dim">(统一用于文本 / 图片 / 视频 / 音频)</span></span>
            <input v-model="huobaoForm.apiKey" class="input" type="password" placeholder="用于 api.chatfire.site 全链路服务" />
            <span class="field-hint">还没有账号？<a href="https://api.chatfire.site/" target="_blank" rel="noopener">立即注册 →</a></span>
          </label>
        </div>
        <div class="preset-grid compact">
          <article v-for="preset in huobaoPresetCards" :key="`${preset.serviceType}-${preset.model}`" class="preset-card">
            <div class="preset-card-top">
              <span class="preset-service">{{ preset.label }}</span>
              <span class="tag tag-accent">{{ preset.provider }}</span>
            </div>
            <div class="preset-model mono">{{ preset.model }}</div>
            <div class="preset-base mono">{{ preset.baseUrl }}</div>
          </article>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" @click="presetDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">创建并启用</button>
        </div>
      </form>
    </div>

    <!-- Add Skill Dialog -->
    <div v-if="addSkillDialog" class="overlay" @click.self="addSkillDialog = false">
      <form class="modal card" @submit.prevent="confirmAddSkill">
        <h2 class="modal-title">新增 Skill — {{ selectedAgentLabel }}</h2>
        <label class="field">
          <span class="field-label">Skill 目录名 <span class="dim">(英文，唯一)</span></span>
          <input v-model="newSkillForm.id" class="input" placeholder="如 custom-extraction" />
        </label>
        <label class="field">
          <span class="field-label">名称</span>
          <input v-model="newSkillForm.name" class="input" placeholder="如 自定义提取规则" />
        </label>
        <label class="field">
          <span class="field-label">描述</span>
          <input v-model="newSkillForm.description" class="input" placeholder="简短描述此 Skill 的用途" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" @click="addSkillDialog = false">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="!newSkillForm.id">创建</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { Plus, Pencil, Trash2, FileText, ChevronDown, Check, Loader2, Bot, Cpu, Sparkles, Users, Coins, Building2 } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'
import { toast } from 'vue-sonner'
import { aiConfigAPI, agentConfigAPI, skillsAPI, usersAPI, creditsAPI, teamsAPI, jimengSessionAPI, doubaoTrainingSessionAPI } from '~/composables/useApi'
import brandLogo from '~/assets/huobao-logo.png'
import { VIDEO_CHANNEL_ADMIN_GUIDE } from '~/constants/video-channels.js'

const { isAdmin, user } = useAuth()
const { activeTeam, activeTeamId, canManageTeam, refreshTeams, selectTeam } = useTeam()
const showBrandImage = ref(true)
const tab = ref('ai')
const showAdvanced = ref(false)
watch([isAdmin, canManageTeam], () => {
  if (!isAdmin.value && canManageTeam.value) tab.value = 'team'
}, { immediate: true })
const baseTabs = computed(() => {
  if (isAdmin.value) {
    return [
      { id: 'ai', label: 'AI 服务', icon: Cpu },
      { id: 'team', label: '团队', icon: Building2 },
      { id: 'credits', label: '积分', icon: Coins },
      { id: 'users', label: '用户', icon: Users },
    ]
  }
  if (canManageTeam.value) {
    return [{ id: 'team', label: '团队', icon: Building2 }]
  }
  return []
})
const canManageMembers = computed(() => canManageTeam.value || isAdmin.value)
const canRenameTeam = computed(() => canManageMembers.value)
const advancedTabs = [
  { id: 'agents', label: 'Agent 配置', icon: Bot },
  { id: 'skills', label: 'Skills', icon: FileText },
]
watch(showAdvanced, (v) => {
  if (!v && tab.value !== 'ai' && tab.value !== 'team') {
    tab.value = isAdmin.value ? 'ai' : 'team'
  }
})

// ===== AI Service Configs =====
const cfgs = ref([])
const cfgDialog = ref(false)
const cfgEditId = ref(null)
const presetDialog = ref(false)
const cfgTesting = ref(false)
const cfgTestResult = ref(null)
const cfgForm = reactive({ name: '', provider: '', api_key: '', base_url: '', modelStr: '', service_type: 'text', priority: 0 })
const huobaoForm = reactive({ apiKey: '' })

const jimengSessions = ref([])
const jimengSessionInput = ref('')
const jimengSessionLabel = ref('')
const jimengSessionSaving = ref(false)

const doubaoTrainingSessions = ref([])
const doubaoTrainingSessionInput = ref('')
const doubaoTrainingSessionLabel = ref('')
const doubaoTrainingSessionSaving = ref(false)
const doubaoTrainingDailyQuota = ref(5)

const jimengHasValidSession = computed(() => jimengSessions.value.some(item => item.valid))
const jimengSessionConfigured = computed(() => jimengSessions.value.length > 0)

const jimengSessionStatusLabel = computed(() => {
  if (jimengHasValidSession.value) return '有可用 Session'
  if (jimengSessionConfigured.value) return 'Session 均无效或已过期'
  return '未配置'
})

const doubaoTrainingHasValidSession = computed(() => doubaoTrainingSessions.value.some(item => item.valid))
const doubaoTrainingSessionConfigured = computed(() => doubaoTrainingSessions.value.length > 0)

const doubaoTrainingSessionStatusLabel = computed(() => {
  if (doubaoTrainingHasValidSession.value) return '有可用 Session'
  if (doubaoTrainingSessionConfigured.value) return 'Session 均无效或已过期'
  return '未配置'
})

async function loadDoubaoTrainingSessionStatus() {
  if (!isAdmin.value) return
  try {
    const res = await doubaoTrainingSessionAPI.list()
    doubaoTrainingSessions.value = res?.items || []
  } catch {
    doubaoTrainingSessions.value = []
  }
}

async function saveDoubaoTrainingSession() {
  if (!doubaoTrainingSessionInput.value.trim()) return
  doubaoTrainingSessionSaving.value = true
  try {
    const raw = doubaoTrainingSessionInput.value.trim()
    const payload = raw.includes('=')
      ? { cookie: raw, label: doubaoTrainingSessionLabel.value || undefined, set_active: true }
      : { session_id: raw, label: doubaoTrainingSessionLabel.value || undefined, set_active: true }
    await doubaoTrainingSessionAPI.save(payload)
    doubaoTrainingSessionInput.value = ''
    doubaoTrainingSessionLabel.value = ''
    toast.success('豆包培训 Session 已保存')
    await loadDoubaoTrainingSessionStatus()
  } catch (e) {
    toast.error(e.message)
  } finally {
    doubaoTrainingSessionSaving.value = false
  }
}

async function validateDoubaoTrainingSessionItem(id) {
  doubaoTrainingSessionSaving.value = true
  try {
    const res = await doubaoTrainingSessionAPI.validate(id)
    toast.success(res?.valid ? 'Session 有效' : 'Session 无效或已过期')
    await loadDoubaoTrainingSessionStatus()
  } catch (e) {
    toast.error(e.message)
  } finally {
    doubaoTrainingSessionSaving.value = false
  }
}

async function activateDoubaoTrainingSession(id) {
  doubaoTrainingSessionSaving.value = true
  try {
    await doubaoTrainingSessionAPI.setActive(id)
    toast.success('已切换当前 Session')
    await loadDoubaoTrainingSessionStatus()
  } catch (e) {
    toast.error(e.message)
  } finally {
    doubaoTrainingSessionSaving.value = false
  }
}

async function removeDoubaoTrainingSession(id) {
  doubaoTrainingSessionSaving.value = true
  try {
    await doubaoTrainingSessionAPI.remove(id)
    toast.success('Session 已删除')
    await loadDoubaoTrainingSessionStatus()
  } catch (e) {
    toast.error(e.message)
  } finally {
    doubaoTrainingSessionSaving.value = false
  }
}

async function clearDoubaoTrainingSession() {
  doubaoTrainingSessionSaving.value = true
  try {
    await doubaoTrainingSessionAPI.clear()
    doubaoTrainingSessionInput.value = ''
    doubaoTrainingSessionLabel.value = ''
    doubaoTrainingSessions.value = []
    toast.success('已清除全部 Session')
  } catch (e) {
    toast.error(e.message)
  } finally {
    doubaoTrainingSessionSaving.value = false
  }
}

async function loadJimengSessionStatus() {
  if (!isAdmin.value) return
  try {
    const res = await jimengSessionAPI.list()
    jimengSessions.value = res?.items || res?.sessions || []
  } catch {
    jimengSessions.value = []
  }
}

async function saveJimengSession() {
  if (!jimengSessionInput.value.trim()) return
  jimengSessionSaving.value = true
  try {
    const raw = jimengSessionInput.value.trim()
    const payload = raw.includes('=')
      ? { cookie: raw, label: jimengSessionLabel.value || undefined, set_active: true }
      : { session_id: raw, label: jimengSessionLabel.value || undefined, set_active: true }
    const res = await jimengSessionAPI.save(payload)
    jimengSessionInput.value = ''
    jimengSessionLabel.value = ''
    await loadJimengSessionStatus()
    toast.success(res?.valid ? 'Session 已添加且有效' : 'Session 已添加，但验证未通过')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    jimengSessionSaving.value = false
  }
}

async function validateJimengSessionItem(id) {
  jimengSessionSaving.value = true
  try {
    const res = await jimengSessionAPI.validate(id)
    await loadJimengSessionStatus()
    toast.success(res?.valid ? 'Session 有效' : 'Session 无效，请重新登录即梦并复制 Cookie')
  } catch (err) {
    toast.error(err?.message || '验证失败')
  } finally {
    jimengSessionSaving.value = false
  }
}

async function activateJimengSession(id) {
  jimengSessionSaving.value = true
  try {
    await jimengSessionAPI.setActive(id)
    await loadJimengSessionStatus()
    toast.success('已设为当前启用 Session')
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    jimengSessionSaving.value = false
  }
}

async function removeJimengSession(id) {
  jimengSessionSaving.value = true
  try {
    await jimengSessionAPI.remove(id)
    await loadJimengSessionStatus()
    toast.success('Session 已删除')
  } catch (err) {
    toast.error(err?.message || '删除失败')
  } finally {
    jimengSessionSaving.value = false
  }
}

async function clearJimengSession() {
  jimengSessionSaving.value = true
  try {
    await jimengSessionAPI.clear()
    jimengSessionInput.value = ''
    jimengSessionLabel.value = ''
    jimengSessions.value = []
    toast.success('已清除全部 Session')
  } catch (err) {
    toast.error(err?.message || '清除失败')
  } finally {
    jimengSessionSaving.value = false
  }
}

const serviceTypes = [{ type: 'text', label: '文本' }, { type: 'image', label: '图片' }, { type: 'video', label: '视频' }, { type: 'audio', label: '音频' }]
const providers = ['ali', 'ali-intl', 'ali-us', 'chatfire', 'chengmeng', 'aistarslab', 'geeknow', 'gemini', 'minimax', 'openai', 'openrouter', 'vidu', 'volcengine', 'volcengine_proxy']
const providerLabels = {
  ali: '阿里百炼（北京）',
  'ali-intl': '阿里百炼（新加坡）',
  'ali-us': '阿里百炼（美国）',
  chatfire: 'ChatFire',
  chengmeng: '橙盟 Seedance 2.0 9图过人脸',
  aistarslab: 'Seedance 2.0 VIP',
  geeknow: 'GeekNow (NewAPI)',
  gemini: 'Gemini',
  minimax: 'MiniMax',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  vidu: 'Vidu',
  volcengine: '火山方舟',
  volcengine_proxy: '火山代理',
}
const providerSelectOptions = computed(() => providers.map(p => ({ label: providerLabels[p] || p, value: p })))
const serviceMeta = {
  text: { label: '文本', desc: '剧本改写、角色场景提取、分镜拆解等 Agent 文本能力' },
  image: { label: '图片', desc: '角色图、场景图、镜头图与首尾帧等静态图像生成' },
  video: { label: '视频', desc: '镜头视频生成，支持单图、多图和首尾帧模式' },
  audio: { label: '音频', desc: '角色试听、旁白与对白语音生成' },
}
const providerPresets = {
  text: {
    ali: {
      label: '阿里百炼·北京',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
      hint: 'API Key 在百炼控制台创建，需与北京地域一致',
    },
    'ali-intl': {
      label: '阿里百炼·新加坡',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
      hint: '国际站 API Key，与新加坡地域 Base URL 配套使用',
    },
    'ali-us': {
      label: '阿里百炼·美国',
      baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
      hint: '美国（弗吉尼亚）地域 API Key 与 Base URL 需一致',
    },
    chatfire: { label: 'ChatFire 推荐', baseUrl: 'https://api.chatfire.site', models: ['gemini-3-pro-preview'] },
    openrouter: { label: 'OpenRouter 推荐', baseUrl: 'https://openrouter.ai/api', models: ['google/gemini-3-flash-preview'] },
    openai: { label: 'OpenAI 推荐', baseUrl: 'https://api.openai.com', models: ['gpt-4.1-mini'] },
  },
  image: {
    geeknow: {
      label: 'GeekNow',
      baseUrl: 'https://geek.closeai.icu',
      models: ['gpt-image-2'],
      hint: 'NewAPI 网关，OpenAI 兼容；Base URL 填站点根地址（勿重复 /v1），默认模型 gpt-image-2',
    },
    chatfire: { label: 'ChatFire 推荐', baseUrl: 'https://api.chatfire.site', models: ['doubao-seedream-4-5-251128'] },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com', models: ['dall-e-3', 'gpt-image-1'] },
    gemini: { label: 'Gemini 推荐', baseUrl: 'https://api.chatfire.site', models: ['gemini-3-pro-image-preview'] },
    volcengine: { label: '火山推荐', baseUrl: 'https://ark.cn-beijing.volces.com', models: ['doubao-seedream-4-0-250828'] },
  },
  video: {
    volcengine: {
      label: '火山方舟 Seedance',
      baseUrl: 'https://ark.cn-beijing.volces.com',
      models: [
        'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-1-5-pro-251215',
      ],
      hint: '官方 Ark；2.0 / 2.0 Fast 时长 4–15 秒。文档：火山方舟「创建视频生成任务 API」',
    },
    volcengine_proxy: {
      label: 'ChatFire 火山代理',
      baseUrl: 'https://api.chatfire.site/volcengine',
      models: ['doubao-seedance-1-5-pro-251215', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128'],
      hint: '第三方代理，是否支持 2.0 以网关为准',
    },
    chengmeng: {
      label: '橙盟 Seedance 2.0 9图过人脸',
      baseUrl: 'https://api.chengmeng.site',
      models: ['53', '15'],
      hint: 'Base URL 填 https://api.chengmeng.site；默认 model_id=53（Fast）/ group_id=15；视频生成页可选 32（Seedance 2.0 标准版）',
      defaultApiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NyIsInVzZXJpZCI6ImppbmdsaW5nIiwidHlwZSI6InVzZXIiLCJpYXQiOjE3NzgyMDYwMjQsImV4cCI6MTc3ODgxMDgyNH0.-rE2vYTdktoOYf2g7S5qAhcacQA_0GrA6bNkeRpndnc',
    },
    aistarslab: {
      label: 'Seedance 2.0 VIP',
      baseUrl: 'https://api.video.aistarslab.com',
      models: ['seedance-2.0-720p-fast'],
      hint: 'Seedance 2.0 VIP 视频通道；默认线路 12 / 模型 seedance-2.0-720p-fast',
      defaultApiKey: 'sk_peb7RV-OP3MTALcV6sTzJewOEfTWiec2nBYf0HkRb80',
    },
    vidu: { label: 'Vidu 推荐', baseUrl: 'https://api.vidu.com', models: ['viduq3-turbo'] },
    ali: { label: '阿里推荐', baseUrl: 'https://dashscope.aliyuncs.com', models: ['wan2.6-i2v-flash'] },
    geeknow: {
      label: 'GeekNow Grok 视频',
      baseUrl: 'https://geek.closeai.icu',
      models: [
        'grok-video-3-pro',
        'grok-video-3-max',
        'grok-video-1.5-pro',
        'grok-video-1.5-max',
      ],
      hint: '与 GeekNow 图片共用 Base URL / API Key；Pro 固定 10s，Max 固定 15s；画幅 2:3 / 3:2 / 1:1',
    },
  },
  audio: {
    minimax: { label: '红果音频', baseUrl: 'https://api.chatfire.site/minimax', models: ['speech-2.8-hd'] },
  },
}
const huobaoPresetCards = [
  { serviceType: 'text', label: '文本', provider: 'chatfire', baseUrl: 'https://api.chatfire.site', model: 'gemini-3-pro-preview', priority: 100 },
  { serviceType: 'image', label: '图片', provider: 'gemini', baseUrl: 'https://api.chatfire.site', model: 'gemini-3-pro-image-preview', priority: 99 },
  { serviceType: 'video', label: '视频 · 火山官方 Seedance 2.0', provider: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com', model: 'doubao-seedance-2-0-260128', priority: 101 },
  { serviceType: 'video', label: '视频 · ChatFire Seedance 2.0', provider: 'volcengine', baseUrl: 'https://api.chatfire.site/volcengine', model: 'doubao-seedance-2-0-260128', priority: 100 },
  { serviceType: 'video', label: '视频 · Seedance 2.0 Fast', provider: 'volcengine', baseUrl: 'https://api.chatfire.site/volcengine', model: 'doubao-seedance-2-0-fast-260128', priority: 99 },
  { serviceType: 'video', label: '视频 · Seedance 1.5 Pro', provider: 'volcengine', baseUrl: 'https://api.chatfire.site/volcengine', model: 'doubao-seedance-1-5-pro-251215', priority: 98 },
  { serviceType: 'audio', label: '音频', provider: 'minimax', baseUrl: 'https://api.chatfire.site/minimax', model: 'speech-2.8-hd', priority: 97 },
]
const endpointPrefixes = {
  chatfire: '/v1',
  geeknow: '/v1',
  openai: '/v1',
  openrouter: '/v1',
  minimax: '/v1',
  gemini: '/v1beta',
  volcengine: '/api/v3',
  volcengine_proxy: '/api/v3',
  ali: '/compatible-mode/v1',
  'ali-intl': '/compatible-mode/v1',
  'ali-us': '/compatible-mode/v1',
  vidu: '/ent/v2',
  chengmeng: '/api',
  aistarslab: '/openapi',
}

const endpointHint = computed(() => {
  const provider = cfgForm.provider
  if (provider === 'aistarslab') return 'OpenAPI 端点由系统自动配置'
  const base = (cfgForm.base_url || 'https://...').replace(/\/+$/, '')
  if (!provider) return '选择服务商后显示推荐端点前缀'
  if (provider.startsWith('ali') && base.includes('/compatible-mode')) {
    return `${base}/chat/completions`
  }
  const prefix = endpointPrefixes[provider] || ''
  return `${base}${prefix}`
})

const aliProviderHint = computed(() => {
  if (!cfgForm.provider?.startsWith('ali') || cfgForm.service_type !== 'text') return ''
  return providerPresets.text[cfgForm.provider]?.hint || ''
})

const chengmengProviderHint = computed(() => {
  if (cfgForm.provider !== 'chengmeng' || cfgForm.service_type !== 'video') return ''
  return providerPresets.video.chengmeng?.hint || ''
})

const aistarslabProviderHint = computed(() => {
  if (cfgForm.provider !== 'aistarslab' || cfgForm.service_type !== 'video') return ''
  return providerPresets.video.aistarslab?.hint || ''
})

const showChengmengRemotePanel = computed(() =>
  cfgDialog.value && cfgForm.provider === 'chengmeng' && cfgForm.service_type === 'video',
)

const showAistarslabRemotePanel = computed(() =>
  cfgDialog.value && cfgForm.provider === 'aistarslab' && cfgForm.service_type === 'video',
)

const chengmengRemoteLoading = ref(false)
const chengmengRemoteError = ref('')
const chengmengRemoteModels = ref([])
const chengmengRemoteMeta = ref('')
let chengmengRemoteTimer = null

const aistarslabRemoteLoading = ref(false)
const aistarslabRemoteError = ref('')
const aistarslabRemoteChannels = ref([])
const aistarslabRemoteMeta = ref('')
let aistarslabRemoteTimer = null

function formatChengmengModelPrice(model) {
  if (model.credit_cost_flat != null) return `${model.credit_cost_flat} 积分/条（用户扣费）`
  if (model.base_price_yuan != null) return `上游约 ${model.base_price_yuan} 元/条`
  return '价格待配置'
}

async function loadChengmengRemoteConfig() {
  if (!showChengmengRemotePanel.value) return
  const apiKey = String(cfgForm.api_key || '').trim()
  const baseUrl = String(cfgForm.base_url || '').trim()
  if (!apiKey || apiKey === '********') {
    chengmengRemoteModels.value = []
    chengmengRemoteMeta.value = ''
    chengmengRemoteError.value = ''
    return
  }
  chengmengRemoteLoading.value = true
  chengmengRemoteError.value = ''
  try {
    const res = await aiConfigAPI.chengmengConfig({
      api_key: apiKey,
      base_url: baseUrl || undefined,
    })
    chengmengRemoteModels.value = res?.models || []
    chengmengRemoteMeta.value = `共 ${chengmengRemoteModels.value.length} 个模型；积分定价项已同步到「积分」页，可按 model_id 单独调价`
    if (Array.isArray(res?.model_ids) && res.model_ids.length) {
      const defaultModel = chengmengRemoteModels.value.find(item => item.default_option) || chengmengRemoteModels.value[0]
      cfgForm.modelStr = defaultModel
        ? `${defaultModel.model_id}, ${defaultModel.group_id}`
        : res.model_ids.join(', ')
    }
  } catch (err) {
    chengmengRemoteModels.value = []
    chengmengRemoteMeta.value = ''
    chengmengRemoteError.value = err?.message || '拉取模型列表失败'
  } finally {
    chengmengRemoteLoading.value = false
  }
}

function scheduleChengmengRemoteConfig() {
  if (chengmengRemoteTimer) clearTimeout(chengmengRemoteTimer)
  chengmengRemoteTimer = setTimeout(() => {
    chengmengRemoteTimer = null
    void loadChengmengRemoteConfig()
  }, 500)
}

function resetChengmengRemoteConfig() {
  if (chengmengRemoteTimer) {
    clearTimeout(chengmengRemoteTimer)
    chengmengRemoteTimer = null
  }
  chengmengRemoteLoading.value = false
  chengmengRemoteError.value = ''
  chengmengRemoteModels.value = []
  chengmengRemoteMeta.value = ''
}

function formatAistarslabModelPrice(model, channel) {
  if (model.credit_cost) {
    const upstream = model.upstream_credit_cost
      ? `，上游约 ${model.upstream_credit_cost}`
      : ''
    return `用户 ${model.credit_cost} 积分/条${upstream}`
  }
  if (model.fixed_total_credits) return `上游 ${model.fixed_total_credits} 积分/条`
  if (model.credits_per_second) {
    const sec = channel?.seconds_max || 15
    return `上游 ${model.credits_per_second} 积分/秒（约 ${Math.round(model.credits_per_second * sec)} 积分/${sec}秒）`
  }
  return '价格以官网为准'
}

async function loadAistarslabRemoteConfig() {
  if (!showAistarslabRemotePanel.value) return
  const apiKey = String(cfgForm.api_key || '').trim()
  const baseUrl = String(cfgForm.base_url || '').trim()
  if (!apiKey || apiKey === '********') {
    aistarslabRemoteChannels.value = []
    aistarslabRemoteMeta.value = ''
    aistarslabRemoteError.value = ''
    return
  }
  aistarslabRemoteLoading.value = true
  aistarslabRemoteError.value = ''
  try {
    const res = await aiConfigAPI.aistarslabConfig({
      api_key: apiKey,
      base_url: baseUrl || undefined,
    })
    const pricingByKey = Object.fromEntries(
      (res?.models || []).map(item => [`${item.channel}:${item.model}`, item]),
    )
    aistarslabRemoteChannels.value = (res?.channels || []).map(channel => ({
      ...channel,
      models: (channel.models || []).map(model => ({
        ...model,
        ...(pricingByKey[`${channel.channel}:${model.model}`] || {}),
      })),
    }))
    const mult = Number(res?.reference_video_multiplier)
    const channelCount = aistarslabRemoteChannels.value.length
    const modelCount = (res?.models || []).length
    aistarslabRemoteMeta.value = Number.isFinite(mult) && mult > 1
      ? `共 ${channelCount} 条线路、${modelCount} 个模型；参考视频消耗 ×${mult}；积分定价项已同步到「积分」页（默认用户价=上游×1.5，可按线路×模型单独调价）`
      : `共 ${channelCount} 条线路、${modelCount} 个模型；积分定价项已同步到「积分」页（默认用户价=上游×1.5）`
    if (Array.isArray(res?.model_ids) && res.model_ids.length) {
      cfgForm.modelStr = res.model_ids.join(', ')
    }
  } catch (err) {
    aistarslabRemoteChannels.value = []
    aistarslabRemoteMeta.value = ''
    aistarslabRemoteError.value = err?.message || '拉取模型列表失败'
  } finally {
    aistarslabRemoteLoading.value = false
  }
}

function scheduleAistarslabRemoteConfig() {
  if (aistarslabRemoteTimer) clearTimeout(aistarslabRemoteTimer)
  aistarslabRemoteTimer = setTimeout(() => {
    aistarslabRemoteTimer = null
    void loadAistarslabRemoteConfig()
  }, 500)
}

function resetAistarslabRemoteConfig() {
  if (aistarslabRemoteTimer) {
    clearTimeout(aistarslabRemoteTimer)
    aistarslabRemoteTimer = null
  }
  aistarslabRemoteLoading.value = false
  aistarslabRemoteError.value = ''
  aistarslabRemoteChannels.value = []
  aistarslabRemoteMeta.value = ''
}

watch(
  () => [cfgDialog.value, cfgForm.provider, cfgForm.service_type, cfgForm.api_key, cfgForm.base_url],
  () => {
    if (!showChengmengRemotePanel.value) {
      resetChengmengRemoteConfig()
    } else {
      scheduleChengmengRemoteConfig()
    }
    if (!showAistarslabRemotePanel.value) {
      resetAistarslabRemoteConfig()
      return
    }
    scheduleAistarslabRemoteConfig()
  },
)

const aliTextModelHint = {
  summary: '常用：qwen-plus（均衡推荐）、qwen-max（更强）、qwen-flash / qwen-turbo（更快更省）。Agent 工具调用建议 qwen-plus 或 qwen-max；列表第一个为默认模型。',
  docLabel: 'OpenAI 兼容模型列表',
  docUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
  extraLabel: '模型总览',
  extraUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/models',
}

const modelFieldHints = {
  text: {
    ali: aliTextModelHint,
    'ali-intl': aliTextModelHint,
    'ali-us': aliTextModelHint,
    chatfire: {
      summary: '填写 ChatFire 提供的模型 ID，逗号分隔；第一个为默认。模板示例：gemini-3-pro-preview。',
      docLabel: 'ChatFire 文档',
      docUrl: 'https://api.chatfire.site/',
    },
    openrouter: {
      summary: '格式为 OpenRouter 模型名，如 google/gemini-3-flash-preview。完整列表见 OpenRouter Models 页。',
      docLabel: 'OpenRouter 模型列表',
      docUrl: 'https://openrouter.ai/models',
    },
    openai: {
      summary: '填写 OpenAI 模型 ID，如 gpt-4.1-mini、gpt-4o。以 OpenAI 官方文档为准。',
      docLabel: 'OpenAI 模型文档',
      docUrl: 'https://platform.openai.com/docs/models',
    },
    default: {
      summary: '多个模型用英文逗号分隔；同配置中第一个为默认，Agent 可在高级配置里覆盖。',
    },
  },
  image: {
    geeknow: {
      summary: '默认模型 gpt-image-2；多个模型用逗号分隔，第一个为默认。图片尺寸请在各剧集工作台顶部设置。',
      docLabel: 'GeekNow 控制台',
      docUrl: 'https://geek.closeai.icu/',
    },
    openai: {
      summary: 'OpenAI 图像模型，如 dall-e-3、gpt-image-1；逗号分隔，第一个为默认。',
      docLabel: 'OpenAI 图像 API',
      docUrl: 'https://platform.openai.com/docs/api-reference/images',
    },
    ali: {
      summary: '视频/图像类 DashScope 模型，如 wan2.6-i2v-flash；与文本兼容接口模型不同，以百炼模型广场为准。',
      docLabel: '模型总览',
      docUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/models',
    },
    default: {
      summary: '填写该图像服务商支持的模型 ID，逗号分隔；第一个为默认。',
    },
  },
  video: {
    volcengine: {
      summary: 'Seedance 2.0：doubao-seedance-2-0-260128；2.0 Fast：doubao-seedance-2-0-fast-260128；1.5 Pro：doubao-seedance-1-5-pro-251215。逗号分隔，第一个为默认。',
      docLabel: '火山方舟 · 创建视频生成任务 API',
      docUrl: 'https://www.volcengine.com/docs/82379/1520757?lang=zh',
    },
    volcengine_proxy: {
      summary: 'ChatFire 等代理网关；模型 ID 与官方一致，Base URL 填代理地址。',
      docLabel: '火山方舟 · 创建视频生成任务 API',
      docUrl: 'https://www.volcengine.com/docs/82379/1520757?lang=zh',
    },
    chengmeng: {
      summary: '填写 model_id 与 group_id（默认 53, 15）。15 秒/条，8 元/条 = 800 积分/条；prompt 自动补 @图片1；参考图需公网 URL',
      docLabel: '橙盟 Seedance API 文档',
      docUrl: 'https://chengmeng.site/docu',
    },
    aistarslab: {
      summary: '模型 ID 见上方 API Key 区域实时列表；逗号分隔，第一个为默认。prompt 用 @图片N @视频N @音频N',
      docLabel: '接口文档',
      docUrl: 'https://my.feishu.cn/wiki/JP5HwMT3Vi67HDkpxgbcgQWVnYd',
    },
    geeknow: {
      summary: 'Grok 视频模型：grok-video-3-pro / grok-video-3-max / grok-video-1.5-pro / grok-video-1.5-max。可与图片通道共用 Base URL 与 Key。',
      docLabel: 'GeekNow Grok 视频 API',
      docUrl: 'https://docs.geeknow.top/api-reference/videos/grok/overview',
    },
    ali: {
      summary: '常用：wan2.6-i2v-flash 等图生视频模型；需在百炼开通对应模型。',
      docLabel: '模型总览',
      docUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/models',
    },
    default: {
      summary: '填写视频生成模型 ID，逗号分隔；第一个为默认。',
    },
  },
  audio: {
    default: {
      summary: '填写语音合成模型 ID，如 speech-2.8-hd；逗号分隔，第一个为默认。',
    },
  },
}

const modelFieldHint = computed(() => {
  const group = modelFieldHints[cfgForm.service_type]
  if (!group) return null
  const provider = cfgForm.provider
  if (provider?.startsWith('ali') && cfgForm.service_type === 'text') return group.ali
  return group[provider] || group.default || null
})

const modelInputPlaceholder = computed(() => {
  const preset = providerPresets[cfgForm.service_type]?.[cfgForm.provider]
  if (cfgForm.provider === 'chengmeng') return '53, 15（model_id, group_id）'
  if (preset?.models?.length) return preset.models.join(', ')
  return 'model-name'
})

function byType(t) { return cfgs.value.filter(c => c.service_type === t) }
function countActive(t) { return byType(t).filter(c => c.is_active).length }
function fmtModel(m) { return Array.isArray(m) ? m.join(', ') : m || '—' }
function providerLabel(provider) {
  return providerLabels[provider] || provider
}
function displayBaseUrl(provider, baseUrl) {
  if (provider === 'aistarslab') return '系统默认（自动配置）'
  return baseUrl || '未设置 Base URL'
}
function ensureAistarslabBaseUrl() {
  if (cfgForm.provider !== 'aistarslab') return
  const preset = providerPresets.video?.aistarslab
  if (!String(cfgForm.base_url || '').trim() && preset?.baseUrl) {
    cfgForm.base_url = preset.baseUrl
  }
}
function presetsByType(type) {
  const group = providerPresets[type] || {}
  return Object.entries(group).map(([provider, preset]) => ({ provider, ...preset }))
}
function applyProviderPreset(type, provider) {
  const preset = providerPresets[type]?.[provider]
  if (!preset) return
  cfgForm.provider = provider
  cfgForm.base_url = preset.baseUrl
  cfgForm.modelStr = preset.models.join(', ')
  cfgForm.name = `${preset.label}-${serviceMeta[type].label}`
  if (preset.defaultApiKey) cfgForm.api_key = preset.defaultApiKey
  if (provider === 'aistarslab') scheduleAistarslabRemoteConfig()
  if (provider === 'chengmeng') scheduleChengmengRemoteConfig()
}

async function loadCfgs() { try { cfgs.value = await aiConfigAPI.list() } catch (e) { toast.error(e.message) } }
async function toggleCfg(c) { await aiConfigAPI.update(c.id, { is_active: !c.is_active }); loadCfgs() }
async function delCfg(id) { await aiConfigAPI.del(id); toast.success('已删除'); loadCfgs() }
function startAddCfg(t) {
  cfgEditId.value = null
  cfgTestResult.value = null
  Object.assign(cfgForm, { name: '', provider: '', api_key: '', base_url: '', modelStr: '', service_type: t, priority: 0 })
  const firstPreset = presetsByType(t)[0]
  if (firstPreset) applyProviderPreset(t, firstPreset.provider)
  cfgDialog.value = true
}
function startEditCfg(c) {
  cfgEditId.value = c.id
  cfgTestResult.value = null
  Object.assign(cfgForm, {
    name: c.name || '',
    provider: c.provider,
    api_key: c.api_key || '',
    base_url: c.base_url || '',
    modelStr: fmtModel(c.model),
    service_type: c.service_type,
    priority: c.priority ?? 0,
  })
  cfgDialog.value = true
}
async function testCfgPayload(payload) {
  cfgTesting.value = true
  try {
    cfgTestResult.value = await aiConfigAPI.test(payload)
    if (cfgTestResult.value.reachable) toast.success('端点已响应')
    else toast.warning('端点未通过测试')
  } catch (e) {
    toast.error(e.message)
  } finally {
    cfgTesting.value = false
  }
}
async function testDraftCfg() {
  ensureAistarslabBaseUrl()
  await testCfgPayload({
    service_type: cfgForm.service_type,
    provider: cfgForm.provider,
    api_key: cfgForm.api_key,
    base_url: cfgForm.base_url,
    model: cfgForm.modelStr.split(',').map(s => s.trim()).filter(Boolean),
  })
}
async function testExistingCfg(c) {
  startEditCfg(c)
  await testCfgPayload({
    service_type: c.service_type,
    provider: c.provider,
    api_key: c.api_key || '',
    base_url: c.base_url || '',
    model: Array.isArray(c.model) ? c.model : [],
  })
}
async function saveCfg() {
  if (!cfgForm.provider) { toast.warning('选择服务商'); return }
  ensureAistarslabBaseUrl()
  const models = cfgForm.modelStr.split(',').map(s => s.trim()).filter(Boolean)
  try {
    if (cfgEditId.value) await aiConfigAPI.update(cfgEditId.value, { name: cfgForm.name, provider: cfgForm.provider, api_key: cfgForm.api_key, base_url: cfgForm.base_url, model: models, priority: cfgForm.priority })
    else await aiConfigAPI.create({ service_type: cfgForm.service_type, provider: cfgForm.provider, name: cfgForm.name || `${cfgForm.provider}-${cfgForm.service_type}`, api_key: cfgForm.api_key, base_url: cfgForm.base_url, model: models, priority: cfgForm.priority })
    cfgDialog.value = false; toast.success('已保存'); loadCfgs()
  } catch (e) { toast.error(e.message) }
}
async function applyHuobaoPreset() {
  if (!huobaoForm.apiKey) {
    toast.warning('请填写 API Key')
    return
  }
  try {
    await aiConfigAPI.huobaoPreset(huobaoForm.apiKey)
    await loadCfgs()
    await loadAgents()
    presetDialog.value = false
    toast.success('红果推荐配置与默认 Agent LLM 已写入')
  } catch (e) {
    toast.error(e.message)
  }
}

// ===== Agent Configs =====
const agentCfgs = ref([])
const editingAgent = ref(null)
const agentSaving = ref(false)
const agentSaved = ref(null)
const AGENT_DEFAULT_MAX_TOKENS = {
  shot_plan_generator: 32768,
}

const agentForm = reactive({ model: '', temperature: 0.7, max_tokens: 4096, system_prompt: '' })

const agentDefs = [
  { type: 'script_rewriter', label: '剧本改写', icon: '📝' },
  { type: 'extractor', label: '角色场景提取', icon: '🔍' },
  { type: 'shot_plan_generator', label: '工业镜头列表', icon: '🎞' },
  { type: 'storyboard_breaker', label: '分镜拆解', icon: '🎬' },
  { type: 'voice_assigner', label: '音色分配', icon: '🎙' },
  { type: 'grid_prompt_generator', label: '图片提示词生成', icon: '🖼' },
]

const defaultPrompts = {
  script_rewriter: `你是专业编剧，擅长将小说改编为短剧剧本。

工作流程：
1. 调用 read_episode_script 读取原始内容
2. 根据读取到的内容，自己进行改写（输出格式化剧本格式）
3. 调用 save_script 保存改写后的完整剧本

格式化剧本格式：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言
- 对白：角色名：（状态/表情）台词内容
- 每个场景 30-60 秒内容`,
  extractor: `你是制片助理，擅长从剧本中提取角色和场景信息，并在提取时与项目已有数据进行智能去重。

工作流程：
1. 调用 read_script_for_extraction 读取格式化剧本
2. 调用 read_existing_characters 读取项目中已存在的角色列表（用于去重）
3. 调用 read_existing_scenes 读取项目中已存在的场景列表（用于去重）
4. 分析剧本内容，提取所有角色信息
5. 对每个角色：若同名已存在则合并更新，若不存在则新增
6. 调用 save_dedup_characters 保存角色（去重合并，自动处理新增和更新）
7. 分析剧本内容，提取所有场景信息
8. 对每个场景：若同地点+时间段已存在则复用，若不存在则新增
9. 调用 save_dedup_scenes 保存场景（去重合并，自动处理新增和复用）

去重规则：
- 角色：按名字精确匹配，同名保留现有（合并信息）
- 场景：按【地点+时间段】精确匹配；同地点不同时段视为新场景

提取要求：
- 角色要包含完整的外貌特征描述（发型、服装、体态等）
- 场景要包含光线、色调、氛围等视觉信息
- 不要遗漏任何有台词或重要动作的角色`,
  shot_plan_generator: `你是红果竖屏短剧工业分镜生成 Agent。

工作流程：
1. 调用 read_shot_plan_context 读取剧本、角色库（R01…）、场景库（S01…）
2. 按工业分镜规范生成完整 1-3 秒微镜头列表，覆盖全部剧本情节
3. 调用 import_industrial_script 导入生成结果

注意：禁止输出模板占位符；必须调用 import_industrial_script 完成导入。`,
  storyboard_breaker: `你是资深影视分镜师，擅长将剧本拆解为分镜方案。

工作流程：
1. 调用 read_storyboard_context 读取剧本、角色列表、场景列表
2. 将剧本拆解为镜头序列（每个镜头 10-15 秒）
3. 为每个镜头生成视频提示词（video_prompt）
4. 调用 save_storyboards 保存所有分镜`,
  voice_assigner: `你是配音导演，擅长为角色选择合适的音色。

工作流程：
1. 调用 list_voices 获取可用音色列表
2. 调用 get_characters 获取所有角色信息
3. 根据每个角色的性别、性格、年龄、角色定位，选择最匹配的音色
4. 对每个角色调用 assign_voice 分配音色，并说明选择理由

注意：每个角色都必须分配音色，不要遗漏。`,
  grid_prompt_generator: `你是专业的 AI 图像提示词工程师，擅长为角色、场景和宫格图生成高质量的英文提示词。

你将收到用户的请求，告知要生成哪种类型的提示词：
- "角色" → 生成角色图片提示词
- "场景" → 生成场景图片提示词
- "宫格" → 生成宫格图提示词

## 角色图片提示词

工作流程：
1. 调用 read_characters 读取所有角色信息
2. 根据角色外貌特征（appearance）、性格（personality）、定位（role）生成英文提示词
3. 提示词结构：[外貌描述]，[性格/气质]，[角色定位]，[电影感]，[高质量]，[无文字水印]

## 场景图片提示词

工作流程：
1. 调用 read_scenes 读取所有场景信息
2. 根据场景地点（location）、时间段（time）、已有描述（prompt）生成英文提示词
3. 提示词结构：[地点]，[时间/光线/氛围]，[已有描述]，[电影感场景]，[高质量]，[无文字水印]

## 宫格图提示词（参考 skills/grid-image-generator/SKILL.md）

工作流程：
1. 调用 read_shots_for_grid 读取选中镜头的详细信息
2. 根据 mode 调用 generate_grid_prompt：
   - first_frame 模式：每格=一个镜头的首帧，NxN 风格统一
   - first_last 模式：每个镜头占2格（左首右尾），同一行风格连续
   - multi_ref 模式：所有格子都是同一镜头的不同参考角度
3. 返回 grid_prompt（整体提示词）和 cell_prompts（每格提示词）

提示词规范：
- 使用英文提示词
- 必须包含 "consistent art style" 保持风格统一
- 必须包含 "cinematic quality"
- 避免出现文字或水印`,
}

function getAgentCfg(type) {
  return agentCfgs.value.find(a => a.agent_type === type)
}

const textModelGroups = computed(() => {
  return cfgs.value
    .filter(c => c.service_type === 'text' && c.is_active && c.api_key)
    .map(c => ({
      label: `${c.provider} — ${c.name}`,
      models: Array.isArray(c.model) ? c.model : (c.model ? [c.model] : []),
    }))
    .filter(g => g.models.length > 0)
})

const textModelSelectOptions = computed(() =>
  textModelGroups.value.map(g => ({
    label: g.label,
    options: g.models.map(m => ({ label: m, value: m })),
  }))
)

async function loadAgents() {
  try { agentCfgs.value = await agentConfigAPI.list() }
  catch (e) { toast.error(e.message) }
}

function toggleAgentEdit(type) {
  if (editingAgent.value === type) { editingAgent.value = null; return }
  const cfg = getAgentCfg(type)
  agentForm.model = cfg?.model || ''
  agentForm.temperature = cfg?.temperature ?? 0.7
  agentForm.max_tokens = cfg?.max_tokens ?? AGENT_DEFAULT_MAX_TOKENS[type] ?? 4096
  agentForm.system_prompt = cfg?.system_prompt || defaultPrompts[type] || ''
  agentSaved.value = null
  editingAgent.value = type
}

function resetAgentPrompt(type) {
  agentForm.system_prompt = defaultPrompts[type] || ''
  toast.info('已恢复默认提示词，点击保存生效')
}

async function saveAgentCfg(type) {
  agentSaving.value = true
  agentSaved.value = null
  try {
    const existing = getAgentCfg(type)
    const data = {
      agent_type: type,
      name: agentDefs.find(a => a.type === type)?.label || type,
      model: agentForm.model,
      temperature: agentForm.temperature,
      max_tokens: agentForm.max_tokens,
      system_prompt: agentForm.system_prompt,
    }
    if (existing) {
      await agentConfigAPI.update(existing.id, data)
    } else {
      await agentConfigAPI.create(data)
    }
    await loadAgents()
    agentSaved.value = type
    toast.success(`${agentDefs.find(a => a.type === type)?.label} 配置已保存`)
    setTimeout(() => { if (agentSaved.value === type) agentSaved.value = null }, 3000)
  } catch (e) {
    toast.error(e.message)
  } finally {
    agentSaving.value = false
  }
}

// ===== Skills =====
const selectedAgent = ref('script_rewriter')
const allSkills = ref([])   // { id, name, description }[]
const editingSkill = ref(null)
const skillContent = ref('')
const skillSaving = ref(false)
const skillSaved = ref(null)
const addSkillDialog = ref(false)
const newSkillForm = reactive({ id: '', name: '', description: '' })

const selectedAgentType = computed(() => selectedAgent.value)
const selectedAgentLabel = computed(() => agentDefs.find(a => a.type === selectedAgent.value)?.label || '')
const selectedAgentIcon = computed(() => agentDefs.find(a => a.type === selectedAgent.value)?.icon || '')

function agentSkillCount(type) {
  return allSkills.value.filter(s => s.id === type || s.id.startsWith(type + '/')).length
}

const currentSkills = computed(() =>
  allSkills.value.filter(s => s.id === selectedAgent.value || s.id.startsWith(selectedAgent.value + '/'))
)

async function loadAllSkills() {
  try { allSkills.value = await skillsAPI.list() }
  catch (e) { toast.error(e.message) }
}

async function selectAgent(type) {
  selectedAgent.value = type
  editingSkill.value = null
}

function startAddSkill() {
  newSkillForm.id = ''
  newSkillForm.name = ''
  newSkillForm.description = ''
  addSkillDialog.value = true
}

async function confirmAddSkill() {
  if (!newSkillForm.id) return
  const skillId = `${selectedAgent.value}/${newSkillForm.id}`
  try {
    await skillsAPI.create({ id: skillId, name: newSkillForm.name, description: newSkillForm.description })
    addSkillDialog.value = false
    await loadAllSkills()
    toast.success('Skill 创建成功')
  } catch (e) {
    toast.error(e.message)
  }
}

async function deleteSkill(id) {
  if (!confirm(`确定删除 Skill「${id}」？`)) return
  try {
    await skillsAPI.del(id)
    if (editingSkill.value === id) editingSkill.value = null
    await loadAllSkills()
    toast.success('已删除')
  } catch (e) {
    toast.error(e.message)
  }
}

async function toggleSkillEdit(id) {
  if (editingSkill.value === id) { editingSkill.value = null; return }
  try {
    const res = await skillsAPI.get(id)
    skillContent.value = res.content
    skillSaved.value = null
    editingSkill.value = id
  } catch (e) { toast.error(e.message) }
}

async function saveSkill(id) {
  skillSaving.value = true
  skillSaved.value = null
  try {
    await skillsAPI.update(id, skillContent.value)
    await loadAllSkills()
    skillSaved.value = id
    toast.success(`已保存`)
    setTimeout(() => { if (skillSaved.value === id) skillSaved.value = null }, 3000)
  } catch (e) {
    toast.error(e.message)
  } finally {
    skillSaving.value = false
  }
}

// ===== Credits =====
const creditPricing = ref([])
const aistarslabChannelEnabled = ref({})
const chengmengModelEnabled = ref({})
const aistarslabChannelSaving = ref('')
const chengmengModelSaving = ref('')
const videoChannelGuide = VIDEO_CHANNEL_ADMIN_GUIDE
const grantForm = reactive({ user_id: null, amount: 1000, summary: '' })

const AISTARSLAB_CHANNEL_ACTION_RE = /^video\.generate\.aistarslab\.(\d+)\./i

function parseChengmengModelFromAction(action) {
  const key = String(action || '')
  if (key === 'video.generate.chengmeng') return '53'
  if (key === 'video.generate.chengmeng_seedance2') return '32'
  const m = key.match(/^video\.generate\.chengmeng\.(\d+)$/i)
  return m?.[1] ?? null
}

function isChengmengPricingAction(action) {
  return !!parseChengmengModelFromAction(action)
}

function parseAistarslabChannelFromAction(action) {
  const m = String(action || '').match(AISTARSLAB_CHANNEL_ACTION_RE)
  return m?.[1] ?? null
}

const chengmengPricingGroups = computed(() => {
  const map = new Map()
  for (const item of creditPricing.value) {
    const modelId = parseChengmengModelFromAction(item.action)
    if (!modelId) continue
    if (!map.has(modelId)) {
      map.set(modelId, {
        modelId,
        title: String(item.label || '').trim() || `模型 ${modelId}`,
        items: [],
      })
    }
    map.get(modelId).items.push(item)
  }
  return [...map.values()]
    .sort((a, b) => Number(a.modelId) - Number(b.modelId))
    .map(group => ({
      ...group,
      enabled: chengmengModelEnabled.value[group.modelId] !== false,
    }))
})

const aistarslabPricingGroups = computed(() => {
  const map = new Map()
  for (const item of creditPricing.value) {
    const channel = parseAistarslabChannelFromAction(item.action)
    if (!channel) continue
    if (!map.has(channel)) {
      const title = String(item.label || '')
        .split('·')[0]
        ?.replace(/^VIP\s*/i, '')
        .trim() || `线路 ${channel}`
      map.set(channel, { channel, title, items: [] })
    }
    map.get(channel).items.push(item)
  }
  return [...map.values()]
    .sort((a, b) => Number(a.channel) - Number(b.channel))
    .map(group => ({
      ...group,
      enabled: aistarslabChannelEnabled.value[group.channel] !== false,
    }))
})

const generalCreditPricing = computed(() =>
  creditPricing.value.filter(item =>
    !parseAistarslabChannelFromAction(item.action)
    && !isChengmengPricingAction(item.action)
    && !isJimengPricingAction(item.action)
    && item.action !== 'video.generate.doubao_training',
  ),
)

const jimengPricingItems = computed(() =>
  creditPricing.value
    .filter(item => isJimengPricingAction(item.action) && item.action !== 'video.generate.jimeng')
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
)

function isJimengPricingAction(action) {
  const key = String(action || '')
  return key === 'video.generate.jimeng'
    || key === 'video.generate.jimeng.seedance2_fast'
    || key === 'video.generate.jimeng.seedance2'
}

async function loadCreditPricing() {
  try {
    const res = await creditsAPI.pricing()
    creditPricing.value = res.items || []
    aistarslabChannelEnabled.value = { ...(res.aistarslab_channel_enabled || {}) }
    chengmengModelEnabled.value = { ...(res.chengmeng_model_enabled || {}) }
  } catch (e) {
    toast.error(e.message)
  }
}

async function toggleChengmengModel(group) {
  const nextEnabled = !group.enabled
  chengmengModelSaving.value = group.modelId
  try {
    await creditsAPI.setChengmengModelEnabled(group.modelId, nextEnabled)
    chengmengModelEnabled.value = {
      ...chengmengModelEnabled.value,
      [group.modelId]: nextEnabled,
    }
    toast.success(`模型 ${group.modelId} 已${nextEnabled ? '启用' : '禁用'}`)
  } catch (e) {
    toast.error(e.message)
  } finally {
    chengmengModelSaving.value = ''
  }
}

async function toggleAistarslabChannel(group) {
  const nextEnabled = !group.enabled
  aistarslabChannelSaving.value = group.channel
  try {
    await creditsAPI.setAistarslabChannelEnabled(group.channel, nextEnabled)
    aistarslabChannelEnabled.value = {
      ...aistarslabChannelEnabled.value,
      [group.channel]: nextEnabled,
    }
    toast.success(`线路 ${group.channel} 已${nextEnabled ? '启用' : '禁用'}`)
  } catch (e) {
    toast.error(e.message)
  } finally {
    aistarslabChannelSaving.value = ''
  }
}

const FLAT_VIDEO_PRICING_ACTIONS = new Set([
  'video.generate.chengmeng',
  'video.generate.chengmeng_seedance2',
  'video.generate.grok.1_5_pro',
  'video.generate.grok.1_5_max',
  'video.generate.grok.3_pro',
  'video.generate.grok.3_max',
  'video.generate.jimeng',
  'video.generate.jimeng.seedance2_fast',
  'video.generate.jimeng.seedance2',
  'video.generate.doubao_training',
  'video.generate.aistarslab',
])

function pricingUnit(action) {
  if (FLAT_VIDEO_PRICING_ACTIONS.has(action)) return '积分/条'
  if (/^video\.generate\.chengmeng\.\d+$/.test(String(action || ''))) return '积分/条'
  if (/^video\.generate\.aistarslab\.\d+\.[a-z0-9-]+$/i.test(String(action || ''))) return '积分/条'
  if (action === 'video.generate' || action === 'video.generate.seedance2' || action === 'video.generate.seedance2_fast') {
    return '积分/秒'
  }
  return '积分/次'
}

async function savePricing(item) {
  try {
    await creditsAPI.updatePricing(item.action, {
      cost: Number(item.cost) || 0,
      label: item.label,
      description: item.description,
    })
    toast.success(`已更新：${item.label}`)
  } catch (e) {
    toast.error(e.message)
  }
}

async function grantCredits() {
  if (!grantForm.user_id || !grantForm.amount) return
  try {
    await creditsAPI.grant({
      user_id: grantForm.user_id,
      amount: grantForm.amount,
      summary: grantForm.summary.trim() || undefined,
    })
    toast.success('充值成功')
    grantForm.amount = 1000
    grantForm.summary = ''
    await loadTeamUsers()
  } catch (e) {
    toast.error(e.message)
  }
}

watch(tab, (value) => {
  if (!isAdmin.value && value !== 'team') {
    tab.value = 'team'
    return
  }
  if (value === 'credits' && isAdmin.value) {
    loadCreditPricing()
    loadTeamUsers()
  }
  if (value === 'team') {
    syncRenameForm()
    if (canManageMembers.value) loadTeamMembers()
  }
})

// ===== Team =====
const newTeamName = ref('')
const renameTeamName = ref('')
const creatingTeam = ref(false)
const renamingTeam = ref(false)

function syncRenameForm() {
  renameTeamName.value = activeTeam.value?.name || ''
}

watch(activeTeam, () => syncRenameForm())

async function createTeam() {
  const name = newTeamName.value.trim()
  if (!name) return
  try {
    creatingTeam.value = true
    const team = await teamsAPI.create(name)
    await refreshTeams()
    selectTeam(team.id)
    newTeamName.value = ''
    syncRenameForm()
    if (canManageMembers.value) await loadTeamMembers()
    toast.success(`团队「${team.name}」已创建`)
  } catch (e) {
    toast.error(e.message)
  } finally {
    creatingTeam.value = false
  }
}

async function renameTeam() {
  if (!activeTeamId.value) return
  const name = renameTeamName.value.trim()
  if (!name || name === activeTeam.value?.name) return
  try {
    renamingTeam.value = true
    await teamsAPI.update(activeTeamId.value, { name })
    await refreshTeams()
    toast.success('团队名称已更新')
  } catch (e) {
    toast.error(e.message)
  } finally {
    renamingTeam.value = false
  }
}

// ===== Team members =====
const teamMembers = ref([])
const memberForm = reactive({ username: '', role: 'member' })

function teamRoleLabel(role) {
  if (role === 'owner') return '所有者'
  if (role === 'admin') return '管理员'
  return '成员'
}

function canEditMember(m) {
  if (isAdmin.value) return m.role !== 'owner' || m.user_id === user.value?.id
  return canManageTeam.value && m.role !== 'owner'
}

function canRemoveMember(m) {
  if (m.user_id === user.value?.id) return false
  if (m.role === 'owner') return false
  return canManageTeam.value || isAdmin.value
}

async function loadTeamMembers() {
  if (!activeTeamId.value) return
  try {
    const res = await teamsAPI.members(activeTeamId.value)
    teamMembers.value = res.items || []
  } catch (e) {
    toast.error(e.message)
  }
}

async function addTeamMember() {
  if (!activeTeamId.value) return
  try {
    await teamsAPI.addMember(activeTeamId.value, {
      username: memberForm.username.trim(),
      role: memberForm.role,
    })
    toast.success('成员已添加')
    memberForm.username = ''
    memberForm.role = 'member'
    loadTeamMembers()
  } catch (e) {
    toast.error(e.message)
  }
}

async function updateMemberRole(m, e) {
  if (!activeTeamId.value) return
  const role = e.target.value
  try {
    await teamsAPI.updateMember(activeTeamId.value, m.user_id, role)
    m.role = role
    toast.success('角色已更新')
  } catch (err) {
    toast.error(err.message)
    loadTeamMembers()
  }
}

async function removeMember(m) {
  if (!activeTeamId.value) return
  if (!confirm(`确定将 ${m.username} 移出团队？`)) return
  try {
    await teamsAPI.removeMember(activeTeamId.value, m.user_id)
    toast.success('已移除成员')
    loadTeamMembers()
  } catch (e) {
    toast.error(e.message)
  }
}

// ===== Users =====
const teamUsers = ref([])
const userForm = reactive({ username: '', password: '', display_name: '', role: 'user' })

function fmtUserTime(s) {
  return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function loadTeamUsers() {
  try {
    const res = await usersAPI.list()
    teamUsers.value = res.items || []
  } catch (e) {
    toast.error(e.message)
  }
}

async function createTeamUser() {
  try {
    await usersAPI.create({
      username: userForm.username.trim(),
      password: userForm.password,
      display_name: userForm.display_name.trim() || userForm.username.trim(),
      role: userForm.role,
    })
    toast.success('用户已创建')
    userForm.username = ''
    userForm.password = ''
    userForm.display_name = ''
    userForm.role = 'user'
    loadTeamUsers()
  } catch (e) {
    toast.error(e.message)
  }
}

onMounted(() => {
  if (isAdmin.value) {
    loadCfgs()
    loadAgents()
    loadAllSkills()
    loadTeamUsers()
    loadJimengSessionStatus()
    loadDoubaoTrainingSessionStatus()
  }
  if (canManageMembers.value) {
    refreshTeams()
    loadTeamMembers()
  }
})
</script>

<style scoped>
.user-create-form {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto auto;
  gap: 10px;
  margin-top: 12px;
}
.team-member-form {
  grid-template-columns: 1fr 160px auto;
}
.team-name-form {
  grid-template-columns: 1fr auto;
  max-width: 480px;
}
@media (max-width: 900px) {
  .user-create-form { grid-template-columns: 1fr 1fr; }
  .team-member-form { grid-template-columns: 1fr; }
  .team-name-form { grid-template-columns: 1fr; max-width: none; }
}
.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 12px;
}
.user-table th, .user-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.user-table th { color: var(--text-3); font-size: 12px; font-weight: 500; }

.setup-pricing-hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
}

.video-channel-guide-table td {
  vertical-align: top;
  font-size: 13px;
  line-height: 1.45;
}

.pricing-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pricing-cost-input {
  width: 140px;
  min-width: 140px;
  flex-shrink: 0;
}

.pricing-unit {
  font-size: 12px;
  white-space: nowrap;
}

.jimeng-session-panel .setup-panel-head.compact {
  align-items: flex-start;
}

.jimeng-session-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.jimeng-cookie-hint {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-2);
}

.jimeng-cookie-hint code {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.jimeng-session-input {
  width: 100%;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-1);
  font-size: 12px;
  line-height: 1.5;
  font-family: var(--font-mono, monospace);
  resize: vertical;
}

.jimeng-session-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.jimeng-session-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.jimeng-session-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-1);
}

.jimeng-session-row.active {
  border-color: var(--accent, #6366f1);
}

.jimeng-session-row-main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.jimeng-session-row-label {
  font-weight: 600;
  font-size: 13px;
}

.jimeng-session-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jimeng-session-label {
  min-width: 160px;
  flex: 1;
  max-width: 240px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-1);
  font-size: 12px;
}

.settings-layout { display: flex; height: 100%; background: var(--bg-base); }

.settings-nav {
  width: 240px; flex-shrink: 0; padding: 16px 10px; border-right: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 14px; background: var(--bg-0);
}
.nav-group { display: flex; flex-direction: column; gap: 4px; }
.nav-group-label {
  font-size: 11px; font-weight: 800; color: var(--text-0);
  letter-spacing: 0.06em; text-transform: uppercase; padding: 0 10px 4px;
}
.nav-item {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-size: 15px;
  border: none; background: none; color: var(--text-0); font-weight: 600; cursor: pointer;
  border-radius: var(--radius); transition: all 0.12s; text-align: left; width: 100%;
}
.nav-item:hover { background: var(--bg-hover); color: var(--text-0); }
.nav-item.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; box-shadow: var(--shadow-card); }
.nav-advanced {
  padding: 12px 8px;
  border-top: 1px solid rgba(27, 41, 64, 0.08);
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
}
.advanced-toggle {
  display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px;
  font-size: 12px; color: var(--text-2);
}
.advanced-toggle input { display: none; }
.advanced-slider {
  position: relative; width: 38px; height: 22px; border-radius: 999px;
  background: rgba(27, 41, 64, 0.12); transition: background 0.18s ease;
}
.advanced-slider::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(18, 24, 38, 0.18); transition: transform 0.18s ease;
}
.advanced-toggle input:checked + .advanced-slider { background: var(--accent); }
.advanced-toggle input:checked + .advanced-slider::after { transform: translateX(16px); }
.advanced-note {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-3);
}

.settings-content { flex: 1; overflow: hidden; }
.settings-scroll { height: 100%; overflow-y: auto; padding: 36px 48px; max-width: 840px; margin: 0 auto; animation: fadeUp 0.3s var(--ease-out); }
.settings-head { margin-bottom: 24px; }
.settings-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.settings-brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 15px;
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(242,247,255,0.9));
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}
.settings-brand-logo {
  width: 26px;
  height: 26px;
  object-fit: contain;
  display: block;
}
.settings-brand-fallback {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  color: var(--accent-text);
  line-height: 1;
}
.settings-brand-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  line-height: 1;
}
.settings-brand-kicker {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-3);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.settings-brand-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-1);
  font-family: var(--font-display);
}
.settings-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.settings-desc { font-size: 13px; color: var(--text-2); margin-top: 4px; }

/* AI Config */
.setup-panel {
  padding: 18px 18px 16px;
  margin-bottom: 18px;
}
.setup-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.setup-panel-head.compact { margin-bottom: 12px; }
.setup-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 4px;
}
.setup-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-0);
}
.setup-desc {
  font-size: 12px;
  color: var(--text-2);
  margin-top: 4px;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.preset-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 8px;
}
.preset-card {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(255,255,255,0.82);
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preset-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.preset-service { font-size: 12px; font-weight: 600; }
.preset-model { font-size: 12px; color: var(--text-1); }
.preset-base { font-size: 11px; color: var(--text-3); }
.template-row { display: flex; flex-wrap: wrap; gap: 8px; }
.template-type-chip {
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.82);
  color: var(--text-1);
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: 0.15s;
}
.template-type-chip:hover {
  border-color: var(--accent);
  color: var(--accent-text);
  background: var(--accent-bg);
}
.sections { display: flex; flex-direction: column; gap: 24px; }
.section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.section-title { font-size: 13px; font-weight: 600; }
.section-subtitle { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.config-list { display: flex; flex-direction: column; gap: 6px; }
.config-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; }
.config-info { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.config-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.config-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.config-provider { font-size: 13px; font-weight: 600; }
.config-name { font-size: 12px; color: var(--text-2); }
.config-model { font-size: 11px; color: var(--text-2); }
.config-base { font-size: 11px; color: var(--text-3); }
.config-empty { font-size: 12px; color: var(--text-3); padding: 12px 0; }

.toggle { position: relative; width: 30px; height: 17px; cursor: pointer; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle span { position: absolute; inset: 0; background: var(--bg-3); border-radius: 99px; transition: 0.2s; }
.toggle span::before { content: ''; position: absolute; width: 13px; height: 13px; left: 2px; bottom: 2px; background: var(--bg-0); border-radius: 50%; transition: 0.2s; box-shadow: var(--shadow); }
.toggle input:checked + span { background: var(--accent); }
.toggle input:checked + span::before { transform: translateX(13px); }

/* Agent */
.agent-list { display: flex; flex-direction: column; gap: 8px; }
.agent-card { overflow: hidden; }
.agent-card-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; cursor: pointer; transition: background 0.1s; }
.agent-card-head:hover { background: var(--bg-hover); }
.agent-type-badge { width: 36px; height: 36px; border-radius: var(--radius); background: var(--accent-bg); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.agent-card-body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--border); padding-top: 16px; }
.agent-card-foot { display: flex; align-items: center; gap: 8px; padding-top: 8px; }

/* Skills 布局 */
.skills-layout { display: flex; height: 100%; overflow: hidden; }
.skills-agent-list {
  width: 200px; flex-shrink: 0; border-right: 1px solid var(--border);
  background: var(--bg-1); display: flex; flex-direction: column;
  overflow-y: auto;
}
.skills-agent-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--text-3); padding: 14px 14px 8px;
}
.skills-agent-item {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; font-size: 13px; cursor: pointer;
  border: none; background: none; color: var(--text-2);
  transition: all 0.12s; width: 100%; text-align: left;
  border-radius: 0;
}
.skills-agent-item:hover { background: var(--bg-hover); color: var(--text-0); }
.skills-agent-item.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }
.skills-agent-label { flex: 1; }
.skill-count-badge {
  font-size: 10px; font-weight: 700; font-family: var(--font-mono);
  background: var(--accent-bg); color: var(--accent-text);
  padding: 1px 5px; border-radius: 99px;
}
.skills-agent-item.active .skill-count-badge { background: rgba(255,255,255,0.2); color: inherit; }
.skills-main { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.skills-main .settings-scroll { max-width: 900px; }

/* Skill */
.skill-list { display: flex; flex-direction: column; gap: 8px; }
.skill-card { overflow: hidden; }
.skill-card-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; transition: background 0.1s; }
.skill-card-head:hover { background: var(--bg-hover); }
.skill-card-body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px; }
.skill-card-foot { display: flex; align-items: center; gap: 8px; }

/* Shared */
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 12px; font-weight: 500; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.overlay { position: fixed; inset: 0; background: rgba(34,45,66,0.32); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 100; animation: fadeIn 0.18s var(--ease-out); }
.modal { padding: 28px; width: 420px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-elevated); }
.modal-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 6px; }
.config-modal { width: min(720px, calc(100vw - 40px)); max-height: calc(100vh - 48px); overflow-y: auto; }
.config-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.modal-note {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-2);
}
.preset-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preset-pill {
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.72);
  color: var(--text-1);
  border-radius: 999px;
  padding: 8px 11px;
  font-size: 12px;
  cursor: pointer;
}
.preset-pill:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent-text);
}
.endpoint-hint {
  margin-top: -4px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px dashed var(--border);
  background: rgba(244,248,255,0.72);
  font-size: 12px;
}
.test-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 14px;
  padding: 12px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.72);
}
.test-result.ok { border-color: rgba(74, 167, 92, 0.28); }
.test-result.bad { border-color: rgba(201, 88, 68, 0.28); }
.test-result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-1);
}
.test-result-url,
.test-result-preview {
  font-size: 11px;
  color: var(--text-3);
  word-break: break-all;
}
.huobao-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 10px;
}
.huobao-grid .field-hint a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}
.huobao-grid .field-hint a:hover {
  text-decoration: underline;
}
.field-hint a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}
.field-hint a:hover {
  text-decoration: underline;
}

.aistarslab-pricing-table .aistarslab-pricing-channel-row td {
  background: var(--surface-2, rgba(255, 255, 255, 0.04));
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  padding-top: 12px;
  padding-bottom: 8px;
}
.aistarslab-pricing-channel-title {
  margin-left: 8px;
  font-weight: 600;
}
.aistarslab-pricing-action {
  font-size: 11px;
  margin-top: 2px;
  word-break: break-all;
}
.aistarslab-pricing-model-disabled td {
  opacity: 0.55;
}
.aistarslab-remote-panel {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-1);
}

.aistarslab-remote-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.aistarslab-remote-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.aistarslab-remote-error {
  margin: 0;
  font-size: 12px;
  color: #e57373;
}

.aistarslab-remote-channel + .aistarslab-remote-channel {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}

.aistarslab-remote-channel-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

.aistarslab-remote-desc,
.aistarslab-remote-meta-line {
  margin: 0 0 6px;
  font-size: 11px;
  line-height: 1.5;
}

.aistarslab-remote-models {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}

.aistarslab-remote-models li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 1.4;
}

.aistarslab-remote-models code {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--bg-2);
}

@media (max-width: 900px) {
  .preset-grid,
  .preset-grid.compact {
    grid-template-columns: 1fr;
  }
}
</style>
