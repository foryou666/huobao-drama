/**
 * 将 static/uploads/ 下已有文件补录为 reference 资产
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createReferenceUploadAsset } from '../src/services/asset-library.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const storageRoot = process.env.STORAGE_PATH || path.resolve(__dirname, '../../data/static')
const uploadsDir = path.join(storageRoot, 'uploads')

if (!fs.existsSync(uploadsDir)) {
  console.log('uploads dir not found:', uploadsDir)
  process.exit(0)
}

const files = fs.readdirSync(uploadsDir).filter(name => !name.startsWith('.'))
let created = 0
for (const name of files) {
  const localPath = `static/uploads/${name}`
  const id = createReferenceUploadAsset({ localPath, originalName: name })
  console.log('synced', localPath, '-> asset', id)
  created += 1
}
console.log(`done, ${created} reference asset(s)`)
