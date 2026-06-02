import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  try {
    const derived = scryptSync(password, salt, 64, SCRYPT_PARAMS)
    const expected = Buffer.from(hash, 'hex')
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
