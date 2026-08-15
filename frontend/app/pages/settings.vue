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
              <img v-if="showBrandImage" :src="brandLogo" alt="影光工场" class="settings-brand-logo" @error="showBrandImage = false" />
              <span v-else class="settings-brand-fallback">红</span>
            </div>
            <div class="settings-brand-copy">
              <div class="settings-brand-kicker">Yingguang Studio</div>
              <div class="settings-brand-name">影光工场</div>
            </div>
          </div>
          <h2 class="settings-title">AI 服务配置</h2>
          <p class="settings-desc">先用推荐模板快速落配置，再按服务类型微调。工作台创建集时会锁定所选图片、视频和音频能力。</p>
        </div>
        <section class="setup-panel card">
          <div class="setup-panel-head">
            <div>
              <div class="setup-kicker">Quick Setup</div>
              <div class="setup-title">影光工场推荐配置</div>
              <div class="setup-desc">一键写入文本、图片、视频、音频四类推荐配置，适合作为开箱默认方案。</div>
            </div>
            <button class="btn btn-primary" @click="presetDialog = true">
              <Sparkles :size="14" /> 影光工场一键配置
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
              <div class="setup-kicker">通道1</div>
              <div class="setup-title">橙盟上游余额</div>
              <div class="setup-desc">
                读取橙盟 <code>/api/user/balance</code>；明细为上游任务列表中的实际扣费（元）。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span v-if="chengmengBalanceAccounts.length" class="mono dim">{{ chengmengBalanceAccounts.length }} 个账号</span>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="chengmengBalanceLoading"
                @click="loadChengmengBalance"
              >
                {{ chengmengBalanceLoading ? '刷新中…' : '刷新余额' }}
              </button>
            </div>
          </div>
          <p v-if="chengmengBalanceError" class="aistarslab-remote-error">{{ chengmengBalanceError }}</p>
          <p v-else-if="chengmengBalanceLoading" class="dim setup-desc">正在拉取橙盟余额与任务明细…</p>
          <div v-if="chengmengBalanceAccounts.length" class="jimeng-session-list">
            <div
              v-for="item in chengmengBalanceAccounts"
              :key="item.config_id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.name || `配置 #${item.config_id}` }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
                <span
                  v-if="item.balance"
                  class="tag tag-success jimeng-credit-tag"
                  :title="`累计充值 ${item.balance.total_recharge} · 累计消耗 ${item.balance.total_spent} · 冻结 ${item.balance.frozen_balance}`"
                >
                  可用 {{ formatUpstreamMoney(item.balance.available_balance) }} 元
                </span>
                <span v-else-if="item.error" class="tag">{{ item.error }}</span>
                <span v-else class="dim mono jimeng-credit-tag">余额 —</span>
              </div>
            </div>
          </div>
          <p v-else-if="!chengmengBalanceLoading" class="dim setup-desc">暂无橙盟视频配置</p>
          <div v-if="chengmengBalanceTasks.length" class="upstream-task-panel">
            <div class="upstream-task-head">上游任务扣费明细</div>
            <p class="dim setup-desc">
              「变动后余额」由当前可用余额按明细从新到旧回推；期间若有充值/其他消费，更早条目可能偏离。
            </p>
            <table class="user-table upstream-task-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>任务</th>
                  <th>模型</th>
                  <th>状态</th>
                  <th>实扣</th>
                  <th>变动后余额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in chengmengBalanceTasks" :key="task.task_id">
                  <td class="mono dim">{{ formatUpstreamTime(task.created_at) }}</td>
                  <td>
                    <div class="mono">{{ shortTaskId(task.task_id) }}</div>
                    <div v-if="task.prompt_head" class="dim upstream-task-prompt">{{ task.prompt_head }}</div>
                  </td>
                  <td class="mono">{{ task.model || '—' }}</td>
                  <td>{{ task.status || '—' }}</td>
                  <td class="mono">{{ formatUpstreamDelta(task.balance_delta, task.cost_unit || '元') }}</td>
                  <td class="mono">{{ formatUpstreamBalanceAfter(task, '元') }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="chengmengBalanceTasksTotal > chengmengBalanceTasks.length" class="dim setup-desc">
              显示最近 {{ chengmengBalanceTasks.length }} 条 / 上游共 {{ chengmengBalanceTasksTotal }} 条
            </p>
          </div>
          <p v-else-if="chengmengBalanceTasksError" class="aistarslab-remote-error">{{ chengmengBalanceTasksError }}</p>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">通道2</div>
              <div class="setup-title">火山方舟 API Key</div>
              <div class="setup-desc">
                可添加多个方舟 API Key 并一键切换；当前启用于通道2 全部视频生成。
                现金余额与<strong>虚拟人像认证入库</strong>需同账号
                <strong>Access Key / Secret Key</strong>（管控面，非 ark- API Key）；
                仅有 API Key 时可生视频、探测可用性。
                也可把 <code>huoshankey_备注=ark-...</code> 与
                <code>huoshanak_备注</code> / <code>huoshansk_备注</code>（账单 AK/SK）写入服务器
                <code>backend/.env</code> 后点「同步环境变量」；或在下方填写
                <strong>账单账号标识</strong> 与 Access Key / Secret Key 建立对应关系。
                费用中心：
                <a href="https://console.volcengine.com/finance/account-overview/" target="_blank" rel="noopener">火山控制台</a>
              </div>
            </div>
            <div class="jimeng-session-status">
              <span v-if="officialBalanceAccounts.length" class="mono dim">{{ officialBalanceAccounts.length }} 个 Key</span>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="officialBalanceLoading || officialKeySaving"
                @click="syncOfficialKeysFromEnv"
              >
                同步环境变量
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="officialBalanceLoading"
                @click="loadOfficialBalance"
              >
                {{ officialBalanceLoading ? '刷新中…' : '刷新余额' }}
              </button>
            </div>
          </div>
          <p v-if="officialBalanceError" class="aistarslab-remote-error">{{ officialBalanceError }}</p>
          <p v-else-if="officialBalanceLoading" class="dim setup-desc">正在拉取方舟任务列表与余额（轻量模式，约需数秒）…</p>
          <div v-if="officialBalanceAccounts.length" class="jimeng-session-list">
            <div
              v-for="item in officialBalanceAccounts"
              :key="item.config_id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.name || `配置 #${item.config_id}` }}</span>
                <span v-if="item.api_key_masked" class="mono dim">{{ item.api_key_masked }}</span>
                <span v-if="item.billing_label" class="dim mono" title="账单账号标识">bill:{{ item.billing_label }}</span>
                <span v-if="item.access_key_masked" class="mono dim" title="账单 Access Key">AK {{ item.access_key_masked }}</span>
                <span v-if="item.env_name" class="dim mono">env:{{ item.env_name }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
                <span v-if="item.probe_ok" class="tag tag-success">可用</span>
                <span v-else-if="item.error" class="tag" :title="item.error">异常</span>
                <span
                  v-if="item.balance && item.balance.available_balance != null"
                  class="tag tag-success jimeng-credit-tag"
                  :title="officialBalanceTitle(item)"
                >
                  可用 {{ formatUpstreamMoney(item.balance.available_balance) }} 元
                </span>
                <span
                  v-else-if="item.has_billing_credentials"
                  class="dim mono jimeng-credit-tag"
                  :title="item.note || item.error || ''"
                >余额查询失败</span>
                <span
                  v-else
                  class="dim mono jimeng-credit-tag"
                  :title="item.note || ''"
                >余额 —（需 AK/SK）</span>
                <span
                  v-if="item.estimated_spend_yuan != null"
                  class="tag jimeng-credit-tag"
                  title="本页近期成功任务按官方价估算合计"
                >
                  近期估算 {{ formatUpstreamMoney(item.estimated_spend_yuan) }} 元
                </span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="officialKeySaving"
                  @click="startEditOfficialKey(item)"
                >
                  编辑
                </button>
                <button
                  v-if="!item.is_active"
                  type="button"
                  class="btn btn-sm"
                  :disabled="officialKeySaving"
                  @click="activateOfficialKey(item.config_id)"
                >
                  设为当前
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="officialKeySaving"
                  @click="removeOfficialKey(item)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <p v-else-if="!officialBalanceLoading" class="dim setup-desc">暂无通道2火山方舟配置</p>
          <div class="jimeng-session-actions" style="margin-top: 12px; flex-wrap: wrap; gap: 8px;">
            <div v-if="officialKeyForm.editing_id" class="dim" style="width: 100%; font-size: 12px;">
              正在编辑 #{{ officialKeyForm.editing_id }}「{{ officialKeyForm.name || '未命名' }}」——
              API Key / Secret 留空表示不改；可只补填 Access Key / Secret Key。
              <button type="button" class="btn btn-sm btn-ghost" style="margin-left: 6px;" @click="resetOfficialKeyForm">取消编辑</button>
            </div>
            <input
              v-model="officialKeyForm.name"
              class="jimeng-session-label"
              type="text"
              placeholder="备注（如：韩桥远）"
            />
            <input
              v-model="officialKeyForm.billing_label"
              class="jimeng-session-label"
              type="text"
              placeholder="账单账号标识（如 lingjingkeji，对应 env huoshanak_标识）"
            />
            <input
              v-model="officialKeyForm.api_key"
              class="jimeng-session-input"
              style="min-width: 220px; flex: 1;"
              type="password"
              :placeholder="officialKeyForm.editing_id ? '方舟 API Key（留空不改）' : '方舟 API Key（ark-...）'"
              autocomplete="new-password"
            />
            <input
              v-model="officialKeyForm.access_key"
              class="jimeng-session-label"
              type="text"
              :placeholder="officialKeyForm.editing_id && officialKeyForm.has_ak ? 'Access Key（已配置，留空不改）' : 'Access Key（火山账单 / 余额查询）'"
            />
            <input
              v-model="officialKeyForm.secret_key"
              class="jimeng-session-label"
              type="password"
              :placeholder="officialKeyForm.editing_id && officialKeyForm.has_sk ? 'Secret Key（已配置，留空不改）' : 'Secret Key（火山账单 / 余额查询）'"
              autocomplete="new-password"
            />
            <label v-if="!officialKeyForm.editing_id" class="jimeng-access-toggle">
              <input v-model="officialKeyForm.activate" type="checkbox" />
              添加后设为当前
            </label>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="officialKeySaving || (!officialKeyForm.editing_id && !officialKeyForm.api_key.trim())"
              @click="saveOfficialKey"
            >
              {{ officialKeySaving ? '保存中…' : (officialKeyForm.editing_id ? '保存修改' : '添加 API Key') }}
            </button>
          </div>
          <div v-if="officialBalanceTasks.length" class="upstream-task-panel">
            <div class="upstream-task-head">上游任务扣费明细（当前启用 Key）</div>
            <p class="dim setup-desc">
              直接读取方舟任务列表（含探测直连）；估算费用为 tokens × 官方刊例价。实际成本来自费用中心 ListBillDetail 实付并写入本站库；本站扣费来自提交时的积分流水。
            </p>
            <table class="user-table upstream-task-table">
              <thead>
                <tr>
                  <th>创建时间</th>
                  <th>完成时间</th>
                  <th>任务时长</th>
                  <th>操作人</th>
                  <th>任务</th>
                  <th>模型</th>
                  <th>状态</th>
                  <th>Tokens</th>
                  <th>估算费用</th>
                  <th>实际成本</th>
                  <th>本站扣费</th>
                  <th>视频</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in officialBalanceTasks" :key="`${task.local_id || ''}-${task.task_id}`">
                  <td class="mono dim">{{ formatUpstreamTime(task.created_at) }}</td>
                  <td class="mono dim">{{ formatUpstreamTime(task.completed_at) }}</td>
                  <td class="mono dim">{{ formatOfficialTaskDuration(task) }}</td>
                  <td>{{ task.username || task.operator || '—' }}</td>
                  <td>
                    <div class="mono">{{ shortTaskId(task.task_id) }}</div>
                    <div v-if="task.local_id" class="dim">本站 #{{ task.local_id }}</div>
                    <div v-if="task.prompt_head" class="dim upstream-task-prompt">{{ task.prompt_head }}</div>
                    <div v-if="task.error_message" class="aistarslab-remote-error">{{ task.error_message }}</div>
                  </td>
                  <td class="mono">
                    <div>{{ task.model || '—' }}</div>
                    <div v-if="task.resolution" class="dim">{{ task.resolution }}</div>
                  </td>
                  <td>{{ task.status || '—' }}</td>
                  <td class="mono">{{ formatOfficialTokens(task) }}</td>
                  <td class="mono" :title="task.cost_note || ''">{{ formatOfficialTaskCost(task) }}</td>
                  <td class="mono" :title="task.actual_cost_note || ''">{{ formatOfficialActualCost(task) }}</td>
                  <td class="mono" :title="task.site_credits_note || ''">{{ formatOfficialSiteCredits(task) }}</td>
                  <td>
                    <div v-if="officialTaskPlayUrl(task)" class="upstream-task-video">
                      <video
                        :src="officialTaskPlayUrl(task)"
                        controls
                        playsinline
                        preload="metadata"
                        class="upstream-task-video-player"
                      />
                      <a
                        class="dim mono"
                        :href="officialTaskPlayUrl(task)"
                        target="_blank"
                        rel="noopener"
                      >新窗口打开</a>
                    </div>
                    <span v-else class="dim">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="upstream-task-pager">
              <span class="dim mono">
                第 {{ officialBalancePage }} 页
                <template v-if="officialBalanceTasksTotal">
                  · 共 {{ officialBalanceTasksTotal }} 条
                </template>
                · 本页 {{ officialBalanceTasks.length }} 条
              </span>
              <div class="upstream-task-pager-actions">
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="officialBalanceLoading || officialBalancePage <= 1"
                  @click="loadOfficialBalancePage(officialBalancePage - 1)"
                >
                  上一页
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="officialBalanceLoading || !officialBalanceHasMore"
                  @click="loadOfficialBalancePage(officialBalancePage + 1)"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
          <p v-else-if="officialBalanceTasksError" class="aistarslab-remote-error">{{ officialBalanceTasksError }}</p>

          <div class="upstream-task-panel official-pnl-panel">
            <div class="official-pnl-head-row">
              <div>
                <div class="upstream-task-head">通道2 盈亏统计</div>
                <p class="dim setup-desc">
                  本站实收（积分÷100）对比控制台实付；仅统计已入库实付的成功任务。后台每 1 分钟自动补拉 5 条实付（从新到旧翻页）。
                </p>
              </div>
              <div class="official-pnl-actions">
                <select v-model="officialPnlDays" class="input input-sm official-pnl-filter" @change="loadOfficialPnl(false)">
                  <option :value="0">全部时间</option>
                  <option :value="7">近 7 天</option>
                  <option :value="30">近 30 天</option>
                  <option :value="90">近 90 天</option>
                </select>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="officialPnlLoading"
                  @click="loadOfficialPnl(false)"
                >
                  {{ officialPnlLoading ? '统计中…' : '刷新统计' }}
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="officialPnlLoading"
                  @click="loadOfficialPnl(true)"
                >
                  补拉实付并统计
                </button>
              </div>
            </div>
            <p v-if="officialPnlError" class="aistarslab-remote-error">{{ officialPnlError }}</p>
            <p v-if="officialBillSync" class="dim setup-desc official-bill-sync-status">
              自动补拉：
              <template v-if="officialBillSync.enabled">每 {{ Math.round((officialBillSync.interval_ms || 60000) / 1000) }} 秒 {{ officialBillSync.batch_size || 5 }} 条</template>
              <template v-else>已禁用</template>
              · 缺实付 {{ officialBillSync.remaining_missing ?? '—' }}
              · 游标 #{{ officialBillSync.cursor_before_id || '最新' }}
              · 累计匹配 {{ officialBillSync.total_matched ?? 0 }}
              <template v-if="officialBillSync.last_run_at"> · 上次 {{ formatUpstreamTime(officialBillSync.last_run_at) }}</template>
              <template v-if="officialBillSync.last_matched != null"> · 上次 +{{ officialBillSync.last_matched }}</template>
              <template v-if="officialBillSync.running"> · 运行中</template>
            </p>
            <p v-if="officialBillSync?.last_error" class="aistarslab-remote-error">{{ officialBillSync.last_error }}</p>
            <template v-else-if="officialPnlSummary">
              <div class="official-pnl-summary" :class="{ 'is-loss': officialPnlSummary.is_loss, 'is-profit': officialPnlSummary.is_profit }">
                <div class="official-pnl-stat">
                  <div class="dim">本站实收</div>
                  <div class="mono">{{ formatUpstreamMoney(officialPnlSummary.total_revenue_yuan) }} 元</div>
                </div>
                <div class="official-pnl-stat">
                  <div class="dim">上游实付</div>
                  <div class="mono">{{ formatUpstreamMoney(officialPnlSummary.total_actual_cost_yuan) }} 元</div>
                </div>
                <div class="official-pnl-stat">
                  <div class="dim">净利润</div>
                  <div class="mono official-pnl-net">{{ formatOfficialPnlSigned(officialPnlSummary.net_profit_yuan) }} 元</div>
                </div>
                <div class="official-pnl-stat">
                  <div class="dim">毛利率</div>
                  <div class="mono">{{ formatOfficialPnlMargin(officialPnlSummary.margin_pct_vs_cost) }}</div>
                </div>
                <div class="official-pnl-stat">
                  <div class="dim">盈利 / 亏损</div>
                  <div class="mono">{{ officialPnlSummary.profit_tasks }} / {{ officialPnlSummary.loss_tasks }}</div>
                </div>
                <div class="official-pnl-stat">
                  <div class="dim">缺实付</div>
                  <div class="mono">{{ officialPnlSummary.missing_actual_cost }}</div>
                </div>
              </div>
              <p v-if="officialPnlSummary.note" class="aistarslab-remote-error">{{ officialPnlSummary.note }}</p>
              <p v-if="officialPnlBackfill?.matched" class="dim setup-desc">
                本次补拉账单实付 {{ officialPnlBackfill.matched }} 条
                <template v-if="officialPnlBackfill.attempted">（尝试 {{ officialPnlBackfill.attempted }} 条）</template>
                <template v-if="officialPnlBackfill.remaining"> · 仍缺约 {{ officialPnlBackfill.remaining }} 条</template>
              </p>
              <p v-if="officialPnlBackfill?.error" class="aistarslab-remote-error">{{ officialPnlBackfill.error }}</p>

              <div v-if="officialPnlByModel.length" class="official-pnl-subtable-wrap">
                <div class="upstream-task-head">按模型</div>
                <table class="user-table upstream-task-table">
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>任务数</th>
                      <th>实收</th>
                      <th>实付</th>
                      <th>利润</th>
                      <th>盈/亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in officialPnlByModel" :key="row.model">
                      <td class="mono">{{ row.model }}</td>
                      <td class="mono">{{ row.count }}</td>
                      <td class="mono">{{ formatUpstreamMoney(row.revenue_yuan) }}</td>
                      <td class="mono">{{ formatUpstreamMoney(row.actual_cost_yuan) }}</td>
                      <td class="mono" :class="officialPnlProfitClass(row.profit_yuan)">{{ formatOfficialPnlSigned(row.profit_yuan) }}</td>
                      <td class="mono">{{ row.profit_count }} / {{ row.loss_count }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="officialPnlLines.length" class="official-pnl-subtable-wrap">
                <div class="upstream-task-head">任务明细（按利润从低到高）</div>
                <table class="user-table upstream-task-table">
                  <thead>
                    <tr>
                      <th>完成时间</th>
                      <th>用户</th>
                      <th>任务</th>
                      <th>模型</th>
                      <th>实收</th>
                      <th>实付</th>
                      <th>利润</th>
                      <th>结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in officialPnlLines" :key="`${row.video_id}-${row.task_id || ''}`">
                      <td class="mono dim">{{ formatUpstreamTime(row.completed_at || row.created_at) }}</td>
                      <td>{{ row.username || '—' }}</td>
                      <td>
                        <div v-if="row.video_id" class="dim">#{{ row.video_id }}</div>
                        <div class="mono">{{ shortTaskId(row.task_id) }}</div>
                      </td>
                      <td class="mono">{{ row.model || '—' }}</td>
                      <td class="mono">{{ formatUpstreamMoney(row.revenue_yuan) }}</td>
                      <td class="mono">{{ row.actual_cost_yuan != null ? formatUpstreamMoney(row.actual_cost_yuan) : '—' }}</td>
                      <td class="mono" :class="officialPnlProfitClass(row.profit_yuan)">{{ formatOfficialPnlSigned(row.profit_yuan) }}</td>
                      <td>{{ formatOfficialPnlOutcome(row.outcome) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="upstream-task-pager">
                  <span class="dim mono">
                    共 {{ officialPnlPagination.total || 0 }} 条 · 本页 {{ officialPnlLines.length }} 条
                  </span>
                  <div class="upstream-task-pager-actions">
                    <button type="button" class="btn btn-sm" :disabled="officialPnlLoading || officialPnlPage <= 1" @click="loadOfficialPnlPage(officialPnlPage - 1)">上一页</button>
                    <button type="button" class="btn btn-sm" :disabled="officialPnlLoading || !officialPnlPagination.has_more" @click="loadOfficialPnlPage(officialPnlPage + 1)">下一页</button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">通道3</div>
              <div class="setup-title">Seedance VIP 上游余额</div>
              <div class="setup-desc">
                读取 aistarslab <code>/openapi/account/credits</code>；明细按本站近期任务回查上游
                <code>costCredits</code>（上游未开放任务列表接口）。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span v-if="aistarslabBalanceAccounts.length" class="mono dim">{{ aistarslabBalanceAccounts.length }} 个账号</span>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="aistarslabBalanceLoading"
                @click="loadAistarslabBalance"
              >
                {{ aistarslabBalanceLoading ? '刷新中…' : '刷新余额' }}
              </button>
            </div>
          </div>
          <p v-if="aistarslabBalanceError" class="aistarslab-remote-error">{{ aistarslabBalanceError }}</p>
          <p v-else-if="aistarslabBalanceLoading" class="dim setup-desc">正在拉取 Seedance VIP 余额与任务明细…</p>
          <div v-if="aistarslabBalanceAccounts.length" class="jimeng-session-list">
            <div
              v-for="item in aistarslabBalanceAccounts"
              :key="item.config_id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.name || `配置 #${item.config_id}` }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
                <span
                  v-if="item.balance"
                  class="tag tag-success jimeng-credit-tag"
                >
                  剩余 {{ item.balance.credits }} 积分
                </span>
                <span v-else-if="item.error" class="tag">{{ item.error }}</span>
                <span v-else class="dim mono jimeng-credit-tag">余额 —</span>
              </div>
            </div>
          </div>
          <p v-else-if="!aistarslabBalanceLoading" class="dim setup-desc">暂无通道3视频配置</p>
          <div v-if="aistarslabBalanceTasks.length" class="upstream-task-panel">
            <div class="upstream-task-head">上游任务扣费明细</div>
            <p class="dim setup-desc">
              失败任务上游仍返回标价 <code>costCredits</code>；实扣列按状态展示。变动后余额由当前积分从新到旧回推——若相邻条目实扣与余额差对不上，可能是上游扣费异常。
            </p>
            <table class="user-table upstream-task-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>任务</th>
                  <th>线路/模型</th>
                  <th>状态</th>
                  <th>实扣</th>
                  <th>变动后余额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in aistarslabBalanceTasks" :key="`${task.local_id || ''}-${task.task_id}`">
                  <td class="mono dim">{{ formatUpstreamTime(task.created_at) }}</td>
                  <td>
                    <div class="mono">{{ shortTaskId(task.task_id) }}</div>
                    <div v-if="task.prompt_head" class="dim upstream-task-prompt">{{ task.prompt_head }}</div>
                    <div v-if="task.error_message" class="aistarslab-remote-error">{{ task.error_message }}</div>
                  </td>
                  <td class="mono">线路{{ task.channel || '—' }} · {{ task.model || '—' }}</td>
                  <td>{{ task.status || '—' }}</td>
                  <td class="mono" :title="task.cost_note || ''">{{ formatAistarslabTaskCost(task) }}</td>
                  <td class="mono">{{ formatUpstreamBalanceAfter(task, '积分') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="aistarslabBalanceTasksError" class="aistarslab-remote-error">{{ aistarslabBalanceTasksError }}</p>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">通道6</div>
              <div class="setup-title">AIGC Seedance 上游余额</div>
              <div class="setup-desc">
                上游无独立余额接口；读取任务状态中的 <code>remaining_credits</code>；
                明细按本站近期任务回查 <code>used_credits</code>。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span v-if="aigcccBalanceAccounts.length" class="mono dim">{{ aigcccBalanceAccounts.length }} 个账号</span>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="aigcccBalanceLoading"
                @click="loadAigcccBalance"
              >
                {{ aigcccBalanceLoading ? '刷新中…' : '刷新余额' }}
              </button>
            </div>
          </div>
          <p v-if="aigcccBalanceError" class="aistarslab-remote-error">{{ aigcccBalanceError }}</p>
          <p v-else-if="aigcccBalanceLoading" class="dim setup-desc">正在拉取 AIGC 余额与任务明细…</p>
          <div v-if="aigcccBalanceAccounts.length" class="jimeng-session-list">
            <div
              v-for="item in aigcccBalanceAccounts"
              :key="item.config_id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.name || `配置 #${item.config_id}` }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
                <span
                  v-if="item.balance"
                  class="tag tag-success jimeng-credit-tag"
                  :title="item.via_task_id ? `经由任务 ${item.via_task_id}` : ''"
                >
                  剩余 {{ item.balance.credits }} 积分
                </span>
                <span v-else-if="item.error" class="tag">{{ item.error }}</span>
                <span v-else class="dim mono jimeng-credit-tag">余额 —</span>
              </div>
            </div>
          </div>
          <p v-else-if="!aigcccBalanceLoading" class="dim setup-desc">暂无通道6视频配置</p>
          <div v-if="aigcccBalanceTasks.length" class="upstream-task-panel">
            <div class="upstream-task-head">上游任务扣费明细</div>
            <p class="dim setup-desc">
              实扣取上游 <code>used_credits</code>；生成中可能尚未返回。变动后余额由当前积分从新到旧回推。
            </p>
            <table class="user-table upstream-task-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>任务</th>
                  <th>模型</th>
                  <th>状态</th>
                  <th>实扣</th>
                  <th>变动后余额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in aigcccBalanceTasks" :key="`${task.local_id || ''}-${task.task_id}`">
                  <td class="mono dim">{{ formatUpstreamTime(task.created_at) }}</td>
                  <td>
                    <div class="mono">{{ shortTaskId(task.task_id) }}</div>
                    <div v-if="task.prompt_head" class="dim upstream-task-prompt">{{ task.prompt_head }}</div>
                    <div v-if="task.error_message" class="aistarslab-remote-error">{{ task.error_message }}</div>
                  </td>
                  <td class="mono">{{ task.model || '—' }}</td>
                  <td>{{ task.status || '—' }}</td>
                  <td class="mono" :title="task.cost_note || ''">{{ formatAigcccTaskCost(task) }}</td>
                  <td class="mono">{{ formatUpstreamBalanceAfter(task, '积分') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="aigcccBalanceTasksError" class="aistarslab-remote-error">{{ aigcccBalanceTasksError }}</p>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">通道4</div>
              <div class="setup-title">即梦 Session</div>
              <div class="setup-desc">
                jimeng.jianying.com Cookie 鉴权，仅管理员在此配置。用户视频页不会展示 Session 内容。
                默认按「用户 + 项目」分配 Session；可对某个号开启「强制全员」，之后所有用户发布视频都走该号。
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
              <span v-if="jimengForceSessionId" class="tag tag-accent">强制全员中</span>
              <span v-if="jimengSessions.length" class="mono dim">{{ jimengSessions.length }} 个 Session</span>
              <button
                v-if="jimengSessions.length"
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="jimengSessionSaving || jimengCreditsLoading"
                @click="loadJimengSessionStatus"
              >
                {{ jimengCreditsLoading ? '刷新中…' : '刷新积分' }}
              </button>
            </div>
          </div>
          <div v-if="jimengForceSessionLabel" class="setup-desc jimeng-force-banner">
            当前强制全员使用：<strong>{{ jimengForceSessionLabel }}</strong>。取消后恢复按用户分配。
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="jimengSessionSaving"
              @click="clearJimengForceSession"
            >
              取消强制
            </button>
          </div>
          <div v-if="jimengSessions.length" class="jimeng-session-list">
            <div
              v-for="item in jimengSessions"
              :key="item.id"
              class="jimeng-session-row"
              :class="{ active: item.is_active, forced: item.is_force }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.label || '未命名' }}</span>
                <span class="mono dim">{{ item.session_id_masked }}</span>
                <span class="tag" :class="item.valid ? 'tag-accent' : ''">{{ item.valid ? '有效' : '无效' }}</span>
                <span
                  v-if="item.valid && item.total_credit != null"
                  class="tag tag-success jimeng-credit-tag"
                  :title="jimengCreditTitle(item)"
                >
                  剩余 {{ item.total_credit }} 积分<span v-if="formatJimengCreditExpire(item)"> · 到期 {{ formatJimengCreditExpire(item) }}</span>
                </span>
                <span v-else-if="item.valid" class="dim mono jimeng-credit-tag">积分 —</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
                <span v-if="item.is_force" class="tag tag-accent">强制全员</span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  v-if="!item.is_force"
                  type="button"
                  class="btn btn-sm"
                  :disabled="jimengSessionSaving"
                  @click="forceJimengSession(item.id)"
                >
                  强制全员
                </button>
                <button
                  v-else
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="jimengSessionSaving"
                  @click="clearJimengForceSession"
                >
                  取消强制
                </button>
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
              <div class="setup-kicker">通道4 · 提交控制</div>
              <div class="setup-title">团队提交成功率</div>
              <div class="setup-desc">
                用于限制非指定团队占用即梦通道。未命中下列团队规则的用户按「默认成功率」随机放行；失败时用户仅看到「上游通道繁忙，提交失败」，不会扣积分。
                管理员账号始终放行。
              </div>
            </div>
            <div class="jimeng-session-status">
              <label class="jimeng-access-toggle">
                <input v-model="jimengAccessEnabled" type="checkbox" />
                启用概率门控
              </label>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="jimengAccessSaving"
                @click="saveJimengAccessSettings"
              >
                {{ jimengAccessSaving ? '保存中…' : '保存规则' }}
              </button>
            </div>
          </div>
          <div class="jimeng-access-grid">
            <label class="field">
              <span>默认成功率（%）</span>
              <input
                v-model.number="jimengAccessDefaultRate"
                class="input"
                type="number"
                min="0"
                max="100"
                step="1"
              />
              <span class="field-hint">非下列团队成员 / 无团队用户使用此值，建议 20</span>
            </label>
          </div>
          <div class="jimeng-access-teams">
            <div class="jimeng-access-teams-head">
              <strong>团队规则</strong>
              <button type="button" class="btn btn-sm" :disabled="!jimengAccessAddTeamId" @click="addJimengAccessTeamRule">
                添加团队
              </button>
            </div>
            <div class="jimeng-access-add-row">
              <select v-model="jimengAccessAddTeamId" class="input">
                <option value="">选择团队…</option>
                <option
                  v-for="t in jimengAccessAvailableTeams"
                  :key="t.id"
                  :value="String(t.id)"
                  :disabled="jimengAccessTeams.some(r => Number(r.team_id) === Number(t.id))"
                >
                  {{ t.name }} (#{{ t.id }})
                </option>
              </select>
            </div>
            <div v-if="!jimengAccessTeams.length" class="setup-desc dim">尚未配置团队规则。可添加 lingjing 等团队并设为 100%。</div>
            <div v-else class="jimeng-access-team-list">
              <div v-for="(rule, idx) in jimengAccessTeams" :key="rule.team_id" class="jimeng-session-row">
                <div class="jimeng-session-row-main">
                  <span class="jimeng-session-row-label">{{ rule.team_name || `团队 #${rule.team_id}` }}</span>
                  <span class="mono dim">#{{ rule.team_id }}</span>
                </div>
                <div class="jimeng-session-row-actions jimeng-access-rate-actions">
                  <label class="jimeng-access-rate-field">
                    成功率
                    <input
                      v-model.number="rule.success_rate"
                      class="input jimeng-access-rate-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                    />
                    %
                  </label>
                  <button type="button" class="btn btn-sm btn-ghost" @click="jimengAccessTeams.splice(idx, 1)">移除</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">S通道5</div>
              <div class="setup-title">小云雀 Access Key</div>
              <div class="setup-desc">
                Access Key 用于生成；网页 Cookie 用于查询剩余积分与包月到期（与即梦一致）。仅管理员配置。
                <a href="https://xyq.jianying.com" target="_blank" rel="noopener">打开官网</a>
              </div>
              <div class="setup-desc jimeng-cookie-hint">
                Key：登录官网 → 顶部 <strong>CLI/API → API</strong> → 新建密钥。<br />
                Cookie：F12 → Network → 刷新 → 选中 <code>xyq.jianying.com</code> 请求 → Headers → Cookie → 粘贴到下方。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="xyqHasValidKey ? 'tag-accent' : ''">{{ xyqKeyStatusLabel }}</span>
              <span v-if="xyqSessions.length" class="mono dim">{{ xyqSessions.length }} 个 Key</span>
              <button
                v-if="xyqSessions.length"
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="xyqSessionSaving || xyqCreditsLoading"
                @click="loadXyqSessionStatus"
              >
                {{ xyqCreditsLoading ? '刷新中…' : '刷新积分' }}
              </button>
            </div>
          </div>
          <div v-if="xyqSessions.length" class="jimeng-session-list">
            <div
              v-for="item in xyqSessions"
              :key="item.id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.label || '未命名' }}</span>
                <span class="mono dim">{{ item.access_key_masked }}</span>
                <span class="tag" :class="item.valid ? 'tag-accent' : ''">{{ item.valid ? '有效' : '无效' }}</span>
                <span
                  v-if="item.valid && item.total_credit != null"
                  class="tag tag-success jimeng-credit-tag"
                  :title="xyqCreditTitle(item)"
                >
                  剩余 {{ item.total_credit }} 积分<span v-if="formatXyqCreditBreakdown(item)">（{{ formatXyqCreditBreakdown(item) }}）</span><span v-if="formatJimengCreditExpire(item)"> · 到期 {{ formatJimengCreditExpire(item) }}</span>
                </span>
                <span v-else-if="item.valid && item.has_cookie" class="dim mono jimeng-credit-tag">积分 —</span>
                <span v-else-if="item.valid" class="dim mono jimeng-credit-tag">未绑 Cookie</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  v-if="!item.is_active"
                  type="button"
                  class="btn btn-sm"
                  :disabled="xyqSessionSaving"
                  @click="activateXyqSession(item.id)"
                >
                  设为当前
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="xyqSessionSaving"
                  @click="openXyqEditDialog(item)"
                >
                  编辑
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="xyqSessionSaving"
                  @click="validateXyqSessionItem(item.id)"
                >
                  验证
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="xyqSessionSaving"
                  @click="removeXyqSession(item.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <div v-else class="setup-desc dim" style="margin-top: 12px;">尚未保存任何 Access Key</div>
          <textarea
            v-model="xyqSessionInput"
            class="jimeng-session-input"
            rows="2"
            placeholder="粘贴 Access Key（必填）…"
          />
          <textarea
            v-model="xyqSessionCookieInput"
            class="jimeng-session-input"
            rows="2"
            placeholder="粘贴网页 Cookie（可选，绑定后可显示剩余积分 / 到期）…"
          />
          <div class="jimeng-session-actions">
            <input v-model="xyqSessionLabel" class="jimeng-session-label" type="text" placeholder="备注（可选，如：账号A）" />
            <button type="button" class="btn btn-sm btn-primary" :disabled="xyqSessionSaving || !xyqSessionInput.trim()" @click="saveXyqSession">
              {{ xyqSessionSaving ? '保存中…' : '添加 Key' }}
            </button>
            <button
              v-if="xyqSessions.length"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="xyqSessionSaving"
              @click="clearXyqSession"
            >
              清除全部
            </button>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">S通道7</div>
              <div class="setup-title">扣子 Cookie / PAT</div>
              <div class="setup-desc">
                Cookie 或 Personal Access Token 二选一即可（可同时配置）。用于调用扣子 Ark 兼容 Seedance 2.0。仅管理员配置。
                <a href="https://www.coze.cn" target="_blank" rel="noopener">打开扣子</a>
              </div>
              <div class="setup-desc jimeng-cookie-hint">
                Cookie：登录 www.coze.cn → F12 → Network → 刷新 → 选中请求 → Headers → Cookie → 粘贴。<br />
                PAT：扣子开放平台 → 个人访问令牌 → 创建后粘贴。可选自定义 API Base（默认 https://api.coze.cn）。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="cozeHasValidSession ? 'tag-accent' : ''">{{ cozeSessionStatusLabel }}</span>
              <span v-if="cozeSessions.length" class="mono dim">{{ cozeSessions.length }} 个 Session</span>
              <button
                v-if="cozeSessions.length"
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="cozeSessionSaving"
                @click="loadCozeSessionStatus"
              >
                刷新
              </button>
            </div>
          </div>
          <div v-if="cozeSessions.length" class="jimeng-session-list">
            <div
              v-for="item in cozeSessions"
              :key="item.id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.label || '未命名' }}</span>
                <span v-if="item.api_key_masked" class="mono dim">PAT {{ item.api_key_masked }}</span>
                <span v-else-if="item.cookie_masked" class="mono dim">Cookie {{ item.cookie_masked }}</span>
                <span class="tag" :class="item.valid ? 'tag-accent' : ''">{{ item.valid ? '有效' : '无效' }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  v-if="!item.is_active"
                  type="button"
                  class="btn btn-sm"
                  :disabled="cozeSessionSaving"
                  @click="activateCozeSession(item.id)"
                >
                  设为当前
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="cozeSessionSaving"
                  @click="validateCozeSessionItem(item.id)"
                >
                  验证
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="cozeSessionSaving"
                  @click="removeCozeSession(item.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <div v-else class="setup-desc dim" style="margin-top: 12px;">尚未保存任何扣子 Session</div>
          <textarea
            v-model="cozeSessionCookieInput"
            class="jimeng-session-input"
            rows="2"
            placeholder="粘贴 Cookie（可选，与 PAT 至少填一项）…"
          />
          <textarea
            v-model="cozeSessionApiKeyInput"
            class="jimeng-session-input"
            rows="2"
            placeholder="粘贴 Personal Access Token / PAT（可选）…"
          />
          <input
            v-model="cozeSessionBaseUrlInput"
            class="jimeng-session-label"
            type="text"
            placeholder="API Base（可选，默认 https://api.coze.cn）"
            style="width: 100%; margin-top: 8px;"
          />
          <div class="jimeng-session-actions">
            <input v-model="cozeSessionLabel" class="jimeng-session-label" type="text" placeholder="备注（可选）" />
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="cozeSessionSaving || (!cozeSessionCookieInput.trim() && !cozeSessionApiKeyInput.trim())"
              @click="saveCozeSession"
            >
              {{ cozeSessionSaving ? '保存中…' : '添加 Session' }}
            </button>
            <button
              v-if="cozeSessions.length"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="cozeSessionSaving"
              @click="clearCozeSession"
            >
              清除全部
            </button>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">通道8(梦工厂专用)</div>
              <div class="setup-title">橙星梦工厂 Token</div>
              <div class="setup-desc">
                打开
                <a href="https://mgc.funshion.com" target="_blank" rel="noopener">橙星梦工厂</a>
                视频页 → F12 → Network → 任选接口 → Headers → Authorization（或 Application → Local Storage → token）粘贴到下方。
                同时填写地址栏 <code>/ai-app/video/</code> 后面的项目 ID。仅管理员配置。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="funshionHasValidSession ? 'tag-accent' : ''">{{ funshionSessionStatusLabel }}</span>
              <span v-if="funshionActiveCoinLabel" class="tag tag-success jimeng-credit-tag">{{ funshionActiveCoinLabel }}</span>
              <span v-if="funshionSessions.length" class="mono dim">{{ funshionSessions.length }} 个 Session</span>
              <button
                v-if="funshionSessions.length"
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="funshionSessionSaving || funshionCreditsLoading"
                @click="loadFunshionSessionStatus"
              >
                {{ funshionCreditsLoading ? '刷新中…' : '刷新积分' }}
              </button>
            </div>
          </div>
          <div v-if="funshionSessions.length" class="jimeng-session-list">
            <div
              v-for="item in funshionSessions"
              :key="item.id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.label || '未命名' }}</span>
                <span v-if="item.token_masked" class="mono dim">Token {{ item.token_masked }}</span>
                <span v-if="item.project_id" class="mono dim">项目 {{ item.project_id }}</span>
                <span class="tag" :class="item.valid ? 'tag-accent' : ''">{{ item.valid ? '有效' : '无效' }}</span>
                <span
                  v-if="item.valid && item.coin_amount != null"
                  class="tag tag-success jimeng-credit-tag"
                  :title="funshionCoinTitle(item)"
                >
                  剩余 {{ item.coin_amount }} 星币
                </span>
                <span v-else-if="item.valid" class="dim mono jimeng-credit-tag">星币 —</span>
                <span v-else-if="item.coin_error" class="dim mono jimeng-credit-tag" :title="item.coin_error">余额查询失败</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  v-if="!item.is_active"
                  type="button"
                  class="btn btn-sm"
                  :disabled="funshionSessionSaving"
                  @click="activateFunshionSession(item.id)"
                >
                  设为当前
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="funshionSessionSaving"
                  @click="validateFunshionSessionItem(item.id)"
                >
                  验证
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="funshionSessionSaving"
                  @click="removeFunshionSession(item.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <div v-else class="setup-desc dim" style="margin-top: 12px;">尚未保存任何橙星 Session</div>
          <textarea
            v-model="funshionSessionTokenInput"
            class="jimeng-session-input"
            rows="2"
            placeholder="粘贴 Authorization / localStorage.token…"
          />
          <input
            v-model="funshionSessionProjectIdInput"
            class="jimeng-session-label"
            type="text"
            placeholder="项目 ID（URL /ai-app/video/ 后面那段，必填）"
            style="width: 100%; margin-top: 8px;"
          />
          <input
            v-model="funshionSessionAppIdInput"
            class="jimeng-session-label"
            type="text"
            placeholder="appId（可选，无项目 ID 时用于自动创建）"
            style="width: 100%; margin-top: 8px;"
          />
          <input
            v-model="funshionSessionBaseUrlInput"
            class="jimeng-session-label"
            type="text"
            placeholder="站点 Base（可选，默认 https://mgc.funshion.com）"
            style="width: 100%; margin-top: 8px;"
          />
          <div class="jimeng-session-actions">
            <input v-model="funshionSessionLabel" class="jimeng-session-label" type="text" placeholder="备注（可选）" />
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="funshionSessionSaving || !funshionSessionTokenInput.trim() || (!funshionSessionProjectIdInput.trim() && !funshionSessionAppIdInput.trim())"
              @click="saveFunshionSession"
            >
              {{ funshionSessionSaving ? '保存中…' : '添加 Session' }}
            </button>
            <button
              v-if="funshionSessions.length"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="funshionSessionSaving"
              @click="clearFunshionSession"
            >
              清除全部
            </button>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">S通道9</div>
              <div class="setup-title">星月梦 Token</div>
              <div class="setup-desc">
                打开
                <a href="https://xingyuemeng.com" target="_blank" rel="noopener">星月梦</a>
                视频页 → F12 → Application → Local Storage → <code>xymai_token</code> 粘贴到下方。
                可选填写 team_id / project_id / episode_id（与 Network 请求头或 URL 一致）。仅管理员配置。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="xingyuemengHasValidSession ? 'tag-accent' : ''">{{ xingyuemengSessionStatusLabel }}</span>
              <span v-if="xingyuemengSessions.length" class="mono dim">{{ xingyuemengSessions.length }} 个 Session</span>
              <button
                v-if="xingyuemengSessions.length"
                type="button"
                class="btn btn-sm btn-ghost"
                :disabled="xingyuemengSessionSaving"
                @click="loadXingyuemengSessionStatus"
              >
                刷新
              </button>
            </div>
          </div>
          <div v-if="xingyuemengSessions.length" class="jimeng-session-list">
            <div
              v-for="item in xingyuemengSessions"
              :key="item.id"
              class="jimeng-session-row"
              :class="{ active: item.is_active }"
            >
              <div class="jimeng-session-row-main">
                <span class="jimeng-session-row-label">{{ item.label || '未命名' }}</span>
                <span v-if="item.token_masked" class="mono dim">Token {{ item.token_masked }}</span>
                <span v-if="item.team_id != null && item.team_id !== ''" class="mono dim">Team {{ item.team_id }}</span>
                <span v-if="item.project_id" class="mono dim">项目 {{ item.project_id }}</span>
                <span v-if="item.episode_id" class="mono dim">分集 {{ item.episode_id }}</span>
                <span class="tag" :class="item.valid ? 'tag-accent' : ''">{{ item.valid ? '有效' : '无效' }}</span>
                <span v-if="item.is_active" class="tag">当前启用</span>
              </div>
              <div class="jimeng-session-row-actions">
                <button
                  v-if="!item.is_active"
                  type="button"
                  class="btn btn-sm"
                  :disabled="xingyuemengSessionSaving"
                  @click="activateXingyuemengSession(item.id)"
                >
                  设为当前
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="xingyuemengSessionSaving"
                  @click="validateXingyuemengSessionItem(item.id)"
                >
                  验证
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="xingyuemengSessionSaving"
                  @click="removeXingyuemengSession(item.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <div v-else class="setup-desc dim" style="margin-top: 12px;">尚未保存任何星月梦 Session</div>
          <textarea
            v-model="xingyuemengSessionTokenInput"
            class="jimeng-session-input"
            rows="2"
            placeholder="粘贴 xymai_token（可带 Bearer 前缀）…"
          />
          <input
            v-model="xingyuemengSessionTeamIdInput"
            class="jimeng-session-label"
            type="text"
            placeholder="team_id（可选，默认 0）"
            style="width: 100%; margin-top: 8px;"
          />
          <input
            v-model="xingyuemengSessionProjectIdInput"
            class="jimeng-session-label"
            type="text"
            placeholder="project_id（可选）"
            style="width: 100%; margin-top: 8px;"
          />
          <input
            v-model="xingyuemengSessionEpisodeIdInput"
            class="jimeng-session-label"
            type="text"
            placeholder="episode_id（可选）"
            style="width: 100%; margin-top: 8px;"
          />
          <div class="jimeng-session-actions">
            <input v-model="xingyuemengSessionLabel" class="jimeng-session-label" type="text" placeholder="备注（可选）" />
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="xingyuemengSessionSaving || !xingyuemengSessionTokenInput.trim()"
              @click="saveXingyuemengSession"
            >
              {{ xingyuemengSessionSaving ? '保存中…' : '添加 Session' }}
            </button>
            <button
              v-if="xingyuemengSessions.length"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="xingyuemengSessionSaving"
              @click="clearXingyuemengSession"
            >
              清除全部
            </button>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">培训</div>
              <div class="setup-title">豆包培训 Session</div>
              <div class="setup-desc">
                doubao.com Cookie 鉴权，用于内部培训练手（官网 Seedance 2.0 Fast / Mini，默认 Mini）。每账号每日 {{ doubaoTrainingDailyQuota }} 次，生成后自动叠加培训标识。
                若提示风控验证，请先在浏览器打开豆包完成验证再重新复制 Cookie。
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
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">AI 配音</div>
              <div class="setup-title">IndexTTS2 API</div>
              <div class="setup-desc">
                用于「AI 配音」页面与解说旁白合成。填写 Gradio 根地址（如 x-gpu 容器 URL）或完整 REST API 地址。
              </div>
              <div class="setup-desc jimeng-cookie-hint">
                Gradio 示例：<code>https://xxx.container.x-gpu.com/</code>（末尾斜杠可有可无）。
                保存后优先于服务器环境变量 <code>INDEXTTS2_API_URL</code>。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="ttsConfigConfigured ? 'tag-accent' : ''">{{ ttsConfigStatusLabel }}</span>
              <span v-if="ttsConfigSource === 'env'" class="mono dim">当前来自环境变量</span>
            </div>
          </div>
          <div class="tts-config-fields">
            <label class="tts-config-label">
              API 地址
              <input v-model="ttsConfigForm.base_url" class="input" type="url" placeholder="https://xxx.container.x-gpu.com/" />
            </label>
            <label class="tts-config-label">
              API Key（可选）
              <input v-model="ttsConfigForm.api_key" class="input" type="password" placeholder="无则留空" autocomplete="new-password" />
            </label>
            <label class="tts-config-label">
              默认音色
              <input v-model="ttsConfigForm.default_voice" class="input" placeholder="voice_01" />
            </label>
          </div>
          <div v-if="ttsConfigTestResult" class="tts-config-test-result" :class="{ ok: ttsConfigTestResult.reachable }">
            {{ ttsConfigTestResult.message }}
            <span v-if="ttsConfigTestResult.status" class="mono dim">HTTP {{ ttsConfigTestResult.status }}</span>
          </div>
          <div class="jimeng-session-actions">
            <button type="button" class="btn btn-sm btn-primary" :disabled="ttsConfigSaving || !ttsConfigForm.base_url.trim()" @click="saveTtsConfig">
              {{ ttsConfigSaving ? '保存中…' : '保存配置' }}
            </button>
            <button type="button" class="btn btn-sm" :disabled="ttsConfigTesting || !ttsConfigForm.base_url.trim()" @click="testTtsConfig">
              {{ ttsConfigTesting ? '测试中…' : '测试连通' }}
            </button>
            <label class="tts-config-active-toggle">
              <input v-model="ttsConfigForm.is_active" type="checkbox" />
              启用此配置
            </label>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">AI 配音 · 云端</div>
              <div class="setup-title">RunningHub IndexTTS2</div>
              <div class="setup-desc">
                用于「工具箱 → AI 配音」页面。对接
                <a
                  href="https://www.runninghub.cn/call-api/api-detail/2012710824451772417?apiType=5"
                  target="_blank"
                  rel="noopener"
                >RunningHub 工作流 API</a>
                （情感向量控制）。
              </div>
              <div class="setup-desc jimeng-cookie-hint">
                1) 保存 API Key → 2) 点「同步节点参数」。若仍失败：打开
                <a
                  href="https://www.runninghub.cn/call-api/api-detail/2012710824451772417?apiType=5"
                  target="_blank"
                  rel="noopener"
                >API 文档 Playground</a>
                ，复制请求体里的 <code>nodeInfoList</code>（或整段 curl），粘贴到下方模板后再点同步。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="rhTtsConfigConfigured ? 'tag-accent' : ''">{{ rhTtsConfigStatusLabel }}</span>
              <span v-if="rhTtsConfigSource === 'env'" class="mono dim">当前来自环境变量</span>
              <span v-if="rhTtsHasBindings" class="tag tag-accent">节点已映射</span>
            </div>
          </div>
          <div class="tts-config-fields">
            <label class="tts-config-label">
              API Key
              <input
                v-model="rhTtsConfigForm.api_key"
                class="input"
                type="password"
                :placeholder="rhTtsHasApiKey ? `已保存 ${rhTtsApiKeyMasked || '••••'}，留空则不修改` : 'RunningHub 32 位 API Key'"
                autocomplete="new-password"
              />
            </label>
            <label class="tts-config-label">
              API Base
              <input v-model="rhTtsConfigForm.api_base" class="input" type="url" placeholder="https://www.runninghub.cn" />
            </label>
            <label class="tts-config-label">
              Workflow ID
              <input v-model="rhTtsConfigForm.workflow_id" class="input" placeholder="2012710824451772417" />
            </label>
            <label class="tts-config-label">
              Webapp ID（同步节点用）
              <input v-model="rhTtsConfigForm.webapp_id" class="input" placeholder="2012809189353070594" />
            </label>
            <label class="tts-config-label">
              调用模式
              <select v-model="rhTtsConfigForm.api_mode" class="input">
                <option value="openapi_v2">OpenAPI v2 工作流</option>
                <option value="ai_app">AI 应用 API（备用）</option>
              </select>
            </label>
          </div>
          <label class="tts-config-label" style="display:block;margin-top:10px">
            nodeInfoList 模板（可粘贴 JSON 数组 / 整段请求体 / curl）
            <textarea
              v-model="rhTtsNodeTemplateText"
              class="textarea"
              rows="6"
              placeholder='[{"nodeId":"1","fieldName":"audio","fieldValue":""},{"nodeId":"6","fieldName":"text","fieldValue":""},{"nodeId":"6","fieldName":"emo_vector","fieldValue":"[0, 0, 0, 0, 0, 0, 0, 0]"}]'
            />
          </label>
          <div v-if="rhTtsConfigTestResult" class="tts-config-test-result" :class="{ ok: rhTtsConfigTestResult.ok || rhTtsConfigTestResult.reachable }">
            {{ rhTtsConfigTestResult.message }}
          </div>
          <div class="jimeng-session-actions">
            <button type="button" class="btn btn-sm btn-primary" :disabled="rhTtsConfigSaving || (!rhTtsConfigForm.api_key.trim() && !rhTtsHasApiKey)" @click="saveRhTtsConfig">
              {{ rhTtsConfigSaving ? '保存中…' : '保存配置' }}
            </button>
            <button type="button" class="btn btn-sm" :disabled="rhTtsConfigTesting" @click="testRhTtsConfig">
              {{ rhTtsConfigTesting ? '测试中…' : '测试连通' }}
            </button>
            <button type="button" class="btn btn-sm" :disabled="rhTtsConfigSyncing" @click="syncRhTtsConfig">
              {{ rhTtsConfigSyncing ? '同步中…' : '同步节点参数' }}
            </button>
            <label class="tts-config-active-toggle">
              <input v-model="rhTtsConfigForm.is_active" type="checkbox" />
              启用此配置
            </label>
          </div>
        </section>
        <section class="setup-panel card jimeng-session-panel">
          <div class="setup-panel-head compact">
            <div>
              <div class="setup-kicker">工具箱</div>
              <div class="setup-title">去字幕 API（本机 VSR）</div>
              <div class="setup-desc">
                本机 GPU 运行
                <a href="https://github.com/foryou666/video-subtitle-remover" target="_blank" rel="noopener">video-subtitle-remover</a>
                + <code>tools/vsr-api</code>，线上服务器通过隧道访问。
              </div>
              <div class="setup-desc jimeng-cookie-hint">
                本机启动：<code>cd tools/vsr-api; .\setup.ps1; .\start.ps1</code>。
                用 cpolar/ngrok 暴露 <code>:7861</code>，此处填隧道根地址（无末尾斜杠）。
              </div>
            </div>
            <div class="jimeng-session-status">
              <span class="tag" :class="vsrConfigConfigured ? 'tag-accent' : ''">{{ vsrConfigStatusLabel }}</span>
              <span v-if="vsrConfigSource === 'env'" class="mono dim">当前来自环境变量</span>
            </div>
          </div>
          <div class="tts-config-fields">
            <label class="tts-config-label">
              API 地址
              <input v-model="vsrConfigForm.base_url" class="input" type="url" placeholder="https://xxx.cpolar.cn" />
            </label>
            <label class="tts-config-label">
              API Key
              <input v-model="vsrConfigForm.api_key" class="input" type="password" placeholder="与 VSR_API_KEY 一致" autocomplete="new-password" />
            </label>
          </div>
          <div v-if="vsrConfigTestResult" class="tts-config-test-result" :class="{ ok: vsrConfigTestResult.reachable }">
            {{ vsrConfigTestResult.message }}
            <span v-if="vsrConfigTestResult.vsr_ready != null" class="mono dim">VSR {{ vsrConfigTestResult.vsr_ready ? '就绪' : '未安装' }}</span>
          </div>
          <div class="jimeng-session-actions">
            <button type="button" class="btn btn-sm btn-primary" :disabled="vsrConfigSaving || !vsrConfigForm.base_url.trim()" @click="saveVsrConfig">
              {{ vsrConfigSaving ? '保存中…' : '保存配置' }}
            </button>
            <button type="button" class="btn btn-sm" :disabled="vsrConfigTesting || !vsrConfigForm.base_url.trim()" @click="testVsrConfig">
              {{ vsrConfigTesting ? '测试中…' : '测试连通' }}
            </button>
            <label class="tts-config-active-toggle">
              <input v-model="vsrConfigForm.is_active" type="checkbox" />
              启用此配置
            </label>
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
              <img v-if="showBrandImage" :src="brandLogo" alt="影光工场" class="settings-brand-logo" @error="showBrandImage = false" />
              <span v-else class="settings-brand-fallback">红</span>
            </div>
            <div class="settings-brand-copy">
              <div class="settings-brand-kicker">Yingguang Studio</div>
              <div class="settings-brand-name">影光工场</div>
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
                <img v-if="showBrandImage" :src="brandLogo" alt="影光工场" class="settings-brand-logo" @error="showBrandImage = false" />
                <span v-else class="settings-brand-fallback">红</span>
              </div>
              <div class="settings-brand-copy">
                <div class="settings-brand-kicker">Yingguang Studio</div>
                <div class="settings-brand-name">影光工场</div>
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
      <div v-else-if="tab === 'credits' && isAdmin" class="settings-scroll">
        <div class="settings-head">
          <h2 class="settings-title">积分管理</h2>
          <p class="settings-desc">配置各操作的积分单价，并为团队成员充值。后续可按 1 元 = 100 积分 对接充值。</p>
        </div>
        <section class="setup-panel card grant-credits-panel">
          <div class="setup-title">为用户充值</div>
          <p class="dim setup-pricing-hint">选择用户并填写积分数量。充值后立即生效，可在用户下拉中看到最新余额。</p>
          <form class="user-create-form grant-credits-form" @submit.prevent="grantCredits">
            <select v-model.number="grantForm.user_id" class="input" required>
              <option :value="0" disabled hidden>选择用户</option>
              <option v-for="u in grantableTeamUsers" :key="u.id" :value="u.id">{{ u.display_name || u.username }}（{{ u.credits_balance ?? 0 }} 积分）</option>
            </select>
            <input v-model.number="grantForm.amount" class="input" type="number" min="1" step="1" placeholder="充值积分" required />
            <input v-model="grantForm.summary" class="input" placeholder="备注（可选）" />
            <button type="submit" class="btn btn-primary" :disabled="grantSaving">
              {{ grantSaving ? '充值中…' : '充值' }}
            </button>
          </form>
          <p v-if="!grantableTeamUsers.length" class="dim grant-credits-empty">暂无可充值用户（可能全部被冻结）。</p>
        </section>
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
          <p class="dim setup-pricing-hint">每个上游 model_id 可单独启用或禁用；<strong>禁用后前台通道1页不再显示该模型</strong>。上游按秒的线路本站也按秒扣费（单价×时长），按次线路仍按条。在「AI 服务」中刷新橙盟配置可同步新模型定价项。</p>
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
                    <span class="dim pricing-unit">{{ pricingUnit(item.action, item) }}</span>
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
                      <span class="dim pricing-unit">{{ pricingUnit(item.action, item) }}</span>
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
          <p class="dim setup-pricing-hint">按秒计费（默认 S 2.5 130 / Fast VIP 标价 60·实收 48（8折）/ VIP 80 积分/秒；VIP 有用户参考视频时 130）。S 2.5 自带参考视频 7 折。前台展示 S 2.5 / Fast VIP / VIP；Session 在「AI 服务」中配置。</p>
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
                    <span class="dim pricing-unit">{{ pricingUnit(item.action, item) }}</span>
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
          <p class="dim setup-pricing-hint">通道2 / S通道9 为<strong>时长×分辨率一口价</strong>（管理端参考值为 5s·480p）；通道4 / S通道5·S 2.5 / S通道7 / 通道8(梦工厂专用) 填<strong>每秒</strong>积分；通道1/3、S通道5·2.0 与 grok视频 填<strong>每条</strong>积分。通道1 各模型见上方「橙盟模型（通道1）」；通道3 见上方表格；通道4 见上方「Seedance 通道4」。</p>
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
                    <span class="dim pricing-unit">{{ pricingUnit(item.action, item) }}</span>
                  </div>
                </td>
                <td><button type="button" class="btn btn-sm" @click="savePricing(item)">保存</button></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- ===== 团队管理 ===== -->
      <div v-else-if="tab === 'team'" class="settings-scroll">
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
      <div v-else-if="tab === 'users' && isAdmin" class="settings-scroll">
        <div class="settings-head">
          <h2 class="settings-title">用户管理</h2>
          <p class="settings-desc">创建团队成员账号，可为已有用户重置密码、限制登录 IP，或冻结/解冻账号。冻结后用户无法登录且现有会话立即失效。普通用户可制作项目；管理员可修改全局设置。</p>
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
          <div class="setup-title">按团队批量设置登录 IP</div>
          <p class="setup-desc">
            限制该团队成员只能从指定 IP / 网段登录。留空并保存可清除限制。
            支持单 IP（如 <code>1.2.3.4</code>）与 IPv4 CIDR（如 <code>1.2.3.0/24</code>），每行一条。
            平台管理员账号不受 IP 限制，避免误锁死后台。
          </p>
          <div class="login-ip-bulk-form">
            <label class="field">
              <span class="field-label">团队</span>
              <select v-model="bulkLoginIpTeamId" class="input" @change="onBulkLoginIpTeamChange">
                <option value="">选择团队</option>
                <option v-for="t in loginIpTeams" :key="t.id" :value="String(t.id)">{{ t.name }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">允许的 IP（每行一条）</span>
              <textarea
                v-model="bulkLoginIpText"
                class="input login-ip-textarea"
                rows="4"
                placeholder="例如：&#10;203.0.113.10&#10;203.0.113.0/24"
              />
            </label>
            <label class="field field-inline">
              <input v-model="bulkLoginIpAlsoMembers" type="checkbox" />
              <span>同时写入每位成员的个人白名单（推荐）</span>
            </label>
            <div class="login-ip-bulk-actions">
              <button
                type="button"
                class="btn btn-primary"
                :disabled="!bulkLoginIpTeamId || bulkLoginIpSaving"
                @click="saveBulkLoginIps"
              >
                {{ bulkLoginIpSaving ? '保存中…' : '保存团队规则' }}
              </button>
              <button
                type="button"
                class="btn"
                :disabled="!bulkLoginIpTeamId || bulkLoginIpSaving"
                @click="clearBulkLoginIps"
              >
                清除限制
              </button>
            </div>
          </div>
        </section>

        <section class="setup-panel card">
          <div class="setup-title">已有用户</div>
          <table class="user-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>显示名</th>
                <th>角色</th>
                <th>状态</th>
                <th>积分</th>
                <th>登录 IP</th>
                <th>最近登录</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in teamUsers" :key="u.id">
                <td>{{ u.username }}</td>
                <td>{{ u.display_name }}</td>
                <td><span class="tag">{{ u.role === 'admin' ? '管理员' : '用户' }}</span></td>
                <td>
                  <span v-if="u.is_active" class="tag tag-success">正常</span>
                  <span v-else class="tag tag-danger">已冻结</span>
                </td>
                <td class="mono">{{ u.credits_balance ?? 0 }}</td>
                <td>
                  <span v-if="u.role === 'admin'" class="dim">不受限</span>
                  <span v-else-if="(u.allowed_ips || []).length" class="tag" :title="(u.allowed_ips || []).join(', ')">
                    {{ (u.allowed_ips || []).length }} 条
                  </span>
                  <span v-else class="dim">不限</span>
                </td>
                <td class="dim mono">
                  <div>{{ u.last_login_at ? fmtUserTime(u.last_login_at) : '—' }}</div>
                  <div v-if="u.last_login_ip" class="login-ip-last">{{ u.last_login_ip }}</div>
                </td>
                <td class="user-table-actions">
                  <button type="button" class="btn btn-sm" @click="openPasswordDialog(u)">改密码</button>
                  <button
                    v-if="u.role !== 'admin'"
                    type="button"
                    class="btn btn-sm"
                    @click="openLoginIpDialog(u)"
                  >登录IP</button>
                  <button
                    v-if="u.is_active && u.id !== user?.id"
                    type="button"
                    class="btn btn-sm btn-danger-outline"
                    :disabled="userFreezeLoadingId === u.id"
                    @click="toggleUserFreeze(u, false)"
                  >
                    {{ userFreezeLoadingId === u.id ? '处理中…' : '冻结' }}
                  </button>
                  <button
                    v-else-if="!u.is_active"
                    type="button"
                    class="btn btn-sm"
                    :disabled="userFreezeLoadingId === u.id"
                    @click="toggleUserFreeze(u, true)"
                  >
                    {{ userFreezeLoadingId === u.id ? '处理中…' : '解冻' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- ===== 生图记录（含即梦账号，仅后台） ===== -->
      <AdminImageRecordsPanel v-else-if="tab === 'image-records' && isAdmin" />
      <AdminPortraitCertsPanel v-else-if="tab === 'portrait-certs' && isAdmin" />
      <AdminMusicRecordsPanel v-else-if="tab === 'music-records' && isAdmin" />
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
          <input v-model="cfgForm.name" class="input" placeholder="如 影光工场默认图像服务" />
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

    <!-- Yingguang Studio Preset Dialog -->
    <div v-if="presetDialog" class="overlay" @click.self="presetDialog = false">
      <form class="modal card config-modal" @submit.prevent="applyHuobaoPreset">
        <div class="config-modal-head">
          <div>
            <div class="setup-kicker">Yingguang Preset</div>
            <h2 class="modal-title">影光工场一键配置</h2>
            <div class="modal-note">按影光工场推荐链路自动创建或更新 4 条服务配置，并同时初始化 5 个 Agent 的默认模型。</div>
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

    <!-- User Password Dialog -->
    <div v-if="passwordDialogUser" class="overlay" @click.self="closePasswordDialog">
      <form class="modal card" @submit.prevent="saveUserPassword">
        <h2 class="modal-title">修改密码</h2>
        <p class="dim modal-note">
          用户：{{ passwordDialogUser.username }}
          <span v-if="passwordDialogUser.display_name">（{{ passwordDialogUser.display_name }}）</span>
        </p>
        <label class="field">
          <span class="field-label">新密码</span>
          <input
            v-model="passwordEditValue"
            class="input"
            type="password"
            placeholder="至少 6 位"
            minlength="6"
            autocomplete="new-password"
            required
          />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" @click="closePasswordDialog">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="passwordSaving">
            {{ passwordSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </div>

    <!-- User Login IP Dialog -->
    <div v-if="loginIpDialogUser" class="overlay" @click.self="closeLoginIpDialog">
      <form class="modal card" @submit.prevent="saveUserLoginIps">
        <h2 class="modal-title">登录 IP 白名单</h2>
        <p class="dim modal-note">
          用户：{{ loginIpDialogUser.username }}
          <span v-if="loginIpDialogUser.display_name">（{{ loginIpDialogUser.display_name }}）</span>
        </p>
        <p class="setup-desc">
          留空表示不单独限制该用户（仍可能受其所属团队规则约束）。每行一个 IP 或 IPv4 CIDR。
        </p>
        <label class="field">
          <span class="field-label">允许的 IP</span>
          <textarea
            v-model="loginIpEditText"
            class="input login-ip-textarea"
            rows="5"
            placeholder="例如：&#10;203.0.113.10&#10;203.0.113.0/24"
          />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" @click="closeLoginIpDialog">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="loginIpSaving">
            {{ loginIpSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </div>

    <!-- S通道5 / 小云雀 Key 编辑 -->
    <div v-if="xyqEditDialog" class="overlay" @click.self="closeXyqEditDialog">
      <form class="modal card config-modal" @submit.prevent="saveXyqEditDialog">
        <div class="config-modal-head">
          <div>
            <h2 class="modal-title">编辑 Access Key</h2>
            <div class="modal-note">
              当前 Key：{{ xyqEditForm.access_key_masked || '—' }}
              <span v-if="xyqEditForm.has_cookie"> · 已绑 Cookie</span>
              <span v-else> · 未绑 Cookie</span>
            </div>
          </div>
        </div>
        <label class="field">
          <span class="field-label">备注</span>
          <input v-model="xyqEditForm.label" class="input" type="text" placeholder="如：账号A" />
        </label>
        <label class="field">
          <span class="field-label">Access Key <span class="dim">（留空则不改）</span></span>
          <textarea
            v-model="xyqEditForm.access_key"
            class="input jimeng-session-input"
            rows="2"
            placeholder="粘贴新的 Access Key；留空保持原 Key"
          />
        </label>
        <label class="field">
          <span class="field-label">网页 Cookie <span class="dim">（用于查询剩余积分 / 到期）</span></span>
          <textarea
            v-model="xyqEditForm.cookie"
            class="input jimeng-session-input"
            rows="4"
            placeholder="粘贴 Cookie；留空则不改已有 Cookie"
            :disabled="xyqEditForm.clear_cookie"
          />
        </label>
        <label class="field field-inline">
          <input v-model="xyqEditForm.clear_cookie" type="checkbox" />
          <span class="field-label">清除已绑定的 Cookie</span>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" @click="closeXyqEditDialog">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="xyqSessionSaving">
            {{ xyqSessionSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { Plus, Pencil, Trash2, FileText, ChevronDown, Check, Loader2, Bot, Cpu, Sparkles, Users, Coins, Building2, ImageIcon, BadgeCheck, Music2 } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'
import AdminImageRecordsPanel from '~/components/AdminImageRecordsPanel.vue'
import AdminPortraitCertsPanel from '~/components/AdminPortraitCertsPanel.vue'
import AdminMusicRecordsPanel from '~/components/AdminMusicRecordsPanel.vue'
import { toast } from 'vue-sonner'
import { aiConfigAPI, agentConfigAPI, skillsAPI, usersAPI, creditsAPI, teamsAPI, jimengSessionAPI, xyqSessionAPI, cozeSessionAPI, funshionSessionAPI, xingyuemengSessionAPI, doubaoTrainingSessionAPI, ttsAPI, ttsRunninghubAPI, subtitleRemoverAPI } from '~/composables/useApi'
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
      { id: 'image-records', label: '生图记录', icon: ImageIcon },
      { id: 'portrait-certs', label: '人像认证', icon: BadgeCheck },
      { id: 'music-records', label: '音乐记录', icon: Music2 },
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
const jimengForceSessionId = ref('')
const jimengSessionInput = ref('')
const jimengSessionLabel = ref('')
const jimengSessionSaving = ref(false)
const jimengAccessEnabled = ref(true)
const jimengAccessDefaultRate = ref(20)
const jimengAccessTeams = ref([])
const jimengAccessAvailableTeams = ref([])
const jimengAccessAddTeamId = ref('')
const jimengAccessSaving = ref(false)
const xyqSessions = ref([])
const xyqSessionInput = ref('')
const xyqSessionCookieInput = ref('')
const xyqSessionLabel = ref('')
const xyqSessionSaving = ref(false)
const xyqCreditsLoading = ref(false)
const xyqEditDialog = ref(false)
const xyqEditForm = ref({
  id: '',
  label: '',
  access_key: '',
  access_key_masked: '',
  cookie: '',
  has_cookie: false,
  clear_cookie: false,
})
const cozeSessions = ref([])
const cozeSessionCookieInput = ref('')
const cozeSessionApiKeyInput = ref('')
const cozeSessionBaseUrlInput = ref('')
const cozeSessionLabel = ref('')
const cozeSessionSaving = ref(false)
const funshionSessions = ref([])
const funshionSessionTokenInput = ref('')
const funshionSessionProjectIdInput = ref('')
const funshionSessionAppIdInput = ref('')
const funshionSessionBaseUrlInput = ref('')
const funshionSessionLabel = ref('')
const funshionSessionSaving = ref(false)
const funshionCreditsLoading = ref(false)
const xingyuemengSessions = ref([])
const xingyuemengSessionTokenInput = ref('')
const xingyuemengSessionTeamIdInput = ref('')
const xingyuemengSessionProjectIdInput = ref('')
const xingyuemengSessionEpisodeIdInput = ref('')
const xingyuemengSessionLabel = ref('')
const xingyuemengSessionSaving = ref(false)
const jimengCreditsLoading = ref(false)
const chengmengBalanceLoading = ref(false)
const chengmengBalanceError = ref('')
const chengmengBalanceAccounts = ref([])
const chengmengBalanceTasks = ref([])
const chengmengBalanceTasksTotal = ref(0)
const chengmengBalanceTasksError = ref('')
const aistarslabBalanceLoading = ref(false)
const aistarslabBalanceError = ref('')
const aistarslabBalanceAccounts = ref([])
const aistarslabBalanceTasks = ref([])
const aistarslabBalanceTasksError = ref('')
const aigcccBalanceLoading = ref(false)
const aigcccBalanceError = ref('')
const aigcccBalanceAccounts = ref([])
const aigcccBalanceTasks = ref([])
const aigcccBalanceTasksError = ref('')
const officialBalanceLoading = ref(false)
const officialBalanceError = ref('')
const officialBalanceAccounts = ref([])
const officialBalanceTasks = ref([])
const officialBalanceTasksError = ref('')
const officialBalancePage = ref(1)
const officialBalancePageSize = 20
const officialBalanceTasksTotal = ref(0)
const officialBalanceHasMore = ref(false)
const officialPnlLoading = ref(false)
const officialPnlError = ref('')
const officialPnlSummary = ref(null)
const officialPnlBackfill = ref(null)
const officialPnlByModel = ref([])
const officialPnlLines = ref([])
const officialPnlPagination = ref({ total: 0, has_more: false })
const officialPnlPage = ref(1)
const officialPnlPageSize = 50
const officialPnlDays = ref(0)
const officialBillSync = ref(null)
const officialKeySaving = ref(false)
const officialKeyForm = reactive({
  editing_id: null,
  name: '',
  billing_label: '',
  api_key: '',
  access_key: '',
  secret_key: '',
  activate: false,
  has_ak: false,
  has_sk: false,
})

function resetOfficialKeyForm() {
  officialKeyForm.editing_id = null
  officialKeyForm.name = ''
  officialKeyForm.billing_label = ''
  officialKeyForm.api_key = ''
  officialKeyForm.access_key = ''
  officialKeyForm.secret_key = ''
  officialKeyForm.activate = false
  officialKeyForm.has_ak = false
  officialKeyForm.has_sk = false
}

function startEditOfficialKey(item) {
  if (!item?.config_id) return
  officialKeyForm.editing_id = item.config_id
  officialKeyForm.name = String(item.name || '').replace(/^火山方舟[·\-\s]*/u, '') || String(item.name || '')
  officialKeyForm.billing_label = String(item.billing_label || '')
  officialKeyForm.api_key = ''
  officialKeyForm.access_key = ''
  officialKeyForm.secret_key = ''
  officialKeyForm.activate = false
  officialKeyForm.has_ak = Boolean(item.has_billing_credentials || item.access_key_masked)
  officialKeyForm.has_sk = Boolean(item.has_billing_credentials)
  // 滚到表单区域更易操作
  try {
    document.querySelector('.jimeng-session-actions')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch {}
}

async function saveOfficialKey() {
  if (officialKeySaving.value) return
  const editingId = officialKeyForm.editing_id
  if (!editingId && !officialKeyForm.api_key.trim()) return
  officialKeySaving.value = true
  try {
    if (editingId) {
      const payload = {
        name: officialKeyForm.name.trim() || undefined,
        billing_label: officialKeyForm.billing_label.trim() || null,
      }
      if (officialKeyForm.api_key.trim()) payload.api_key = officialKeyForm.api_key.trim()
      if (officialKeyForm.access_key.trim()) payload.access_key = officialKeyForm.access_key.trim()
      if (officialKeyForm.secret_key.trim()) payload.secret_key = officialKeyForm.secret_key.trim()
      await aiConfigAPI.officialKeyUpdate(editingId, payload)
      toast.success('通道2 API Key 已更新')
    } else {
      await aiConfigAPI.officialKeyCreate({
        name: officialKeyForm.name.trim() || undefined,
        billing_label: officialKeyForm.billing_label.trim() || undefined,
        api_key: officialKeyForm.api_key.trim(),
        access_key: officialKeyForm.access_key.trim() || undefined,
        secret_key: officialKeyForm.secret_key.trim() || undefined,
        activate: !!officialKeyForm.activate,
      })
      toast.success('通道2 API Key 已添加')
    }
    resetOfficialKeyForm()
    await loadOfficialBalance()
  } catch (err) {
    toast.error(err?.message || (editingId ? '更新失败' : '添加失败'))
  } finally {
    officialKeySaving.value = false
  }
}
const doubaoTrainingSessions = ref([])
const doubaoTrainingSessionInput = ref('')
const doubaoTrainingSessionLabel = ref('')
const doubaoTrainingSessionSaving = ref(false)
const doubaoTrainingDailyQuota = ref(5)

const ttsConfigForm = reactive({
  base_url: '',
  api_key: '',
  default_voice: 'voice_01',
  is_active: true,
})
const ttsConfigSaving = ref(false)
const ttsConfigTesting = ref(false)
const ttsConfigTestResult = ref(null)
const ttsConfigSource = ref('none')
const ttsConfigConfigured = computed(() => !!ttsConfigForm.base_url.trim())
const ttsConfigStatusLabel = computed(() => {
  if (ttsConfigSource.value === 'database' && ttsConfigForm.is_active) return '已配置'
  if (ttsConfigSource.value === 'env') return '环境变量'
  if (ttsConfigForm.base_url.trim()) return '未保存'
  return '未配置'
})

const rhTtsConfigForm = reactive({
  api_key: '',
  api_base: 'https://www.runninghub.cn',
  workflow_id: '2012710824451772417',
  webapp_id: '2012809189353070594',
  api_mode: 'openapi_v2',
  is_active: true,
})
const rhTtsNodeTemplateText = ref('')
const rhTtsConfigSaving = ref(false)
const rhTtsConfigTesting = ref(false)
const rhTtsConfigSyncing = ref(false)
const rhTtsConfigTestResult = ref(null)
const rhTtsConfigSource = ref('none')
const rhTtsHasBindings = ref(false)
const rhTtsHasApiKey = ref(false)
const rhTtsApiKeyMasked = ref('')
const rhTtsConfigConfigured = computed(() => rhTtsHasApiKey.value || !!rhTtsConfigForm.api_key.trim())
const rhTtsConfigStatusLabel = computed(() => {
  if (rhTtsConfigSource.value === 'database' && rhTtsConfigForm.is_active) return '已配置'
  if (rhTtsConfigSource.value === 'database_inactive' && rhTtsHasApiKey.value) return '已保存未启用'
  if (rhTtsConfigSource.value === 'env') return '环境变量'
  if (rhTtsConfigForm.api_key.trim()) return '未保存'
  if (rhTtsHasApiKey.value) return '已配置'
  return '未配置'
})

const vsrConfigForm = reactive({
  base_url: '',
  api_key: '',
  is_active: true,
})
const vsrConfigSaving = ref(false)
const vsrConfigTesting = ref(false)
const vsrConfigTestResult = ref(null)
const vsrConfigSource = ref('none')
const vsrConfigConfigured = computed(() => !!vsrConfigForm.base_url.trim())
const vsrConfigStatusLabel = computed(() => {
  if (vsrConfigSource.value === 'database' && vsrConfigForm.is_active) return '已配置'
  if (vsrConfigSource.value === 'env') return '环境变量'
  if (vsrConfigForm.base_url.trim()) return '未保存'
  return '未配置'
})

const jimengHasValidSession = computed(() => jimengSessions.value.some(item => item.valid))
const jimengSessionConfigured = computed(() => jimengSessions.value.length > 0)
const xyqHasValidKey = computed(() => xyqSessions.value.some(item => item.valid))
const xyqKeyConfigured = computed(() => xyqSessions.value.length > 0)
const xyqKeyStatusLabel = computed(() => {
  if (xyqHasValidKey.value) return 'Key 可用'
  if (xyqKeyConfigured.value) return 'Key 均无效'
  return '未配置 Access Key'
})
const cozeHasValidSession = computed(() => cozeSessions.value.some(item => item.valid))
const cozeSessionConfigured = computed(() => cozeSessions.value.length > 0)
const cozeSessionStatusLabel = computed(() => {
  if (cozeHasValidSession.value) return 'Session 可用'
  if (cozeSessionConfigured.value) return 'Session 均无效'
  return '未配置'
})
const funshionHasValidSession = computed(() => funshionSessions.value.some(item => item.valid))
const funshionSessionConfigured = computed(() => funshionSessions.value.length > 0)
const funshionSessionStatusLabel = computed(() => {
  if (funshionHasValidSession.value) return 'Session 可用'
  if (funshionSessionConfigured.value) return 'Session 均无效'
  return '未配置'
})
const funshionActiveCoinLabel = computed(() => {
  const active = funshionSessions.value.find(item => item.is_active && item.valid && item.coin_amount != null)
    || funshionSessions.value.find(item => item.valid && item.coin_amount != null)
  if (!active || active.coin_amount == null) return ''
  return `上游 ${active.coin_amount} 星币`
})

function funshionCoinTitle(item) {
  if (!item) return ''
  const parts = []
  if (item.coin_vip != null) parts.push(`VIP ${item.coin_vip}`)
  if (item.coin_package != null) parts.push(`套餐 ${item.coin_package}`)
  if (item.coin_give != null) parts.push(`赠送 ${item.coin_give}`)
  if (item.coin_error) parts.push(item.coin_error)
  return parts.length ? parts.join(' · ') : '橙星上游星币余额'
}
const xingyuemengHasValidSession = computed(() => xingyuemengSessions.value.some(item => item.valid))
const xingyuemengSessionConfigured = computed(() => xingyuemengSessions.value.length > 0)
const xingyuemengSessionStatusLabel = computed(() => {
  if (xingyuemengHasValidSession.value) return 'Session 可用'
  if (xingyuemengSessionConfigured.value) return 'Session 均无效'
  return '未配置'
})

const jimengSessionStatusLabel = computed(() => {
  if (jimengForceSessionId.value) return '强制全员使用中'
  if (jimengHasValidSession.value) return '有可用 Session'
  if (jimengSessionConfigured.value) return 'Session 均无效或已过期'
  return '未配置'
})

const jimengForceSessionLabel = computed(() => {
  if (!jimengForceSessionId.value) return ''
  const item = jimengSessions.value.find(s => s.id === jimengForceSessionId.value)
  if (!item) return jimengForceSessionId.value
  return item.label || item.session_id_masked || item.id
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

async function loadTtsConfig() {
  if (!isAdmin.value) return
  try {
    const res = await ttsAPI.getConfig()
    ttsConfigSource.value = res?.source || 'none'
    ttsConfigForm.base_url = res?.base_url || ''
    ttsConfigForm.api_key = res?.api_key || ''
    ttsConfigForm.default_voice = res?.default_voice || 'voice_01'
    ttsConfigForm.is_active = res?.is_active !== false
    ttsConfigTestResult.value = null
  } catch (e) {
    toast.error(e.message || '加载 TTS 配置失败')
  }
}

async function saveTtsConfig() {
  if (!ttsConfigForm.base_url.trim()) return
  ttsConfigSaving.value = true
  try {
    const res = await ttsAPI.saveConfig({
      base_url: ttsConfigForm.base_url.trim(),
      api_key: ttsConfigForm.api_key || undefined,
      default_voice: ttsConfigForm.default_voice.trim() || 'voice_01',
      is_active: ttsConfigForm.is_active,
    })
    ttsConfigSource.value = res?.source || 'database'
    ttsConfigForm.api_key = res?.api_key || '********'
    toast.success('TTS API 配置已保存')
    await loadCfgs()
  } catch (e) {
    toast.error(e.message || '保存失败')
  } finally {
    ttsConfigSaving.value = false
  }
}

async function testTtsConfig() {
  if (!ttsConfigForm.base_url.trim()) return
  ttsConfigTesting.value = true
  ttsConfigTestResult.value = null
  try {
    ttsConfigTestResult.value = await ttsAPI.testConfig({ base_url: ttsConfigForm.base_url.trim() })
  } catch (e) {
    ttsConfigTestResult.value = { reachable: false, message: e.message || '测试失败' }
  } finally {
    ttsConfigTesting.value = false
  }
}

async function loadRhTtsConfig() {
  if (!isAdmin.value) return
  try {
    const res = await ttsRunninghubAPI.getConfig()
    rhTtsConfigSource.value = res?.source || 'none'
    rhTtsHasApiKey.value = !!(res?.has_api_key || res?.configured)
    rhTtsApiKeyMasked.value = res?.api_key_masked || ''
    // 输入框保持空白，避免把掩码当真实 Key 再存回去
    rhTtsConfigForm.api_key = ''
    rhTtsConfigForm.api_base = res?.api_base || 'https://www.runninghub.cn'
    rhTtsConfigForm.workflow_id = res?.workflow_id || '2012710824451772417'
    rhTtsConfigForm.webapp_id = res?.webapp_id || '2012809189353070594'
    rhTtsConfigForm.api_mode = res?.api_mode || 'openapi_v2'
    // 已有 Key 时默认勾选启用，避免「保存了却未启用」
    rhTtsConfigForm.is_active = res?.is_active !== false || rhTtsHasApiKey.value
    rhTtsHasBindings.value = !!res?.has_bindings
    const tpl = res?.node_info_template
    rhTtsNodeTemplateText.value = Array.isArray(tpl) && tpl.length
      ? JSON.stringify(tpl, null, 2)
      : ''
    rhTtsConfigTestResult.value = null
  } catch (e) {
    toast.error(e.message || '加载 RunningHub 配置失败')
  }
}

async function saveRhTtsConfig() {
  if (!rhTtsConfigForm.api_key.trim() && !rhTtsHasApiKey.value) return
  rhTtsConfigSaving.value = true
  try {
    let nodeInfoTemplate
    const raw = rhTtsNodeTemplateText.value.trim()
    if (raw) {
      try {
        nodeInfoTemplate = JSON.parse(raw)
      } catch {
        toast.error('nodeInfoList 模板不是合法 JSON')
        return
      }
    }
    const res = await ttsRunninghubAPI.saveConfig({
      // 空字符串表示不改动已保存 Key
      api_key: rhTtsConfigForm.api_key.trim() || undefined,
      api_base: rhTtsConfigForm.api_base.trim() || undefined,
      workflow_id: rhTtsConfigForm.workflow_id.trim() || undefined,
      webapp_id: rhTtsConfigForm.webapp_id.trim() || undefined,
      api_mode: rhTtsConfigForm.api_mode,
      node_info_template: nodeInfoTemplate,
      is_active: true,
    })
    rhTtsConfigSource.value = res?.source || 'database'
    rhTtsHasApiKey.value = !!(res?.has_api_key || res?.configured)
    rhTtsApiKeyMasked.value = res?.api_key_masked || ''
    rhTtsConfigForm.api_key = ''
    rhTtsConfigForm.is_active = res?.is_active !== false
    rhTtsHasBindings.value = !!res?.has_bindings
    toast.success('RunningHub IndexTTS2 配置已保存')
    await loadCfgs()
  } catch (e) {
    toast.error(e.message || '保存失败')
  } finally {
    rhTtsConfigSaving.value = false
  }
}

async function testRhTtsConfig() {
  rhTtsConfigTesting.value = true
  rhTtsConfigTestResult.value = null
  try {
    rhTtsConfigTestResult.value = await ttsRunninghubAPI.testConfig({
      api_key: rhTtsConfigForm.api_key || undefined,
      api_base: rhTtsConfigForm.api_base.trim() || undefined,
    })
  } catch (e) {
    rhTtsConfigTestResult.value = { ok: false, reachable: false, message: e.message || '测试失败' }
  } finally {
    rhTtsConfigTesting.value = false
  }
}

async function syncRhTtsConfig() {
  rhTtsConfigSyncing.value = true
  try {
    let nodeInfoTemplate
    const raw = rhTtsNodeTemplateText.value.trim()
    if (raw) {
      // 后端可解析数组 / 请求体 / curl；前端先尝试 JSON
      try {
        nodeInfoTemplate = JSON.parse(raw)
      } catch {
        nodeInfoTemplate = raw
      }
    }
    const res = await ttsRunninghubAPI.syncConfig({
      api_key: rhTtsConfigForm.api_key || undefined,
      node_info_template: nodeInfoTemplate,
    })
    rhTtsConfigSource.value = res?.source || 'database'
    rhTtsConfigForm.api_key = res?.api_key || '********'
    rhTtsHasBindings.value = !!res?.has_bindings
    const tpl = res?.node_info_template
    if (Array.isArray(tpl) && tpl.length) {
      rhTtsNodeTemplateText.value = JSON.stringify(tpl, null, 2)
    }
    toast.success(res?.sync_source === 'manual' ? '已根据粘贴模板推断节点映射' : `已同步节点参数（${res?.sync_source || 'api'}）`)
  } catch (e) {
    toast.error(e.message || '同步失败')
  } finally {
    rhTtsConfigSyncing.value = false
  }
}

async function loadVsrConfig() {
  if (!isAdmin.value) return
  try {
    const res = await subtitleRemoverAPI.getConfig()
    vsrConfigSource.value = res?.source || 'none'
    vsrConfigForm.base_url = res?.base_url || ''
    vsrConfigForm.api_key = res?.api_key || ''
    vsrConfigForm.is_active = res?.is_active !== false
    vsrConfigTestResult.value = null
  } catch (e) {
    toast.error(e.message || '加载去字幕配置失败')
  }
}

async function saveVsrConfig() {
  if (!vsrConfigForm.base_url.trim()) return
  vsrConfigSaving.value = true
  try {
    const res = await subtitleRemoverAPI.saveConfig({
      base_url: vsrConfigForm.base_url.trim(),
      api_key: vsrConfigForm.api_key || undefined,
      is_active: vsrConfigForm.is_active,
    })
    vsrConfigSource.value = res?.source || 'database'
    vsrConfigForm.api_key = res?.api_key || '********'
    toast.success('去字幕 API 配置已保存')
    await loadCfgs()
  } catch (e) {
    toast.error(e.message || '保存失败')
  } finally {
    vsrConfigSaving.value = false
  }
}

async function testVsrConfig() {
  if (!vsrConfigForm.base_url.trim()) return
  vsrConfigTesting.value = true
  vsrConfigTestResult.value = null
  try {
    vsrConfigTestResult.value = await subtitleRemoverAPI.testConfig({
      base_url: vsrConfigForm.base_url.trim(),
      api_key: vsrConfigForm.api_key || undefined,
    })
  } catch (e) {
    vsrConfigTestResult.value = { reachable: false, message: e.message || '测试失败' }
  } finally {
    vsrConfigTesting.value = false
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
  jimengCreditsLoading.value = true
  try {
    const res = await jimengSessionAPI.list()
    jimengSessions.value = res?.items || res?.sessions || []
    jimengForceSessionId.value = res?.force_session_id || ''
  } catch {
    jimengSessions.value = []
    jimengForceSessionId.value = ''
  } finally {
    jimengCreditsLoading.value = false
  }
}

async function loadJimengAccessSettings() {
  if (!isAdmin.value) return
  try {
    const res = await jimengSessionAPI.accessSettings()
    jimengAccessEnabled.value = res?.enabled !== false
    jimengAccessDefaultRate.value = Number(res?.default_success_rate ?? 20)
    jimengAccessTeams.value = (res?.teams || []).map(item => ({
      team_id: Number(item.team_id),
      team_name: item.team_name || `团队 #${item.team_id}`,
      success_rate: Number(item.success_rate ?? 100),
    }))
    jimengAccessAvailableTeams.value = res?.available_teams || []
  } catch {
    jimengAccessTeams.value = []
    jimengAccessAvailableTeams.value = []
  }
}

function addJimengAccessTeamRule() {
  const id = Number(jimengAccessAddTeamId.value)
  if (!id) return
  if (jimengAccessTeams.value.some(item => Number(item.team_id) === id)) {
    toast.warning('该团队已在列表中')
    return
  }
  const team = jimengAccessAvailableTeams.value.find(item => Number(item.id) === id)
  jimengAccessTeams.value.push({
    team_id: id,
    team_name: team?.name || `团队 #${id}`,
    success_rate: 100,
  })
  jimengAccessAddTeamId.value = ''
}

async function saveJimengAccessSettings() {
  if (!isAdmin.value) return
  jimengAccessSaving.value = true
  try {
    const res = await jimengSessionAPI.saveAccessSettings({
      enabled: jimengAccessEnabled.value,
      default_success_rate: Number(jimengAccessDefaultRate.value),
      teams: jimengAccessTeams.value.map(item => ({
        team_id: Number(item.team_id),
        success_rate: Number(item.success_rate),
      })),
    })
    jimengAccessEnabled.value = res?.enabled !== false
    jimengAccessDefaultRate.value = Number(res?.default_success_rate ?? 20)
    jimengAccessTeams.value = (res?.teams || []).map(item => ({
      team_id: Number(item.team_id),
      team_name: item.team_name || `团队 #${item.team_id}`,
      success_rate: Number(item.success_rate ?? 100),
    }))
    jimengAccessAvailableTeams.value = res?.available_teams || jimengAccessAvailableTeams.value
    toast.success('通道4提交规则已保存')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    jimengAccessSaving.value = false
  }
}

async function loadChengmengBalance() {
  if (!isAdmin.value) return
  chengmengBalanceLoading.value = true
  chengmengBalanceError.value = ''
  chengmengBalanceTasksError.value = ''
  try {
    const res = await aiConfigAPI.chengmengBalance({ page_size: 20, light: true })
    chengmengBalanceAccounts.value = res?.accounts || []
    chengmengBalanceTasks.value = res?.tasks || []
    chengmengBalanceTasksTotal.value = Number(res?.total || 0)
    if (res?.tasks_error) chengmengBalanceTasksError.value = res.tasks_error
  } catch (err) {
    chengmengBalanceAccounts.value = []
    chengmengBalanceTasks.value = []
    chengmengBalanceTasksTotal.value = 0
    chengmengBalanceError.value = err?.message || '查询通道1余额失败'
  } finally {
    chengmengBalanceLoading.value = false
  }
}

async function loadAistarslabBalance() {
  if (!isAdmin.value) return
  aistarslabBalanceLoading.value = true
  aistarslabBalanceError.value = ''
  aistarslabBalanceTasksError.value = ''
  try {
    const res = await aiConfigAPI.aistarslabBalance({ limit: 20, light: true })
    aistarslabBalanceAccounts.value = res?.accounts || []
    aistarslabBalanceTasks.value = res?.tasks || []
    if (res?.tasks_error) aistarslabBalanceTasksError.value = res.tasks_error
  } catch (err) {
    aistarslabBalanceAccounts.value = []
    aistarslabBalanceTasks.value = []
    aistarslabBalanceError.value = err?.message || '查询通道3余额失败'
  } finally {
    aistarslabBalanceLoading.value = false
  }
}

async function loadAigcccBalance() {
  if (!isAdmin.value) return
  aigcccBalanceLoading.value = true
  aigcccBalanceError.value = ''
  aigcccBalanceTasksError.value = ''
  try {
    const res = await aiConfigAPI.aigcccBalance({ limit: 20 })
    aigcccBalanceAccounts.value = res?.accounts || []
    aigcccBalanceTasks.value = res?.tasks || []
    if (res?.tasks_error) aigcccBalanceTasksError.value = res.tasks_error
  } catch (err) {
    aigcccBalanceAccounts.value = []
    aigcccBalanceTasks.value = []
    aigcccBalanceError.value = err?.message || '查询通道6余额失败'
  } finally {
    aigcccBalanceLoading.value = false
  }
}

async function loadOfficialBalance() {
  return loadOfficialBalancePage(1)
}

async function loadOfficialBalancePage(page) {
  if (!isAdmin.value) return
  const nextPage = Math.max(1, Number(page) || 1)
  officialBalanceLoading.value = true
  officialBalanceError.value = ''
  officialBalanceTasksError.value = ''
  try {
    const res = await aiConfigAPI.officialBalance({
      limit: officialBalancePageSize,
      page: nextPage,
      light: true,
    })
    officialBalanceAccounts.value = res?.accounts || []
    officialBalanceTasks.value = res?.tasks || []
    officialBalancePage.value = Number(res?.page || res?.page_num || nextPage) || nextPage
    officialBalanceTasksTotal.value = Number(res?.total || 0)
    officialBalanceHasMore.value = !!res?.has_more
      || (
        officialBalanceTasksTotal.value > 0
        && officialBalancePage.value * officialBalancePageSize < officialBalanceTasksTotal.value
      )
    if (res?.tasks_error) officialBalanceTasksError.value = res.tasks_error
  } catch (err) {
    officialBalanceAccounts.value = []
    officialBalanceTasks.value = []
    officialBalanceTasksTotal.value = 0
    officialBalanceHasMore.value = false
    officialBalanceError.value = err?.message || '查询通道2用量失败'
  } finally {
    officialBalanceLoading.value = false
  }
}

function officialBalanceTitle(item) {
  if (!item?.balance) return ''
  const parts = []
  if (item.balance.cash_balance != null) parts.push(`现金 ${formatUpstreamMoney(item.balance.cash_balance)}`)
  if (item.balance.freeze_amount != null) parts.push(`冻结 ${formatUpstreamMoney(item.balance.freeze_amount)}`)
  if (item.balance.arrears_balance != null) parts.push(`欠费 ${formatUpstreamMoney(item.balance.arrears_balance)}`)
  return parts.join(' · ')
}

async function activateOfficialKey(id) {
  if (!id || officialKeySaving.value) return
  officialKeySaving.value = true
  try {
    await aiConfigAPI.officialKeyActivate(id)
    toast.success('已切换当前通道2 API Key')
    await loadOfficialBalance()
  } catch (err) {
    toast.error(err?.message || '切换失败')
  } finally {
    officialKeySaving.value = false
  }
}

async function removeOfficialKey(item) {
  if (!item?.config_id || officialKeySaving.value) return
  if (!confirm(`确定删除「${item.name || item.config_id}」？`)) return
  officialKeySaving.value = true
  try {
    await aiConfigAPI.officialKeyDelete(item.config_id)
    toast.success('已删除')
    await loadOfficialBalance()
  } catch (err) {
    toast.error(err?.message || '删除失败')
  } finally {
    officialKeySaving.value = false
  }
}

async function syncOfficialKeysFromEnv() {
  if (officialKeySaving.value) return
  officialKeySaving.value = true
  try {
    const res = await aiConfigAPI.officialKeySyncEnv()
    toast.success(`已同步环境变量：新建 ${res?.created || 0}，更新 ${res?.updated || 0}`)
    await loadOfficialBalance()
  } catch (err) {
    toast.error(err?.message || '同步失败')
  } finally {
    officialKeySaving.value = false
  }
}

function formatUpstreamMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function formatUpstreamCost(cost, unit) {
  if (cost == null || cost === '') return '—'
  const n = Number(cost)
  if (!Number.isFinite(n)) return '—'
  const suffix = unit || ''
  if (suffix === '元') return `${formatUpstreamMoney(n)} 元`
  if (suffix === '积分') return `${n} 积分`
  return `${n}${suffix ? ` ${suffix}` : ''}`
}

function formatAistarslabTaskCost(task) {
  if (!task) return '—'
  if (task.cost_note) return task.cost_note
  if (task.refunded) {
    const listed = Number(task.cost)
    if (Number.isFinite(listed)) return `已退还（原扣 ${listed}）`
    return '已退还'
  }
  return formatUpstreamCost(task.net_cost ?? task.cost, task.cost_unit || '积分')
}

function formatAigcccTaskCost(task) {
  return formatAistarslabTaskCost(task)
}

function formatOfficialTokens(task) {
  const n = Number(task?.tokens ?? task?.completion_tokens ?? task?.total_tokens)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return n.toLocaleString('zh-CN')
}

/** 视频生成时长（秒）；有排队耗时时附注 */
function formatOfficialTaskDuration(task) {
  const videoSec = Number(task?.duration_seconds ?? task?.seconds)
  const elapsed = Number(task?.elapsed_seconds)
  const parts = []
  if (Number.isFinite(videoSec) && videoSec > 0) parts.push(`${Math.round(videoSec)} 秒`)
  if (Number.isFinite(elapsed) && elapsed > 0) {
    const waitLabel = elapsed >= 60
      ? `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`
      : `${elapsed}秒`
    parts.push(parts.length ? `耗时 ${waitLabel}` : waitLabel)
  }
  return parts.length ? parts.join(' · ') : '—'
}

function formatOfficialTaskCost(task) {
  const value = task?.estimated_cost ?? task?.cost
  if (value == null || value === '') return '—'
  return formatUpstreamCost(value, task.cost_unit || '元')
}

function formatOfficialActualCost(task) {
  if (task?.actual_cost == null || task?.actual_cost === '') return '—'
  return formatUpstreamCost(task.actual_cost, task.actual_cost_unit || '元')
}

function formatOfficialSiteCredits(task) {
  const net = task?.site_credits
  if (net == null || net === '') return '—'
  const n = Number(net)
  if (!Number.isFinite(n)) return '—'
  if (task?.site_credits_refunded && task?.site_credits_gross != null) {
    return `${n} 积分（原 ${task.site_credits_gross}）`
  }
  return `${n} 积分`
}

function formatOfficialPnlSigned(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${formatUpstreamMoney(n)}`
}

function formatOfficialPnlMargin(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}

function formatOfficialPnlOutcome(outcome) {
  const map = {
    profit: '盈利',
    loss: '亏损',
    breakeven: '持平',
    missing_actual_cost: '缺实付',
    missing_revenue: '缺实收',
    not_billable: '未计费',
    unknown: '—',
  }
  return map[String(outcome || '')] || outcome || '—'
}

function officialPnlProfitClass(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return n > 0 ? 'official-pnl-positive' : 'official-pnl-negative'
}

async function loadOfficialPnl(backfill = false) {
  return loadOfficialPnlPage(1, backfill)
}

async function loadOfficialPnlPage(page, backfill = false) {
  if (!isAdmin.value) return
  const nextPage = Math.max(1, Number(page) || 1)
  officialPnlLoading.value = true
  officialPnlError.value = ''
  try {
    const res = await aiConfigAPI.officialPnl({
      days: officialPnlDays.value > 0 ? officialPnlDays.value : undefined,
      limit: officialPnlPageSize,
      offset: (nextPage - 1) * officialPnlPageSize,
      sort: 'profit_asc',
      backfill: backfill ? 1 : undefined,
    })
    officialPnlSummary.value = res?.summary || null
    officialPnlBackfill.value = res?.backfill || null
    officialBillSync.value = res?.bill_sync || null
    officialPnlByModel.value = res?.by_model || []
    officialPnlLines.value = res?.lines || []
    officialPnlPagination.value = res?.pagination || { total: 0, has_more: false }
    officialPnlPage.value = nextPage
  } catch (err) {
    officialPnlSummary.value = null
    officialPnlBackfill.value = null
    officialPnlByModel.value = []
    officialPnlLines.value = []
    officialPnlPagination.value = { total: 0, has_more: false }
    officialPnlError.value = err?.message || '通道2盈亏统计失败'
  } finally {
    officialPnlLoading.value = false
  }
}

function officialTaskPlayUrl(task) {
  const raw = String(task?.play_url || task?.local_path || task?.video_url || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/')) return raw
  return `/${raw}`
}

function formatUpstreamDelta(delta, unit) {
  if (delta == null || delta === '') return '—'
  const n = Number(delta)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return unit === '元' ? '0 元' : '0 积分'
  const sign = n > 0 ? '+' : ''
  if (unit === '元') return `${sign}${formatUpstreamMoney(n)} 元`
  return `${sign}${n} 积分`
}

function formatUpstreamBalanceAfter(task, unit) {
  if (task?.balance_after == null || task?.balance_after === '') return '—'
  const n = Number(task.balance_after)
  if (!Number.isFinite(n)) return '—'
  if (unit === '元') return `${formatUpstreamMoney(n)} 元`
  return `${n} 积分`
}

function formatUpstreamTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return '—'
  const d = new Date(raw.includes('T') || raw.includes('Z') || raw.includes('+') ? raw : raw.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return raw.slice(0, 19)
  return d.toLocaleString('zh-CN', { hour12: false })
}

function shortTaskId(value) {
  const id = String(value || '').trim()
  if (!id) return '—'
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}…${id.slice(-6)}`
}

async function loadXyqSessionStatus() {
  if (!isAdmin.value) return
  xyqCreditsLoading.value = true
  try {
    const res = await xyqSessionAPI.list()
    xyqSessions.value = res?.items || res?.sessions || []
  } catch {
    xyqSessions.value = []
  } finally {
    xyqCreditsLoading.value = false
  }
}

async function saveXyqSession() {
  if (!xyqSessionInput.value.trim()) return
  xyqSessionSaving.value = true
  try {
    const cookie = xyqSessionCookieInput.value.trim()
    const res = await xyqSessionAPI.save({
      access_key: xyqSessionInput.value.trim(),
      cookie: cookie || undefined,
      label: xyqSessionLabel.value || undefined,
      set_active: true,
    })
    xyqSessionInput.value = ''
    xyqSessionCookieInput.value = ''
    xyqSessionLabel.value = ''
    await loadXyqSessionStatus()
    toast.success(res?.valid ? 'Access Key 已添加且有效' : 'Access Key 已添加，但验证未通过')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    xyqSessionSaving.value = false
  }
}

function openXyqEditDialog(item) {
  xyqEditForm.value = {
    id: item.id,
    label: item.label || '',
    access_key: '',
    access_key_masked: item.access_key_masked || '',
    cookie: '',
    has_cookie: !!item.has_cookie,
    clear_cookie: false,
  }
  xyqEditDialog.value = true
}

function closeXyqEditDialog() {
  xyqEditDialog.value = false
}

async function saveXyqEditDialog() {
  const form = xyqEditForm.value
  if (!form.id) return
  const accessKey = String(form.access_key || '').trim()
  const cookie = String(form.cookie || '').trim()
  xyqSessionSaving.value = true
  try {
    const payload = {
      id: form.id,
      label: form.label ?? '',
      set_active: false,
    }
    if (accessKey) payload.access_key = accessKey
    if (form.clear_cookie) payload.cookie = null
    else if (cookie) payload.cookie = cookie
    await xyqSessionAPI.save(payload)
    closeXyqEditDialog()
    await loadXyqSessionStatus()
    toast.success('已保存')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    xyqSessionSaving.value = false
  }
}

async function validateXyqSessionItem(id) {
  xyqSessionSaving.value = true
  try {
    const res = await xyqSessionAPI.validate(id)
    await loadXyqSessionStatus()
    toast.success(res?.valid ? 'Access Key 有效' : 'Access Key 无效，请到小云雀重新创建密钥')
  } catch (err) {
    toast.error(err?.message || '验证失败')
  } finally {
    xyqSessionSaving.value = false
  }
}

async function activateXyqSession(id) {
  xyqSessionSaving.value = true
  try {
    await xyqSessionAPI.setActive(id)
    await loadXyqSessionStatus()
    toast.success('已设为当前启用 Access Key')
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    xyqSessionSaving.value = false
  }
}

async function removeXyqSession(id) {
  xyqSessionSaving.value = true
  try {
    await xyqSessionAPI.remove(id)
    await loadXyqSessionStatus()
    toast.success('Access Key 已删除')
  } catch (err) {
    toast.error(err?.message || '删除失败')
  } finally {
    xyqSessionSaving.value = false
  }
}

async function clearXyqSession() {
  if (!confirm('确定清除全部小云雀 Access Key？')) return
  xyqSessionSaving.value = true
  try {
    await xyqSessionAPI.clear()
    await loadXyqSessionStatus()
    toast.success('已清除全部 Access Key')
  } catch (err) {
    toast.error(err?.message || '清除失败')
  } finally {
    xyqSessionSaving.value = false
  }
}

async function loadCozeSessionStatus() {
  if (!isAdmin.value) return
  try {
    const res = await cozeSessionAPI.list()
    cozeSessions.value = res?.items || res?.sessions || []
  } catch {
    cozeSessions.value = []
  }
}

async function saveCozeSession() {
  if (!cozeSessionCookieInput.value.trim() && !cozeSessionApiKeyInput.value.trim()) return
  cozeSessionSaving.value = true
  try {
    const res = await cozeSessionAPI.save({
      cookie: cozeSessionCookieInput.value.trim() || undefined,
      api_key: cozeSessionApiKeyInput.value.trim() || undefined,
      base_url: cozeSessionBaseUrlInput.value.trim() || undefined,
      label: cozeSessionLabel.value || undefined,
      set_active: true,
    })
    cozeSessionCookieInput.value = ''
    cozeSessionApiKeyInput.value = ''
    cozeSessionBaseUrlInput.value = ''
    cozeSessionLabel.value = ''
    await loadCozeSessionStatus()
    toast.success(res?.valid ? '扣子 Session 已添加且有效' : 'Session 已添加，但验证未通过')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    cozeSessionSaving.value = false
  }
}

async function validateCozeSessionItem(id) {
  cozeSessionSaving.value = true
  try {
    const res = await cozeSessionAPI.validate(id)
    await loadCozeSessionStatus()
    toast.success(res?.valid ? 'Session 有效' : 'Session 无效，请检查 Cookie 或 PAT')
  } catch (err) {
    toast.error(err?.message || '验证失败')
  } finally {
    cozeSessionSaving.value = false
  }
}

async function activateCozeSession(id) {
  cozeSessionSaving.value = true
  try {
    await cozeSessionAPI.setActive(id)
    await loadCozeSessionStatus()
    toast.success('已设为当前启用 Session')
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    cozeSessionSaving.value = false
  }
}

async function removeCozeSession(id) {
  cozeSessionSaving.value = true
  try {
    await cozeSessionAPI.remove(id)
    await loadCozeSessionStatus()
    toast.success('Session 已删除')
  } catch (err) {
    toast.error(err?.message || '删除失败')
  } finally {
    cozeSessionSaving.value = false
  }
}

async function clearCozeSession() {
  if (!confirm('确定清除全部扣子 Session？')) return
  cozeSessionSaving.value = true
  try {
    await cozeSessionAPI.clear()
    await loadCozeSessionStatus()
    toast.success('已清除全部 Session')
  } catch (err) {
    toast.error(err?.message || '清除失败')
  } finally {
    cozeSessionSaving.value = false
  }
}

async function loadFunshionSessionStatus() {
  if (!isAdmin.value) return
  funshionCreditsLoading.value = true
  try {
    const res = await funshionSessionAPI.list()
    funshionSessions.value = res?.items || res?.sessions || []
  } catch {
    funshionSessions.value = []
  } finally {
    funshionCreditsLoading.value = false
  }
}

async function saveFunshionSession() {
  if (!funshionSessionTokenInput.value.trim()) return
  if (!funshionSessionProjectIdInput.value.trim() && !funshionSessionAppIdInput.value.trim()) {
    toast.error('请填写项目 ID 或 appId')
    return
  }
  funshionSessionSaving.value = true
  try {
    const res = await funshionSessionAPI.save({
      token: funshionSessionTokenInput.value.trim(),
      project_id: funshionSessionProjectIdInput.value.trim() || undefined,
      app_id: funshionSessionAppIdInput.value.trim() || undefined,
      base_url: funshionSessionBaseUrlInput.value.trim() || undefined,
      label: funshionSessionLabel.value || undefined,
      set_active: true,
    })
    funshionSessionTokenInput.value = ''
    funshionSessionProjectIdInput.value = ''
    funshionSessionAppIdInput.value = ''
    funshionSessionBaseUrlInput.value = ''
    funshionSessionLabel.value = ''
    await loadFunshionSessionStatus()
    toast.success(res?.valid ? '橙星 Session 已添加且有效' : 'Session 已添加，但验证未通过')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    funshionSessionSaving.value = false
  }
}

async function validateFunshionSessionItem(id) {
  funshionSessionSaving.value = true
  try {
    const res = await funshionSessionAPI.validate(id)
    await loadFunshionSessionStatus()
    toast.success(res?.valid ? 'Token 有效' : 'Token 无效，请重新从视频页复制')
  } catch (err) {
    toast.error(err?.message || '验证失败')
  } finally {
    funshionSessionSaving.value = false
  }
}

async function activateFunshionSession(id) {
  funshionSessionSaving.value = true
  try {
    await funshionSessionAPI.setActive(id)
    await loadFunshionSessionStatus()
    toast.success('已设为当前启用 Session')
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    funshionSessionSaving.value = false
  }
}

async function removeFunshionSession(id) {
  funshionSessionSaving.value = true
  try {
    await funshionSessionAPI.remove(id)
    await loadFunshionSessionStatus()
    toast.success('Session 已删除')
  } catch (err) {
    toast.error(err?.message || '删除失败')
  } finally {
    funshionSessionSaving.value = false
  }
}

async function clearFunshionSession() {
  if (!confirm('确定清除全部橙星 Session？')) return
  funshionSessionSaving.value = true
  try {
    await funshionSessionAPI.clear()
    await loadFunshionSessionStatus()
    toast.success('已清除全部 Session')
  } catch (err) {
    toast.error(err?.message || '清除失败')
  } finally {
    funshionSessionSaving.value = false
  }
}

async function loadXingyuemengSessionStatus() {
  if (!isAdmin.value) return
  try {
    const res = await xingyuemengSessionAPI.list()
    xingyuemengSessions.value = res?.items || res?.sessions || []
  } catch {
    xingyuemengSessions.value = []
  }
}

async function saveXingyuemengSession() {
  if (!xingyuemengSessionTokenInput.value.trim()) return
  xingyuemengSessionSaving.value = true
  try {
    const res = await xingyuemengSessionAPI.save({
      token: xingyuemengSessionTokenInput.value.trim(),
      team_id: xingyuemengSessionTeamIdInput.value.trim() || undefined,
      project_id: xingyuemengSessionProjectIdInput.value.trim() || undefined,
      episode_id: xingyuemengSessionEpisodeIdInput.value.trim() || undefined,
      label: xingyuemengSessionLabel.value || undefined,
      set_active: true,
    })
    xingyuemengSessionTokenInput.value = ''
    xingyuemengSessionTeamIdInput.value = ''
    xingyuemengSessionProjectIdInput.value = ''
    xingyuemengSessionEpisodeIdInput.value = ''
    xingyuemengSessionLabel.value = ''
    await loadXingyuemengSessionStatus()
    toast.success(res?.valid ? '星月梦 Session 已添加且有效' : 'Session 已添加，但验证未通过')
  } catch (err) {
    toast.error(err?.message || '保存失败')
  } finally {
    xingyuemengSessionSaving.value = false
  }
}

async function validateXingyuemengSessionItem(id) {
  xingyuemengSessionSaving.value = true
  try {
    const res = await xingyuemengSessionAPI.validate(id)
    await loadXingyuemengSessionStatus()
    toast.success(res?.valid ? 'Token 有效' : 'Token 无效，请重新从视频页复制')
  } catch (err) {
    toast.error(err?.message || '验证失败')
  } finally {
    xingyuemengSessionSaving.value = false
  }
}

async function activateXingyuemengSession(id) {
  xingyuemengSessionSaving.value = true
  try {
    await xingyuemengSessionAPI.setActive(id)
    await loadXingyuemengSessionStatus()
    toast.success('已设为当前启用 Session')
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    xingyuemengSessionSaving.value = false
  }
}

async function removeXingyuemengSession(id) {
  xingyuemengSessionSaving.value = true
  try {
    await xingyuemengSessionAPI.remove(id)
    await loadXingyuemengSessionStatus()
    toast.success('Session 已删除')
  } catch (err) {
    toast.error(err?.message || '删除失败')
  } finally {
    xingyuemengSessionSaving.value = false
  }
}

async function clearXingyuemengSession() {
  if (!confirm('确定清除全部星月梦 Session？')) return
  xingyuemengSessionSaving.value = true
  try {
    await xingyuemengSessionAPI.clear()
    await loadXingyuemengSessionStatus()
    toast.success('已清除全部 Session')
  } catch (err) {
    toast.error(err?.message || '清除失败')
  } finally {
    xingyuemengSessionSaving.value = false
  }
}

function formatJimengCreditExpire(item) {
  const unix = Number(item?.credit_expire_at)
  const iso = item?.credit_expire_at_iso
  const date = Number.isFinite(unix) && unix > 0
    ? new Date(unix * 1000)
    : (iso ? new Date(iso) : null)
  if (!date || Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function jimengCreditTitle(item) {
  if (item?.total_credit == null) return ''
  const parts = []
  if (item.gift_credit != null) parts.push(`赠送 ${item.gift_credit}`)
  if (item.purchase_credit != null) parts.push(`购买 ${item.purchase_credit}`)
  if (item.vip_credit != null) parts.push(`VIP ${item.vip_credit}`)
  const expire = formatJimengCreditExpire(item)
  if (expire) parts.push(`到期 ${expire}`)
  return parts.length ? `${parts.join(' · ')}（合计 ${item.total_credit}）` : `合计 ${item.total_credit} 积分`
}

/** 小云雀含「每日免费」分项；漏显会导致合计看起来对不上官网 */
function formatXyqCreditBreakdown(item) {
  if (!item || item.total_credit == null) return ''
  const parts = []
  if (item.free_credit != null && Number(item.free_credit) !== 0) parts.push(`免费${item.free_credit}`)
  if (item.gift_credit != null && Number(item.gift_credit) !== 0) parts.push(`赠送${item.gift_credit}`)
  if (item.vip_credit != null && Number(item.vip_credit) !== 0) parts.push(`VIP${item.vip_credit}`)
  if (item.purchase_credit != null && Number(item.purchase_credit) !== 0) parts.push(`购买${item.purchase_credit}`)
  return parts.join('+')
}

function xyqCreditTitle(item) {
  if (item?.total_credit == null) return ''
  const parts = []
  if (item.free_credit != null) parts.push(`免费 ${item.free_credit}`)
  if (item.gift_credit != null) parts.push(`赠送 ${item.gift_credit}`)
  if (item.purchase_credit != null) parts.push(`购买 ${item.purchase_credit}`)
  if (item.vip_credit != null) parts.push(`VIP ${item.vip_credit}`)
  const expire = formatJimengCreditExpire(item)
  if (expire) parts.push(`到期 ${expire}`)
  return parts.length
    ? `${parts.join(' · ')}（合计 ${item.total_credit}）`
    : `合计 ${item.total_credit} 积分`
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

async function forceJimengSession(id) {
  const item = jimengSessions.value.find(s => s.id === id)
  const name = item?.label || item?.session_id_masked || id
  if (!confirm(`确定强制全员使用「${name}」？之后所有用户发布通道4视频都将使用此账号。`)) return
  jimengSessionSaving.value = true
  try {
    await jimengSessionAPI.setForce(id)
    await loadJimengSessionStatus()
    toast.success('已强制全员使用该 Session')
  } catch (err) {
    toast.error(err?.message || '操作失败')
  } finally {
    jimengSessionSaving.value = false
  }
}

async function clearJimengForceSession() {
  jimengSessionSaving.value = true
  try {
    await jimengSessionAPI.clearForce()
    await loadJimengSessionStatus()
    toast.success('已取消强制，恢复按用户分配')
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
    jimengForceSessionId.value = ''
    toast.success('已清除全部 Session')
  } catch (err) {
    toast.error(err?.message || '清除失败')
  } finally {
    jimengSessionSaving.value = false
  }
}

const serviceTypes = [{ type: 'text', label: '文本' }, { type: 'image', label: '图片' }, { type: 'video', label: '视频' }, { type: 'audio', label: '音频' }]
const providers = ['ali', 'ali-intl', 'ali-us', 'apimart', 'chatfire', 'chengmeng', 'aistarslab', 'geeknow', 'qilingze', 'gemini', 'minimax', 'openai', 'openrouter', 'vidu', 'volcengine', 'volcengine_proxy']
const providerLabels = {
  ali: '阿里百炼（北京）',
  'ali-intl': '阿里百炼（新加坡）',
  'ali-us': '阿里百炼（美国）',
  chatfire: 'ChatFire',
  apimart: 'APIMart',
  chengmeng: '橙盟 Seedance 2.0 9图过人脸',
  aistarslab: 'Seedance 2.0 VIP',
  geeknow: 'GeekNow (NewAPI)',
  qilingze: '启灵泽 (NewAPI)',
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
    apimart: { label: 'APIMart ChatGPT', baseUrl: 'https://api.apib.ai', models: ['gpt-5.6-terra', 'gpt-5.5', 'gpt-5.6-luna'] },
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
    qilingze: {
      label: '启灵泽',
      baseUrl: 'https://api.qilingze.com',
      models: ['gpt-image-2', 'nano-banana-2'],
      hint: '独立 NewAPI 上游；Base URL 填 https://api.qilingze.com（勿重复 /v1）；支持 gpt-image-2、nano-banana-2 等',
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
      models: ['70', '77'],
      hint: 'Base URL 填 https://api.chengmeng.site；模型从上游 /api/models 同步（当前默认 model_id=91 官转满血线路1）；创建任务仅需 model_id，无需 group_id',
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
    minimax: { label: '影光工场音频', baseUrl: 'https://api.chatfire.site/minimax', models: ['speech-2.8-hd'] },
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
  apimart: '/v1',
  geeknow: '/v1',
  qilingze: '/v1',
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
  const unit = String(model.billing_unit || '').toLowerCase()
  if (unit === 'per_second' || unit === 'second' || model.credit_cost_per_second != null) {
    const rate = model.credit_cost_per_second ?? model.credit_cost
    return rate != null ? `${rate} 积分/秒（用户扣费）` : '按秒计费'
  }
  if (model.credit_cost_flat != null) return `${model.credit_cost_flat} 积分/条（用户扣费）`
  if (model.base_price_yuan != null) {
    const ul = String(model.unit_label || '')
    return `上游约 ${model.base_price_yuan} ${ul || '元'}`
  }
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
    qilingze: {
      summary: '推荐 gpt-image-2 或 nano-banana-2；多个模型用逗号分隔，第一个为默认。图片尺寸请在各剧集工作台顶部设置。',
      docLabel: '启灵泽 API',
      docUrl: 'https://api.qilingze.com/',
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
    toast.success('影光工场推荐配置与默认 Agent LLM 已写入')
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
const grantForm = reactive({ user_id: 0, amount: 1000, summary: '' })
const grantSaving = ref(false)

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
    || key === 'video.generate.jimeng.seedance25'
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
  'video.generate.doubao_training',
  'video.generate.aistarslab',
  'video.generate.xyq.mini_trial',
  'video.generate.xyq.mini',
  'video.generate.xyq.seedance2_fast',
  'video.generate.xyq.seedance2',
])

const PER_SECOND_VIDEO_PRICING_ACTIONS = new Set([
  'video.generate',
  'video.generate.jimeng',
  'video.generate.jimeng.seedance2_fast',
  'video.generate.jimeng.seedance2',
  'video.generate.jimeng.seedance25',
  'video.generate.xyq.seedance25',
  'video.generate.coze.seedance2_fast',
  'video.generate.coze.seedance2',
  'video.upscale.seedvr2',
])

const OFFICIAL_CHANNEL2_PRICING_ACTIONS = new Set([
  'video.generate.seedance2',
  'video.generate.seedance2_fast',
  'video.generate.seedance2_mini',
  'video.generate.seedance2_fast_hd',
  'video.generate.seedance25',
])

function pricingUnit(action, item) {
  const desc = `${item?.description || ''} ${item?.label || ''}`
  if (FLAT_VIDEO_PRICING_ACTIONS.has(action)) return '积分/条'
  if (OFFICIAL_CHANNEL2_PRICING_ACTIONS.has(action) || String(action || '').startsWith('video.generate.xingyuemeng.')) {
    return '参考(5s·480p)'
  }
  if (/^video\.generate\.chengmeng\.\d+$/.test(String(action || ''))) {
    return /按秒|积分\/秒/.test(desc) ? '积分/秒' : '积分/条'
  }
  if (/^video\.generate\.aistarslab\.\d+\.[a-z0-9-]+$/i.test(String(action || ''))) {
    return /按秒|积分\/秒/.test(desc) ? '积分/秒' : '积分/条'
  }
  if (PER_SECOND_VIDEO_PRICING_ACTIONS.has(action)) return '积分/秒'
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
  const userId = Number(grantForm.user_id)
  const amount = Math.floor(Number(grantForm.amount))
  if (!Number.isFinite(userId) || userId <= 0) {
    toast.error('请选择要充值的用户')
    return
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    toast.error('充值积分必须大于 0')
    return
  }
  if (grantSaving.value) return
  grantSaving.value = true
  try {
    await creditsAPI.grant({
      user_id: userId,
      amount,
      summary: grantForm.summary.trim() || undefined,
    })
    toast.success('充值成功')
    grantForm.amount = 1000
    grantForm.summary = ''
    await loadTeamUsers()
  } catch (e) {
    toast.error(e.message || '充值失败')
  } finally {
    grantSaving.value = false
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
  if (value === 'users' && isAdmin.value) {
    loadTeamUsers()
    loadLoginIpTeams()
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
const grantableTeamUsers = computed(() => teamUsers.value.filter(u => u.is_active !== false))
const userForm = reactive({ username: '', password: '', display_name: '', role: 'user' })
const passwordDialogUser = ref(null)
const passwordEditValue = ref('')
const passwordSaving = ref(false)
const userFreezeLoadingId = ref(null)

const loginIpDialogUser = ref(null)
const loginIpEditText = ref('')
const loginIpSaving = ref(false)
const loginIpTeams = ref([])
const bulkLoginIpTeamId = ref('')
const bulkLoginIpText = ref('')
const bulkLoginIpAlsoMembers = ref(true)
const bulkLoginIpSaving = ref(false)

function fmtUserTime(s) {
  return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatAllowedIpsText(list) {
  return (Array.isArray(list) ? list : []).join('\n')
}

async function loadTeamUsers() {
  try {
    const res = await usersAPI.list()
    teamUsers.value = res.items || []
    const selectedId = Number(grantForm.user_id)
    if (selectedId > 0 && !grantableTeamUsers.value.some(u => Number(u.id) === selectedId)) {
      grantForm.user_id = 0
    }
  } catch (e) {
    toast.error(e.message)
  }
}

async function loadLoginIpTeams() {
  try {
    const res = await teamsAPI.directory()
    loginIpTeams.value = res.items || []
  } catch (e) {
    loginIpTeams.value = []
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

function openPasswordDialog(user) {
  passwordDialogUser.value = user
  passwordEditValue.value = ''
}

function closePasswordDialog() {
  passwordDialogUser.value = null
  passwordEditValue.value = ''
}

async function saveUserPassword() {
  if (!passwordDialogUser.value || passwordSaving.value) return
  const pwd = String(passwordEditValue.value || '')
  if (pwd.length < 6) {
    toast.error('密码至少 6 位')
    return
  }
  passwordSaving.value = true
  try {
    await usersAPI.update(passwordDialogUser.value.id, { password: pwd })
    toast.success(`已更新 ${passwordDialogUser.value.username} 的密码`)
    closePasswordDialog()
  } catch (e) {
    toast.error(e.message)
  } finally {
    passwordSaving.value = false
  }
}

function openLoginIpDialog(target) {
  loginIpDialogUser.value = target
  loginIpEditText.value = formatAllowedIpsText(target?.allowed_ips)
}

function closeLoginIpDialog() {
  loginIpDialogUser.value = null
  loginIpEditText.value = ''
}

async function saveUserLoginIps() {
  if (!loginIpDialogUser.value || loginIpSaving.value) return
  loginIpSaving.value = true
  try {
    await usersAPI.update(loginIpDialogUser.value.id, { allowed_ips: loginIpEditText.value })
    toast.success(`已更新 ${loginIpDialogUser.value.username} 的登录 IP`)
    closeLoginIpDialog()
    await loadTeamUsers()
  } catch (e) {
    toast.error(e.message)
  } finally {
    loginIpSaving.value = false
  }
}

async function onBulkLoginIpTeamChange() {
  const id = Number(bulkLoginIpTeamId.value)
  if (!id) {
    bulkLoginIpText.value = ''
    return
  }
  try {
    const res = await teamsAPI.getLoginIps(id)
    bulkLoginIpText.value = formatAllowedIpsText(res.allowed_ips)
  } catch (e) {
    bulkLoginIpText.value = ''
    toast.error(e.message)
  }
}

async function saveBulkLoginIps() {
  const teamId = Number(bulkLoginIpTeamId.value)
  if (!teamId || bulkLoginIpSaving.value) return
  bulkLoginIpSaving.value = true
  try {
    if (bulkLoginIpAlsoMembers.value) {
      const res = await usersAPI.bulkLoginIps({
        team_id: teamId,
        allowed_ips: bulkLoginIpText.value,
        mode: 'set',
        also_set_team: true,
      })
      toast.success(`已更新团队规则，并写入 ${res.updated || 0} 名成员`)
    } else {
      await teamsAPI.setLoginIps(teamId, bulkLoginIpText.value)
      toast.success('已保存团队登录 IP 规则')
    }
    await loadTeamUsers()
  } catch (e) {
    toast.error(e.message)
  } finally {
    bulkLoginIpSaving.value = false
  }
}

async function clearBulkLoginIps() {
  if (!bulkLoginIpTeamId.value) return
  if (!window.confirm('确定清除该团队的登录 IP 限制？')) return
  bulkLoginIpText.value = ''
  await saveBulkLoginIps()
}

async function toggleUserFreeze(targetUser, nextActive) {
  if (!targetUser?.id || userFreezeLoadingId.value === targetUser.id) return
  if (!nextActive && targetUser.id === user.value?.id) {
    toast.error('不能冻结当前登录账号')
    return
  }
  const actionLabel = nextActive ? '解冻' : '冻结'
  if (!nextActive && !window.confirm(`确定冻结用户「${targetUser.username}」？冻结后将无法登录。`)) return

  userFreezeLoadingId.value = targetUser.id
  try {
    await usersAPI.update(targetUser.id, { is_active: nextActive })
    toast.success(`已${actionLabel} ${targetUser.username}`)
    await loadTeamUsers()
  } catch (e) {
    toast.error(e.message)
  } finally {
    userFreezeLoadingId.value = null
  }
}

async function loadAdminUpstreamPanels() {
  if (!isAdmin.value) return
  await loadChengmengBalance()
  await new Promise(r => setTimeout(r, 400))
  await loadOfficialBalance()
  await new Promise(r => setTimeout(r, 400))
  await loadAistarslabBalance()
  await new Promise(r => setTimeout(r, 400))
  await loadAigcccBalance()
  await new Promise(r => setTimeout(r, 400))
  await loadJimengSessionStatus()
}

onMounted(() => {
  if (isAdmin.value) {
    loadCfgs()
    loadAgents()
    loadAllSkills()
    loadTeamUsers()
    loadLoginIpTeams()
    loadJimengAccessSettings()
    void loadAdminUpstreamPanels()
    loadXyqSessionStatus()
    loadCozeSessionStatus()
    loadFunshionSessionStatus()
    loadXingyuemengSessionStatus()
    loadDoubaoTrainingSessionStatus()
    loadTtsConfig()
    loadRhTtsConfig()
    loadVsrConfig()
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
.grant-credits-form {
  grid-template-columns: minmax(220px, 1.4fr) 140px minmax(180px, 1fr) auto;
  max-width: 920px;
}
.grant-credits-panel {
  margin-bottom: 20px;
}
.grant-credits-empty {
  margin-top: 10px;
  font-size: 13px;
}
@media (max-width: 900px) {
  .user-create-form { grid-template-columns: 1fr 1fr; }
  .grant-credits-form { grid-template-columns: 1fr; max-width: none; }
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
.user-table-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.login-ip-bulk-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
}
.login-ip-textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.45;
  min-height: 96px;
  resize: vertical;
}
.login-ip-bulk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.field-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.login-ip-last {
  font-size: 11px;
  margin-top: 2px;
  opacity: 0.75;
}
.btn-danger-outline {
  border-color: rgba(239, 83, 80, 0.45);
  color: #ef5350;
}
.btn-danger-outline:hover:not(:disabled) {
  background: rgba(239, 83, 80, 0.08);
  border-color: rgba(239, 83, 80, 0.65);
}

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

.jimeng-session-row.forced {
  border-color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent);
}

.jimeng-force-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
}

.jimeng-access-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
}

.jimeng-access-grid {
  display: grid;
  grid-template-columns: minmax(180px, 280px);
  gap: 12px;
  margin-top: 12px;
}

.jimeng-access-teams {
  margin-top: 14px;
}

.jimeng-access-teams-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.jimeng-access-add-row {
  margin-bottom: 10px;
}

.jimeng-access-team-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.jimeng-access-rate-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.jimeng-access-rate-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
}

.jimeng-access-rate-input {
  width: 72px;
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

.jimeng-credit-tag {
  white-space: nowrap;
}

.upstream-task-panel {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.official-pnl-panel {
  margin-top: 18px;
}

.official-pnl-head-row,
.official-pnl-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.official-pnl-actions {
  align-items: center;
}

.official-pnl-filter {
  min-width: 110px;
}

.official-pnl-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.official-pnl-summary.is-profit {
  border-color: rgba(82, 196, 26, 0.35);
}

.official-pnl-summary.is-loss {
  border-color: rgba(255, 77, 79, 0.35);
}

.official-pnl-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.official-pnl-net {
  font-weight: 600;
}

.official-pnl-positive {
  color: #52c41a;
}

.official-pnl-negative {
  color: #ff4d4f;
}

.official-pnl-subtable-wrap {
  margin-top: 14px;
}

.official-bill-sync-status {
  margin-top: 8px;
  font-size: 12px;
}

.upstream-task-head {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-1);
}

.upstream-task-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.upstream-task-pager-actions {
  display: flex;
  gap: 8px;
}

.upstream-task-table {
  width: 100%;
  font-size: 12px;
}

.upstream-task-table th,
.upstream-task-table td {
  vertical-align: top;
}

.upstream-task-prompt {
  margin-top: 4px;
  max-width: 360px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.upstream-task-video {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 160px;
}

.upstream-task-video-player {
  width: 240px;
  max-width: 36vw;
  border-radius: 8px;
  background: #111;
  aspect-ratio: 16 / 9;
  object-fit: contain;
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

.tts-config-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.tts-config-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.tts-config-label .input {
  font-weight: 400;
}

.tts-config-fields .tts-config-label:first-child {
  grid-column: 1 / -1;
}

.tts-config-test-result {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.tts-config-test-result.ok {
  border-color: color-mix(in srgb, var(--success, #22c55e) 40%, var(--border));
}

.tts-config-active-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  margin-left: auto;
}

@media (max-width: 900px) {
  .tts-config-fields {
    grid-template-columns: 1fr;
  }
}

.settings-layout {
  display: flex;
  flex: 1 1 auto;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  min-height: 0;
  background: var(--bg-base);
}

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

.settings-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.settings-scroll {
  flex: 1 1 auto;
  align-self: stretch;
  min-height: 0;
  overflow-y: auto;
  padding: 36px 48px;
  width: 100%;
  box-sizing: border-box;
  animation: fadeUp 0.3s var(--ease-out);
}
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
.skills-layout {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
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
.skills-main { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; }

/* Skill */
.skill-list { display: flex; flex-direction: column; gap: 8px; }
.skill-card { overflow: hidden; }
.skill-card-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; transition: background 0.1s; }
.skill-card-head:hover { background: var(--bg-hover); }
.skill-card-body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px; }
.skill-card-foot { display: flex; align-items: center; gap: 8px; }

/* Shared */
.field { display: flex; flex-direction: column; gap: 5px; }
.field-inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.field-inline .field-label { margin: 0; }
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
