import { synthesizeIndexTts2Gradio } from '../src/services/adapters/indextts2-gradio.ts'

const baseUrl = process.argv[2] || 'https://1uz2g0m1ukntt377-7860.container.x-gpu.com/'
const voice = process.argv[3] || 'voice_01'

const r = await synthesizeIndexTts2Gradio({
  baseUrl,
  text: '你好，IndexTTS2对接测试。',
  voice,
})
console.log('audioUrl', r.audioUrl)
const resp = await fetch(r.audioUrl)
console.log('status', resp.status, 'bytes', (await resp.arrayBuffer()).byteLength)
