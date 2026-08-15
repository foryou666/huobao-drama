/** 配乐权属 / 会员等级默认档（与后端 music-license.ts 对齐） */
export const MUSIC_MEMBER_LEVEL_START = '2026-01-01'
export const MUSIC_MEMBER_LEVEL_END = '2027-01-01'
/** 授权期限：永久（无截止日） */
export const MUSIC_LICENSE_PERIOD_END_LABEL = '永久'

export function formatCnDate(isoDate) {
  const m = String(isoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(isoDate || '')
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
}

/** 用户等级有效期（≠ 授权期限） */
export function musicMemberLevelPeriodLabel(
  start = MUSIC_MEMBER_LEVEL_START,
  end = MUSIC_MEMBER_LEVEL_END,
) {
  return `${formatCnDate(start)} 至 ${formatCnDate(end)}`
}

/** @deprecated 兼容旧引用 */
export function musicLicensePeriodLabel(
  start = MUSIC_MEMBER_LEVEL_START,
  end = MUSIC_MEMBER_LEVEL_END,
) {
  return musicMemberLevelPeriodLabel(start, end)
}

/** 授权期限：自出具日起永久 */
export function musicAuthPeriodLabel(issuedAt) {
  const start = formatCnDate(String(issuedAt || MUSIC_MEMBER_LEVEL_START).slice(0, 10))
  return `${start} 至 ${MUSIC_LICENSE_PERIOD_END_LABEL}`
}

export function resolveMusicMemberLevel(role) {
  return String(role || '').toLowerCase() === 'admin' ? '管理员会员' : '标准会员'
}

export const MUSIC_AGREEMENT_LINKS = [
  { to: '/music/user-agreement', label: '用户协议' },
  { to: '/music/ownership', label: '权属声明' },
  { to: '/recharge-agreement', label: '充值协议' },
]
