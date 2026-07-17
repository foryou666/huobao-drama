import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { ensureFfmpegConfigured } from '../utils/ffmpeg-path.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')
const DATA_ROOT = path.resolve(__dirname, '../../../data')

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  const normalized = relativePath.replace(/^\/+/, '')
  if (normalized.startsWith('static/')) return path.join(DATA_ROOT, normalized)
  return path.join(STORAGE_ROOT, normalized)
}

function resolveSegmentVideoPath(seg: typeof schema.videoRepaintSegments.$inferSelect): string | null {
  if (!seg.videoGenerationId) return null
  const [gen] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, seg.videoGenerationId)).all()
  if (!gen || gen.status !== 'completed') return null
  const raw = gen.localPath || gen.videoUrl
  if (!raw) return null
  return raw.replace(/^\/+/, '')
}

function probeDuration(filePath: string): Promise<number> {
  ensureFfmpegConfigured()
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return }
      resolve(Math.round(Number(metadata.format?.duration || 0) * 10) / 10)
    })
  })
}

export async function mergeRepaintJobSegments(jobId: number): Promise<{
  mergedVideoPath: string
  duration: number
  clipCount: number
}> {
  const [job] = db.select().from(schema.videoRepaintJobs)
    .where(eq(schema.videoRepaintJobs.id, jobId)).all()
  if (!job) throw new Error('转绘任务不存在')

  const segments = db.select().from(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.jobId, jobId))
    .all()
    .sort((a, b) => a.segmentIndex - b.segmentIndex)

  if (!segments.length) throw new Error('没有可拼接的分段')

  const videoPaths: string[] = []
  for (const seg of segments) {
    const rel = resolveSegmentVideoPath(seg)
    if (!rel) {
      throw new Error(`分段 #${seg.segmentIndex + 1} 尚未生成完成，无法拼接`)
    }
    const abs = toAbsPath(rel)
    if (!fs.existsSync(abs)) {
      throw new Error(`分段 #${seg.segmentIndex + 1} 视频文件缺失`)
    }
    videoPaths.push(rel)
  }

  logTaskStart('RepaintMerge', 'concat', { jobId, clips: videoPaths.length })

  const listDir = path.join(STORAGE_ROOT, 'temp')
  fs.mkdirSync(listDir, { recursive: true })
  const listPath = path.join(listDir, `${uuid()}.txt`)
  fs.writeFileSync(
    listPath,
    videoPaths.map(v => `file '${toAbsPath(v).replace(/'/g, "'\\''")}'`).join('\n'),
    'utf-8',
  )

  const outputDir = path.join(STORAGE_ROOT, 'repaint', 'merged')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `job-${jobId}-${uuid()}.mp4`
  const outputPath = path.join(outputDir, outputFilename)

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-fflags', '+genpts',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-c:a', 'aac',
          '-ar', '48000',
          '-b:a', '192k',
          '-movflags', '+faststart',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  } catch (err: any) {
    logTaskError('RepaintMerge', 'concat', { jobId, error: err.message })
    throw new Error(err.message || 'ffmpeg 拼接失败')
  } finally {
    try { fs.unlinkSync(listPath) } catch { /* ignore */ }
  }

  const duration = await probeDuration(outputPath)
  const mergedRelative = `static/repaint/merged/${outputFilename}`

  db.update(schema.videoRepaintJobs).set({
    mergedVideoPath: mergedRelative,
    stage: 'merge',
    status: 'merged',
    updatedAt: now(),
    errorMsg: null,
  }).where(eq(schema.videoRepaintJobs.id, jobId)).run()

  await trySyncStaticToOss(mergedRelative, job.dramaId ?? undefined)

  logTaskSuccess('RepaintMerge', 'concat', { jobId, output: mergedRelative, duration, clips: videoPaths.length })

  return { mergedVideoPath: mergedRelative, duration, clipCount: videoPaths.length }
}
