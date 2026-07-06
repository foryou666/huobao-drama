import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { DOUBAO_TRAINING_OVERLAY_TEXT } from '../constants/doubao-training.js'
import { ensureFfmpegConfigured, resolveFfmpegExecutable } from './ffmpeg-path.js'
import { getAppMeta } from '../db/index.js'

const OVERLAY_META_KEY = 'doubao_training_overlay_text'

export function getTrainingOverlayText(): string {
  const custom = getAppMeta(OVERLAY_META_KEY)?.trim()
  return custom || DOUBAO_TRAINING_OVERLAY_TEXT
}

function resolveFfmpegBin(): string {
  ensureFfmpegConfigured()
  return resolveFfmpegExecutable()
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
}

export async function applyTrainingVideoOverlay(inputPath: string, overlayText?: string): Promise<string> {
  const text = escapeDrawtext(String(overlayText || getTrainingOverlayText()).trim() || DOUBAO_TRAINING_OVERLAY_TEXT)
  const outputPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}-training${path.extname(inputPath) || '.mp4'}`,
  )
  const vf = [
    `drawtext=text='${text}'`,
    'fontcolor=white@0.92',
    'fontsize=22',
    'box=1',
    'boxcolor=black@0.55',
    'boxborderw=10',
    'x=w-tw-16',
    'y=h-th-16',
  ].join(':')

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', vf,
      '-c:a', 'copy',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      outputPath,
    ]
    const proc = spawn(resolveFfmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', chunk => { stderr += String(chunk) })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-500) || `ffmpeg overlay failed (${code})`))
    })
  })

  try {
    if (inputPath !== outputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
  } catch { /* ignore */ }

  return outputPath
}

export async function downloadToTempFile(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`下载视频失败 HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const file = path.join(os.tmpdir(), `doubao-training-${Date.now()}.mp4`)
  fs.writeFileSync(file, buf)
  return file
}
