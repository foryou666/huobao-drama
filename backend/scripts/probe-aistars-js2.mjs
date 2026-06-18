import fs from 'fs'

const html = fs.readFileSync('d:/java/hongguoduanju/tmp-aistars-home.html', 'utf8')
const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map(m => m[0])
const patterns = [
  'newapi/v1/video/generations',
  'apiCreateVideoTask',
  'video/generations',
  'imagesJson',
  'referenceMode',
  'modeType',
]

for (const chunk of chunks) {
  const url = `https://video.aistarslab.com${chunk}`
  try {
    const js = await (await fetch(url)).text()
    for (const p of patterns) {
      if (!js.includes(p)) continue
      let idx = 0
      let count = 0
      while ((idx = js.indexOf(p, idx)) !== -1 && count < 2) {
        count++
        console.log(`\n=== ${chunk.split('/').pop()} :: ${p} #${count} ===`)
        console.log(js.slice(Math.max(0, idx - 150), idx + 400))
        idx++
      }
    }
  } catch { /* ignore */ }
}
