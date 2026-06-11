import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const backupsRoot = path.join(root, 'dist-backups')
const arg = process.argv[2]

function listBackups() {
  if (!existsSync(backupsRoot)) return []
  return readdirSync(backupsRoot)
    .filter(name => /^\d{8}-\d{6}$/.test(name))
    .sort()
}

const backups = listBackups()
if (!backups.length) {
  console.error('No backups in frontend/dist-backups/')
  process.exit(1)
}

let stamp = arg
if (!stamp) {
  if (existsSync(path.join(backupsRoot, 'LATEST'))) {
    stamp = readFileSync(path.join(backupsRoot, 'LATEST'), 'utf8').trim()
  } else {
    stamp = backups[backups.length - 1]
  }
}

const source = path.join(backupsRoot, stamp)
if (!existsSync(source)) {
  console.error(`Backup not found: ${stamp}`)
  console.error('Available:', backups.join(', '))
  process.exit(1)
}

const preRestore = path.join(backupsRoot, `${stamp}-before-restore-${Date.now()}`)
if (existsSync(dist)) {
  cpSync(dist, preRestore, { recursive: true })
  console.log(`Saved current dist -> ${preRestore}`)
}

rmSync(dist, { recursive: true, force: true })
cpSync(source, dist, { recursive: true })
writeFileSync(path.join(backupsRoot, 'LATEST'), stamp)

console.log(`Restored ${source} -> ${dist}`)
console.log('5679 serves frontend/dist directly; no backend restart required.')
