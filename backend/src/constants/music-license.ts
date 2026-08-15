/** 配乐权属 / 授权证书默认条款（影光工场） */

export const MUSIC_LICENSE_ISSUER = '影光工场'
export const MUSIC_LICENSE_ISSUER_LEGAL = '影光工场（平台运营方）'
export const MUSIC_LICENSE_REGION = '全球'
export const MUSIC_LICENSE_CHANNEL = '网络'
export const MUSIC_LICENSE_USAGE = '短剧 / 影视配乐及衍生传播'
export const MUSIC_LICENSE_RIGHTS = '信息网络传播权、复制权（限于授权项目）、放映权（限于授权项目）'

/** 用户等级有效期（当前默认档；仅会员身份展示，不等于授权期限） */
export const MUSIC_MEMBER_LEVEL_START = '2026-01-01'
export const MUSIC_MEMBER_LEVEL_END = '2027-01-01'

/** 配乐授权期限：无固定截止日，永久有效 */
export const MUSIC_LICENSE_PERIOD_END_LABEL = '永久'

export function resolveMusicMemberLevel(role?: string | null): string {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'admin') return '管理员会员'
  return '标准会员'
}

/** 更稳妥的中文日期格式化 */
export function formatCnDate(isoDate: string): string {
  const m = String(isoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(isoDate || '')
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
}

/** 用户等级有效期文案 */
export function musicMemberLevelPeriodLabel(
  start = MUSIC_MEMBER_LEVEL_START,
  end = MUSIC_MEMBER_LEVEL_END,
): string {
  return `${formatCnDate(start)} 至 ${formatCnDate(end)}`
}

/** @deprecated 请使用 musicMemberLevelPeriodLabel；授权期限请用 musicAuthPeriodLabel */
export function musicLicensePeriodLabel(
  start = MUSIC_MEMBER_LEVEL_START,
  end = MUSIC_MEMBER_LEVEL_END,
): string {
  return musicMemberLevelPeriodLabel(start, end)
}

/** 授权期限文案：自出具日起永久 */
export function musicAuthPeriodLabel(issuedAt?: string | null): string {
  const start = formatCnDate(String(issuedAt || MUSIC_MEMBER_LEVEL_START).slice(0, 10))
  return `${start} 至 ${MUSIC_LICENSE_PERIOD_END_LABEL}`
}

/** 生成订单编号：YG-BGM-YYYYMMDD-XXXXXX */
export function buildMusicOrderNo(id: number, createdAt?: string | null): string {
  const d = createdAt ? new Date(createdAt) : new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const seq = String(Math.max(1, Math.floor(id))).padStart(6, '0')
  return `YG-BGM-${y}${mo}${day}-${seq}`
}
