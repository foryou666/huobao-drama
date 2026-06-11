import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
// @ts-expect-error ffprobe-static has no bundled types
import ffprobeStatic from 'ffprobe-static'

let configured = false

export function ensureFfmpegConfigured(): void {
  if (configured) return
  configured = true

  if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic)
  const ffprobePath = (ffprobeStatic as { path?: string })?.path
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)
}
