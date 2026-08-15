import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { resolveMediaFilePath } from '../utils/audio-duration.js'
import { ensureFfmpegConfigured, resolveFfmpegExecutable } from '../utils/ffmpeg-path.js'
import { zipDirectoryToFile } from '../utils/zip-directory.js'
import { listNarrationSegments } from './narration-segments.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

const US_PER_SEC = 1_000_000
/** 剪映素材子目录：用小写，与剪映丢失媒体弹窗中的 resources/ 一致 */
const RESOURCES_DIR = 'resources'

type TimelineItem = {
  segmentIndex: number
  audioPath: string
  videoPath?: string | null
  audioDurationSec: number
  videoDurationSec?: number | null
  text: string
}

type EnrichedItem = TimelineItem & {
  _audioId?: string
  _videoId?: string | null
  _textId?: string
  _audioDur?: number
  _videoDur?: number
}

function copyVideoAsset(srcRelative: string, destDir: string, prefix: string): string | null {
  const abs = resolveMediaFilePath(srcRelative)
  if (!abs || !fs.existsSync(abs)) return null
  const ext = path.extname(abs) || '.mp4'
  const name = `${prefix}${ext}`
  fs.copyFileSync(abs, path.join(destDir, name))
  return name
}

/** 旁白统一转成 mp3，剪映对 flac 兼容性较差 */
function copyAudioAsMp3(srcRelative: string, destDir: string, prefix: string): string | null {
  const abs = resolveMediaFilePath(srcRelative)
  if (!abs || !fs.existsSync(abs)) return null
  const destName = `${prefix}.mp3`
  const destAbs = path.join(destDir, destName)

  if (/\.mp3$/i.test(abs)) {
    fs.copyFileSync(abs, destAbs)
    return destName
  }

  try {
    ensureFfmpegConfigured()
    const ff = resolveFfmpegExecutable()
    const result = spawnSync(
      ff,
      ['-y', '-i', abs, '-vn', '-acodec', 'libmp3lame', '-q:a', '3', destAbs],
      { encoding: 'utf8' },
    )
    if (result.status === 0 && fs.existsSync(destAbs) && fs.statSync(destAbs).size > 0) {
      return destName
    }
  } catch {
    /* fallback below */
  }

  // 转码失败则原样拷贝（仍可能被剪映拒绝，但至少有文件）
  const ext = path.extname(abs) || '.bin'
  const fallback = `${prefix}${ext}`
  fs.copyFileSync(abs, path.join(destDir, fallback))
  return fallback
}

function materialPath(fileName: string) {
  return `${RESOURCES_DIR}/${fileName}`
}

function buildMaterials(items: EnrichedItem[], resourcesDir: string) {
  const videos: any[] = []
  const audios: any[] = []
  const texts: any[] = []

  items.forEach((item, idx) => {
    const audioFile = copyAudioAsMp3(item.audioPath, resourcesDir, `audio_${idx}`)
    const videoFile = item.videoPath ? copyVideoAsset(item.videoPath, resourcesDir, `video_${idx}`) : null
    const audioId = randomUUID().toUpperCase()
    const videoId = videoFile ? randomUUID().toUpperCase() : null
    const textId = randomUUID().toUpperCase()
    const audioDur = Math.max(1, item.audioDurationSec) * US_PER_SEC
    const videoDur = Math.max(1, item.videoDurationSec || item.audioDurationSec) * US_PER_SEC

    if (audioFile) {
      audios.push({
        id: audioId,
        type: 'extract_music',
        path: materialPath(audioFile),
        duration: Math.round(audioDur),
        name: `旁白${idx + 1}`,
        material_name: `旁白${idx + 1}`,
      })
    }
    if (videoFile && videoId) {
      videos.push({
        id: videoId,
        type: 'video',
        path: materialPath(videoFile),
        duration: Math.round(videoDur),
        width: 1080,
        height: 1920,
        material_name: `镜头${idx + 1}`,
      })
    }
    texts.push({
      id: textId,
      type: 'text',
      content: item.text,
    })

    item._audioId = audioFile ? audioId : undefined
    item._videoId = videoId
    item._textId = textId
    item._audioDur = audioDur
    item._videoDur = videoDur
  })

  return { videos, audios, texts, items }
}

function buildTracks(items: EnrichedItem[]) {
  const videoSegments: any[] = []
  const audioSegments: any[] = []
  let cursor = 0

  for (const item of items) {
    const duration = Math.round(item._audioDur || 5 * US_PER_SEC)
    if (item._videoId && item._videoDur) {
      let offset = 0
      const clipDur = Math.round(item._videoDur)
      while (offset < duration) {
        const piece = Math.min(clipDur, duration - offset)
        videoSegments.push({
          id: randomUUID().toUpperCase(),
          material_id: item._videoId,
          target_timerange: { start: cursor + offset, duration: piece },
          source_timerange: { start: 0, duration: piece },
          speed: 1,
          volume: 1,
        })
        offset += piece
      }
    }
    if (item._audioId) {
      audioSegments.push({
        id: randomUUID().toUpperCase(),
        material_id: item._audioId,
        target_timerange: { start: cursor, duration },
        source_timerange: { start: 0, duration },
        speed: 1,
        volume: 1,
      })
    }
    cursor += duration
  }

  return [
    { id: randomUUID().toUpperCase(), type: 'video', segments: videoSegments, attribute: 0, flag: 0 },
    { id: randomUUID().toUpperCase(), type: 'audio', segments: audioSegments, attribute: 0, flag: 0 },
  ]
}

/** 将草稿目录打成 zip（根目录为草稿文件夹名） */
function zipDraftFolder(absBase: string, absZip: string) {
  if (fs.existsSync(absZip)) fs.unlinkSync(absZip)
  zipDirectoryToFile(absBase, absZip, path.basename(absBase))
}

/**
 * 写入 Windows 本机路径修复脚本。
 * 剪映桌面版要求素材为「本机绝对路径」；云端导出时无法预知用户解压位置，
 * 故需用户解压后先运行此脚本，再拷入剪映草稿目录。
 */
function writePathFixScripts(absBase: string) {
  const ps1 = [
    "$ErrorActionPreference = 'Stop'",
    "$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path",
    "$posix = $root -replace '\\\\','/'",
    "$contentFile = Join-Path $root 'draft_content.json'",
    "$metaFile = Join-Path $root 'draft_meta_info.json'",
    "if (-not (Test-Path -LiteralPath $contentFile)) { throw '未找到 draft_content.json' }",
    "$raw = [System.IO.File]::ReadAllText($contentFile, [System.Text.UTF8Encoding]::new($false))",
    `$fixed = [regex]::Replace($raw, '"path"\\s*:\\s*"(?:[A-Za-z]:/[^"]*/)?${RESOURCES_DIR}/([^"]+)"', { param($m) '"path": "' + $posix + '/${RESOURCES_DIR}/' + $m.Groups[1].Value + '"' })`,
    "[System.IO.File]::WriteAllText($contentFile, $fixed, [System.Text.UTF8Encoding]::new($false))",
    "if (Test-Path -LiteralPath $metaFile) {",
    "  $metaRaw = [System.IO.File]::ReadAllText($metaFile, [System.Text.UTF8Encoding]::new($false))",
    "  $metaRaw = [regex]::Replace($metaRaw, '\"draft_root_path\"\\s*:\\s*\"[^\"]*\"', ('\"draft_root_path\": \"' + $posix + '\"'))",
    "  if ($metaRaw -match '\"draft_fold_path\"') {",
    "    $metaRaw = [regex]::Replace($metaRaw, '\"draft_fold_path\"\\s*:\\s*\"[^\"]*\"', ('\"draft_fold_path\": \"' + $posix + '\"'))",
    "  } else {",
    "    $metaRaw = $metaRaw.TrimEnd() -replace '\\}\\s*$', (',\"draft_fold_path\": \"' + $posix + '\"}')",
    "  }",
    "  [System.IO.File]::WriteAllText($metaFile, $metaRaw, [System.Text.UTF8Encoding]::new($false))",
    "}",
    "Write-Host ''",
    "Write-Host ('路径已修复为：' + $posix)",
    "Write-Host '请将【本文件夹整体】复制到剪映草稿目录，然后重启剪映。'",
    "Write-Host '（剪映 → 全局设置 → 草稿位置）'",
    '',
  ].join('\r\n')

  const bat = [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'echo 正在把素材路径改成当前文件夹的绝对路径...',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix_paths.ps1"',
    'if errorlevel 1 (',
    '  echo.',
    `  echo 修复失败。也可在剪映「链接媒体」弹窗中，选择本目录下的 ${RESOURCES_DIR} 文件夹自动匹配。`,
    '  pause',
    '  exit /b 1',
    ')',
    'echo.',
    'echo 完成。下一步：把本文件夹复制到剪映草稿目录后重启剪映。',
    'pause',
    '',
  ].join('\r\n')

  fs.writeFileSync(path.join(absBase, 'fix_paths.ps1'), ps1, 'utf8')
  fs.writeFileSync(path.join(absBase, '修复路径.bat'), bat, 'utf8')
}

export type JianyingExportResult = {
  draftPath: string
  zipPath: string
}

/** 导出剪映草稿目录并打包 zip */
export function exportJianyingDraft(jobId: number, title: string): JianyingExportResult {
  const segments = listNarrationSegments(jobId)
    .filter(s => s.ttsAudioPath)
    .sort((a, b) => a.segmentIndex - b.segmentIndex)

  if (!segments.length) throw new Error('没有可用的旁白音频，请先完成 TTS')

  const items: EnrichedItem[] = segments.map(s => ({
    segmentIndex: s.segmentIndex,
    audioPath: s.ttsAudioPath!,
    videoPath: s.videoPath,
    audioDurationSec: Number(s.ttsDurationSec) || 5,
    videoDurationSec: s.videoDurationSec ? Number(s.videoDurationSec) : null,
    text: s.text,
  }))

  const draftId = randomUUID().toUpperCase()
  const safeTitle = String(title || `解说漫_${jobId}`).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)
  const folderName = `${safeTitle}_${jobId}_${draftId.slice(0, 8)}`
  const relBase = `static/jianying-drafts/${folderName}`
  const relZip = `${relBase}.zip`
  const absBase = path.join(STORAGE_ROOT, 'jianying-drafts', folderName)
  const absZip = path.join(STORAGE_ROOT, 'jianying-drafts', `${folderName}.zip`)
  const resourcesDir = path.join(absBase, RESOURCES_DIR)
  fs.mkdirSync(resourcesDir, { recursive: true })

  const { videos, audios, texts } = buildMaterials(items, resourcesDir)
  const tracks = buildTracks(items)
  const totalDuration = Math.round(items.reduce((sum, item) => sum + (item._audioDur || 0), 0))

  if (!audios.length) throw new Error('旁白音频未能打包进草稿，请检查 TTS 文件是否存在')

  const draftContent = {
    canvas_config: { width: 1080, height: 1920, ratio: '9:16' },
    color_space: 0,
    config: { maintrack_adsorb: true },
    cover: null,
    create_time: Math.floor(Date.now() / 1000),
    duration: totalDuration,
    fps: 30,
    id: draftId,
    name: safeTitle,
    materials: { videos, audios, texts, speeds: [], transitions: [] },
    tracks,
    version: 360000,
  }

  // 不写服务器绝对路径，避免剪映在 Windows 上按 Linux 路径找媒体
  const metaInfo = {
    draft_id: draftId,
    draft_name: safeTitle,
    draft_root_path: '',
    draft_fold_path: '',
    tm_draft_create: Date.now(),
    tm_draft_modified: Date.now(),
  }

  fs.writeFileSync(path.join(absBase, 'draft_content.json'), JSON.stringify(draftContent, null, 2), 'utf8')
  fs.writeFileSync(path.join(absBase, 'draft_meta_info.json'), JSON.stringify(metaInfo, null, 2), 'utf8')
  writePathFixScripts(absBase)
  fs.writeFileSync(path.join(absBase, 'README.txt'), [
    '剪映草稿导入步骤（必读）',
    '',
    '1. 解压本 zip，进入解压出的草稿文件夹',
    '2. 双击运行「修复路径.bat」（把素材改成你电脑上的绝对路径）',
    '3. 将【整个文件夹】复制到剪映草稿目录：',
    '   剪映专业版 → 左上角菜单 → 全局设置 → 草稿位置',
    '4. 完全退出并重新打开剪映，在草稿列表中打开本项目',
    '',
    '若仍提示媒体丢失：在弹窗中点「链接媒体」，选择本文件夹里的 resources 目录，勾选自动匹配。',
    '',
    `生成时间: ${new Date().toISOString()}`,
    `镜头视频: ${videos.length}  旁白音频: ${audios.length}`,
  ].join('\n'), 'utf8')

  zipDraftFolder(absBase, absZip)
  return { draftPath: relBase, zipPath: relZip }
}
