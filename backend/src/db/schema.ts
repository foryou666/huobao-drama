/**
 * Drizzle schema — 精确匹配现有 SQLite 数据库列名
 * 从 PRAGMA table_info() 逆向生成
 */
import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const dramas = sqliteTable('dramas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  genre: text('genre'),
  style: text('style').default('realistic'),
  totalEpisodes: integer('total_episodes').default(1),
  totalDuration: integer('total_duration').default(0),
  status: text('status').notNull().default('draft'),
  thumbnail: text('thumbnail'),
  tags: text('tags'),
  metadata: text('metadata'),
  imageAspectRatio: text('image_aspect_ratio').default('9:16'),
  directorStyle: text('director_style').default('hongguo_director'),
  teamId: integer('team_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const episodes = sqliteTable('episodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  scriptContent: text('script_content'),
  description: text('description'),
  duration: integer('duration').default(0),
  status: text('status').default('draft'),
  videoUrl: text('video_url'),
  thumbnail: text('thumbnail'),
  imageConfigId: integer('image_config_id'),
  videoConfigId: integer('video_config_id'),
  audioConfigId: integer('audio_config_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
  name: text('name').notNull(),
  role: text('role'),
  description: text('description'),
  appearance: text('appearance'),
  imagePrompt: text('image_prompt'),
  personality: text('personality'),
  voiceStyle: text('voice_style'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  seedValue: text('seed_value'),
  sortOrder: integer('sort_order'),
  localPath: text('local_path'),
  voiceSampleUrl: text('voice_sample_url'),
  voiceProvider: text('voice_provider'),
  portraitType: text('portrait_type').default('ai'),
  seedanceAssetId: text('seedance_asset_id'),
  seedanceAssetGroupId: text('seedance_asset_group_id'),
  seedanceAssetStatus: text('seedance_asset_status'),
  ossObjectKey: text('oss_object_key'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// Episode-Character many-to-many
export const episodeCharacters = sqliteTable('episode_characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  characterId: integer('character_id').notNull(),
  createdAt: text('created_at').notNull(),
})

// Episode-Scene many-to-many
export const episodeScenes = sqliteTable('episode_scenes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  sceneId: integer('scene_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const scenes = sqliteTable('scenes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
  episodeId: integer('episode_id'),
  location: text('location').notNull(),
  time: text('time').notNull(),
  prompt: text('prompt').notNull(),
  storyboardCount: integer('storyboard_count').default(1),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  status: text('status').default('pending'),
  localPath: text('local_path'),
  ossObjectKey: text('oss_object_key'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const storyboards = sqliteTable('storyboards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  sceneId: integer('scene_id'),
  storyboardNumber: integer('storyboard_number').notNull(),
  title: text('title'),
  location: text('location'),
  time: text('time'),
  shotType: text('shot_type'),
  angle: text('angle'),
  movement: text('movement'),
  action: text('action'),
  result: text('result'),
  atmosphere: text('atmosphere'),
  imagePrompt: text('image_prompt'),
  videoPrompt: text('video_prompt'),
  bgmPrompt: text('bgm_prompt'),
  soundEffect: text('sound_effect'),
  dialogue: text('dialogue'),
  description: text('description'),
  duration: integer('duration').default(0),
  composedImage: text('composed_image'),
  firstFrameImage: text('first_frame_image'),
  lastFrameImage: text('last_frame_image'),
  blockingImage: text('blocking_image'),
  blockingLayout: text('blocking_layout'),
  sceneAngleId: text('scene_angle_id'),
  referenceImages: text('reference_images'),
  characterImageRefs: text('character_image_refs'),
  propImageRefs: text('prop_image_refs'),
  voiceRefs: text('voice_refs'),
  videoUrl: text('video_url'),
  ttsAudioUrl: text('tts_audio_url'),
  subtitleUrl: text('subtitle_url'),
  composedVideoUrl: text('composed_video_url'),
  status: text('status').default('pending'),
  promptStatus: text('prompt_status').default('empty'),
  clipSource: text('clip_source'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const shotPlans = sqliteTable('shot_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  shotNumber: integer('shot_number').notNull(),
  title: text('title'),
  sceneId: integer('scene_id'),
  location: text('location'),
  time: text('time'),
  action: text('action'),
  dialogue: text('dialogue'),
  dialogueType: text('dialogue_type').default('dialogue'),
  duration: real('duration').default(2),
  description: text('description'),
  industrialBlock: text('industrial_block'),
  source: text('source').default('manual'),
  status: text('status').default('draft'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const shotPlanCharacters = sqliteTable('shot_plan_characters', {
  shotPlanId: integer('shot_plan_id').notNull(),
  characterId: integer('character_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.shotPlanId, table.characterId] }),
}))

export const shotClipPlans = sqliteTable('shot_clip_plans', {
  storyboardId: integer('storyboard_id').notNull(),
  shotPlanId: integer('shot_plan_id').notNull(),
  orderInClip: integer('order_in_clip').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.storyboardId, table.shotPlanId] }),
}))

export const storyboardCharacters = sqliteTable('storyboard_characters', {
  storyboardId: integer('storyboard_id').notNull(),
  characterId: integer('character_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.storyboardId, table.characterId] }),
}))

export const storyboardProps = sqliteTable('storyboard_props', {
  storyboardId: integer('storyboard_id').notNull(),
  propId: integer('prop_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.storyboardId, table.propId] }),
}))

export const videoPromptHistory = sqliteTable('video_prompt_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storyboardId: integer('storyboard_id').notNull(),
  beforePrompt: text('before_prompt').notNull(),
  afterPrompt: text('after_prompt').notNull(),
  source: text('source').notNull(),
  label: text('label'),
  createdAt: text('created_at').notNull(),
})

export const aiServiceConfigs = sqliteTable('ai_service_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serviceType: text('service_type').notNull(),
  provider: text('provider'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  model: text('model'),
  endpoint: text('endpoint'),
  queryEndpoint: text('query_endpoint'),
  priority: integer('priority').default(0),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  settings: text('settings'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // 注意: 此表无 deleted_at
})

export const aiServiceProviders = sqliteTable('ai_service_providers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  displayName: text('display_name'),
  serviceType: text('service_type').notNull(),
  provider: text('provider').notNull(),
  defaultUrl: text('default_url'),
  presetModels: text('preset_models'),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const aiVoices = sqliteTable('ai_voices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  voiceId: text('voice_id').notNull().unique(),   // MiniMax voice_id
  voiceName: text('voice_name').notNull(),         // 中文名
  description: text('description'),                // 描述数组 JSON
  language: text('language'),                     // 语言标签
  provider: text('provider').notNull(),           // minimax
  createdAt: text('created_at').notNull(),
})

export const agentConfigs = sqliteTable('agent_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentType: text('agent_type').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  model: text('model'),
  systemPrompt: text('system_prompt'),
  temperature: real('temperature'),
  maxTokens: integer('max_tokens'),
  maxIterations: integer('max_iterations'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const imageGenerations = sqliteTable('image_generations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storyboardId: integer('storyboard_id'),
  dramaId: integer('drama_id'),
  sceneId: integer('scene_id'),
  characterId: integer('character_id'),
  propId: integer('prop_id'),
  imageType: text('image_type'),
  frameType: text('frame_type'),
  provider: text('provider'),
  prompt: text('prompt'),
  negativePrompt: text('negative_prompt'),
  model: text('model'),
  size: text('size'),
  quality: text('quality'),
  style: text('style'),
  steps: integer('steps'),
  cfgScale: real('cfg_scale'),
  seed: integer('seed'),
  imageUrl: text('image_url'),
  minioUrl: text('minio_url'),
  localPath: text('local_path'),
  status: text('status').default('pending'),
  taskId: text('task_id'),
  errorMsg: text('error_msg'),
  width: integer('width'),
  height: integer('height'),
  referenceImages: text('reference_images'),
  creditTransactionId: integer('credit_transaction_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
})

export const videoGenerations = sqliteTable('video_generations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storyboardId: integer('storyboard_id'),
  dramaId: integer('drama_id'),
  provider: text('provider'),
  prompt: text('prompt'),
  model: text('model'),
  imageGenId: integer('image_gen_id'),
  referenceMode: text('reference_mode'),
  imageUrl: text('image_url'),
  firstFrameUrl: text('first_frame_url'),
  lastFrameUrl: text('last_frame_url'),
  referenceImageUrls: text('reference_image_urls'),
  referencePayload: text('reference_payload'),
  duration: integer('duration'),
  fps: integer('fps'),
  resolution: text('resolution'),
  aspectRatio: text('aspect_ratio'),
  style: text('style'),
  motionLevel: integer('motion_level'),
  cameraMotion: text('camera_motion'),
  seed: integer('seed'),
  videoUrl: text('video_url'),
  minioUrl: text('minio_url'),
  localPath: text('local_path'),
  status: text('status').default('pending'),
  taskId: text('task_id'),
  errorMsg: text('error_msg'),
  creditTransactionId: integer('credit_transaction_id'),
  configId: integer('config_id'),
  userId: integer('user_id'),
  width: integer('width'),
  height: integer('height'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
  deletedAt: text('deleted_at'),
})

export const videoMerges = sqliteTable('video_merges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id'),
  dramaId: integer('drama_id'),
  title: text('title'),
  provider: text('provider'),
  model: text('model'),
  status: text('status').default('pending'),
  scenes: text('scenes'), // JSON
  mergedUrl: text('merged_url'),
  duration: integer('duration'),
  taskId: text('task_id'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  deletedAt: text('deleted_at'),
})

export const props = sqliteTable('props', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
  name: text('name').notNull(),
  type: text('type'),
  description: text('description'),
  prompt: text('prompt'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('user'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  creditsBalance: integer('credits_balance').default(10000),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const teamMembers = sqliteTable('team_members', {
  teamId: integer('team_id').notNull(),
  userId: integer('user_id').notNull(),
  role: text('role').notNull().default('member'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.teamId, table.userId] }),
}))

export const dramaTeamShares = sqliteTable('drama_team_shares', {
  dramaId: integer('drama_id').notNull(),
  teamId: integer('team_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.dramaId, table.teamId] }),
}))

export const creditPricing = sqliteTable('credit_pricing', {
  action: text('action').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  cost: integer('cost').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

export const creditTransactions = sqliteTable('credit_transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  type: text('type').notNull(),
  action: text('action').notNull(),
  summary: text('summary'),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  resourceType: text('resource_type'),
  resourceId: integer('resource_id'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
})

export type CreditTransactionType = 'charge' | 'grant' | 'refund' | 'recharge'

export const paymentOrders = sqliteTable('payment_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderNo: text('order_no').notNull().unique(),
  userId: integer('user_id').notNull(),
  provider: text('provider').notNull().default('wechat'),
  packageId: text('package_id'),
  amountYuan: integer('amount_yuan').notNull(),
  amountFen: integer('amount_fen').notNull(),
  credits: integer('credits').notNull(),
  status: text('status').notNull().default('pending'),
  codeUrl: text('code_url'),
  wxPrepayId: text('wx_prepay_id'),
  wxTransactionId: text('wx_transaction_id'),
  creditTransactionId: integer('credit_transaction_id'),
  errorMsg: text('error_msg'),
  paidAt: text('paid_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** static/ 本地路径 → OSS objectKey，角色/场景图在生成或上传时写入 */
export const ossStaticMappings = sqliteTable('oss_static_mappings', {
  localPath: text('local_path').primaryKey(),
  objectKey: text('object_key').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const activityLogs = sqliteTable('activity_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  action: text('action').notNull(),
  summary: text('summary'),
  resourceType: text('resource_type'),
  resourceId: integer('resource_id'),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  metadata: text('metadata'),
  creditCost: integer('credit_cost'),
  createdAt: text('created_at').notNull(),
})

export const assets = sqliteTable('assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  storyboardId: integer('storyboard_id'),
  storyboardNum: integer('storyboard_num'),
  name: text('name'),
  description: text('description'),
  type: text('type'),
  category: text('category'),
  sourceType: text('source_type'),
  sourceId: integer('source_id'),
  url: text('url'),
  thumbnailUrl: text('thumbnail_url'),
  localPath: text('local_path'),
  fileSize: integer('file_size'),
  mimeType: text('mime_type'),
  width: integer('width'),
  height: integer('height'),
  duration: integer('duration'),
  format: text('format'),
  imageGenId: integer('image_gen_id'),
  videoGenId: integer('video_gen_id'),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).default(false),
  viewCount: integer('view_count').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const assistantThreads = sqliteTable('assistant_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  episodeId: integer('episode_id').notNull(),
  stepKey: text('step_key').notNull(),
  agentType: text('agent_type').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const assistantMessages = sqliteTable('assistant_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolSummary: text('tool_summary'),
  attachments: text('attachments'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

export const videoRepaintJobs = sqliteTable('video_repaint_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  userId: integer('user_id').notNull(),
  teamId: integer('team_id'),
  status: text('status').notNull().default('uploaded'),
  stage: text('stage').notNull().default('upload'),
  sourceVideoPath: text('source_video_path'),
  sourceDuration: real('source_duration'),
  mergedVideoPath: text('merged_video_path'),
  analysisJson: text('analysis_json'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const videoRepaintSegments = sqliteTable('video_repaint_segments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull(),
  segmentIndex: integer('segment_index').notNull(),
  startSec: real('start_sec').notNull(),
  endSec: real('end_sec').notNull(),
  durationSec: real('duration_sec').notNull(),
  shotIds: text('shot_ids'),
  videoPrompt: text('video_prompt'),
  contentRefs: text('content_refs'),
  videoGenerationId: integer('video_generation_id'),
  status: text('status').default('draft'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
