import fs from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
// @ts-expect-error ffprobe-static has no bundled types
import ffprobeStatic from 'ffprobe-static'

let configured = false

/** ffmpeg 可执行路径：优先 ffmpeg-static，缺失时回退到 PATH 中的 ffmpeg */
export function resolveFfmpegExecutable(): string {
  if (typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) return ffmpegStatic
  return 'ffmpeg'
}

function resolveFfprobeExecutable(): string | undefined {
  const ffprobePath = (ffprobeStatic as { path?: string })?.path
  if (ffprobePath && fs.existsSync(ffprobePath)) return ffprobePath
  return undefined
}

export function ensureFfmpegConfigured(): void {
  if (configured) return
  configured = true

  ffmpeg.setFfmpegPath(resolveFfmpegExecutable())
  const ffprobePath = resolveFfprobeExecutable()
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)
}
