import fs from 'fs'

const html = fs.readFileSync('d:/java/hongguoduanju/tmp-aistars-home.html', 'utf8')
const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map(m => m[0])
const patterns = ['imagesJson', '/newapi/v1/video', 'image_urls', 'reference_images', 'input_reference', '"images"']

for (const chunk of chunks.slice(0, 40)) {
  const url = `https://video.aistarslab.com${chunk}`
  try {
    const js = await (await fetch(url)).text()
    for (const p of patterns) {
      if (!js.includes(p)) continue
      const idx = js.indexOf(p)
      console.log(`\n=== ${chunk.split('/').pop()} :: ${p} ===`)
      console.log(js.slice(Math.max(0, idx - 120), idx + 280))
    }
  } catch { /* ignore */ }
}
