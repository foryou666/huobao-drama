<template>
  <div class="studio-page narration-canvas-page">
    <header class="studio-header">
      <div class="studio-header-copy">
        <button type="button" class="btn btn-ghost btn-sm narration-back" @click="goList">← 任务列表</button>
        <h1 class="studio-title">{{ job?.title || '解说工作流' }}</h1>
        <p v-if="job" class="studio-desc">
          任务 #{{ job.id }} · {{ stageLabel(job.stage) }}
          <span v-if="segments.length"> · {{ segments.length }} 段旁白</span>
        </p>
      </div>
      <button type="button" class="btn btn-sm" :disabled="loading" @click="loadJob">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <div v-if="loadError" class="narration-error-banner">{{ loadError }}</div>
    <div v-else-if="!job && loading" class="studio-empty dim">加载中…</div>

    <template v-else-if="job">
      <div class="narration-workspace">
        <NarrationJianyingPreview
          v-if="selectedNode?.type === 'export'"
          :segments="segments"
        />
        <NarrationWorkflowCanvas
          v-else
          :job="job"
          :segments="segments"
          :analysis="analysis"
          :asset-readiness="assetReadiness"
          :selected-id="selectedNode?.id || ''"
          @select="onSelectNode"
        />

        <aside
          v-if="selectedNode"
          class="narration-drawer card"
          :class="{ 'export-wide': selectedNode.type === 'export' || selectedNode.type === 'asset-group' }"
        >
          <header class="narration-drawer-head">
            <div>
              <p class="narration-drawer-type">{{ drawerTypeLabel }}</p>
              <h2 class="narration-drawer-title">{{ selectedNode.title }}</h2>
            </div>
            <button type="button" class="btn btn-sm btn-ghost" @click="closeDrawer">关闭</button>
          </header>

          <div class="narration-drawer-body">
            <!-- 分段 -->
            <template v-if="selectedNode.type === 'segment'">
              <p class="dim">
                资产确认后，先清洗剧本元数据（标题/画幅/音效等），再按<strong>整句</strong>切分（不在逗号处拆开）。有台词约 8 秒（最长 10 秒），纯叙述约 6 秒（最长 8 秒），避免空镜拖沓；换说话人另起段。分段时会为每段绑定场景/角色并生成多节拍画面 Prompt。
              </p>
              <p v-if="!hasAnalysis" class="narration-error">请先完成角色 / 场景 / 道具提取，再分段。</p>
              <p v-if="job.error_msg" class="narration-error">{{ job.error_msg }}</p>

              <div class="narration-novel-box">
                <div class="narration-novel-head">
                  <strong>任务原文</strong>
                  <span class="dim">未做 TTS 时可替换为英文原台词，再重新切分</span>
                </div>
                <textarea
                  v-model="novelDraft"
                  class="textarea narration-novel-editor"
                  rows="10"
                  :disabled="busy || ttsLocked"
                  placeholder="粘贴英文原台词 / 小说正文…"
                />
                <div class="narration-drawer-actions">
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="busy || ttsLocked || !novelDraft.trim() || novelDraft.trim() === String(job.novel_text || '').trim()"
                    @click="replaceNovelAndResplit"
                  >
                    {{ busy ? '处理中…' : '替换原文并重新切分' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm"
                    :disabled="busy || ttsLocked"
                    @click="novelDraft = String(job.novel_text || '')"
                  >
                    还原当前原文
                  </button>
                </div>
              </div>

              <div class="narration-drawer-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  :disabled="busy || ttsLocked || !hasAnalysis"
                  @click="runSegment"
                >
                  {{ busy ? '处理中…' : segments.length ? '重新切分并绑定画面' : '开始旁白分段' }}
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="busy || ttsLocked || !hasAnalysis"
                  @click="runResplit"
                >
                  按新规则重新切分
                </button>
                <button
                  v-if="segments.length"
                  type="button"
                  class="btn btn-sm btn-primary"
                  @click="selectTtsNode"
                >
                  下一步：TTS 朗读
                </button>
              </div>
              <p v-if="ttsLocked" class="dim">已完成 TTS，无法重新切分。</p>
              <div v-if="segments.length" class="narration-segment-preview">
                <p class="dim">共 {{ segments.length }} 段</p>
                <div v-for="seg in segments" :key="seg.id" class="narration-mini-seg">
                  <strong>段 {{ seg.segment_index + 1 }}</strong>
                  <span class="dim"> · 约 {{ seg.estimated_speech_sec || estimateSpeechSec(seg.text) }}s</span>
                  <span v-if="segmentLooksLikeDialogue(seg.text)" class="narration-tag-dial">台词</span>
                  <span v-else class="narration-tag-narr">叙述</span>
                  <span v-if="(seg.estimated_speech_sec || estimateSpeechSec(seg.text)) > GROK_SHOT_MAX_SEC" class="narration-warn-tag">偏长</span>
                  <pre>{{ seg.text }}</pre>
                </div>
              </div>
            </template>

            <!-- 实体抽取 -->
            <template v-else-if="selectedNode.type === 'extract'">
              <p class="dim">
                第一步：从整部剧本提取<strong>角色、场景、道具</strong>文字设定（无需先分段）。
                抽取完成后可先生图定稿，再进行旁白分段。
                推理走 APIMart ChatGPT（默认 gpt-5.6-terra）。
              </p>
              <div v-if="hasAnalysis" class="narration-entity-grid">
                <div v-if="analysis.characters?.length" class="narration-entity-block">
                  <h3>角色 ({{ analysis.characters.length }})</h3>
                  <ul>
                    <li v-for="c in analysis.characters" :key="c.id">
                      <strong>{{ c.name }}</strong>
                      <span v-if="c.appearance" class="dim"> · {{ c.appearance.slice(0, 40) }}</span>
                    </li>
                  </ul>
                </div>
                <div v-if="analysis.scenes?.length" class="narration-entity-block">
                  <h3>场景 ({{ analysis.scenes.length }})</h3>
                  <ul>
                    <li v-for="s in analysis.scenes" :key="s.id">{{ s.location }} — {{ s.prompt?.slice(0, 50) }}</li>
                  </ul>
                </div>
                <div v-if="analysis.props?.length" class="narration-entity-block">
                  <h3>道具 ({{ analysis.props.length }})</h3>
                  <ul>
                    <li v-for="p in analysis.props" :key="p.id">{{ p.name }}</li>
                  </ul>
                </div>
              </div>
              <p v-else class="dim">尚未抽取。点击下方按钮开始。</p>
              <div class="narration-drawer-actions">
                <button type="button" class="btn btn-primary" :disabled="busy || extracting" @click="runExtract">
                  {{ extracting ? '抽取中…' : hasAnalysis ? '重新抽取角色 / 场景 / 道具' : '开始抽取角色 / 场景 / 道具' }}
                </button>
                <button
                  v-if="hasAnalysis && assetReadiness.items?.length"
                  type="button"
                  class="btn btn-sm"
                  :disabled="assetBusy"
                  @click="generateAllAssets"
                >
                  一键生成全部缺图
                </button>
                <button
                  v-if="hasAnalysis && assetReadiness.items?.length"
                  type="button"
                  class="btn btn-sm btn-primary"
                  @click="selectAssetGroupNode"
                >
                  下一步：资产定稿
                </button>
                <button
                  v-else-if="hasAnalysis"
                  type="button"
                  class="btn btn-sm btn-primary"
                  @click="selectSegmentNode"
                >
                  下一步：旁白分段
                </button>
              </div>
            </template>

            <!-- 资产定稿（集中管理） -->
            <template v-else-if="selectedNode.type === 'asset-group'">
              <NarrationAssetPanel
                :job-id="jobId"
                :readiness="assetReadiness"
                @updated="onAssetsUpdated"
              />
              <div class="narration-drawer-actions">
                <button type="button" class="btn btn-sm btn-primary" @click="selectSegmentNode">
                  下一步：旁白分段
                </button>
              </div>
            </template>

            <!-- TTS -->
            <template v-else-if="selectedNode.type === 'tts'">
              <p class="dim">
                <strong>直接朗读小说原文</strong>，不改写。使用 RunningHub IndexTTS2。
                无参考音色时可「自动匹配」：根据角色外貌/性格推断音色画像，再从音色库挑选最接近的参考音频。
              </p>

              <div class="narration-voice-section">
                <label class="narration-voice-label">旁白音色（音色库）</label>
                <div class="narration-voice-picker-row">
                  <button
                    type="button"
                    class="btn btn-sm"
                    :disabled="ttsLocked || voiceAssetsLoading"
                    @click="openNarratorVoicePicker"
                  >
                    {{ voiceAssetsLoading ? '加载音色…' : '从音色库选择' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="ttsLocked || autoVoiceBusy"
                    @click="autoMatchVoices"
                  >
                    {{ autoVoiceBusy ? '匹配中…' : '自动匹配音色' }}
                  </button>
                  <span v-if="selectedNarratorVoiceName" class="tts-voice-pill">
                    {{ selectedNarratorVoiceName }}
                    <button
                      v-if="!ttsLocked"
                      type="button"
                      class="tts-voice-clear"
                      @click="clearNarratorVoice"
                    >×</button>
                  </span>
                  <span v-else class="dim">未选择 · 可点自动匹配</span>
                </div>
                <audio
                  v-if="selectedNarratorVoiceUrl"
                  :src="mediaDisplayUrl(selectedNarratorVoiceUrl)"
                  controls
                  class="narration-audio"
                  preload="metadata"
                />
                <p v-if="autoVoiceSummary" class="dim narration-auto-voice-summary">{{ autoVoiceSummary }}</p>
              </div>

              <div v-if="analysis.characters?.length" class="narration-voice-section">
                <label class="narration-voice-label">角色音色（可选，默认跟随旁白）</label>
                <div v-for="c in analysis.characters" :key="c.id" class="narration-char-voice-block">
                  <div class="narration-char-voice-row">
                    <span class="narration-char-name">{{ c.name }}</span>
                    <select
                      class="input"
                      :value="c.voice_id || ''"
                      :disabled="ttsLocked"
                      @change="onCharacterVoiceChange(c, $event)"
                    >
                      <option value="">跟随旁白</option>
                      <option
                        v-for="v in voiceAssets"
                        :key="c.id + '-' + v.id"
                        :value="'asset:' + v.id"
                      >
                        {{ v.name || ('音色#' + v.id) }}
                      </option>
                    </select>
                  </div>
                  <p v-if="characterVoiceHint(c)" class="dim narration-char-voice-hint">{{ characterVoiceHint(c) }}</p>
                </div>
              </div>

              <button
                type="button"
                class="btn btn-primary"
                :disabled="busy || ttsRunning"
                @click="runTTS"
              >
                {{ ttsRunning ? '合成中…' : '批量 TTS 朗读' }}
              </button>
              <p v-if="ttsSummary" class="dim">{{ ttsSummary }}</p>

              <div v-if="segments.some(s => s.tts_audio_url)" class="narration-tts-list">
                <label class="narration-voice-label">已合成旁白</label>
                <div v-for="seg in segments.filter(s => s.tts_audio_url)" :key="seg.id" class="narration-tts-item">
                  <div class="narration-tts-item-head">
                    <strong>段 {{ seg.segment_index + 1 }}</strong>
                    <span class="dim">{{ formatSec(seg.tts_duration_sec) }}</span>
                    <span v-if="seg.duration_mismatch" class="narration-warn-tag">
                      视频需 {{ seg.shots_needed }} 镜或循环
                    </span>
                  </div>
                  <audio :src="mediaDisplayUrl(seg.tts_audio_url)" controls class="narration-audio" />
                </div>
              </div>

              <VoiceAssetPickerModal
                :open="voicePickerOpen"
                :voices="voiceAssets"
                :selected="selectedNarratorAssetRef"
                :max="1"
                @close="voicePickerOpen = false"
                @confirm="onNarratorVoicePicked"
              />
            </template>

            <!-- 画面镜头汇总 -->
            <template v-else-if="selectedNode.type === 'grok-group'">
              <p class="dim">各段镜头汇总在此查看，避免画布堆满节点。可逐段生成或一键全部生成。</p>
              <label class="narration-field">
                <span>视频通道</span>
                <select v-model="grokChannel" class="input" :disabled="busy" @change="onGrokChannelChange">
                  <option
                    v-for="ch in grokChannels"
                    :key="ch.id"
                    :value="ch.id"
                    :disabled="!ch.configured"
                  >
                    {{ ch.label }}{{ ch.configured ? '' : '（未配置）' }}
                  </option>
                </select>
              </label>
              <label class="narration-field">
                <span>Grok 模型</span>
                <select v-model="grokModel" class="input" :disabled="busy" @change="saveGrokSettings">
                  <option v-for="m in currentChannelModels" :key="m.id" :value="m.id">
                    {{ m.label }}
                  </option>
                </select>
              </label>
              <p v-if="selectedChannelHint" class="dim narration-channel-hint">{{ selectedChannelHint }}</p>
              <div class="narration-drawer-actions">
                <button type="button" class="btn btn-sm" :disabled="busy" @click="loadJob">刷新</button>
                <button type="button" class="btn btn-sm btn-primary" :disabled="busy || !selectedChannelConfigured" @click="generateAll">生成全部</button>
              </div>
              <div class="narration-shot-list">
                <button
                  v-for="seg in segments"
                  :key="seg.id"
                  type="button"
                  class="narration-shot-row"
                  :class="{ active: focusedGrokSegId === seg.id }"
                  @click="focusedGrokSegId = seg.id"
                >
                  <div class="narration-shot-row-head">
                    <strong>第 {{ seg.segment_index + 1 }} 段</strong>
                    <span class="dim">约 {{ seg.estimated_speech_sec || estimateSpeechSec(seg.text) }}s</span>
                    <span class="tag">{{ grokSegStatusLabel(seg.status) }}</span>
                    <span v-if="segHasVideo(seg)" class="narration-ok-tag">有视频</span>
                    <span v-if="seg.duration_mismatch" class="narration-warn-tag">偏长</span>
                  </div>
                  <p class="narration-shot-row-text">{{ seg.text }}</p>
                </button>
              </div>
              <template v-if="focusedGrokSeg">
                <hr class="narration-divider" />
                <div class="narration-shot-detail">
                  <p class="dim">当前选中第 {{ focusedGrokSeg.segment_index + 1 }} 段</p>
                  <div v-if="focusedGrokSeg.duration_mismatch" class="narration-duration-warn">
                    <strong>时长不匹配</strong>
                    <p>
                      旁白 {{ formatSec(focusedGrokSeg.tts_duration_sec) }}，Grok 单镜最长 {{ focusedGrokSeg.video_max_sec || GROK_SHOT_MAX_SEC }}s。
                    </p>
                  </div>
                  <textarea
                    v-model="focusedGrokSeg.video_prompt"
                    class="textarea narration-segment-prompt"
                    rows="4"
                    placeholder="画面 Prompt"
                    @change="saveSegmentPrompt(focusedGrokSeg)"
                  />
                  <div class="narration-drawer-actions">
                    <button
                      type="button"
                      class="btn btn-sm btn-primary"
                      :disabled="busy || focusedGrokSeg.status === 'generating'"
                      @click="generateSegment(focusedGrokSeg)"
                    >
                      {{ focusedGrokSeg.status === 'generating' ? '生成中…' : '生成此段' }}
                    </button>
                  </div>
                  <div
                    v-if="focusedGrokSeg.video_url && focusedGrokSeg.status === 'completed' && mediaDisplayUrl(focusedGrokSeg.video_url)"
                    class="narration-segment-video-wrap"
                  >
                    <video
                      :src="mediaDisplayUrl(focusedGrokSeg.video_url)"
                      controls
                      playsinline
                      preload="metadata"
                      class="narration-segment-video"
                    />
                  </div>
                  <p v-if="focusedGrokSeg.error_msg" class="narration-error">{{ focusedGrokSeg.error_msg }}</p>
                </div>
              </template>
            </template>

            <!-- Grok 镜头（兼容旧单节点） -->
            <template v-else-if="selectedNode.type === 'grok'">
              <p class="dim">自动带入本段关联的定稿图作为 Grok 参考（最多 6 张）。</p>
              <label class="narration-field">
                <span>视频通道</span>
                <select v-model="grokChannel" class="input" :disabled="busy" @change="onGrokChannelChange">
                  <option
                    v-for="ch in grokChannels"
                    :key="ch.id"
                    :value="ch.id"
                    :disabled="!ch.configured"
                  >
                    {{ ch.label }}{{ ch.configured ? '' : '（未配置）' }}
                  </option>
                </select>
              </label>
              <label class="narration-field">
                <span>Grok 模型</span>
                <select v-model="grokModel" class="input" :disabled="busy" @change="saveGrokSettings">
                  <option v-for="m in currentChannelModels" :key="m.id" :value="m.id">
                    {{ m.label }}
                  </option>
                </select>
              </label>
              <div v-if="selectedGrokSeg?.duration_mismatch" class="narration-duration-warn">
                <strong>时长不匹配</strong>
                <p>
                  旁白 {{ formatSec(selectedGrokSeg.tts_duration_sec) }}，Grok 单镜最长 {{ selectedGrokSeg.video_max_sec || GROK_SHOT_MAX_SEC }}s。
                  导出剪映时会<strong>循环视频</strong>铺满旁白；建议将本段拆成 {{ selectedGrokSeg.shots_needed }} 镜或重新切分旁白。
                </p>
              </div>
              <p v-else-if="selectedGrokSeg?.tts_duration_sec" class="dim">
                旁白 {{ formatSec(selectedGrokSeg.tts_duration_sec) }} · 视频最长 {{ selectedGrokSeg.video_max_sec || GROK_SHOT_MAX_SEC }}s
              </p>
              <pre class="narration-segment-text">{{ selectedGrokSeg?.text }}</pre>
              <textarea
                v-if="selectedGrokSeg"
                v-model="selectedGrokSeg.video_prompt"
                class="textarea narration-segment-prompt"
                rows="5"
                placeholder="画面 Prompt"
                @change="saveSegmentPrompt(selectedGrokSeg)"
              />
              <div v-if="selectedGrokSeg?.content_refs?.length" class="narration-ref-list">
                <p class="dim">关联参考图：</p>
                <ul>
                  <li v-for="(ref, i) in selectedGrokSeg.content_refs" :key="i">{{ ref.label }}</li>
                </ul>
              </div>
              <div class="narration-drawer-actions">
                <button type="button" class="btn btn-sm" :disabled="busy" @click="loadJob">刷新</button>
                <button type="button" class="btn btn-sm" :disabled="busy" @click="generateAll">生成全部</button>
                <button
                  v-if="selectedGrokSeg"
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="busy || selectedGrokSeg.status === 'generating'"
                  @click="generateSegment(selectedGrokSeg)"
                >
                  {{ selectedGrokSeg.status === 'generating' ? '生成中…' : '生成此段' }}
                </button>
              </div>
              <audio
                v-if="selectedGrokSeg?.tts_audio_url"
                :src="mediaDisplayUrl(selectedGrokSeg.tts_audio_url)"
                controls
                class="narration-audio"
              />
              <div
                v-if="selectedGrokSeg?.video_url && selectedGrokSeg.status === 'completed' && mediaDisplayUrl(selectedGrokSeg.video_url)"
                class="narration-segment-video-wrap"
              >
                <video
                  :src="mediaDisplayUrl(selectedGrokSeg.video_url)"
                  controls
                  playsinline
                  preload="metadata"
                  class="narration-segment-video"
                />
              </div>
              <p
                v-else-if="selectedGrokSeg?.video_url && selectedGrokSeg.status === 'completed'"
                class="dim"
              >
                视频地址加载中…
              </p>
              <p v-if="selectedGrokSeg?.error_msg" class="narration-error">{{ selectedGrokSeg.error_msg }}</p>
            </template>

            <!-- 导出 -->
            <template v-else-if="selectedNode.type === 'export'">
              <p class="dim">
                左侧可预览全片拼接效果（旁白对齐、视频不足时循环铺满，与剪映草稿一致）。确认无误后导出草稿到本机打开。
              </p>
              <p class="dim">
                镜头视频 {{ videoReadyCount }} / {{ segments.length }}
                · 旁白音频 {{ ttsReadyCount }} / {{ segments.length }}
              </p>
              <p class="dim">
                可导出完整镜头 {{ exportReadyCount }} / {{ segments.length }}
                <span v-if="exportMissingCount"> · 缺 {{ exportMissingCount }} 段</span>
              </p>
              <p class="dim">
                导入步骤：解压 ZIP → 双击「修复路径.bat」→ 整夹复制到剪映草稿目录 → 重启剪映。
                若仍提示媒体丢失，在弹窗中链接本目录下的 resources 文件夹。
              </p>
              <p v-if="videoReadyCount && !ttsReadyCount" class="narration-error">
                已有镜头视频，但缺少 TTS 旁白。请先回到「TTS 朗读」生成音频后再导出。
              </p>
              <p v-else-if="ttsReadyCount && !videoReadyCount" class="narration-error">
                已有旁白，但镜头视频尚未完成。请先在「画面镜头」生成视频。
              </p>
              <div class="narration-drawer-actions">
                <button type="button" class="btn btn-primary" :disabled="busy || exporting || !exportReadyCount" @click="runExport">
                  {{ exporting ? '导出中…' : '导出剪映草稿' }}
                </button>
                <button type="button" class="btn btn-sm" @click="closeDrawer">返回画布</button>
                <a
                  v-if="job.jianying_zip_url || job.jianying_draft_url"
                  href="#"
                  class="btn"
                  @click.prevent="downloadJianyingDraft"
                >
                  下载草稿 ZIP
                </a>
              </div>
            </template>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<script setup>
import { defineAsyncComponent, ref, computed, onMounted, watch } from 'vue'
import { narrationAPI, assetAPI } from '~/composables/useApi'
import { NARRATION_STAGE_LABELS } from '~/constants/narration-steps.js'
import { GROK_SHOT_MAX_SEC, estimateSpeechSec } from '~/constants/narration-voices.js'
import { mediaDisplayUrl, prefetchMediaUrlsInBackground, collectMediaPrefetchPaths } from '~/utils/media-url.js'
import { toast } from 'vue-sonner'
import NarrationWorkflowCanvas from '~/components/NarrationWorkflowCanvas.vue'
import NarrationJianyingPreview from '~/components/NarrationJianyingPreview.vue'
import NarrationAssetPanel from '~/components/NarrationAssetPanel.vue'

const VoiceAssetPickerModal = defineAsyncComponent(() => import('~/components/VoiceAssetPickerModal.vue'))

const route = useRoute()
const router = useRouter()
const jobId = computed(() => Number(route.params.id))

const loading = ref(false)
const busy = ref(false)
const extracting = ref(false)
const ttsRunning = ref(false)
const exporting = ref(false)
const assetBusy = ref(false)
const loadError = ref('')
const job = ref(null)
const segments = ref([])
const analysis = ref({ characters: [], scenes: [], props: [], segment_meta: [] })
const assetReadiness = ref({ items: [], ready: false, total: 0, ready_count: 0 })
const selectedNode = ref(null)
const focusedGrokSegId = ref(null)
const narratorVoice = ref('')
const novelDraft = ref('')
const ttsSummary = ref('')
const voiceAssets = ref([])
const voiceAssetsLoading = ref(false)
const voicePickerOpen = ref(false)
const autoVoiceBusy = ref(false)
const autoVoiceSummary = ref('')
const grokChannels = ref([])
const grokChannel = ref('geeknow')
const grokModel = ref('grok-video-3-pro')

let assetPollTimer = null

const currentChannelModels = computed(() => {
  const ch = grokChannels.value.find(c => c.id === grokChannel.value)
  return ch?.models || []
})

const selectedChannelConfigured = computed(() => {
  const ch = grokChannels.value.find(c => c.id === grokChannel.value)
  return !!ch?.configured
})

const selectedChannelHint = computed(() => {
  const ch = grokChannels.value.find(c => c.id === grokChannel.value)
  if (!ch) return ''
  if (!ch.configured) return `${ch.label} 未配置 API Key`
  if (ch.id === 'huajing') return '花镜使用 Grok Imagine 线路（JSON）；请确保上游额度充足'
  return 'GeekNow 支持 Grok Video 1.5 / 3 Pro·Max'
})

const ttsLocked = computed(() =>
  segments.value.some(s => s.tts_audio_url || s.status === 'tts_done' || s.tts_voice),
)

const hasRunningHubNarratorVoice = computed(() => {
  const v = String(narratorVoice.value || '').trim()
  return /^asset:\d+$/i.test(v) || v.startsWith('static/') || /^https?:\/\//i.test(v)
})

const selectedNarratorAssetId = computed(() => {
  const m = /^asset:(\d+)$/i.exec(String(narratorVoice.value || '').trim())
  return m ? Number(m[1]) : null
})

const selectedNarratorAsset = computed(() => {
  const id = selectedNarratorAssetId.value
  if (!id) return null
  return voiceAssets.value.find(v => Number(v.id) === id) || null
})

const selectedNarratorAssetRef = computed(() => {
  const a = selectedNarratorAsset.value
  if (!a) return []
  return [{
    asset_id: a.id,
    name: a.name,
    path: a.local_path || a.localPath || a.url,
  }]
})

const selectedNarratorVoiceName = computed(() => {
  if (selectedNarratorAsset.value?.name) return selectedNarratorAsset.value.name
  const v = String(narratorVoice.value || '').trim()
  if (/^asset:(\d+)$/i.test(v)) return `音色#${RegExp.$1}`
  if (v.startsWith('static/')) return v.split('/').pop() || v
  return ''
})

const selectedNarratorVoiceUrl = computed(() => {
  const a = selectedNarratorAsset.value
  if (a) return a.local_path || a.localPath || a.url || ''
  const v = String(narratorVoice.value || '').trim()
  if (v.startsWith('static/') || v.startsWith('/static/')) return v.startsWith('/') ? v : `/${v}`
  return ''
})

const hasAnalysis = computed(() =>
  (analysis.value.characters?.length || 0) + (analysis.value.scenes?.length || 0) > 0,
)

const selectedGrokSeg = computed(() => {
  if (selectedNode.value?.type !== 'grok') return null
  const id = selectedNode.value.data?.seg?.id
  return segments.value.find(s => s.id === id) || selectedNode.value.data?.seg
})

const focusedGrokSeg = computed(() => {
  if (!focusedGrokSegId.value) return null
  return segments.value.find(s => s.id === focusedGrokSegId.value) || null
})

function segVideoUrl(seg) {
  return String(seg?.video_url || seg?.videoUrl || '').trim()
}

function segTtsUrl(seg) {
  return String(
    seg?.tts_audio_url
    || seg?.ttsAudioUrl
    || seg?.tts_audio_path
    || seg?.ttsAudioPath
    || '',
  ).trim()
}

function segHasVideo(seg) {
  if (!seg) return false
  if (segVideoUrl(seg)) return true
  return seg.status === 'completed'
}

function segHasTts(seg) {
  return !!segTtsUrl(seg)
}

const videoReadyCount = computed(() =>
  segments.value.filter(segHasVideo).length,
)

const ttsReadyCount = computed(() =>
  segments.value.filter(segHasTts).length,
)

const exportReadyCount = computed(() =>
  segments.value.filter(s => segHasVideo(s) && segHasTts(s)).length,
)

const exportMissingCount = computed(() =>
  Math.max(0, segments.value.length - exportReadyCount.value),
)

const drawerTypeLabel = computed(() => {
  const t = selectedNode.value?.type
  if (t === 'segment') return '旁白分段'
  if (t === 'extract') return '角色 / 场景 / 道具'
  if (t === 'asset-group') return '资产定稿'
  if (t?.startsWith('asset-character')) return '角色三视图'
  if (t?.startsWith('asset-scene')) return '场景定稿'
  if (t?.startsWith('asset-prop')) return '道具定稿'
  if (t === 'tts') return 'TTS 朗读'
  if (t === 'grok' || t === 'grok-group') return '画面镜头'
  if (t === 'export') return '剪映导出'
  return '节点'
})

function segmentLooksLikeDialogue(text) {
  const s = String(text || '')
  if (/[「『]/.test(s)) return true
  if (/["“].+?["”]/.test(s)) return true
  return false
}

function grokSegStatusLabel(status) {
  const map = {
    draft: '待生成',
    tts_generating: 'TTS中',
    tts_done: '待视频',
    generating: '生成中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] || status || '—'
}

function stageLabel(stage) {
  return NARRATION_STAGE_LABELS[stage] || stage
}

function assetStatusLabel(status, done) {
  if (done) return '已定稿'
  if (status === 'generating') return '生成中…'
  if (status === 'failed') return '生成失败'
  return '待生成'
}

function prefetchJobMedia(data) {
  const paths = collectMediaPrefetchPaths(
    ...(data.segments || []).flatMap(s => [
      s.video_url,
      s.tts_audio_url,
      ...(s.content_refs || []).map(r => r.url),
    ]),
    ...(data.asset_readiness?.items || []).map(i => i.image_url),
  )
  if (paths.length) prefetchMediaUrlsInBackground(paths)
}

function applyJob(data) {
  job.value = data
  segments.value = (data.segments || []).map(s => ({ ...s }))
  analysis.value = data.analysis || { characters: [], scenes: [], props: [], segment_meta: [] }
  assetReadiness.value = data.asset_readiness || {
    items: [],
    ready: false,
    total: 0,
    ready_count: 0,
  }
  narratorVoice.value = data.narrator_voice || ''
  novelDraft.value = String(data.novel_text || '')
  void loadVoiceAssets()
  if (Array.isArray(data.grok_channels) && data.grok_channels.length) {
    grokChannels.value = data.grok_channels.filter(ch => ch?.id !== 'qilingze')
  }
  const prevChannel = data.grok_channel || grokChannel.value || 'geeknow'
  const switchedFromQilingze = prevChannel === 'qilingze'
  grokChannel.value = switchedFromQilingze ? 'geeknow' : prevChannel
  if (switchedFromQilingze) {
    grokModel.value = grokChannels.value.find(c => c.id === 'geeknow')?.default_model || 'grok-video-3-pro'
  } else {
    grokModel.value = data.grok_model || grokModel.value || 'grok-video-3-pro'
  }
  prefetchJobMedia(data)

  // 首次进入且尚未抽取：自动打开「角色/场景/道具」面板
  if (!selectedNode.value && !(
    (analysis.value.characters?.length || 0)
    + (analysis.value.scenes?.length || 0)
    + (analysis.value.props?.length || 0)
  )) {
    selectExtractNode()
  }

  if (selectedNode.value) {
    const id = selectedNode.value.id
    if (id.startsWith('grok-')) {
      const segId = Number(id.replace('grok-', ''))
      const seg = segments.value.find(s => s.id === segId)
      if (seg) {
        selectedNode.value = {
          ...selectedNode.value,
          stageDone: seg.status === 'completed',
          status: seg.status,
          imageUrl: null,
          videoUrl: seg.video_url && seg.status === 'completed' ? seg.video_url : null,
          data: { seg, refCount: (seg.content_refs || []).length },
        }
      }
    } else if (id === 'asset-group') {
      const items = assetReadiness.value.items || []
      const ready = Number(assetReadiness.value.ready_count || items.filter(i => i.has_image).length)
      const total = Number(assetReadiness.value.total || items.length)
      selectedNode.value = {
        ...selectedNode.value,
        subtitle: total ? `${ready}/${total} 已定稿 · 点击管理` : '抽取后在此集中生图',
        stageDone: total > 0 && ready === total,
        status: items.some(i => i.image_status === 'generating')
          ? 'generating'
          : (ready ? 'completed' : 'draft'),
        data: {
          items,
          ready,
          total,
          thumbs: items.slice(0, 12).map(item => ({
            id: `${item.type}-${item.id}`,
            name: item.name,
            type: item.type,
            imageUrl: item.image_url || null,
            ready: !!item.has_image,
            status: item.image_status,
          })),
        },
      }
    }
  }
}

function onSelectNode(node) {
  selectedNode.value = node
  if (node?.type === 'grok-group') {
    const firstPending = segments.value.find(s => s.status !== 'completed') || segments.value[0]
    focusedGrokSegId.value = firstPending?.id ?? null
  }
}

function closeDrawer() {
  selectedNode.value = null
  focusedGrokSegId.value = null
}

function selectExtractNode() {
  selectedNode.value = {
    id: 'extract',
    type: 'extract',
    title: '角色 / 场景 / 道具',
    subtitle: hasAnalysis.value ? '已抽取' : '点击提取',
    stageDone: hasAnalysis.value,
    data: { analysis: analysis.value },
  }
}

function selectAssetGroupNode() {
  const items = assetReadiness.value.items || []
  const ready = Number(assetReadiness.value.ready_count || items.filter(i => i.has_image).length)
  const total = Number(assetReadiness.value.total || items.length)
  selectedNode.value = {
    id: 'asset-group',
    type: 'asset-group',
    title: '资产定稿',
    subtitle: total ? `${ready}/${total} 已定稿 · 点击管理` : '抽取后在此集中生图',
    stageDone: total > 0 && ready === total,
    status: items.some(i => i.image_status === 'generating')
      ? 'generating'
      : (ready ? 'completed' : 'draft'),
    data: { items, ready, total },
  }
}

function selectSegmentNode() {
  selectedNode.value = {
    id: 'segment',
    type: 'segment',
    title: '旁白分段',
    subtitle: segments.value.length ? `${segments.value.length} 段原文` : '提取资产后再分段',
    stageDone: segments.value.length > 0,
    data: { segments: segments.value },
  }
}

function selectTtsNode() {
  selectedNode.value = {
    id: 'tts',
    type: 'tts',
    title: 'TTS 朗读',
    subtitle: 'RunningHub IndexTTS2',
    stageDone: ttsLocked.value,
    data: {},
  }
}

async function onAssetsUpdated(payload) {
  if (payload) {
    applyJob(payload)
    return
  }
  try {
    const data = await narrationAPI.get(jobId.value)
    applyJob(data)
  } catch { /* poll */ }
}

function startAssetPoll() {
  stopAssetPoll()
  assetPollTimer = setInterval(() => onAssetsUpdated(), 4000)
}

function stopAssetPoll() {
  if (assetPollTimer) {
    clearInterval(assetPollTimer)
    assetPollTimer = null
  }
}

async function loadJob() {
  if (!jobId.value) return
  loading.value = true
  loadError.value = ''
  try {
    const data = await narrationAPI.get(jobId.value)
    applyJob(data)
    if (assetReadiness.value.items?.some(i => i.image_status === 'generating')) {
      startAssetPoll()
    }
  } catch (err) {
    loadError.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function goList() {
  router.push('/narration')
}

async function saveGrokSettings() {
  try {
    const data = await narrationAPI.patch(jobId.value, {
      grok_channel: grokChannel.value,
      grok_model: grokModel.value,
    })
    applyJob(data)
  } catch (err) {
    toast.error(err?.message || '保存通道失败')
  }
}

async function onGrokChannelChange() {
  const ch = grokChannels.value.find(c => c.id === grokChannel.value)
  if (ch?.default_model) grokModel.value = ch.default_model
  else if (ch?.models?.length && !ch.models.some(m => m.id === grokModel.value)) {
    grokModel.value = ch.models[0].id
  }
  await saveGrokSettings()
}

async function runSegment() {
  busy.value = true
  try {
    const data = await narrationAPI.segment(jobId.value)
    applyJob(data)
    toast.success('旁白分段完成，已绑定画面 Prompt')
  } catch (err) {
    toast.error(err?.message || '切分失败')
  } finally {
    busy.value = false
  }
}

async function runExtract() {
  extracting.value = true
  busy.value = true
  try {
    const data = await narrationAPI.extract(jobId.value)
    applyJob(data)
    toast.success('角色 / 场景 / 道具已提取，可先生图或直接分段')
    if (assetReadiness.value.items?.length) selectAssetGroupNode()
  } catch (err) {
    toast.error(err?.message || '抽取失败')
  } finally {
    extracting.value = false
    busy.value = false
  }
}

function apiAssetType(type) {
  if (type === 'character') return 'characters'
  if (type === 'scene') return 'scenes'
  return 'props'
}

async function generateSelectedAsset() {
  const item = selectedNode.value?.data?.item
    || assetReadiness.value.items?.find(r => `asset-${r.type}-${r.id}` === selectedNode.value?.id)
  if (!item) return
  assetBusy.value = true
  try {
    const res = await narrationAPI.generateAsset(jobId.value, apiAssetType(item.type), item.id)
    applyJob(res.job || res)
    toast.success(`${item.name} 已提交生图`)
    startAssetPoll()
  } catch (err) {
    toast.error(err?.message || '生图失败')
  } finally {
    assetBusy.value = false
  }
}

async function generateAllAssets() {
  assetBusy.value = true
  try {
    const res = await narrationAPI.generateAllAssets(jobId.value)
    applyJob(res.job || res)
    toast.success('已提交批量生图')
    startAssetPoll()
  } catch (err) {
    toast.error(err?.message || '批量生图失败')
  } finally {
    assetBusy.value = false
  }
}

function formatSec(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toFixed(1)}s`
}

async function selectNarratorVoice(voiceId) {
  narratorVoice.value = voiceId
  await saveVoice()
}

async function loadVoiceAssets() {
  voiceAssetsLoading.value = true
  try {
    const dramaId = job.value?.drama_id || job.value?.dramaId
    const params = { type: 'voice' }
    if (dramaId) params.drama_id = Number(dramaId)
    let res = await assetAPI.list(params)
    let list = Array.isArray(res) ? res : (res?.items || [])
    if (!list.length && dramaId) {
      res = await assetAPI.list({ type: 'voice' })
      list = Array.isArray(res) ? res : (res?.items || [])
    }
    voiceAssets.value = list
  } catch {
    voiceAssets.value = []
  } finally {
    voiceAssetsLoading.value = false
  }
}

async function openNarratorVoicePicker() {
  if (!voiceAssets.value.length) await loadVoiceAssets()
  voicePickerOpen.value = true
}

async function onNarratorVoicePicked(picked) {
  voicePickerOpen.value = false
  const ref = picked?.[0]
  if (!ref?.asset_id && !ref?.assetId) return
  const id = ref.asset_id ?? ref.assetId
  await selectNarratorVoice(`asset:${id}`)
  toast.success('旁白音色已保存')
}

async function clearNarratorVoice() {
  narratorVoice.value = ''
  autoVoiceSummary.value = ''
  await saveVoice()
}

function characterVoiceHint(c) {
  const profile = c?.voice_profile
  const parts = [
    profile?.gender,
    profile?.age,
    profile?.tone,
    profile?.desc || c?.personality,
  ].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  const appearance = String(c?.appearance || '').trim()
  if (appearance) return appearance.slice(0, 48)
  return ''
}

function formatAutoAssignments(list) {
  if (!Array.isArray(list) || !list.length) return ''
  return list.map(a => `${a.target}→${a.name}`).join('；')
}

async function autoMatchVoices() {
  if (autoVoiceBusy.value || ttsLocked.value) return
  autoVoiceBusy.value = true
  try {
    if (!voiceAssets.value.length) await loadVoiceAssets()
    const res = await narrationAPI.autoVoices(jobId.value, { force: true })
    applyJob(res.job || res)
    autoVoiceSummary.value = formatAutoAssignments(res.assignments) || '已自动匹配'
    toast.success('已按角色音色画像匹配音色库')
    await loadVoiceAssets()
  } catch (err) {
    toast.error(err?.message || '自动匹配失败')
  } finally {
    autoVoiceBusy.value = false
  }
}

async function setCharacterVoice(char, voiceId) {
  char.voice_id = voiceId || undefined
  try {
    const data = await narrationAPI.patchAnalysis(jobId.value, analysis.value)
    applyJob(data)
    toast.success(`${char.name} 音色已保存`)
  } catch (err) {
    toast.error(err?.message || '保存失败')
  }
}

function onCharacterVoiceChange(char, event) {
  const value = event?.target?.value ?? ''
  void setCharacterVoice(char, value)
}

async function runResplit() {
  busy.value = true
  try {
    const data = await narrationAPI.resplitSegments(jobId.value)
    applyJob(data)
    toast.success('已按清洗元数据 + 约 8–10 秒打包规则重新切分')
  } catch (err) {
    toast.error(err?.message || '切分失败')
  } finally {
    busy.value = false
  }
}

async function replaceNovelAndResplit() {
  const text = novelDraft.value.trim()
  if (!text) {
    toast.error('请先粘贴英文原台词')
    return
  }
  busy.value = true
  try {
    const data = await narrationAPI.replaceNovel(jobId.value, text)
    applyJob(data)
    toast.success(segments.value.length
      ? '原文已替换为英文，并已重新切分旁白段（资产定稿保留）'
      : '原文已替换；请先抽取资产后再分段')
    selectSegmentNode()
  } catch (err) {
    toast.error(err?.message || '替换原文失败')
  } finally {
    busy.value = false
  }
}

async function saveVoice() {
  try {
    const data = await narrationAPI.patch(jobId.value, { narrator_voice: narratorVoice.value })
    applyJob(data)
  } catch (err) {
    toast.error(err?.message || '保存失败')
  }
}

async function runTTS() {
  ttsRunning.value = true
  busy.value = true
  ttsSummary.value = ''
  try {
    if (!hasRunningHubNarratorVoice.value) {
      toast.message('未选手动音色，将按角色画像自动匹配音色库…')
    }
    const res = await narrationAPI.tts(jobId.value)
    applyJob(res.job || res)
    if (res.auto_voice_assignments?.length) {
      autoVoiceSummary.value = formatAutoAssignments(res.auto_voice_assignments)
    }
    ttsSummary.value = `完成 ${res.tts_done || 0} 段${res.errors?.length ? `，失败：${res.errors.join('; ')}` : ''}`
    toast.success('TTS 批量完成')
    await loadVoiceAssets()
  } catch (err) {
    toast.error(err?.message || 'TTS 失败')
  } finally {
    ttsRunning.value = false
    busy.value = false
  }
}

async function saveSegmentPrompt(seg) {
  try {
    await narrationAPI.patchSegment(jobId.value, seg.id, { video_prompt: seg.video_prompt })
  } catch (err) {
    toast.error(err?.message || '保存失败')
  }
}

async function generateSegment(seg) {
  busy.value = true
  try {
    await narrationAPI.generateSegment(jobId.value, seg.id)
    toast.success(`段 ${seg.segment_index + 1} 已提交生成`)
    await loadJob()
  } catch (err) {
    toast.error(err?.message || '生成失败')
  } finally {
    busy.value = false
  }
}

async function generateAll() {
  busy.value = true
  try {
    const res = await narrationAPI.generateAll(jobId.value)
    applyJob(res.job || res)
    toast.success(`已提交 ${res.queued || 0} 段`)
    if (res.errors?.length) toast.warning(`部分失败：${res.errors.join(', ')}`)
  } catch (err) {
    toast.error(err?.message || '批量生成失败')
  } finally {
    busy.value = false
  }
}

async function downloadJianyingZip(zipPath, filename) {
  const { getAuthToken } = await import('~/utils/auth-token.js')
  const { getActiveTeamId } = await import('~/utils/team-context.js')
  const headers = {}
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = String(teamId)
  // zip 走代理下载，确保带 Content-Disposition，避免只打开目录链接
  const params = new URLSearchParams({ path: zipPath, filename })
  const res = await fetch(`/api/v1/media/download?${params}`, { headers })
  if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
  }
}

async function downloadJianyingDraft() {
  const zipPath = String(job.value?.jianying_zip_url || '').replace(/^\/+/, '')
    || (job.value?.jianying_draft_url
      ? `${String(job.value.jianying_draft_url).replace(/^\/+/, '').replace(/\/$/, '')}.zip`
      : '')
  if (!zipPath.startsWith('static/')) {
    toast.error('暂无草稿包，请先导出')
    return
  }
  const title = String(job.value?.title || `解说漫_${jobId.value}`).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)
  try {
    await downloadJianyingZip(zipPath, `${title}_剪映草稿.zip`)
  } catch (err) {
    toast.error(err?.message || '下载失败，请重新导出')
  }
}

async function runExport() {
  exporting.value = true
  busy.value = true
  try {
    const data = await narrationAPI.exportJianying(jobId.value)
    applyJob(data)
    const zipPath = String(data?.jianying_zip_url || '').replace(/^\/+/, '')
    const filename = String(data?.download_filename || `${job.value?.title || '解说漫'}_剪映草稿.zip`)
    if (zipPath.startsWith('static/')) {
      await downloadJianyingZip(zipPath, filename)
      toast.success('剪映草稿已导出并开始下载')
    } else {
      toast.success('剪映草稿已导出')
      toast.warning('未返回下载地址，请点「下载草稿 ZIP」重试')
    }
  } catch (err) {
    toast.error(err?.message || '导出失败')
  } finally {
    exporting.value = false
    busy.value = false
  }
}

onMounted(loadJob)
onUnmounted(stopAssetPoll)
watch(() => route.params.id, loadJob)
</script>

<style scoped>
.narration-canvas-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.studio-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px 8px;
  flex-shrink: 0;
}

.studio-title {
  margin: 4px 0 0;
  font-size: 22px;
}

.studio-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-1);
}

.narration-back {
  padding-left: 0;
}

.narration-error-banner {
  margin: 0 24px;
  padding: 12px;
  color: var(--danger, #e57373);
}

.narration-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
  overflow: hidden;
}

.narration-drawer {
  position: relative;
  z-index: 20;
  width: min(420px, 38vw);
  flex-shrink: 0;
  margin: 0 16px 16px 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  isolation: isolate;
}

.narration-drawer.export-wide {
  width: min(360px, 34vw);
}

.narration-drawer-head {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface, var(--bg-1));
  flex-shrink: 0;
}

.narration-drawer-type {
  margin: 0;
  font-size: 11px;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.narration-drawer-title {
  margin: 4px 0 0;
  font-size: 18px;
}

.narration-drawer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.narration-drawer-preview img {
  width: 100%;
  border-radius: 8px;
  object-fit: contain;
  max-height: 280px;
  background: var(--bg-2);
}

.narration-drawer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.narration-error {
  color: var(--danger, #e57373);
  font-size: 13px;
}

.narration-novel-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-2);
}

.narration-novel-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.narration-novel-editor {
  width: 100%;
  min-height: 160px;
  font-size: 12px;
  line-height: 1.5;
}

.narration-segment-preview {
  margin-top: 8px;
}

.narration-mini-seg {
  margin-top: 10px;
}

.narration-mini-seg pre {
  margin: 6px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  background: var(--bg-2);
  padding: 8px;
  border-radius: 8px;
  max-height: 100px;
  overflow: auto;
}

.narration-entity-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.narration-entity-block ul {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
}

.narration-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.narration-channel-hint {
  font-size: 12px;
  margin: 0;
}

.narration-segment-text {
  font-size: 12px;
  margin: 0;
  white-space: pre-wrap;
  background: var(--bg-2);
  padding: 10px;
  border-radius: 8px;
  max-height: 120px;
  overflow: auto;
}

.narration-ref-list ul {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
}

.narration-audio {
  width: 100%;
  height: 32px;
}

.narration-voice-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.narration-voice-label {
  font-size: 12px;
  font-weight: 600;
}

.narration-voice-picker-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tts-voice-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg-2);
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
}

.tts-voice-clear {
  border: 0;
  background: transparent;
  color: var(--text-dim, #999);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.narration-voice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.narration-voice-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: var(--bg-2);
  text-align: left;
  cursor: pointer;
}

.narration-voice-card.active {
  border-color: rgba(120, 170, 255, 0.65);
  box-shadow: 0 0 0 1px rgba(120, 170, 255, 0.25);
}

.narration-voice-card.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.narration-voice-preview-btn {
  font-size: 11px;
  color: var(--accent, #7eb0ff);
}

.narration-char-voice-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  align-items: center;
}

.narration-char-voice-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.narration-char-voice-hint,
.narration-auto-voice-summary {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
}

.narration-char-name {
  font-size: 12px;
}

.narration-tts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.narration-tts-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 8px;
  background: var(--bg-2);
}

.narration-tts-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.narration-warn-tag {
  font-size: 11px;
  color: #ffb86c;
  border: 1px solid rgba(255, 184, 108, 0.35);
  border-radius: 999px;
  padding: 1px 8px;
}

.narration-tag-dial,
.narration-tag-narr {
  font-size: 11px;
  border-radius: 999px;
  padding: 1px 8px;
  margin-left: 4px;
}
.narration-tag-dial {
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}
.narration-tag-narr {
  color: var(--text-3);
  border: 1px solid var(--border);
}

.narration-shot-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
  margin-top: 8px;
  flex-shrink: 0;
}
.narration-shot-row {
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-1);
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.narration-shot-row.active {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.narration-shot-row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.narration-shot-row-text {
  margin: 0;
  font-size: 12px;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.narration-shot-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  z-index: 1;
  min-width: 0;
}
.narration-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 14px 0;
}

.narration-duration-warn {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 184, 108, 0.08);
  border: 1px solid rgba(255, 184, 108, 0.25);
  font-size: 12px;
}

.narration-duration-warn p {
  margin: 6px 0 0;
  color: var(--text-dim);
}

.narration-segment-prompt {
  width: 100%;
  min-height: 88px;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.narration-segment-video-wrap {
  position: relative;
  z-index: 0;
  width: 100%;
  max-height: 280px;
  overflow: hidden;
  border-radius: 8px;
  background: #000;
  isolation: isolate;
  transform: translateZ(0);
}

.narration-segment-video {
  display: block;
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  background: #000;
  border-radius: 8px;
}

.narration-ok-tag {
  font-size: 11px;
  color: #66bb6a;
  border: 1px solid rgba(102, 187, 106, 0.35);
  border-radius: 999px;
  padding: 1px 8px;
}

.studio-empty {
  padding: 32px;
  text-align: center;
}
</style>
