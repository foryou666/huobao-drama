/**
 * 从项目资产包批量导入剧集、角色（多服装多图）、场景、道具
 *
 * 用法:
 *   npx tsx scripts/import-drama-project-assets.mjs [源目录] [--team-id=1] [--title="Crash into his arms"] [--episodes=40]
 *
 * 源目录结构:
 *   人物/角色名/服装名/多张图   或  人物/角色名/多张图
 *   场景/场景名/多张图
 *   道具/道具名/多张图
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
import { appendCharacterOutfitImage, listCharacterOutfits } from '../src/utils/character-image-variants.js'
import { upsertSceneAngleImage } from '../src/utils/scene-image-variants.js'
import { upsertPropViewImage } from '../src/utils/prop-image-variants.js'
import { syncCharacterAsset, syncSceneAsset, syncPropAsset } from '../src/services/asset-library.js'
import { buildDefaultCharacterImagePrompt } from '../src/utils/character-image-prompt.js'
import { syncCharacterPrimaryImage, syncScenePrimaryImage } from '../src/utils/oss-entity-sync.js'
import { isOssConfigured } from '../src/utils/oss-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const STORAGE_ROOT = process.env.STORAGE_PATH || path.join(projectRoot, 'data', 'static')

const argv = process.argv.slice(2)
const SOURCE_ROOT = argv.find(a => !a.startsWith('--')) || 'D:/Desktop/Crash into his arms'
const TEAM_ID = Number((argv.find(a => a.startsWith('--team-id=')) || '--team-id=1').split('=')[1])
const DRAMA_TITLE = (argv.find(a => a.startsWith('--title=')) || '--title=Crash into his arms').split('=').slice(1).join('=').replace(/^"|"$/g, '')
const TOTAL_EPISODES = Number((argv.find(a => a.startsWith('--episodes=')) || '--episodes=40').split('=')[1])

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i
const PRIMARY_HINTS = ['终稿', '定稿', '正稿', '主图', 'hero']
const BASELINE_OUTFIT_HINTS = ['常服', '内衬', '日常', 'default', 'base']

function slugifyId(name) {
  return String(name || 'item')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .slice(0, 48) || 'item'
}

function listEntries(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
}

function listImages(dir) {
  return listEntries(dir)
    .filter(e => e.isFile() && IMAGE_RE.test(e.name))
    .map(e => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function fileSize(file) {
  try { return fs.statSync(file).size } catch { return 0 }
}

function stem(file) {
  return path.basename(file, path.extname(file))
}

function scorePrimary(file, nameHint) {
  const base = stem(file)
  const lower = base.toLowerCase()
  const hint = String(nameHint || '').toLowerCase()
  let score = fileSize(file)
  if (hint && (lower === hint || lower.includes(hint))) score += 1e9
  if (PRIMARY_HINTS.some(h => base.includes(h))) score += 5e8
  if (/^\d+$/.test(base)) score -= 1e6
  if (/丑|备选|草稿|草图|test/i.test(base)) score -= 5e7
  return score
}

function pickPrimary(files, nameHint) {
  if (!files.length) return null
  return [...files].sort((a, b) => scorePrimary(b, nameHint) - scorePrimary(a, nameHint))[0]
}

function pickDefaultCandidate(files, outfitLabel) {
  return pickPrimary(files, outfitLabel)
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

async function importCharacter(dramaId, charName, charDir, stats) {
  const char = ensureCharacter(dramaId, charName)
  const entries = listEntries(charDir)
  const outfitDirs = entries.filter(e => e.isDirectory())
  const rootImages = listImages(charDir)

  let primaryRelative = null
  const baselineOutfitId = outfitDirs
    .map(d => d.name)
    .sort((a, b) => {
      const ai = BASELINE_OUTFIT_HINTS.findIndex(h => a.includes(h))
      const bi = BASELINE_OUTFIT_HINTS.findIndex(h => b.includes(h))
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    })[0]

  if (outfitDirs.length) {
    for (const outfitDir of outfitDirs) {
      const outfitLabel = outfitDir.name
      const outfitId = slugifyId(outfitLabel)
      const images = listImages(path.join(charDir, outfitDir.name))
      if (!images.length) continue

      const defaultFile = pickDefaultCandidate(images, outfitLabel)
      for (const img of images) {
        const relative = await copyToStatic(img, 'characters')
        stats.images += 1
        appendCharacterOutfitImage(char.id, {
          outfitId,
          label: outfitLabel,
          url: relative,
          candidateLabel: img === defaultFile ? '定稿' : stem(img),
          setAsDefault: img === defaultFile,
        })
      }
      stats.outfits += 1
      console.log(`    服装 ${outfitLabel}: ${images.length} 张`)
    }
  }

  if (rootImages.length) {
    const primaryFile = pickPrimary(rootImages, charName)
    if (primaryFile) {
      primaryRelative = await copyToStatic(primaryFile, 'characters')
      stats.images += 1
      await setCharacterPrimary(char.id, primaryRelative)
      console.log(`    主图: ${path.basename(primaryFile)}`)
    }
    const rest = rootImages.filter(f => f !== primaryFile)
    for (const img of rest) {
      const label = stem(img)
      const outfitId = slugifyId(label)
      const relative = await copyToStatic(img, 'characters')
      stats.images += 1
      appendCharacterOutfitImage(char.id, {
        outfitId,
        label,
        url: relative,
        candidateLabel: '定稿',
        setAsDefault: true,
      })
      stats.outfits += 1
      if (!primaryRelative) primaryRelative = relative
      console.log(`    附加图→服装 ${label}`)
    }
  }

  if (!primaryRelative) {
    const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, char.id)).all()
    const outfits = listCharacterOutfits(updated?.referenceImages)
    const baseline = outfits.find(o => o.label === baselineOutfitId)
      || outfits.find(o => BASELINE_OUTFIT_HINTS.some(h => o.label.includes(h)))
      || outfits[0]
    primaryRelative = baseline?.url || updated?.imageUrl || updated?.localPath || null
  }
  if (primaryRelative) {
    await setCharacterPrimary(char.id, primaryRelative)
  }

  syncCharacterAsset(char.id)
  stats.characters += 1
  console.log(`  ✓ 角色 ${charName} (id=${char.id})`)
}

async function importScene(dramaId, location, sceneDir, stats) {
  const scene = ensureScene(dramaId, location)
  const images = listImages(sceneDir)
  if (!images.length) return

  const primaryFile = pickPrimary(images, location)
  const primaryRelative = await copyToStatic(primaryFile, 'scenes')
  stats.images += 1
  await setScenePrimary(scene.id, primaryRelative)
  console.log(`    主视角: ${path.basename(primaryFile)}`)

  for (const img of images) {
    if (img === primaryFile) continue
    const relative = await copyToStatic(img, 'scenes')
    stats.images += 1
    const angleId = `ref_${slugifyId(stem(img))}`
    upsertSceneAngleImage(scene.id, angleId, relative, stem(img))
    console.log(`    参考图: ${path.basename(img)}`)
  }

  syncSceneAsset(scene.id)
  stats.scenes += 1
  console.log(`  ✓ 场景 ${location} (id=${scene.id})`)
}

async function importProp(dramaId, name, propDir, stats) {
  const prop = ensureProp(dramaId, name)
  const images = listImages(propDir)
  if (!images.length) return

  const primaryFile = pickPrimary(images, name)
  const primaryRelative = await copyToStatic(primaryFile, 'props')
  stats.images += 1
  const ts = now()
  db.update(schema.props)
    .set({ imageUrl: primaryRelative, localPath: primaryRelative, updatedAt: ts })
    .where(eq(schema.props.id, prop.id))
    .run()

  for (const img of images) {
    if (img === primaryFile) continue
    const relative = await copyToStatic(img, 'props')
    stats.images += 1
    const viewId = `ref_${slugifyId(stem(img))}`
    upsertPropViewImage(prop.id, viewId, relative, stem(img))
    console.log(`    参考图: ${path.basename(img)}`)
  }

  syncPropAsset(prop.id)
  stats.props += 1
  console.log(`  ✓ 道具 ${name} (id=${prop.id}, ${images.length} 张)`)
}

async function main() {
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error('源目录不存在:', SOURCE_ROOT)
    process.exit(1)
  }

  const charRoot = path.join(SOURCE_ROOT, '人物')
  const sceneRoot = path.join(SOURCE_ROOT, '场景')
  const propRoot = path.join(SOURCE_ROOT, '道具')

  console.log('=== 导入项目资产 ===')
  console.log('源目录:', SOURCE_ROOT)
  console.log('剧名:', DRAMA_TITLE)
  console.log('团队 ID:', TEAM_ID)
  console.log('集数:', TOTAL_EPISODES)

  const { drama, created } = ensureDrama(DRAMA_TITLE, TEAM_ID, TOTAL_EPISODES)
  console.log(`\n剧集: ${drama.title} (id=${drama.id})${created ? ' [新建]' : ' [已存在]'}`)

  const stats = { characters: 0, outfits: 0, scenes: 0, props: 0, images: 0 }

  if (fs.existsSync(charRoot)) {
    console.log('\n--- 人物 ---')
    for (const entry of listEntries(charRoot).filter(e => e.isDirectory())) {
      await importCharacter(drama.id, entry.name, path.join(charRoot, entry.name), stats)
    }
  } else {
    console.warn('未找到 人物 目录')
  }

  if (fs.existsSync(sceneRoot)) {
    console.log('\n--- 场景 ---')
    for (const entry of listEntries(sceneRoot).filter(e => e.isDirectory())) {
      await importScene(drama.id, entry.name, path.join(sceneRoot, entry.name), stats)
    }
  } else {
    console.warn('未找到 场景 目录')
  }

  if (fs.existsSync(propRoot)) {
    console.log('\n--- 道具 ---')
    for (const entry of listEntries(propRoot).filter(e => e.isDirectory())) {
      await importProp(drama.id, entry.name, path.join(propRoot, entry.name), stats)
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
