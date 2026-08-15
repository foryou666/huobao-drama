export const NARRATION_PROJECT_KIND = 'narration'

export function parseDramaProjectMeta(drama: { metadata?: string | null } | null | undefined) {
  let meta: Record<string, unknown> = {}
  if (drama?.metadata) {
    try {
      const parsed = JSON.parse(drama.metadata)
      if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>
    } catch {
      meta = {}
    }
  }
  const projectKind = String(meta.project_kind || '').trim() || null
  const narrationJobId = Number(meta.narration_job_id)
  return {
    project_kind: projectKind,
    narration_job_id: Number.isFinite(narrationJobId) && narrationJobId > 0 ? narrationJobId : null,
    meta,
  }
}

export function buildNarrationDramaMetadata(jobId: number, existingMeta?: Record<string, unknown>) {
  return JSON.stringify({
    ...(existingMeta || {}),
    project_kind: NARRATION_PROJECT_KIND,
    narration_job_id: jobId,
  })
}
