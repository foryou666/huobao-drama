import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { hashPassword } from '../utils/password.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../../data/huobao_drama.db')

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const sqlite = new Database(DB_PATH, { timeout: 30000 })
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('busy_timeout = 30000')

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dramas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    style TEXT DEFAULT 'realistic',
    total_episodes INTEGER DEFAULT 1,
    total_duration INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    thumbnail TEXT,
    tags TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    script_content TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    video_url TEXT,
    thumbnail TEXT,
    image_config_id INTEGER,
    video_config_id INTEGER,
    audio_config_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    appearance TEXT,
    personality TEXT,
    voice_style TEXT,
    image_url TEXT,
    reference_images TEXT,
    seed_value TEXT,
    sort_order INTEGER,
    local_path TEXT,
    voice_sample_url TEXT,
    voice_provider TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_id INTEGER,
    location TEXT NOT NULL,
    time TEXT NOT NULL,
    prompt TEXT NOT NULL,
    storyboard_count INTEGER DEFAULT 1,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS storyboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER,
    storyboard_number INTEGER NOT NULL,
    title TEXT,
    location TEXT,
    time TEXT,
    shot_type TEXT,
    angle TEXT,
    movement TEXT,
    action TEXT,
    result TEXT,
    atmosphere TEXT,
    image_prompt TEXT,
    video_prompt TEXT,
    bgm_prompt TEXT,
    sound_effect TEXT,
    dialogue TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    composed_image TEXT,
    first_frame_image TEXT,
    last_frame_image TEXT,
    reference_images TEXT,
    video_url TEXT,
    tts_audio_url TEXT,
    subtitle_url TEXT,
    composed_video_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS episode_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_episode_characters_episode_id
    ON episode_characters (episode_id);
  CREATE INDEX IF NOT EXISTS idx_episode_characters_character_id
    ON episode_characters (character_id);

  CREATE TABLE IF NOT EXISTS episode_scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_episode_scenes_episode_id
    ON episode_scenes (episode_id);
  CREATE INDEX IF NOT EXISTS idx_episode_scenes_scene_id
    ON episode_scenes (scene_id);

  CREATE TABLE IF NOT EXISTS storyboard_characters (
    storyboard_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, character_id)
  );
  CREATE INDEX IF NOT EXISTS idx_storyboard_characters_storyboard_id
    ON storyboard_characters (storyboard_id);
  CREATE INDEX IF NOT EXISTS idx_storyboard_characters_character_id
    ON storyboard_characters (character_id);

  CREATE TABLE IF NOT EXISTS storyboard_props (
    storyboard_id INTEGER NOT NULL,
    prop_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, prop_id)
  );
  CREATE INDEX IF NOT EXISTS idx_storyboard_props_storyboard_id
    ON storyboard_props (storyboard_id);
  CREATE INDEX IF NOT EXISTS idx_storyboard_props_prop_id
    ON storyboard_props (prop_id);

  CREATE TABLE IF NOT EXISTS video_prompt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storyboard_id INTEGER NOT NULL,
    before_prompt TEXT NOT NULL,
    after_prompt TEXT NOT NULL,
    source TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_video_prompt_history_storyboard_id
    ON video_prompt_history (storyboard_id);

  CREATE TABLE IF NOT EXISTS ai_service_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    provider TEXT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    endpoint TEXT,
    query_endpoint TEXT,
    priority INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    settings TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_service_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    display_name TEXT,
    service_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    default_url TEXT,
    preset_models TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_voices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voice_id TEXT NOT NULL UNIQUE,
    voice_name TEXT NOT NULL,
    description TEXT,
    language TEXT,
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    model TEXT,
    system_prompt TEXT,
    temperature REAL,
    max_tokens INTEGER,
    max_iterations INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS image_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storyboard_id INTEGER,
    drama_id INTEGER,
    scene_id INTEGER,
    character_id INTEGER,
    prop_id INTEGER,
    image_type TEXT,
    frame_type TEXT,
    provider TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    model TEXT,
    size TEXT,
    quality TEXT,
    style TEXT,
    steps INTEGER,
    cfg_scale REAL,
    seed INTEGER,
    image_url TEXT,
    minio_url TEXT,
    local_path TEXT,
    status TEXT DEFAULT 'pending',
    task_id TEXT,
    error_msg TEXT,
    width INTEGER,
    height INTEGER,
    reference_images TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS video_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storyboard_id INTEGER,
    drama_id INTEGER,
    provider TEXT,
    prompt TEXT,
    model TEXT,
    image_gen_id INTEGER,
    reference_mode TEXT,
    image_url TEXT,
    first_frame_url TEXT,
    last_frame_url TEXT,
    reference_image_urls TEXT,
    duration INTEGER,
    fps INTEGER,
    resolution TEXT,
    aspect_ratio TEXT,
    style TEXT,
    motion_level INTEGER,
    camera_motion TEXT,
    seed INTEGER,
    video_url TEXT,
    minio_url TEXT,
    local_path TEXT,
    status TEXT DEFAULT 'pending',
    task_id TEXT,
    error_msg TEXT,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS video_merges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER,
    drama_id INTEGER,
    title TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    scenes TEXT,
    merged_url TEXT,
    duration INTEGER,
    task_id TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    prompt TEXT,
    image_url TEXT,
    reference_images TEXT,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER,
    episode_id INTEGER,
    storyboard_id INTEGER,
    storyboard_num INTEGER,
    name TEXT,
    description TEXT,
    type TEXT,
    category TEXT,
    url TEXT,
    thumbnail_url TEXT,
    local_path TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    format TEXT,
    image_gen_id INTEGER,
    video_gen_id INTEGER,
    is_favorite INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
`)

function ensureColumn(table: string, column: string, definition: string) {
  const tableExists = sqlite.prepare(
    `SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
  ).get(table) as { ok: number } | undefined
  if (!tableExists) return
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(col => col.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('characters', 'image_prompt', 'TEXT')
ensureColumn('characters', 'portrait_type', "TEXT DEFAULT 'ai'")
ensureColumn('characters', 'seedance_asset_id', 'TEXT')
ensureColumn('characters', 'seedance_asset_group_id', 'TEXT')
ensureColumn('characters', 'seedance_asset_status', 'TEXT')
ensureColumn('video_generations', 'reference_payload', 'TEXT')
ensureColumn('dramas', 'image_aspect_ratio', "TEXT DEFAULT '9:16'")
ensureColumn('dramas', 'director_style', "TEXT DEFAULT 'hongguo_director'")
ensureColumn('dramas', 'team_id', 'INTEGER')
ensureColumn('episodes', 'image_config_id', 'INTEGER')
ensureColumn('episodes', 'video_config_id', 'INTEGER')
ensureColumn('assistant_messages', 'attachments', 'TEXT')
ensureColumn('storyboards', 'character_image_refs', 'TEXT')
ensureColumn('storyboards', 'prop_image_refs', 'TEXT')
ensureColumn('storyboards', 'blocking_image', 'TEXT')
ensureColumn('storyboards', 'blocking_layout', 'TEXT')
ensureColumn('storyboards', 'scene_angle_id', 'TEXT')
ensureColumn('storyboards', 'prompt_status', "TEXT DEFAULT 'empty'")
ensureColumn('storyboards', 'clip_source', 'TEXT')
ensureColumn('storyboards', 'voice_refs', 'TEXT')
ensureColumn('scenes', 'reference_images', 'TEXT')

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS shot_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    shot_number INTEGER NOT NULL,
    title TEXT,
    scene_id INTEGER,
    location TEXT,
    time TEXT,
    action TEXT,
    dialogue TEXT,
    dialogue_type TEXT DEFAULT 'dialogue',
    duration REAL DEFAULT 2,
    description TEXT,
    industrial_block TEXT,
    source TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'draft',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_shot_plans_episode_id ON shot_plans (episode_id);

  CREATE TABLE IF NOT EXISTS shot_plan_characters (
    shot_plan_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    PRIMARY KEY (shot_plan_id, character_id)
  );

  CREATE INDEX IF NOT EXISTS idx_shot_plan_characters_plan_id ON shot_plan_characters (shot_plan_id);

  CREATE TABLE IF NOT EXISTS video_repaint_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    drama_id INTEGER,
    episode_id INTEGER,
    user_id INTEGER NOT NULL,
    team_id INTEGER,
    status TEXT NOT NULL DEFAULT 'uploaded',
    stage TEXT NOT NULL DEFAULT 'upload',
    source_video_path TEXT,
    source_duration REAL,
    merged_video_path TEXT,
    analysis_json TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_video_repaint_jobs_user_id ON video_repaint_jobs (user_id);
  CREATE INDEX IF NOT EXISTS idx_video_repaint_jobs_team_id ON video_repaint_jobs (team_id);

  CREATE TABLE IF NOT EXISTS video_repaint_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    segment_index INTEGER NOT NULL,
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    duration_sec REAL NOT NULL,
    shot_ids TEXT,
    video_prompt TEXT,
    content_refs TEXT,
    video_generation_id INTEGER,
    status TEXT DEFAULT 'draft',
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_video_repaint_segments_job_id ON video_repaint_segments (job_id);

  CREATE TABLE IF NOT EXISTS narration_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    novel_text TEXT,
    drama_id INTEGER,
    episode_id INTEGER,
    user_id INTEGER NOT NULL,
    team_id INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    stage TEXT NOT NULL DEFAULT 'upload',
    analysis_json TEXT,
    narrator_voice TEXT,
    tts_config_id INTEGER,
    grok_model TEXT DEFAULT 'grok-video-3-pro',
    aspect_ratio TEXT DEFAULT '9:16',
    jianying_draft_path TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_narration_jobs_user_id ON narration_jobs (user_id);
  CREATE INDEX IF NOT EXISTS idx_narration_jobs_team_id ON narration_jobs (team_id);

  CREATE TABLE IF NOT EXISTS narration_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    segment_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    tts_audio_path TEXT,
    tts_duration_sec REAL,
    video_prompt TEXT,
    content_refs TEXT,
    scene_id TEXT,
    character_ids TEXT,
    prop_ids TEXT,
    video_generation_id INTEGER,
    video_path TEXT,
    video_duration_sec REAL,
    status TEXT DEFAULT 'draft',
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_narration_segments_job_id ON narration_segments (job_id);

  CREATE TABLE IF NOT EXISTS tts_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    team_id INTEGER,
    drama_id INTEGER,
    text TEXT NOT NULL,
    voice_asset_id INTEGER,
    voice_path TEXT,
    voice_preset_id TEXT,
    voice_name TEXT,
    emotion_mode TEXT DEFAULT 'same',
    emotion_text TEXT,
    emotion_vector TEXT,
    emotion_weight REAL,
    audio_path TEXT,
    duration_sec REAL,
    status TEXT DEFAULT 'completed',
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tts_generations_user_id ON tts_generations (user_id);
  CREATE INDEX IF NOT EXISTS idx_tts_generations_team_id ON tts_generations (team_id);

  CREATE TABLE IF NOT EXISTS subtitle_removal_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    team_id INTEGER,
    status TEXT NOT NULL DEFAULT 'uploaded',
    source_video_path TEXT,
    output_video_path TEXT,
    remote_job_id TEXT,
    inpaint_mode TEXT DEFAULT 'sttn-auto',
    subtitle_areas_json TEXT,
    progress INTEGER DEFAULT 0,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_subtitle_removal_jobs_user_id ON subtitle_removal_jobs (user_id);
  CREATE INDEX IF NOT EXISTS idx_subtitle_removal_jobs_team_id ON subtitle_removal_jobs (team_id);

  CREATE TABLE IF NOT EXISTS shot_clip_plans (
    storyboard_id INTEGER NOT NULL,
    shot_plan_id INTEGER NOT NULL,
    order_in_clip INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, shot_plan_id)
  );

  CREATE INDEX IF NOT EXISTS idx_shot_clip_plans_storyboard_id ON shot_clip_plans (storyboard_id);
  CREATE INDEX IF NOT EXISTS idx_shot_clip_plans_shot_plan_id ON shot_clip_plans (shot_plan_id);
`)
ensureColumn('assets', 'source_type', 'TEXT')
ensureColumn('narration_segments', 'tts_voice', 'TEXT')
ensureColumn('assets', 'source_id', 'INTEGER')
ensureColumn('activity_logs', 'credit_cost', 'INTEGER')
ensureColumn('image_generations', 'credit_transaction_id', 'INTEGER')
ensureColumn('image_generations', 'is_pinned', 'INTEGER DEFAULT 0')
ensureColumn('image_generations', 'pinned_at', 'TEXT')
ensureColumn('video_generations', 'credit_transaction_id', 'INTEGER')
ensureColumn('video_generations', 'user_id', 'INTEGER')
ensureColumn('video_generations', 'config_id', 'INTEGER')
try {
  sqlite.exec(`
    UPDATE video_generations
    SET config_id = (
      SELECT id FROM ai_service_configs
      WHERE service_type = 'video' AND provider = 'chengmeng'
      ORDER BY id ASC
      LIMIT 1
    )
    WHERE config_id IS NULL AND provider = 'chengmeng'
  `)
} catch { /* ignore backfill errors */ }
try {
  sqlite.exec(`
    UPDATE video_generations
    SET user_id = (
      SELECT user_id FROM credit_transactions
      WHERE credit_transactions.id = video_generations.credit_transaction_id
    )
    WHERE user_id IS NULL AND credit_transaction_id IS NOT NULL
  `)
} catch { /* ignore backfill errors */ }
ensureColumn('characters', 'oss_object_key', 'TEXT')
ensureColumn('scenes', 'oss_object_key', 'TEXT')

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS oss_static_mappings (
    local_path TEXT PRIMARY KEY,
    object_key TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS credit_pricing (
    action TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    cost INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT,
    drama_id INTEGER,
    episode_id INTEGER,
    resource_type TEXT,
    resource_id INTEGER,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    summary TEXT,
    resource_type TEXT,
    resource_id INTEGER,
    drama_id INTEGER,
    episode_id INTEGER,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);

  CREATE TABLE IF NOT EXISTS assistant_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    episode_id INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, episode_id, step_key)
  );

  CREATE TABLE IF NOT EXISTS assistant_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_summary TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread_id ON assistant_messages(thread_id);

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

  CREATE TABLE IF NOT EXISTS drama_team_shares (
    drama_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (drama_id, team_id)
  );

  CREATE INDEX IF NOT EXISTS idx_drama_team_shares_team_id ON drama_team_shares(team_id);

  CREATE TABLE IF NOT EXISTS payment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'wechat',
    package_id TEXT,
    amount_yuan INTEGER NOT NULL,
    amount_fen INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    code_url TEXT,
    wx_prepay_id TEXT,
    wx_transaction_id TEXT,
    credit_transaction_id INTEGER,
    error_msg TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

  CREATE TABLE IF NOT EXISTS canvas_boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    team_id INTEGER,
    created_by INTEGER NOT NULL,
    focus_episode_id INTEGER,
    viewport_json TEXT,
    thumbnail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_canvas_boards_team_id ON canvas_boards(team_id);
  CREATE INDEX IF NOT EXISTS idx_canvas_boards_deleted_at ON canvas_boards(deleted_at);

  CREATE TABLE IF NOT EXISTS canvas_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    node_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_type TEXT,
    ref_id INTEGER,
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    w REAL NOT NULL DEFAULT 200,
    h REAL NOT NULL DEFAULT 120,
    z_index INTEGER NOT NULL DEFAULT 0,
    layout_json TEXT,
    content_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(board_id, node_key)
  );

  CREATE INDEX IF NOT EXISTS idx_canvas_nodes_board_id ON canvas_nodes(board_id);
  CREATE INDEX IF NOT EXISTS idx_canvas_nodes_ref ON canvas_nodes(ref_type, ref_id);

  CREATE TABLE IF NOT EXISTS canvas_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    edge_key TEXT NOT NULL,
    from_node_key TEXT NOT NULL,
    to_node_key TEXT NOT NULL,
    edge_type TEXT NOT NULL DEFAULT 'link',
    layout_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(board_id, edge_key)
  );

  CREATE INDEX IF NOT EXISTS idx_canvas_edges_board_id ON canvas_edges(board_id);
`)

ensureColumn('canvas_boards', 'focus_episode_id', 'INTEGER')
ensureColumn('users', 'credits_balance', 'INTEGER DEFAULT 10000')

function seedDefaultAdmin() {
  const count = sqlite.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  if (count.c > 0) return
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  const ts = new Date().toISOString()
  sqlite.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 1, ?, ?)
  `).run('admin', hashPassword(password), '管理员', ts, ts)
  console.log('🔐 已创建默认管理员账号 admin（初始密码由 ADMIN_PASSWORD 环境变量指定，未设置时使用内置默认值）')
  console.log('   请仅在服务端查看日志，勿将初始密码展示给终端用户')
}

seedDefaultAdmin()
sqlite.prepare('UPDATE users SET credits_balance = 10000 WHERE credits_balance IS NULL').run()

sqlite.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`)

export function getAppMeta(key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setAppMeta(key: string, value: string) {
  sqlite.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(key, value)
}

export const db = drizzle(sqlite, { schema })
export { schema }
export type DB = typeof db
