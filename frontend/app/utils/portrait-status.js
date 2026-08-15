/**
 * 方舟虚拟人像认证状态（基准图 + 各造型备选图）
 */

export function normalizePortraitPath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

export function characterPrimaryPath(char) {
  return normalizePortraitPath(
    char?.image_url || char?.imageUrl || char?.local_path || char?.localPath || '',
  )
}

function pathsLikelySame(a, b) {
  const na = normalizePortraitPath(a)
  const nb = normalizePortraitPath(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const fa = na.split('/').pop() || ''
  const fb = nb.split('/').pop() || ''
  return !!fa && fa === fb
}

export function listCharacterOutfitEntries(char) {
  const media = char?.character_media || char?.characterMedia
  const fromMedia = media?.outfit_previews || media?.outfitPreviews
  if (Array.isArray(fromMedia) && fromMedia.length) return fromMedia

  const raw = char?.reference_images ?? char?.referenceImages
  if (!raw) return []
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(item => item?.kind === 'outfit')
}

function candidatePortraitActive(candidate) {
  if (!candidate) return false
  const status = String(candidate.seedance_asset_status ?? candidate.seedanceAssetStatus ?? '').toLowerCase()
  const assetId = candidate.seedance_asset_id ?? candidate.seedanceAssetId
  if (!assetId || (status && status !== 'active')) return false
  const certified = normalizePortraitPath(
    candidate.seedance_certified_url ?? candidate.seedanceCertifiedUrl ?? candidate.url,
  )
  const current = normalizePortraitPath(candidate.url)
  if (certified && current && !pathsLikelySame(certified, current)) return false
  return true
}

export function isCharacterPortraitActive(char) {
  if (!char) return false
  const status = String(char.seedance_asset_status ?? char.seedanceAssetStatus ?? '').toLowerCase()
  const assetId = char.seedance_asset_id ?? char.seedanceAssetId
  return status === 'active' && !!assetId
}

export function isOutfitPortraitActive(outfit) {
  if (!outfit) return false
  const candidates = outfit.candidates || []
  if (candidates.some(candidatePortraitActive)) return true
  const status = String(outfit.seedance_asset_status ?? outfit.seedanceAssetStatus ?? '').toLowerCase()
  const assetId = outfit.seedance_asset_id ?? outfit.seedanceAssetId
  if (!assetId || (status && status !== 'active')) return false
  const certified = normalizePortraitPath(outfit.seedance_certified_url ?? outfit.seedanceCertifiedUrl ?? outfit.url)
  const current = normalizePortraitPath(outfit.url)
  if (certified && current && !pathsLikelySame(certified, current)) return false
  return true
}

export function isCandidatePortraitActive(candidate) {
  return candidatePortraitActive(candidate)
}

export function isCharacterPrimaryImagePath(char, imageUrl) {
  const primary = characterPrimaryPath(char)
  const path = normalizePortraitPath(imageUrl)
  if (!primary || !path) return false
  return pathsLikelySame(primary, path)
}

export function findOutfitForImagePath(char, imageUrl) {
  const path = normalizePortraitPath(imageUrl)
  if (!path) return null
  return listCharacterOutfitEntries(char).find((outfit) => {
    if (pathsLikelySame(outfit.url, path)) return true
    return (outfit.candidates || []).some(c => pathsLikelySame(c.url, path))
  }) || null
}

export function findCandidateForImagePath(char, imageUrl) {
  const path = normalizePortraitPath(imageUrl)
  if (!path) return null
  for (const outfit of listCharacterOutfitEntries(char)) {
    const hit = (outfit.candidates || []).find(c => pathsLikelySame(c.url, path))
    if (hit) return { outfit, candidate: hit }
  }
  return null
}

/** 该图是否会在通道2提交时改写为 asset:// */
export function isCertifiedPortraitImage(char, imageUrl) {
  if (!char || !imageUrl) return false
  if (isCharacterPortraitActive(char) && isCharacterPrimaryImagePath(char, imageUrl)) return true
  const found = findCandidateForImagePath(char, imageUrl)
  if (found && candidatePortraitActive(found.candidate)) return true
  const outfit = findOutfitForImagePath(char, imageUrl)
  return !!(outfit && isOutfitPortraitActive(outfit) && pathsLikelySame(outfit.url, imageUrl))
}

export function portraitStatusLabel(char) {
  if (!char) return '未认证'
  const status = String(char.seedance_asset_status ?? char.seedanceAssetStatus ?? '').toLowerCase()
  const assetId = char.seedance_asset_id ?? char.seedanceAssetId
  if (status === 'active' && assetId) return '已认证'
  if (status === 'processing') return '审核中'
  if (status === 'failed') return '认证失败'
  if (status === 'pending' || assetId) return '需重新认证'
  return '未认证'
}

export function outfitPortraitStatusLabel(outfit) {
  if (!outfit) return '未认证'
  if (isOutfitPortraitActive(outfit)) return '已认证'
  const candidates = outfit.candidates || []
  if (candidates.some(c => String(c.seedance_asset_status || '').toLowerCase() === 'processing')) return '审核中'
  if (candidates.some(c => String(c.seedance_asset_status || '').toLowerCase() === 'failed')) return '认证失败'
  const status = String(outfit.seedance_asset_status ?? outfit.seedanceAssetStatus ?? '').toLowerCase()
  const assetId = outfit.seedance_asset_id ?? outfit.seedanceAssetId
  if (status === 'processing') return '审核中'
  if (status === 'failed') return '认证失败'
  if (status === 'pending' || assetId) return '需重新认证'
  return '未认证'
}

export function candidatePortraitStatusLabel(candidate) {
  if (!candidate) return '未认证'
  const status = String(candidate.seedance_asset_status ?? candidate.seedanceAssetStatus ?? '').toLowerCase()
  const assetId = candidate.seedance_asset_id ?? candidate.seedanceAssetId
  if (candidatePortraitActive(candidate)) return '已认证'
  if (status === 'processing') return '审核中'
  if (status === 'failed') return '认证失败'
  if (status === 'pending' || assetId) return '需重新认证'
  return '未认证'
}

export function portraitStatusTagClass(label) {
  if (label === '已认证') return 'tag-success'
  if (label === '审核中') return 'tag-accent'
  if (label === '认证失败') return 'tag-error'
  return ''
}

export function outfitPortraitStatusTagClass(label) {
  return portraitStatusTagClass(label)
}

/** 角色是否至少有一张已认证图（基准或任意备选） */
export function characterHasAnyCertifiedPortrait(char) {
  if (isCharacterPortraitActive(char)) return true
  return listCharacterOutfitEntries(char).some(isOutfitPortraitActive)
}
