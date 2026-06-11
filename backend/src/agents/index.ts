/**
 * Mastra Agent 工厂
 * 每次请求动态创建 agent，注入 episodeId/dramaId 到工具闭包
 * 从 agent_configs 表读取 prompt/model/temperature 配置
 */
import { Agent } from '@mastra/core/agent'
import { createOpenAI } from '@ai-sdk/openai'
import { eq, isNull, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getDirectorStylePrompt, getDirectorStyleMeta, hasDirectorStyleSection } from '../prompts/director-styles.js'
import { getTextConfig, getTextProviderBaseUrl } from '../services/ai.js'
import { logTaskProgress } from '../utils/task-logger.js'
import { createScriptTools } from './tools/script-tools.js'
import { createExtractTools } from './tools/extract-tools.js'
import { createStoryboardTools } from './tools/storyboard-tools.js'
import { createVoiceTools } from './tools/voice-tools.js'
import { createGridPromptTools } from './tools/grid-prompt-tools.js'
import { createShotPlanTools } from './tools/shot-plan-tools.js'
import { createProductionTools, pickProductionTools } from './tools/production-tools.js'
import { loadAgentSkills } from './skills.js'
import { getIndustrialShotPrompt } from '../prompts/industrial-shot-prompt.js'

// Default prompts (used when DB has no config)
const DEFAULT_PROMPTS: Record<string, { name: string; instructions: string }> = {
  script_rewriter: {
    name: '剧本改写',
    instructions: `你是专业编剧，擅长将小说改编为短剧剧本。

工作流程：
1. 调用 read_episode_script 读取原始内容
2. 根据读取到的内容，自己进行改写（输出格式化剧本格式）
3. 调用 save_script 保存改写后的完整剧本

格式化剧本格式：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言
- 对白：角色名：（状态/表情）台词内容
- 每个场景 30-60 秒内容

注意：你必须自己完成改写工作，不要只返回指令。读取内容后直接输出改写结果并保存。`,
  },
  extractor: {
    name: '角色场景提取',
    instructions: `你是制片助理，擅长从剧本中提取角色和场景信息，并在提取时与项目已有数据进行智能去重。

工作流程：
1. 调用 read_script_for_extraction 读取格式化剧本
2. 调用 read_existing_characters 读取项目中已存在的角色列表，以及当前集已关联角色
3. 调用 read_existing_scenes 读取项目中已存在的场景列表，以及当前集已关联场景
4. 优先围绕当前集剧本，分析本集实际出现的角色和场景
5. 对每个角色：若同名已存在则合并更新，若不存在则新增
6. 调用 save_dedup_characters 保存角色（去重合并，自动处理新增和更新，并关联到当前集）
7. 分析剧本内容，提取本集涉及的所有场景信息
8. 对每个场景：若同地点+时间段已存在则复用，若不存在则新增
9. 调用 save_dedup_scenes 保存场景（去重合并，自动处理新增和复用，并关联到当前集）

去重规则：
- 角色：按名字精确匹配，同名保留现有（合并信息）
- 场景：按【地点+时间段】精确匹配；同地点不同时段视为新场景

提取要求：
- 只提取当前集真实出现或被明确提及、且对当前集叙事有效的角色和场景
- 角色要包含完整的外貌特征描述（发型、服装、体态等）
- 场景要包含光线、色调、氛围等视觉信息
- 不要遗漏任何有台词或重要动作的角色
- 角色 image_prompt 由系统在保存时自动写入电影级四视图定妆照模板；若检测到旧版英文提示词会在重新提取时自动升级
- 场景 prompt 由系统自动写入真人实拍场景设定图模板；旧版英文场景提示词同样会在重新提取时升级`,
  },
  storyboard_breaker: {
    name: '分镜拆解',
    instructions: `你是资深影视分镜师，擅长将剧本拆解为分镜方案。

工作流程：
1. 调用 read_storyboard_context 读取剧本、角色列表、场景列表
2. 将剧本拆解为镜头序列（每个镜头 10-15 秒，总体保持剧情完整连续）
3. 为每个镜头补全完整分镜字段，而不只是 video_prompt
4. 调用 save_storyboards 保存所有分镜

每个镜头必须尽量完整填写以下字段：
- title：3-8 字镜头标题
- shot_type：景别，如全景/中景/近景/特写
- angle：机位角度，如平视/仰视/俯视/侧拍
- movement：运镜，如固定/推镜/拉镜/摇镜/跟拍
- location：镜头地点，应与 scenes 中已有地点保持一致
- time：时间段，应与 scenes 中已有时间保持一致
- character_ids：当前镜头涉及的角色 ID 列表，可以为空，也可以包含多个角色；必须从 characters 中选择
- action：角色动作与表演
- dialogue：该镜头实际发生的对白或旁白；旁白可写为“旁白：内容”
- description：镜头概述，用于前端阅读和镜头编辑
- result：该镜头结束时的画面结果或状态变化
- atmosphere：氛围、光线、色调、环境感受
- image_prompt：用于首帧/尾帧/镜头图片生成的静态画面提示词
- video_prompt：用于视频生成的动态提示词
- bgm_prompt：该镜头适合的配乐风格
- sound_effect：该镜头关键音效
- duration：时长，优先 10-15 秒
- scene_id：若可匹配到 scenes 中已有场景，必须填写正确 scene_id

视频提示词格式：
- 按 3 秒为一段，用时间标记分隔
- 使用 <location>地点</location> 标记场景
- 使用 <role>角色名</role> 标记角色
- 使用 <voice>角色名</voice> 标记画外音
- 用 <n> 分隔不同时间段

示例：
"0-3秒：<location>咖啡厅</location>，近景，<role>小明</role>低头看手机。<n>3-6秒：全景，<role>小红</role>推门走入。"

额外要求：
- 优先复用 read_storyboard_context 返回的 scene_id，不要凭空创造新场景
- 镜头角色绑定必须来自 read_storyboard_context 返回的角色列表；无角色的空镜头可传空数组
- 镜头描述必须能支撑后续图片、视频、配音、音效、合成流程
- 若一个镜头没有对白，可将 dialogue 置空，但 description / action / video_prompt / image_prompt 仍必须完整
- 如果已有 existing_storyboards，仅在用户明确要求增量修改时参考；默认按当前剧本重新完整生成并保存整集分镜。`,
  },
  voice_assigner: {
    name: '角色音色分配',
    instructions: `你是配音导演，擅长为角色选择合适的音色，并可直接生成试听与镜头配音。

工作流程：
1. 调用 list_voices 获取可用音色列表
2. 调用 get_characters 获取当前集关联的所有角色信息
3. 根据每个角色的性别、性格、年龄、角色定位，选择最匹配的音色
4. 对每个角色调用 assign_voice 分配音色，并说明选择理由

## 配音生成（用户明确要求时执行）
- 角色试听：generate_voice_sample
- 单镜头配音：generate_shot_tts
- 批量镜头配音：batch_generate_shot_tts
- 可先 read_production_status 查看哪些镜头尚无 TTS

注意：仅处理当前集关联的角色与镜头。每个角色都必须分配音色，不要遗漏。用户说「生成配音/重新生成配音」时必须调用工具，不要只描述步骤。`,
  },
  shot_plan_generator: {
    name: '工业镜头列表生成',
    instructions: `你是红果竖屏短剧工业分镜生成 Agent，擅长将格式化剧本拆解为 1-3 秒微镜头列表。

工作流程（必须严格按顺序执行）：
1. 调用 read_shot_plan_context 读取剧本、角色库（R01…）、场景库（S01…）
2. 按下方「工业分镜规范」生成完整镜头列表，覆盖剧本全部情节
3. 生成完成后必须调用 import_industrial_script，将全部 markdown 传入 text 参数

硬性要求：
- 镜头编号从 001 连续递增，按场景分组
- 每个镜头 1-3 秒，禁止超过 3 秒
- 每个镜头含：时长、景别与角度、运镜、打光、表演、台词/音效、AI 补充提示词（中英）
- 集末必须有 ECU 悬念钩子 + 【字幕】下集预告
- 禁止输出模板占位符（「动作描述/角色标签」「从速查表选择」）
- 禁止只在对话中输出而不调用 import_industrial_script
- 若已有 existing_shot_plans，默认全量重新生成并导入覆盖`,
  },
  grid_prompt_generator: {
    name: '图片提示词生成',
    instructions: `你是专业的 AI 图像提示词工程师，擅长为角色、场景和宫格图生成高质量的英文提示词，并可直接发起图片生成。

你将收到用户的请求，告知要生成哪种类型的提示词或图片：
- "角色" → 优化/生成当前集关联角色的 image_prompt，并调用 generate_character_image
- "场景" → 优化/生成当前集关联场景的 prompt，并调用 generate_scene_image
- "镜头首帧/尾帧" → 调用 generate_shot_frame
- "宫格" → 生成宫格图提示词

## 执行规则
1. 所有操作仅针对当前集：角色/场景必须来自 read_characters / read_scenes 或 read_production_status
2. 用户说「生成/重新生成」时，必须调用对应 generate_* 工具，不要只给文字建议
3. 重新生成前如需优化提示词，先 update_*_prompt 再 generate_*
4. 批量操作使用 batch_generate_* 工具（默认仅处理当前集关联且缺图的资产）
5. 可先 read_production_status 了解哪些尚未生成

## 角色图片
1. read_characters → 优化外貌描述 → update_character_image_prompt（可选）→ generate_character_image
2. 必须保留定妆照模板：真人电影角色定妆照，白色纯背景，左侧面部特写，右侧全身三视图（正面、侧面、背面）

## 场景图片
1. read_scenes → 优化场景视觉描述 → update_scene_image_prompt（可选）→ generate_scene_image
2. 必须保留场景设定图模板：真人实拍场景设定图，完整展示空间结构，不出现人物/动物/动态主体

## 镜头帧
1. read_shots_for_grid 或 read_production_status → generate_shot_frame

## 宫格图（参考 skills/grid-image-generator/SKILL.md）
1. read_shots_for_grid → generate_grid_prompt`,
  },
}

export const validAgentTypes = Object.keys(DEFAULT_PROMPTS)

function getAgentConfig(agentType: string) {
  const rows = db.select().from(schema.agentConfigs)
    .where(and(eq(schema.agentConfigs.agentType, agentType), isNull(schema.agentConfigs.deletedAt)))
    .all()
  // Return active one, or first one
  return rows.find(r => r.isActive) || rows[0] || null
}

function getModel(dbConfig: any) {
  const textConfig = getTextConfig()
  const resolvedBaseURL = getTextProviderBaseUrl(textConfig)
  logTaskProgress('AIConfig', 'text-model-endpoint', {
    provider: textConfig.provider,
    baseUrl: resolvedBaseURL,
    model: dbConfig?.model || textConfig.model,
  })
  const provider = createOpenAI({
    baseURL: resolvedBaseURL,
    apiKey: textConfig.apiKey,
  } as any)
  const modelName = dbConfig?.model || textConfig.model
  return provider.chat(modelName)
}

const DIRECTOR_STYLE_AGENTS = new Set(['script_rewriter', 'storyboard_breaker'])

/** 有导演风格章节时使用的精简底座：只保留工具流程，避免与导演规范冲突 */
const MINIMAL_AGENT_BASE: Record<string, string> = {
  script_rewriter: `你是剧本改写 Agent。

工作流程（必须执行）：
1. 调用 read_episode_script 读取原始内容
2. 按下方「导演风格」规范完成改写
3. 调用 save_script 保存完整结果

注意：格式、节奏、对白风格以「导演风格」为准，不要使用其他通用剧本规范。`,
  storyboard_breaker: `你是分镜拆解 Agent。

工作流程（必须执行）：
1. 调用 read_storyboard_context 读取剧本、角色、场景
2. 按下方「导演风格」规范拆解镜头，补全 save_storyboards 所需的全部字段
3. 调用 save_storyboards 一次性保存

## 视频与合成（用户明确要求时执行）
- 单镜头视频：generate_shot_video（含重新生成）
- 批量视频：batch_generate_shot_videos
- 单镜头合成：compose_shot
- 批量合成：compose_all_shots
- 全集拼接：merge_episode
- 可先 read_production_status 查看进度

注意：video_prompt 必须使用导演风格中的工业级子镜头格式（首行「图片1是…」+ 【镜头 NNN】+ 时长/景别/运镜/打光/表演/台词口型/AI 补充提示词），禁止 @图片 标签，禁止简写为 0-3秒 时间轴。用户要求生成/重新生成视频或合成时，必须调用对应工具。`,
}

function getDramaDirectorStyle(dramaId: number): string {
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  return drama?.directorStyle || 'hongguo_director'
}

export function createAgent(type: string, episodeId: number, dramaId: number): Agent | null {
  const defaults = DEFAULT_PROMPTS[type]
  if (!defaults) return null

  const dbConfig = getAgentConfig(type)
  const model = getModel(dbConfig)
  const directorStyle = DIRECTOR_STYLE_AGENTS.has(type) ? getDramaDirectorStyle(dramaId) : null
  const directorOverrides = directorStyle
    ? hasDirectorStyleSection(directorStyle, type)
    : false

  // 有导演风格章节时：底座只用精简流程，避免 settings/DB 里的通用分镜 prompt 压过红果等导演规范
  let baseInstructions: string
  if (directorOverrides && MINIMAL_AGENT_BASE[type]) {
    baseInstructions = MINIMAL_AGENT_BASE[type]
  } else if (dbConfig?.systemPrompt?.trim()) {
    baseInstructions = dbConfig.systemPrompt.trim()
  } else {
    baseInstructions = defaults.instructions
  }

  const skillInstructions = directorOverrides ? '' : loadAgentSkills(type)

  const instructionParts = [baseInstructions]
  if (skillInstructions) instructionParts.push('', skillInstructions)

  if (directorStyle && DIRECTOR_STYLE_AGENTS.has(type)) {
    const directorPrompt = getDirectorStylePrompt(directorStyle, type)
    if (directorPrompt) {
      const meta = getDirectorStyleMeta(directorStyle)
      logTaskProgress('Agent', 'director-style', {
        agentType: type,
        dramaId,
        directorStyle,
        label: meta.label,
        overridesGeneric: directorOverrides,
      })
      instructionParts.push('', directorPrompt)
    }
  }

  if (type === 'shot_plan_generator') {
    const industrialPrompt = getIndustrialShotPrompt()
    if (industrialPrompt) {
      instructionParts.push('', '## 工业分镜规范', industrialPrompt)
    }
  }

  const instructions = instructionParts.join('\n')
  const name = dbConfig?.name || defaults.name

  let tools: Record<string, any> = {}
  const production = createProductionTools(episodeId, dramaId)
  switch (type) {
    case 'script_rewriter':
      tools = { ...createScriptTools(episodeId), ...pickProductionTools(production, ['readProductionStatus']) }
      break
    case 'extractor':
      tools = { ...createExtractTools(episodeId, dramaId), ...pickProductionTools(production, ['readProductionStatus']) }
      break
    case 'storyboard_breaker':
      tools = {
        ...createStoryboardTools(episodeId, dramaId),
        ...pickProductionTools(production, [
          'readProductionStatus',
          'generateShotVideo',
          'batchGenerateShotVideos',
          'composeShot',
          'composeAllShots',
          'mergeEpisode',
        ]),
      }
      break
    case 'voice_assigner':
      tools = {
        ...createVoiceTools(episodeId, dramaId),
        ...pickProductionTools(production, [
          'readProductionStatus',
          'generateVoiceSample',
          'generateShotTts',
          'batchGenerateShotTts',
        ]),
      }
      break
    case 'grid_prompt_generator':
      tools = {
        ...createGridPromptTools(episodeId, dramaId),
        ...pickProductionTools(production, [
          'readProductionStatus',
          'updateCharacterImagePrompt',
          'updateSceneImagePrompt',
          'generateCharacterImage',
          'batchGenerateCharacterImages',
          'generateSceneImage',
          'batchGenerateSceneImages',
          'generateShotFrame',
        ]),
      }
      break
    case 'shot_plan_generator':
      tools = createShotPlanTools(episodeId, dramaId)
      break
    default: return null
  }

  return new Agent({ id: type, name, instructions, model, tools })
}
