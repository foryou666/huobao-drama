import fs from 'fs'
import path from 'path'
import { deflateRawSync } from 'zlib'

/** CRC32（ZIP 规范） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u16(n: number) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n >>> 0, 0)
  return b
}

function u32(n: number) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) out.push(...walkFiles(abs, base))
    else if (st.isFile()) out.push(path.relative(base, abs))
  }
  return out
}

type ZipEntry = {
  name: string
  data: Buffer
  crc: number
  method: number
  compressed: Buffer
  localOffset: number
}

/**
 * 将目录打成 zip（根目录为 folderName/…），无外部依赖。
 * 小文件 DEFLATE；大文件（音视频）STORE，避免吃内存/CPU。
 */
export function zipDirectoryToFile(absDir: string, absZip: string, rootName: string) {
  const files = walkFiles(absDir)
  if (!files.length) throw new Error('草稿目录为空，无法打包')

  const entries: ZipEntry[] = []
  let offset = 0
  const chunks: Buffer[] = []

  for (const rel of files) {
    const abs = path.join(absDir, rel)
    const data = fs.readFileSync(abs)
    const name = `${rootName}/${rel.split(path.sep).join('/')}`
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const useStore = data.length > 256 * 1024 || /\.(mp4|webm|mov|mp3|wav|flac|jpg|jpeg|png|webp)$/i.test(rel)
    const compressed = useStore ? data : deflateRawSync(data)
    const method = useStore ? 0 : 8

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      compressed,
    ])
    entries.push({
      name,
      data,
      crc,
      method,
      compressed,
      localOffset: offset,
    })
    chunks.push(local)
    offset += local.length
  }

  const centralChunks: Buffer[] = []
  let centralSize = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(e.method),
      u16(0),
      u16(0),
      u32(e.crc),
      u32(e.compressed.length),
      u32(e.data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(e.localOffset),
      nameBuf,
    ])
    centralChunks.push(central)
    centralSize += central.length
  }

  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ])

  fs.mkdirSync(path.dirname(absZip), { recursive: true })
  fs.writeFileSync(absZip, Buffer.concat([...chunks, ...centralChunks, end]))
}
