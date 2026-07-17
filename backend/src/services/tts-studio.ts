import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { findNarrationVoicePreset } from '../constants/narration-voices.js'
import { generateNarrationTTS } from './narration-tts.js'
import type { IndexTts2EmotionOptions } from './adapters/indextts2-gradio.js'

export interface StudioTtsVoiceInput {
  voice_asset_id?: number | null
  voice_path?: string | null
  voice_id?: string | null
}

export interface StudioTtsRequest {
  text: string
  voice?: StudioTtsVoiceInput
  emotion?: IndexTts2EmotionOptions
  config_id?: number | null
}

function resolveVoiceAsset(assetId: number) {
  const [row] = db.select().from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .all()
  if (!row || row.deletedAt) throw new Error('音色资产不存在')
  if (row.type !== 'voice') throw new Error('所选资产不是音色类型')
  const path = String(row.localPath || row.url || '').trim().replace(/^\/+/, '')
  if (!path) throw new Error('音色资产缺少音频文件')
  return { path, name: row.name || '音色', assetId: row.id }
}

export function resolveStudioTtsVoice(voice?: StudioTtsVoiceInput) {
  const assetId = Number(voice?.voice_asset_id)
  if (Number.isFinite(assetId) && assetId > 0) {
    const asset = resolveVoiceAsset(assetId)
    return {
      voiceKey: asset.path,
      voiceName: asset.name,
      voiceAssetId: asset.assetId,
      voicePresetId: null as string | null,
      voicePath: asset.path,
    }
  }

  const path = String(voice?.voice_path || '').trim().replace(/^\/+/, '')
  if (path) {
    return {
      voiceKey: path,
      voiceName: path.split('/').pop() || '参考音色',
      voiceAssetId: null,
      voicePresetId: null,
      voicePath: path,
    }
  }

  const presetId = String(voice?.voice_id || '').trim()
  const preset = findNarrationVoicePreset(presetId)
  const voiceKey = preset?.voice_id || presetId || 'voice_01'
  return {
    voiceKey,
    voiceName: preset?.name || voiceKey,
    voiceAssetId: null,
    voicePresetId: preset?.voice_id || voiceKey,
    voicePath: null,
  }
}

export async function generateStudioTts(req: StudioTtsRequest) {
  const text = String(req.text || '').trim()
  if (!text) throw new Error('请输入配音文本')

  const resolved = resolveStudioTtsVoice(req.voice)
  const { path, durationSec } = await generateNarrationTTS({
    text,
    voice: resolved.voiceKey,
    configId: req.config_id,
    emotion: req.emotion,
  })

  return {
    path,
    durationSec,
    ...resolved,
  }
}
