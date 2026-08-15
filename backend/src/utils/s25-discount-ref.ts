import fs from 'fs'
import path from 'path'
import { getAbsolutePath } from './storage.js'
import { logTaskWarn } from './task-logger.js'

/**
 * 通道4/5 Seedance 2.5：无用户参考视频时静默附加的短视频（上游有参考视频会打折）。
 * 相对 data/ 的路径；缺失时从 backend/assets 复制。
 */
export const S25_DISCOUNT_REF_VIDEO_PATH = 'static/system/jimeng-s25-discount-ref.mp4'

/** @deprecated 兼容旧名 */
export const JIMENG_S25_DISCOUNT_REF_VIDEO_PATH = S25_DISCOUNT_REF_VIDEO_PATH

export function isS25SilentDiscountRefPath(url?: string | null): boolean {
  const raw = String(url || '').replace(/^\/+/, '').trim()
  return raw.includes('jimeng-s25-discount-ref')
}

/** 确保静默优惠参考视频落在 data/static；缺失时从 backend/assets 复制 */
export function ensureS25DiscountRefVideo(): string | null {
  const staticRel = S25_DISCOUNT_REF_VIDEO_PATH
  const staticAbs = getAbsolutePath(staticRel)
  if (fs.existsSync(staticAbs)) return staticRel

  const assetCandidates = [
    path.resolve(process.cwd(), 'assets/jimeng-s25-discount-ref.mp4'),
    path.resolve(process.cwd(), 'backend/assets/jimeng-s25-discount-ref.mp4'),
  ]
  for (const src of assetCandidates) {
    if (!fs.existsSync(src)) continue
    try {
      fs.mkdirSync(path.dirname(staticAbs), { recursive: true })
      fs.copyFileSync(src, staticAbs)
      return staticRel
    } catch (err: any) {
      logTaskWarn('S25DiscountRef', 'copy-failed', { src, dest: staticAbs, error: err.message })
    }
  }
  return null
}
