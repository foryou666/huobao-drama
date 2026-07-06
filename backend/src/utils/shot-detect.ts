import { spawn } from 'child_process'
import { ensureFfmpegConfigured, resolveFfmpegExecutable } from './ffmpeg-path.js'
import { resolveMediaFilePath } from './media-path.js'

export interface DetectedShot {
  id: string
  start_sec: number
  end_sec: number
  duration_sec: number
}

const MIN_SHOT_SEC = 0.8
const MAX_SHOTS = 80
const DEFAULT_THRESHOLD = 0.32

function roundSec(value: number) {
  return Math.round(value * 100) / 100
}

function parseShowinfoTimes(stderr: string): number[] {
  const times = new Set<number>()
  const re = /pts_time:([0-9.]+)/g
  for (const match of stderr.matchAll(re)) {
    const t = Number(match[1])
    if (Number.isFinite(t) && t > 0.05) times.add(roundSec(t))
  }
  return [...times].sort((a, b) => a - b)
}

function buildShotsFromCutPoints(cutPoints: number[], totalDuration: number): DetectedShot[] {
  const points = cutPoints.filter(t => t > 0 && t < totalDuration)
  const boundaries = [0, ...points, totalDuration]
  const raw: DetectedShot[] = []

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = roundSec(boundaries[i])
    const end = roundSec(boundaries[i + 1])
    const duration = roundSec(end - start)
    if (duration < MIN_SHOT_SEC) continue
    raw.push({
      id: `s${raw.length + 1}`,
      start_sec: start,
      end_sec: end,
      duration_sec: duration,
    })
  }

  if (!raw.length) {
    return [{
      id: 's1',
      start_sec: 0,
      end_sec: roundSec(totalDuration),
      duration_sec: roundSec(totalDuration),
    }]
  }

  // 合并过短镜头
  const merged: DetectedShot[] = []
  for (const shot of raw) {
    if (merged.length && shot.duration_sec < MIN_SHOT_SEC) {
      const prev = merged[merged.length - 1]
      prev.end_sec = shot.end_sec
      prev.duration_sec = roundSec(prev.end_sec - prev.start_sec)
    } else if (merged.length && shot.duration_sec < 1.2 && prevTooShort(merged[merged.length - 1])) {
      const prev = merged[merged.length - 1]
      prev.end_sec = shot.end_sec
      prev.duration_sec = roundSec(prev.end_sec - prev.start_sec)
    } else {
      merged.push({ ...shot })
    }
  }

  return merged.slice(0, MAX_SHOTS).map((shot, idx) => ({
    ...shot,
    id: `s${idx + 1}`,
  }))
}

function prevTooShort(shot: DetectedShot) {
  return shot.duration_sec < 1.5
}

function runFfmpegSceneDetect(filePath: string, threshold: number): Promise<string> {
  ensureFfmpegConfigured()
  const ffmpegPath = resolveFfmpegExecutable()
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-i', filePath,
      '-filter:v', `select=gt(scene\\,${threshold}),showinfo`,
      '-f', 'null',
      '-',
    ]
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk) => { stderr += String(chunk) })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0 && !stderr.includes('pts_time')) {
        reject(new Error(stderr.slice(-400) || `ffmpeg scene detect exited ${code}`))
        return
      }
      resolve(stderr)
    })
  })
}

export async function detectVideoShots(
  relativeVideoPath: string,
  totalDuration: number,
  threshold = DEFAULT_THRESHOLD,
): Promise<DetectedShot[]> {
  const filePath = resolveMediaFilePath(relativeVideoPath)
  if (!filePath) throw new Error('无法定位视频文件')

  try {
    const stderr = await runFfmpegSceneDetect(filePath, threshold)
    const cutPoints = parseShowinfoTimes(stderr)
    return buildShotsFromCutPoints(cutPoints, totalDuration)
  } catch {
    // 降级：整段为一个镜头
    return [{
      id: 's1',
      start_sec: 0,
      end_sec: roundSec(totalDuration),
      duration_sec: roundSec(totalDuration),
    }]
  }
}
