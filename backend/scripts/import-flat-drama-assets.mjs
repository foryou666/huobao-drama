/**
 * 从扁平目录批量导入剧集资产（图片直接在根目录，按文件名自动分类）
 *
 * 用法:
 *   npx tsx scripts/import-flat-drama-assets.mjs [源目录] [--title="剧名"] [--team-id=1] [--episodes=10]
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { db, schema } from '../src/db/index.js'
import { eq, and, isNull } from 'drizzle-orm'
import { now } from '../src/utils/response.js'
import { ensureThumbnail } from '../src/utils/thumbnail.js'
import { syncCharacterAsset, syncSceneAsset, syncPropAsset } from '../src/services/asset-library.js'
import { buildDefaultCharacterImagePrompt } from '../src/utils/character-image-prompt.js'
import { syncCharacterPrimaryImage, syncScenePrimaryImage } from '../src/utils/oss-entity-sync.js'
import { isOssConfigured } from '../src/utils/oss-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const STORAGE_ROOT = process.env.STORAGE_PATH || path.join(projectRoot, 'data', 'static')

const argv = process.argv.slice(2)
const SOURCE_ROOT = argv.find(a => !a.startsWith('--')) || ''
const TEAM_ID = Number((argv.find(a => a.startsWith('--team-id=')) || '--team-id=1').split('=')[1])
const DRAMA_TITLE = (argv.find(a => a.startsWith('--title=')) || '--title=未命名项目').split('=').slice(1).join('=').replace(/^"|"$/g, '')
const TOTAL_EPISODES = Number((argv.find(a => a.startsWith('--episodes=')) || '--episodes=10').split('=')[1])

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i

const SCENE_KEYWORDS = [
  '宿舍', '走廊', '海滩', '花园', '酒店', '蛋糕', '门口', '包厢', '卫生间',
  '学校', '校园', '教室', '大厅', '房间', '小花园', '回宿舍', '夏威夷',
  '路', '馆', '屋', '室', '园', '厅', '店', '场',
]

const PROP_KEYWORDS = ['神丹', '挂件', '道具', '物品', '武器', '丹药']

function classifyImage(stem) {
  const name = String(stem || '').trim()
  if (!name || /^image\s*\(\d+\)$/i.test(name)) return null
  if (PROP_KEYWORDS.some(k => name.includes(k))) return 'prop'
  if (SCENE_KEYWORDS.some(k => name.includes(k))) return 'scene'
  return 'character'
}

function listFlatImages(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && IMAGE_RE.test(e.name))
    .map(e => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

async function copyToStatic(src, subDir) {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })
  const ext = path.extname(src).toLowerCase() || '.png'
  const filename = `${uuid()}${ext}`
  const destAbs = path.join(dir, filename)
  fs.copyFileSync(src, destAbs)
  const relative = `static/${subDir}/${filename}`
  await ensureThumbnail(relative).catch(() => {})
  return relative
}

function findDramaByTitle(title) {
  return db.select().from(schema.dramas)
    .where(and(isNull(schema.dramas.deletedAt), eq(schema.dramas.title, title)))
    .all()[0] || null
}

function ensureDrama(title, teamId, totalEpisodes) {
  let drama = findDramaByTitle(title)
  const ts = now()
  if (drama) {
    const epCount = db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, drama.id)).all().length
    if (epCount < totalEpisodes) {
      for (let i = epCount + 1; i <= totalEpisodes; i++) {
        db.insert(schema.episodes).values({
          dramaId: drama.id,
          episodeNumber: i,
          title: `第${i}集`,
          status: 'draft',
          createdAt: ts,
          updatedAt: ts,
        }).run()
      }
    }
    if (drama.teamId !== teamId) {
      db.update(schema.dramas).set({ teamId, updatedAt: ts }).where(eq(schema.dramas.id, drama.id)).run()
      drama = { ...drama, teamId }
    }
    return { drama, created: false }
  }

  const res = db.insert(schema.dramas).values({
    title,
    description: `从资产包导入：${path.basename(SOURCE_ROOT)}`,
    teamId,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const dramaId = Number(res.lastInsertRowid)
  for (let i = 1; i <= totalEpisodes; i++) {
    db.insert(schema.episodes).values({
      dramaId,
      episodeNumber: i,
      title: `第${i}集`,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    }).run()
  }
  const [created] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  return { drama: created, created: true }
}

function findCharacter(dramaId, name) {
  return db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, dramaId))
    .all()
    .find(c => !c.deletedAt && c.name === name) || null
}

function ensureCharacter(dramaId, name) {
  const existing = findCharacter(dramaId, name)
  if (existing) return existing
  const ts = now()
  const res = db.insert(schema.characters).values({
    dramaId,
    name,
    role: '',
    description: '',
    appearance: '',
    personality: '',
    imagePrompt: buildDefaultCharacterImagePrompt({ name }),
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const [created] = db.select().from(schema.characters).where(eq(schema.characters.id, Number(res.lastInsertRowid))).all()
  return created
}

function findScene(dramaId, location) {
  return db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, dramaId))
    .all()
    .find(s => !s.deletedAt && s.location === location) || null
}

function ensureScene(dramaId, location) {
  const existing = findScene(dramaId, location)
  if (existing) return existing
  const ts = now()
  const res = db.insert(schema.scenes).values({
    dramaId,
    episodeId: null,
    location,
    time: '日',
    prompt: location,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const [created] = db.select().from(schema.scenes).where(eq(schema.scenes.id, Number(res.lastInsertRowid))).all()
  return created
}

function findProp(dramaId, name) {
  return db.select().from(schema.props)
    .where(eq(schema.props.dramaId, dramaId))
    .all()
    .find(p => !p.deletedAt && p.name === name) || null
}

function ensureProp(dramaId, name) {
  const existing = findProp(dramaId, name)
  if (existing) return existing
  const ts = now()
  const res = db.insert(schema.props).values({
    dramaId,
    name,
    type: 'prop',
    description: '',
    prompt: name,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const [created] = db.select().from(schema.props).where(eq(schema.props.id, Number(res.lastInsertRowid))).all()
  return created
}

async function setCharacterPrimary(characterId, relative) {
  const ts = now()
  db.update(schema.characters)
    .set({ imageUrl: relative, localPath: relative, updatedAt: ts })
    .where(eq(schema.characters.id, characterId))
    .run()
  if (isOssConfigured()) {
    await syncCharacterPrimaryImage(characterId, relative).catch(() => {})
  }
}

async function setScenePrimary(sceneId, relative) {
  const ts = now()
  db.update(schema.scenes)
    .set({ imageUrl: relative, localPath: relative, updatedAt: ts })
    .where(eq(schema.scenes.id, sceneId))
    .run()
  if (isOssConfigured()) {
    await syncScenePrimaryImage(sceneId, relative).catch(() => {})
  }
}

async function main() {
  if (!SOURCE_ROOT || !fs.existsSync(SOURCE_ROOT)) {
    console.error('源目录不存在:', SOURCE_ROOT)
    process.exit(1)
  }

  const images = listFlatImages(SOURCE_ROOT)
  console.log('=== 扁平资产导入 ===')
  console.log('源目录:', SOURCE_ROOT)
  console.log('剧名:', DRAMA_TITLE)
  console.log('团队 ID:', TEAM_ID)
  console.log('图片数:', images.length)

  const { drama, created } = ensureDrama(DRAMA_TITLE, TEAM_ID, TOTAL_EPISODES)
  console.log(`\n剧集: ${drama.title} (id=${drama.id})${created ? ' [新建]' : ' [已存在]'}`)

  const stats = { characters: 0, scenes: 0, props: 0, images: 0, skipped: 0 }

  for (const src of images) {
    const stem = path.basename(src, path.extname(src))
    const kind = classifyImage(stem)
    if (!kind) {
      stats.skipped += 1
      console.log(`  跳过: ${path.basename(src)}`)
      continue
    }

    const relative = await copyToStatic(src, kind === 'character' ? 'characters' : kind === 'scene' ? 'scenes' : 'props')
    stats.images += 1

    if (kind === 'character') {
      const char = ensureCharacter(drama.id, stem)
      await setCharacterPrimary(char.id, relative)
      syncCharacterAsset(char.id)
      stats.characters += 1
      console.log(`  ✓ 角色 ${stem}`)
    } else if (kind === 'scene') {
      const scene = ensureScene(drama.id, stem)
      await setScenePrimary(scene.id, relative)
      syncSceneAsset(scene.id)
      stats.scenes += 1
      console.log(`  ✓ 场景 ${stem}`)
    } else {
      const prop = ensureProp(drama.id, stem)
      const ts = now()
      db.update(schema.props)
        .set({ imageUrl: relative, localPath: relative, updatedAt: ts })
        .where(eq(schema.props.id, prop.id))
        .run()
      syncPropAsset(prop.id)
      stats.props += 1
      console.log(`  ✓ 道具 ${stem}`)
    }
  }

  console.log('\n=== 导入完成 ===')
  console.log(JSON.stringify({
    drama_id: drama.id,
    title: drama.title,
    team_id: TEAM_ID,
    ...stats,
  }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
