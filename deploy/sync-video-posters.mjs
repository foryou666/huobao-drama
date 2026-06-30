/**
 * 将本地已有的视频封面缩略图上传到服务器（仅补缺，不重新 ffmpeg 生成）
 *
 * 用法:
 *   DEPLOY_SSH_PASSWORD=*** node deploy/sync-video-posters.mjs
 *   DEPLOY_SSH_PASSWORD=*** node deploy/sync-video-posters.mjs --dry-run
 */
import fs from 'fs'
import path from 'path'
import { Client } from 'ssh2'
import { spawn } from 'child_process'
import os from 'os'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

const cfg = {
  host: process.env.DEPLOY_SSH_HOST || '8.160.163.57',
  port: Number(process.env.DEPLOY_SSH_PORT || 22),
  username: process.env.DEPLOY_SSH_USER || 'root',
  password: process.env.DEPLOY_SSH_PASSWORD || '',
}

const APP_DIR = process.env.DEPLOY_APP_DIR || '/opt/hongguoduanju'
const LOCAL_THUMBS = path.join(root, 'data', 'static', 'thumbs', 'videos')
const REMOTE_THUMBS = `${APP_DIR}/data/static/thumbs/videos`
const DB_PATH = `${APP_DIR}/data/huobao_drama.db`

function connect() {
  if (!cfg.password) {
    console.error('请设置环境变量 DEPLOY_SSH_PASSWORD')
    process.exit(1)
  }
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => resolve(conn))
    conn.on('error', reject)
    conn.connect({ ...cfg, readyTimeout: 30000 })
  })
}

function exec(conn, command, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    conn.exec(command, (err, stream) => {
      if (err) return reject(err)
      const timer = setTimeout(() => {
        stream.close()
        reject(new Error(`timeout after ${timeout}ms`))
      }, timeout)
      stream.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve({ stdout, stderr })
        else reject(new Error(`exit ${code}\n${stderr || stdout}`))
      })
      stream.on('data', (d) => { stdout += d })
      stream.stderr.on('data', (d) => { stderr += d })
    })
  })
}

function uploadFile(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err)
      const remoteDir = path.posix.dirname(remotePath.replace(/\\/g, '/'))
      sftp.mkdir(remoteDir, { mode: 0o755 }, () => {
        sftp.fastPut(localPath, remotePath, (putErr) => {
          sftp.end()
          if (putErr) reject(putErr)
          else resolve()
        })
      })
    })
  })
}

async function uploadPosterBatch(conn, names) {
  const staging = path.join(os.tmpdir(), `video-posters-${Date.now()}`)
  const thumbsDir = path.join(staging, 'thumbs', 'videos')
  fs.mkdirSync(thumbsDir, { recursive: true })

  for (const name of names) {
    fs.copyFileSync(path.join(LOCAL_THUMBS, name), path.join(thumbsDir, name))
  }

  const tarPath = `${staging}.tgz`
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-czf', tarPath, '-C', staging, 'thumbs'], { stdio: 'inherit', shell: false })
    tar.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exit ${code}`)))
  })

  const mb = (fs.statSync(tarPath).size / 1024 / 1024).toFixed(1)
  console.log(`打包完成: ${names.length} 个, ${mb} MB`)

  await uploadFile(conn, tarPath, '/tmp/video-posters.tgz')
  await exec(conn, `
    mkdir -p ${REMOTE_THUMBS} &&
    tar -xzf /tmp/video-posters.tgz -C ${APP_DIR}/data/static &&
    rm -f /tmp/video-posters.tgz
  `)

  fs.rmSync(staging, { recursive: true, force: true })
  fs.unlinkSync(tarPath)
}

function posterFilenameFromVideoPath(localPath) {
  const normalized = String(localPath || '').trim().replace(/^\/+/, '')
  if (!normalized.startsWith('static/videos/')) return ''
  const base = path.basename(normalized).replace(/\.[^.]+$/i, '')
  return base ? `${base}.webp` : ''
}

async function fetchServerVideoPaths(conn) {
  const queryScript = `
import Database from 'better-sqlite3'
const db = new Database(${JSON.stringify(DB_PATH)}, { readonly: true })
const rows = db.prepare(
  "SELECT DISTINCT local_path AS localPath FROM video_generations WHERE local_path LIKE 'static/videos/%'"
).all()
for (const row of rows) console.log(String(row.localPath || '').trim())
db.close()
`.trim()

  const remoteScript = `${APP_DIR}/backend/scripts/_list-video-paths.mjs`
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err)
      sftp.mkdir(`${APP_DIR}/backend/scripts`, { mode: 0o755 }, () => {
        const stream = sftp.createWriteStream(remoteScript, { mode: 0o644 })
        stream.on('close', resolve)
        stream.on('error', reject)
        stream.end(queryScript)
      })
    })
  })

  const { stdout } = await exec(
    conn,
    `cd ${APP_DIR}/backend && node scripts/_list-video-paths.mjs`,
    { timeout: 120000 },
  )
  await exec(conn, `rm -f ${remoteScript}`).catch(() => {})
  return stdout
}

async function main() {
  if (!fs.existsSync(LOCAL_THUMBS)) {
    console.error(`本地目录不存在: ${LOCAL_THUMBS}`)
    process.exit(1)
  }

  const localFiles = new Set(fs.readdirSync(LOCAL_THUMBS).filter((f) => f.endsWith('.webp')))
  console.log(`本地封面: ${localFiles.size} 个`)

  const conn = await connect()
  try {
    const dbOut = await fetchServerVideoPaths(conn)
    const needed = new Set()
    for (const line of dbOut.split(/\r?\n/)) {
      const name = posterFilenameFromVideoPath(line)
      if (name) needed.add(name)
    }
    console.log(`服务器视频记录需封面: ${needed.size} 个`)

    const { stdout: remoteOut } = await exec(
      conn,
      `ls -1 ${REMOTE_THUMBS} 2>/dev/null || true`,
    )
    const remoteFiles = new Set(
      remoteOut.split(/\r?\n/).map((s) => s.trim()).filter((f) => f.endsWith('.webp')),
    )
    console.log(`服务器已有封面: ${remoteFiles.size} 个`)

    const toUpload = [...needed].filter((name) => !remoteFiles.has(name) && localFiles.has(name))
    const missingLocal = [...needed].filter((name) => !remoteFiles.has(name) && !localFiles.has(name))

    console.log(`待上传（本地有、服务器缺）: ${toUpload.length} 个`)
    if (missingLocal.length) {
      console.log(`本地也没有、需后续生成: ${missingLocal.length} 个（本次跳过）`)
    }

    if (!toUpload.length) {
      console.log('无需上传')
      return
    }

    if (dryRun) {
      console.log('\n[dry-run] 将上传:')
      for (const name of toUpload.slice(0, 20)) console.log(' ', name)
      if (toUpload.length > 20) console.log(`  ... 共 ${toUpload.length} 个`)
      return
    }

    let uploaded = 0
    const batchSize = 400
    for (let i = 0; i < toUpload.length; i += batchSize) {
      const batch = toUpload.slice(i, i + batchSize)
      console.log(`\n上传批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(toUpload.length / batchSize)} (${batch.length} 个)...`)
      await uploadPosterBatch(conn, batch)
      uploaded += batch.length
      console.log(`累计已上传 ${uploaded}/${toUpload.length}`)
    }

    console.log(`\n完成: 上传 ${uploaded} 个`)
    const { stdout: afterOut } = await exec(conn, `ls -1 ${REMOTE_THUMBS} | wc -l`)
    console.log(`服务器封面总数: ${afterOut.trim()}`)
  } finally {
    conn.end()
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
