import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const backupsRoot = path.join(root, 'dist-backups')

if (!existsSync(dist)) {
  console.error('No frontend/dist to backup.')
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
const target = path.join(backupsRoot, stamp)
mkdirSync(backupsRoot, { recursive: true })
cpSync(dist, target, { recursive: true })

const meta = {
  created_at: new Date().toISOString(),
  path: target,
  source: dist,
  note: 'Production frontend static files before deploy',
}
writeFileSync(path.join(target, '_backup-meta.json'), JSON.stringify(meta, null, 2))
writeFileSync(path.join(backupsRoot, 'LATEST'), stamp)

const list = readdirSync(backupsRoot)
  .filter(name => /^\d{8}-\d{6}$/.test(name))
  .sort()
console.log(`Backed up dist -> ${target}`)
console.log(`Latest marker: dist-backups/LATEST (${stamp})`)
console.log(`Available backups (${list.length}): ${list.slice(-5).join(', ')}${list.length > 5 ? ' ...' : ''}`)
