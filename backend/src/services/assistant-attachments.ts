export type AssistantAttachmentKind =
  | 'character'
  | 'scene'
  | 'shot_frame'
  | 'shot_blocking'
  | 'shot_video'
  | 'shot_compose'
  | 'merge'

export interface AssistantAttachment {
  kind: AssistantAttachmentKind
  id: number
  label?: string
  frame_type?: 'first_frame' | 'last_frame'
  status: 'processing' | 'ready' | 'failed'
  url?: string | null
}

interface ToolCallLike {
  toolName: string | null
  args?: Record<string, unknown> | null
}

interface ToolResultLike {
  toolName: string | null
  result: string
}

function parseResult(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function pushUnique(items: AssistantAttachment[], item: AssistantAttachment) {
  const key = `${item.kind}:${item.id}:${item.frame_type || ''}`
  if (items.some(existing => `${existing.kind}:${existing.id}:${existing.frame_type || ''}` === key)) return
  items.push(item)
}

export function extractAttachmentsFromTools(
  toolCalls: ToolCallLike[],
  toolResults: ToolResultLike[],
): AssistantAttachment[] {
  const items: AssistantAttachment[] = []

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i]
    const name = call.toolName
    if (!name) continue

    const matchingResult = toolResults.find((row, idx) => row.toolName === name && idx >= i)
      || toolResults[i]
    const result = parseResult(matchingResult?.result || '{}')
    const args = call.args || {}

    if (name === 'generate_character_image') {
      const id = Number(result.character_id ?? args.character_id)
      if (id) {
        pushUnique(items, {
          kind: 'character',
          id,
          label: String(result.character_name || args.label || `角色 #${id}`),
          status: result.error ? 'failed' : 'processing',
        })
      }
    }

    if (name === 'batch_generate_character_images') {
      const batchItems = Array.isArray(result.items) ? result.items : []
      if (batchItems.length) {
        batchItems.forEach((row: any) => {
          const id = Number(row.character_id)
          if (id) {
            pushUnique(items, {
              kind: 'character',
              id,
              label: row.character_name ? String(row.character_name) : `角色 #${id}`,
              status: 'processing',
            })
          }
        })
      } else {
        const ids = Array.isArray(result.character_ids)
          ? result.character_ids.map(Number)
          : Array.isArray(args.character_ids)
            ? args.character_ids.map(Number)
            : []
        if (ids.length) {
          ids.forEach(id => pushUnique(items, { kind: 'character', id, label: `角色 #${id}`, status: 'processing' }))
        } else if (Number(result.started) > 0) {
          pushUnique(items, {
            kind: 'character',
            id: 0,
            label: `批量角色图 ×${result.started}`,
            status: 'processing',
          })
        }
      }
    }

    if (name === 'generate_scene_image') {
      const id = Number(result.scene_id ?? args.scene_id)
      if (id) {
        pushUnique(items, {
          kind: 'scene',
          id,
          label: String(result.location || args.label || `场景 #${id}`),
          status: result.error ? 'failed' : 'processing',
        })
      }
    }

    if (name === 'batch_generate_scene_images') {
      const batchItems = Array.isArray(result.items) ? result.items : []
      if (batchItems.length) {
        batchItems.forEach((row: any) => {
          const id = Number(row.scene_id)
          if (id) {
            pushUnique(items, {
              kind: 'scene',
              id,
              label: row.location ? String(row.location) : `场景 #${id}`,
              status: 'processing',
            })
          }
        })
      } else {
        const ids = Array.isArray(result.scene_ids)
          ? result.scene_ids.map(Number)
          : Array.isArray(args.scene_ids)
            ? args.scene_ids.map(Number)
            : []
        if (ids.length) {
          ids.forEach(id => pushUnique(items, { kind: 'scene', id, label: `场景 #${id}`, status: 'processing' }))
        } else if (Number(result.started) > 0) {
          pushUnique(items, {
            kind: 'scene',
            id: 0,
            label: `批量场景图 ×${result.started}`,
            status: 'processing',
          })
        }
      }
    }

    if (name === 'generate_shot_frame') {
      const id = Number(result.storyboard_id ?? args.storyboard_id)
      const frameType = String(result.frame_type ?? args.frame_type ?? 'first_frame') as 'first_frame' | 'last_frame'
      if (id) {
        pushUnique(items, {
          kind: 'shot_frame',
          id,
          label: `镜头 #${id} ${frameType === 'first_frame' ? '首帧' : '尾帧'}`,
          frame_type: frameType,
          status: result.error ? 'failed' : 'processing',
        })
      }
    }

    if (name === 'generate_shot_video') {
      const id = Number(result.storyboard_id ?? args.storyboard_id)
      if (id) {
        pushUnique(items, {
          kind: 'shot_video',
          id,
          label: `镜头 #${id} 视频`,
          status: result.error ? 'failed' : 'processing',
        })
      }
    }

    if (name === 'batch_generate_shot_videos') {
      const batchItems = Array.isArray(result.items) ? result.items : []
      if (batchItems.length) {
        batchItems.forEach((row: any) => {
          const id = Number(row.storyboard_id)
          if (id) pushUnique(items, { kind: 'shot_video', id, label: `镜头 #${id} 视频`, status: 'processing' })
        })
      } else if (Number(result.started) > 0) {
        pushUnique(items, {
          kind: 'shot_video',
          id: 0,
          label: `批量视频 ×${result.started}`,
          status: 'processing',
        })
      }
    }

    if (name === 'compose_shot') {
      const id = Number(result.storyboard_id ?? args.storyboard_id)
      if (id) {
        pushUnique(items, {
          kind: 'shot_compose',
          id,
          label: `镜头 #${id} 合成`,
          status: result.error ? 'failed' : (result.composed_video_url ? 'ready' : 'processing'),
          url: result.composed_video_url ? String(result.composed_video_url) : null,
        })
      }
    }

    if (name === 'compose_all_shots') {
      const results = Array.isArray(result.results) ? result.results : []
      results.filter((row: any) => row.ok).forEach((row: any) => {
        const id = Number(row.storyboard_id)
        if (id) pushUnique(items, { kind: 'shot_compose', id, label: `镜头 #${id} 合成`, status: 'ready' })
      })
    }

    if (name === 'merge_episode') {
      pushUnique(items, {
        kind: 'merge',
        id: Number(result.merge_id || 0),
        label: '全集拼接',
        status: result.error ? 'failed' : 'processing',
      })
    }
  }

  return items
}

export function serializeAttachments(items: AssistantAttachment[]): string | null {
  if (!items.length) return null
  return JSON.stringify(items)
}

export function parseAttachments(raw?: string | null): AssistantAttachment[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as AssistantAttachment[] : []
  } catch {
    return []
  }
}
