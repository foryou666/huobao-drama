import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { resolveMediaFilePath } from '../utils/audio-duration.js'
import { listNarrationSegments } from './narration-segments.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

const US_PER_SEC = 1_000_000

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

function copyAsset(srcRelative: string, destDir: string, prefix: string) {
  const abs = resolveMediaFilePath(srcRelative)
  if (!abs || !fs.existsSync(abs)) return null
  const ext = path.extname(abs) || '.bin'
  const name = `${prefix}${ext}`
  fs.copyFileSync(abs, path.join(destDir, name))
  return name
}

function buildMaterials(items: EnrichedItem[], resourcesDir: string) {
  const videos: any[] = []
  const audios: any[] = []
  const texts: any[] = []

  items.forEach((item, idx) => {
    const audioFile = copyAsset(item.audioPath, resourcesDir, `audio_${idx}`)
    const videoFile = item.videoPath ? copyAsset(item.videoPath, resourcesDir, `video_${idx}`) : null
    const audioId = randomUUID()
    const videoId = videoFile ? randomUUID() : null
    const textId = randomUUID()
    const audioDur = Math.max(1, item.audioDurationSec) * US_PER_SEC
    const videoDur = Math.max(1, item.videoDurationSec || item.audioDurationSec) * US_PER_SEC

    audios.push({
      id: audioId,
      type: 'extract_music',
      path: `Resources/${audioFile}`,
      duration: audioDur,
      name: `旁白${idx + 1}`,
    })
    if (videoFile && videoId) {
      videos.push({
        id: videoId,
        type: 'video',
        path: `Resources/${videoFile}`,
        duration: videoDur,
        width: 1080,
        height: 1920,
      })
    }
    texts.push({
      id: textId,
      type: 'text',
      content: item.text,
    })

    item._audioId = audioId
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
    const duration = item._audioDur || 5 * US_PER_SEC
    if (item._videoId && item._videoDur) {
      let offset = 0
      while (offset < duration) {
        const piece = Math.min(item._videoDur, duration - offset)
        videoSegments.push({
          id: randomUUID(),
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
        id: randomUUID(),
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
    { id: randomUUID(), type: 'video', segments: videoSegments, attribute: 0, flag: 0 },
    { id: randomUUID(), type: 'audio', segments: audioSegments, attribute: 0, flag: 0 },
  ]
}

/** 导出剪映草稿目录，返回相对路径 static/jianying-drafts/{id}/ */
export function exportJianyingDraft(jobId: number, title: string): string {
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

  const draftId = randomUUID()
  const relBase = `static/jianying-drafts/${jobId}_${draftId.slice(0, 8)}`
  const absBase = path.join(STORAGE_ROOT, 'jianying-drafts', `${jobId}_${draftId.slice(0, 8)}`)
  const resourcesDir = path.join(absBase, 'Resources')
  fs.mkdirSync(resourcesDir, { recursive: true })

  const { videos, audios, texts } = buildMaterials(items, resourcesDir)
  const tracks = buildTracks(items)
  const totalDuration = items.reduce((sum, item) => sum + (item._audioDur || 0), 0)

  const draftContent = {
    canvas_config: { width: 1080, height: 1920, ratio: '9:16' },
    color_space: 0,
    config: { maintrack_adsorb: true },
    cover: null,
    create_time: Date.now() * 1000,
    duration: totalDuration,
    fps: 30,
    id: draftId,
    materials: { videos, audios, texts, speeds: [], transitions: [] },
    tracks,
    version: 360000,
  }

  const metaInfo = {
    draft_id: draftId,
    draft_name: title || `解说漫_${jobId}`,
    draft_root_path: absBase,
    tm_draft_create: Date.now(),
    tm_draft_modified: Date.now(),
  }

  fs.writeFileSync(path.join(absBase, 'draft_content.json'), JSON.stringify(draftContent, null, 2), 'utf8')
  fs.writeFileSync(path.join(absBase, 'draft_meta_info.json'), JSON.stringify(metaInfo, null, 2), 'utf8')
  fs.writeFileSync(path.join(absBase, 'README.txt'), [
    '剪映草稿导出说明',
    '1. 将整个文件夹复制到剪映草稿目录（CapCut/Jianying Pro drafts folder）',
    '2. 重启剪映即可在草稿列表中看到',
    '3. 若路径不识别，可在剪映中新建项目后导入 Resources 内音视频手动对齐',
    '',
    `生成时间: ${new Date().toISOString()}`,
  ].join('\n'), 'utf8')

  return relBase
}
