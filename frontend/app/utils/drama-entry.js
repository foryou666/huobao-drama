/** 进入项目工作台时默认打开的集数（最近更新优先） */
export function resolveDefaultEpisodeNumber(episodes) {
  if (!Array.isArray(episodes) || !episodes.length) return null
  const sorted = [...episodes].sort((a, b) => {
    const ta = new Date(a.updated_at || a.updatedAt || 0).getTime()
    const tb = new Date(b.updated_at || b.updatedAt || 0).getTime()
    if (tb !== ta) return tb - ta
    return Number(b.episode_number ?? b.episodeNumber) - Number(a.episode_number ?? a.episodeNumber)
  })
  const num = Number(sorted[0]?.episode_number ?? sorted[0]?.episodeNumber)
  return Number.isFinite(num) && num > 0 ? num : null
}

/** 项目 → 工作台路径；无集时带 setup=1 进入创建首集流程 */
export function dramaWorkbenchPath(dramaId, episodes, episodeNumber) {
  const id = Number(dramaId)
  if (!Number.isFinite(id) || id <= 0) return '/'
  const num = episodeNumber != null
    ? Number(episodeNumber)
    : resolveDefaultEpisodeNumber(episodes)
  if (num) return `/drama/${id}/episode/${num}`
  return `/drama/${id}/episode/1?setup=1`
}
