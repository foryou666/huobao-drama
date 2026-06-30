/**
 * 从目录批量导入项目音色（MP3 子文件夹）
 *
 * 用法:
 *   npx tsx scripts/import-drama-voices.mjs [源目录] [--title="剧名"] [--drama-id=12]
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import ffmpeg from 'fluent-ffmpeg'
import { db, schema } from '../src/db/index.js'
import { eq, and, isNull } from 'drizzle-orm'
import { now } from '../src/utils/response.js'
import { upsertLibraryAsset } from '../src/services/asset-library.js'
import {
  getAudioDurationSeconds,
  validateVoiceRefDuration,
  VOICE_REF_MIN_SECONDS,
  VOICE_REF_MAX_SECONDS,
} from '../src/utils/audio-duration.js'
import { ensureFfmpegConfigured } from '../src/utils/ffmpeg-path.js'
import { syncProjectAsset } from '../src/utils/oss-entity-sync.js'
import { isOssConfigured } from '../src/utils/oss-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const STORAGE_ROOT = process.env.STORAGE_PATH || path.join(projectRoot, 'data', 'static')

const argv = process.argv.slice(2)
const SOURCE_ROOT = argv.find(a => !a.startsWith('--')) || ''
const DRAMA_TITLE = (argv.find(a => a.startsWith('--title=')) || '').split('=').slice(1).join('=').replace(/^"|"$/g, '')
const DRAMA_ID = Number((argv.find(a => a.startsWith('--drama-id=')) || '').split('=')[1] || 0)

const AUDIO_RE = /\.(mp3|wav|m4a)$/i

/** 文件夹/文件名 → 音色展示名 */
const VOICE_NAME_OVERRIDES = {
  '男主声音': '伍运来',
  '白玥光': '白悦光',
  '欧阳锐音色': '欧阳锐',
  '沈跃音色': '沈跃',
  '秦屿音色': '秦屿',
  '孙嘉豪音色': '孙嘉豪',
  '刀疤脸音色': '刀疤脸',
  '1111': '蔡杰',
}

function cleanVoiceLabel(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (VOICE_NAME_OVERRIDES[text]) return VOICE_NAME_OVERRIDES[text]
  return text
    .replace(/音色$/u, '')
    .replace(/\.mp3$/i, '')
    .trim()
}

function resolveVoiceName(relativeDir, fileName) {
  const parts = relativeDir.split(/[/\\]+/).filter(Boolean)
  const fileStem = path.basename(fileName, path.extname(fileName))
  for (let i = parts.length - 1; i >= 0; i--) {
    const label = cleanVoiceLabel(parts[i])
    if (label && label !== '1111') return label
  }
  return cleanVoiceLabel(fileStem) || '未命名音色'
}

function listVoiceFiles(dir) {
  const items = []
  if (!fs.existsSync(dir)) return items
  function walk(current, rel = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name)
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, nextRel)
      else if (AUDIO_RE.test(entry.name)) {
        items.push({
          abs,
          relDir: path.dirname(nextRel) === '.' ? '' : path.dirname(nextRel),
          fileName: entry.name,
        })
      }
    }
  }
  walk(dir)
  return items.sort((a, b) => a.abs.localeCompare(b.abs, 'zh-CN'))
}

function findDrama() {
  if (DRAMA_ID > 0) {
    const [row] = db.select().from(schema.dramas)
      .where(and(eq(schema.dramas.id, DRAMA_ID), isNull(schema.dramas.deletedAt)))
      .all()
    return row || null
  }
  if (!DRAMA_TITLE) return null
  return db.select().from(schema.dramas)
    .where(and(isNull(schema.dramas.deletedAt), eq(schema.dramas.title, DRAMA_TITLE)))
    .all()[0] || null
}

function normalizeAudio(inputPath, outputPath, targetMin, targetMax) {
  ensureFfmpegConfigured()
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err)
      const duration = Number(metadata.format?.duration || 0)
      let command = ffmpeg(inputPath).audioCodec('libmp3lame').audioBitrate('128k').format('mp3')

      if (duration > targetMax) {
        command = command.setStartTime(0).duration(targetMax)
      } else if (duration > 0 && duration < targetMin) {
        command = command.audioFilters(`apad=whole_dur=${targetMin}`)
      }

      command
        .on('end', () => resolve())
        .on('error', probeErr => reject(probeErr))
        .save(outputPath)
    })
  })
}

async function prepareVoiceFile(src) {
  const ext = path.extname(src).toLowerCase() || '.mp3'
  const filename = `${uuid()}${ext}`
  const destAbs = path.join(STORAGE_ROOT, 'assets', filename)
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  fs.copyFileSync(src, destAbs)

  let relative = `static/assets/${filename}`
  let duration = await getAudioDurationSeconds(relative)
  let durationError = validateVoiceRefDuration(duration)

  if (durationError) {
    const fixedFilename = `${uuid()}${ext}`
    const fixedAbs = path.join(STORAGE_ROOT, 'assets', fixedFilename)
    await normalizeAudio(destAbs, fixedAbs, VOICE_REF_MIN_SECONDS, VOICE_REF_MAX_SECONDS)
    fs.unlinkSync(destAbs)
    relative = `static/assets/${fixedFilename}`
    duration = await getAudioDurationSeconds(relative)
    durationError = validateVoiceRefDuration(duration)
    if (durationError) {
      if (fs.existsSync(fixedAbs)) fs.unlinkSync(fixedAbs)
      throw new Error(durationError)
    }
  }

  return { relative, duration: Math.round(duration), fileSize: fs.statSync(path.join(STORAGE_ROOT, 'assets', path.basename(relative))).size }
}

function findExistingVoice(dramaId, name) {
  return db.select().from(schema.assets)
    .where(and(
      eq(schema.assets.dramaId, dramaId),
      eq(schema.assets.type, 'voice'),
      eq(schema.assets.name, name),
      isNull(schema.assets.deletedAt),
    ))
    .all()[0] || null
}

async function main() {
  if (!SOURCE_ROOT || !fs.existsSync(SOURCE_ROOT)) {
    console.error('源目录不存在:', SOURCE_ROOT)
    process.exit(1)
  }

  const drama = findDrama()
  if (!drama) {
    console.error('未找到项目，请指定 --title 或 --drama-id')
    process.exit(1)
  }

  const voices = listVoiceFiles(SOURCE_ROOT)
  console.log('=== 导入项目音色 ===')
  console.log('源目录:', SOURCE_ROOT)
  console.log(`项目: ${drama.title} (id=${drama.id})`)
  console.log('音色文件:', voices.length)

  const stats = { imported: 0, updated: 0, failed: 0 }

  for (const item of voices) {
    const name = resolveVoiceName(item.relDir, item.fileName)
    try {
      const { relative, duration, fileSize } = await prepareVoiceFile(item.abs)
      const description = `从资产包导入：${item.relDir ? `${item.relDir}/` : ''}${item.fileName}`

      const existing = findExistingVoice(drama.id, name)
      const id = upsertLibraryAsset({
        dramaId: drama.id,
        name,
        description,
        type: 'voice',
        category: 'voice',
        url: relative,
        localPath: relative,
        sourceType: 'import',
        mimeType: 'audio/mpeg',
        duration,
        fileSize,
      })

      if (isOssConfigured()) {
        await syncProjectAsset(drama.id, relative).catch(() => {})
      }

      if (existing) stats.updated += 1
      else stats.imported += 1
      console.log(`  ✓ ${name} (${duration}s) id=${id}`)
    } catch (err) {
      stats.failed += 1
      console.error(`  ✗ ${name}: ${err.message}`)
    }
  }

  console.log('\n=== 导入完成 ===')
  console.log(JSON.stringify({
    drama_id: drama.id,
    title: drama.title,
    ...stats,
  }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
