import type { AuthUser } from '../middleware/auth.js'

/** 图片工作台可查看全部 / 指定用户（不含置顶等管理员操作） */
const IMAGE_STUDIO_GLOBAL_VIEW_USERNAMES = new Set(['qiao1'])

export function canViewAllImageStudio(user: Pick<AuthUser, 'role' | 'username'>): boolean {
  if (user.role === 'admin') return true
  const username = String(user.username || '').trim().toLowerCase()
  return IMAGE_STUDIO_GLOBAL_VIEW_USERNAMES.has(username)
}
