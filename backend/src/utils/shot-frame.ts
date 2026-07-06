import path from 'path'
import { v4 as uuid } from 'uuid'
import ffmpeg from 'fluent-ffmpeg'
import { ensureFfmpegConfigured } from './ffmpeg-path.js'
import { resolveMediaFilePath } from './media-path.js'
import { getAbsolutePath } from './storage.js'

/** 从视频中在指定时刻抽取一帧 JPEG */
export async function extractVideoFrameAt(
  relativeVideoPath: string,
  timeSec: number,
): Promise<string> {
  const inputPath = resolveMediaFilePath(relativeVideoPath)
  if (!inputPath) throw new Error('无法定位视频文件')

  ensureFfmpegConfigured()
  const filename = `${uuid()}.jpg`
  const relativeOut = `static/frames/repaint/${filename}`
  const outputPath = getAbsolutePath(relativeOut)
  await import('fs').then(fs => fs.promises.mkdir(path.dirname(outputPath), { recursive: true }))

  const mark = Math.max(0, timeSec).toFixed(3)

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(mark)
      .frames(1)
      .outputOptions(['-q:v', '2'])
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath)
  })

  return relativeOut
}
