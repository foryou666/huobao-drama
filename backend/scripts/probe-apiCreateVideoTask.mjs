import fs from 'fs'

const js = await (await fetch('https://video.aistarslab.com/_next/static/chunks/17zfpz0isf-ic.js')).text()
const idx = js.indexOf('function eS(')
console.log('eS at', idx)
console.log(js.slice(idx, idx + 1200))

const idx2 = js.indexOf('openapi/video/task')
console.log('\nopenapi paths:')
let i = 0
while ((i = js.indexOf('openapi', i)) !== -1 && i < js.length) {
  console.log(js.slice(i, i + 80))
  i += 8
  if (i > 50000) break
}
