export function joinProviderUrl(baseUrl: string, requiredPrefix: string, path: string) {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '')
  const normalizedPrefix = normalizeSegment(requiredPrefix)
  const [rawPath, rawSearch = ''] = String(path || '').split('?')
  const normalizedPath = normalizeSegment(rawPath)
  const search = rawSearch ? (rawSearch.startsWith('?') ? rawSearch : `?${rawSearch}`) : ''

  if (!normalizedBase) {
    return `${normalizedPrefix}${normalizedPath}${search}`
  }

  try {
    const url = new URL(normalizedBase)
    const currentPath = url.pathname.replace(/\/+$/, '')
    const mergedPrefix = currentPath.endsWith(normalizedPrefix)
      ? currentPath
      : `${currentPath}${normalizedPrefix}`

    url.pathname = `${mergedPrefix}${normalizedPath}`.replace(/\/{2,}/g, '/')
    url.search = search
    return url.toString()
  } catch {
    const basePath = normalizedBase.endsWith(normalizedPrefix)
      ? normalizedBase
      : `${normalizedBase}${normalizedPrefix}`
    return `${basePath}${normalizedPath}${search}`
  }
}

function normalizeSegment(segment: string) {
  if (!segment) return ''
  return segment.startsWith('/') ? segment : `/${segment}`
}
