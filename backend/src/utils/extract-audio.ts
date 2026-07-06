import path from 'path'
import { v4 as uuid } from 'uuid'
import ffmpeg from 'fluent-ffmpeg'
import { ensureFfmpegConfigured } from './ffmpeg-path.js'
import { resolveMediaFilePath } from './media-path.js'
import { getAbsolutePath } from './storage.js'

export async function extractAudioWav(relativeVideoPath: string): Promise<string> {
  const inputPath = resolveMediaFilePath(relativeVideoPath)
  if (!inputPath) throw new Error('无法定位视频文件')

  ensureFfmpegConfigured()
  const filename = `${uuid()}.wav`
  const relativeOut = `static/audio/repaint/${filename}`
  const outputPath = getAbsolutePath(relativeOut)
  const dir = path.dirname(outputPath)
  await import('fs').then(fs => fs.promises.mkdir(dir, { recursive: true }))

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath)
  })

  return relativeOut
}
