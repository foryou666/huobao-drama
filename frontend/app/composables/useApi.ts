import { clearAuthSession, getAuthToken } from '~/utils/auth-token'
import { getActiveTeamId } from '~/utils/team-context'

const BASE = '/api/v1'

async function readJsonResponse(resp: Response) {
  const text = await resp.text()
  if (!text.trim()) {
    if (resp.status === 504 || resp.status === 502 || resp.status === 408) {
      throw new Error('请求超时：分镜拆解耗时较长，请稍后刷新页面查看结果，或重试')
    }
    throw new Error(`服务器返回空响应 (HTTP ${resp.status})`)
  }
  try {
    return JSON.parse(text)
  } catch {
    const preview = text.slice(0, 120).replace(/\s+/g, ' ')
    throw new Error(`服务器响应无法解析 (HTTP ${resp.status})${preview ? `: ${preview}` : ''}`)
  }
}

async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = String(teamId)

  const opts: RequestInit = { method, headers }
  if (body) opts.body = JSON.stringify(body)

  const start = performance.now()
  console.log(`%c[API] %c${method} %c${path}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', body || '')

  try {
    const resp = await fetch(`${BASE}${path}`, opts)
    const json = await readJsonResponse(resp)
    const ms = Math.round(performance.now() - start)

    if (!resp.ok || (json.code && json.code >= 400)) {
      console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', json.message || '')
      if (resp.status === 401 && !path.startsWith('/auth/login')) {
        clearAuthSession()
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login'
        }
      }
      throw new Error(json.message || `${resp.status}`)
    }

    console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#66bb6a', 'color:#66bb6a;font-weight:bold', 'color:#888')
    return json.data ?? json
  } catch (err: any) {
    const ms = Math.round(performance.now() - start)
    const msg = String(err?.message || err || '')
    if (msg.includes('Unexpected end of JSON input') || msg.includes('Failed to execute \'json\'')) {
      throw new Error('请求超时或连接中断：分镜拆解耗时较长，请稍后刷新查看是否已保存，或重试')
    }
    if (!msg.match(/^\d{3}$/)) {
      console.log(`%c[API] %c${method} ${path} %cERROR %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', msg)
    }
    throw err
  }
}

export const api = {
  get: <T = any>(p: string) => req<T>('GET', p),
  post: <T = any>(p: string, b?: any) => req<T>('POST', p, b),
  put: <T = any>(p: string, b?: any) => req<T>('PUT', p, b),
  patch: <T = any>(p: string, b?: any) => req<T>('PATCH', p, b),
  del: <T = any>(p: string, b?: any) => req<T>('DELETE', p, b),
}

export const mediaAPI = {
  resolveUrls: (paths: string[]) => api.post<{ urls: Record<string, string> }>('/media/resolve-urls', { paths }),
  resolveUrl: (path: string) => api.get<{ path: string; url: string }>(`/media/url?path=${encodeURIComponent(path)}`),
}

export const dramaAPI = {
  list: (opts?: { includeArchived?: boolean; lite?: boolean; pageSize?: number }) => {
    const q = new URLSearchParams()
    if (opts?.includeArchived) q.set('include_archived', '1')
    if (opts?.lite) q.set('lite', '1')
    if (opts?.pageSize) q.set('page_size', String(opts.pageSize))
    const qs = q.toString()
    return api.get<{ items: any[] }>(`/dramas${qs ? `?${qs}` : ''}`)
  },
  listLite: (opts?: { includeArchived?: boolean; pageSize?: number }) =>
    dramaAPI.list({ ...opts, lite: true }),
  get: (id: number, opts?: { workbench?: boolean }) => {
    const q = opts?.workbench ? '?workbench=1' : ''
    return api.get(`/dramas/${id}${q}`)
  },
  create: (data: any) => api.post('/dramas', data),
  update: (id: number, data: any) => api.put(`/dramas/${id}`, data),
  del: (id: number) => api.del(`/dramas/${id}`),
  archive: (id: number) => api.post(`/dramas/${id}/archive`),
  restore: (id: number) => api.post(`/dramas/${id}/restore`),
  generateCover: (id: number, data?: {
    prompt?: string
    character_ids?: number[]
    scene_ids?: number[]
    character_image_refs?: Record<number, string>
    scene_image_refs?: Record<number, string>
    aspect_ratios?: Array<'9:16' | '16:9' | '3:4' | '4:3'>
  }) =>
    api.post<{
      image_generation_id?: number
      items?: Array<{ aspect_ratio: '9:16' | '16:9' | '3:4' | '4:3'; image_generation_id: number }>
      credits_balance?: number
    }>(
      `/dramas/${id}/generate-cover`,
      data || {},
    ),
  listCoverCandidates: (id: number) =>
    api.get<{
      items?: Array<{
        id: number
        status?: string
        aspect_ratio?: '9:16' | '16:9' | '3:4' | '4:3' | null
        size?: string | null
        local_path?: string | null
        image_url?: string | null
        path?: string | null
        prompt?: string | null
        created_at?: string
        completed_at?: string | null
        error_msg?: string | null
      }>
    }>(`/dramas/${id}/cover-candidates`),
  applyCover: (id: number, data: {
    covers: Partial<Record<'3:4' | '4:3', string>>
    primary_aspect_ratio?: '3:4' | '4:3'
  }) =>
    api.post<{
      thumbnail?: string
      cover_url?: string
      cover_3_4?: string | null
      cover_4_3?: string | null
      covers?: Partial<Record<'3:4' | '4:3', string | null>>
    }>(
      `/dramas/${id}/apply-cover`,
      data,
    ),
  shares: (id: number) => api.get(`/dramas/${id}/shares`),
  addShare: (id: number, teamId: number) => api.post(`/dramas/${id}/shares`, { team_id: teamId }),
  removeShare: (id: number, teamId: number) => api.del(`/dramas/${id}/shares/${teamId}`),
}

export const scriptImportAPI = {
  preview: (data: { script_text: string; title?: string }) =>
    api.post<{
      ok: boolean
      reason?: string
      preamble?: string
      episodes: Array<{
        episode_number: number
        marker: string
        title: string
        content: string
        char_count: number
        warn_long: boolean
        risk_long: boolean
      }>
      total_chars: number
      model_note?: string
      warn_chars?: number
      risk_chars?: number
    }>('/script-import/preview', data),
  commit: (data: {
    title: string
    script_text?: string
    style?: string
    director_style?: string
    image_config_id?: number | null
    video_config_id?: number | null
    audio_config_id?: number | null
    episodes?: any[]
  }) => api.post<{
    drama_id: number
    episode_count: number
    image_config_id?: number | null
    script_import?: any
  }>('/script-import/commit', data),
  status: (dramaId: number) => api.get(`/script-import/${dramaId}/status`),
  extract: (dramaId: number) => api.post(`/script-import/${dramaId}/extract`),
  assets: (dramaId: number) => api.get<{
    total: number
    ready_count: number
    missing_count: number
    items: Array<{
      type: 'character' | 'scene' | 'prop'
      id: number
      name: string
      description?: string
      prompt?: string
      has_image: boolean
      image_url?: string | null
    }>
    script_import?: any
  }>(`/script-import/${dramaId}/assets`),
  generateImages: (dramaId: number, data?: {
    character_ids?: number[]
    scene_ids?: number[]
    prop_ids?: number[]
    only_missing?: boolean
  }) => api.post<{
    requested: number
    started: number
    failed: number
    errors: any[]
    assets?: any
  }>(`/script-import/${dramaId}/generate-images`, data || {}),
}

export const autoProduceAPI = {
  create: (data: {
    title: string
    script_text: string
    clip_count?: number
    duration_sec?: number
    aspect_ratio?: '16:9' | '9:16'
    dialogue_lock?: boolean
    generate_images?: boolean
    director_style?: string
  }) => api.post<any>('/auto-produce/jobs', data),
  list: (limit = 20) => api.get<{ items: any[] }>(`/auto-produce/jobs?limit=${limit}`),
  get: (id: string) => api.get<any>(`/auto-produce/jobs/${id}`),
}

export const promptsAPI = {
  directorStyles: () => api.get<{ items: { id: string; label: string; description: string }[]; default: string }>('/prompts/director-styles'),
}

export const seedanceAPI = {
  models: () => api.get('/ai-configs/seedance-models'),
}

export const episodeAPI = {
  create: (data: any) => api.post('/episodes', data),
  update: (id: number, data: any) => api.put(`/episodes/${id}`, data),
  del: (id: number) => api.del(`/episodes/${id}`),
  characters: (id: number) => api.get(`/episodes/${id}/characters`),
  scenes: (id: number) => api.get(`/episodes/${id}/scenes`),
  storyboards: (id: number) => api.get(`/episodes/${id}/storyboards`),
  shotPlans: (id: number) => api.get(`/episodes/${id}/shot-plans`),
  importShotPlans: (id: number, text: string) => api.post(`/episodes/${id}/shot-plans/import`, { text }),
  generateShotPlans: (id: number) => api.post(`/episodes/${id}/shot-plans/generate`),
  confirmShotPlans: (id: number) => api.post(`/episodes/${id}/shot-plans/confirm`),
  reorderShotPlans: (id: number, orderedIds: number[]) =>
    api.post(`/episodes/${id}/shot-plans/reorder`, { ordered_ids: orderedIds }),
  updateShotPlan: (episodeId: number, planId: number, data: any) =>
    api.put(`/episodes/${episodeId}/shot-plans/${planId}`, data),
  clips: (id: number) => api.get(`/episodes/${id}/clips`),
  autoGroupClips: (id: number) => api.post(`/episodes/${id}/clips/auto-group`),
  movePlanToClip: (episodeId: number, planId: number, targetClipId: number) =>
    api.post(`/episodes/${episodeId}/clips/move-plan`, { plan_id: planId, target_clip_id: targetClipId }),
  pipelineStatus: (id: number) => api.get(`/episodes/${id}/pipeline-status`),
  activityLogs: (id: number, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get<{ items: any[]; total: number; limit: number; offset: number }>(`/episodes/${id}/activity-logs${qs ? `?${qs}` : ''}`)
  },
}

export const storyboardAPI = {
  create: (data: any) => api.post('/storyboards', data),
  update: (id: number, data: any) => api.put(`/storyboards/${id}`, data),
  generateTTS: (id: number) => api.post(`/storyboards/${id}/generate-tts`),
  generateBlocking: (id: number, data?: { blocking_layout?: any; prompt?: string }) =>
    api.post(`/storyboards/${id}/generate-blocking`, data || {}),
  generateFrameFromBlocking: (id: number, data?: { frame_type?: 'first_frame' | 'last_frame'; prompt?: string }) =>
    api.post(`/storyboards/${id}/generate-frame-from-blocking`, data || {}),
  optimizeVideoPrompt: (id: number, data?: {
    current_prompt?: string
    feedback?: string
    mode?: 'polish' | 'rewrite'
    focus?: 'transition' | 'shot' | 'camera' | 'dialogue' | 'general'
  }) =>
    api.post(`/storyboards/${id}/optimize-video-prompt`, data || {}),
  videoPromptHistory: (id: number) => api.get(`/storyboards/${id}/video-prompt-history`),
  restoreVideoPromptHistory: (id: number, historyId: number) =>
    api.post(`/storyboards/${id}/video-prompt-history/${historyId}/restore`),
  del: (id: number) => api.del(`/storyboards/${id}`),
}

function uploadFormHeaders() {
  const headers: Record<string, string> = {}
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = String(teamId)
  return headers
}

function parseUploadFormResponse(status: number, text: string) {
  let json: { code?: number; message?: string; data?: unknown } = {}
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`上传响应无法解析 (HTTP ${status})`)
  }
  if (status >= 400 || (json.code && json.code >= 400)) {
    if (status === 401) {
      clearAuthSession()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    throw new Error(json.message || `${status}`)
  }
  return json.data ?? json
}

async function uploadForm(
  path: string,
  form: FormData,
  opts?: { onProgress?: (percent: number) => void },
) {
  if (typeof XMLHttpRequest === 'undefined' || !opts?.onProgress) {
    const resp = await fetch(`${BASE}${path}`, { method: 'POST', headers: uploadFormHeaders(), body: form })
    const text = await resp.text()
    return parseUploadFormResponse(resp.status, text)
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    const headers = uploadFormHeaders()
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value)
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      opts.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      try {
        resolve(parseUploadFormResponse(xhr.status, xhr.responseText))
      } catch (err: any) {
        reject(err)
      }
    }
    xhr.onerror = () => reject(new Error('上传失败'))
    xhr.onabort = () => reject(new Error('上传已取消'))
    xhr.send(form)
  })
}

export const uploadAPI = {
  image: (file: File, dramaId?: number | null) => {
    const form = new FormData()
    form.append('file', file)
    if (dramaId != null && Number.isFinite(Number(dramaId)) && Number(dramaId) > 0) {
      form.append('drama_id', String(dramaId))
    }
    return uploadForm('/upload/image', form)
  },
  video: (file: File, dramaId?: number | null) => {
    const form = new FormData()
    form.append('file', file)
    if (dramaId != null && Number.isFinite(Number(dramaId)) && Number(dramaId) > 0) {
      form.append('drama_id', String(dramaId))
    }
    return uploadForm('/upload/video', form)
  },
  audio: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return uploadForm('/upload/audio', form)
  },
}

export const agentAPI = {
  chat: (
    type: string,
    body: {
      message: string
      drama_id: number
      episode_id: number
      history?: { role: 'user' | 'assistant'; content: string }[]
      context?: string
    },
  ) => api.post<{ text: string; toolCalls?: { toolName?: string }[]; toolResults?: unknown[] }>(
    `/agent/${type}/chat`,
    body,
  ),
}

export interface AssistantDbMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tool_summary: string | null
  attachments?: string | null
  created_at: string
  sort_order: number
}

export type AssistantStreamHandlers = {
  onUser?: (data: { id: number; content: string; created_at: string }) => void
  onDelta?: (text: string) => void
  onTool?: (name: string) => void
  onDone?: (data: {
    assistant_message_id: number
    text: string
    tool_summary: string | null
    attachments?: import('~/composables/useEpisodeAssistant').AssistantAttachment[]
    mutated: boolean
  }) => void
  onError?: (message: string) => void
}

function parseSseBlock(block: string) {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

export const assistantAPI = {
  listMessages: (episodeId: number, stepKey: string) =>
    api.get<{ items: AssistantDbMessage[]; thread_id: number | null }>(
      `/assistant/messages?episode_id=${episodeId}&step_key=${encodeURIComponent(stepKey)}`,
    ),
  clearMessages: (episodeId: number, stepKey: string) =>
    api.del(`/assistant/messages?episode_id=${episodeId}&step_key=${encodeURIComponent(stepKey)}`),
  recordActivity: (body: {
    episode_id: number
    step_key: string
    agent_type: string
    user_message: string
    assistant_message: string
    attachments?: Array<Record<string, unknown>>
  }) => api.post<{
    user_message_id: number
    assistant_message_id: number
    attachments?: Array<Record<string, unknown>>
  }>('/assistant/activity', body),
  patchMessage: (messageId: number, body: {
    content?: string
    attachments?: Array<Record<string, unknown>>
  }) => api.patch<{ id: number; content: string; attachments?: Array<Record<string, unknown>> }>(
    `/assistant/messages/${messageId}`,
    body,
  ),
  chatStream: async (
    body: {
      agent_type: string
      message: string
      drama_id: number
      episode_id: number
      step_key: string
      context?: string
    },
    handlers: AssistantStreamHandlers,
    signal?: AbortSignal,
  ) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getAuthToken()
    if (token) headers.Authorization = `Bearer ${token}`
    const teamId = getActiveTeamId()
    if (teamId) headers['X-Team-Id'] = String(teamId)

    const resp = await fetch(`${BASE}/assistant/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!resp.ok) {
      if (resp.status === 401) {
        clearAuthSession()
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login'
        }
      }
      const text = await resp.text()
      try {
        const json = JSON.parse(text)
        throw new Error(json.message || `${resp.status}`)
      } catch {
        throw new Error(text || `HTTP ${resp.status}`)
      }
    }

    if (!resp.body) throw new Error('流式响应不可用')

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep = buffer.indexOf('\n\n')
      while (sep >= 0) {
        const block = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const parsed = parseSseBlock(block)
        if (parsed) {
          if (parsed.event === 'user') handlers.onUser?.(parsed.data)
          else if (parsed.event === 'delta') handlers.onDelta?.(parsed.data.text || '')
          else if (parsed.event === 'tool') handlers.onTool?.(parsed.data.name || '')
          else if (parsed.event === 'done') handlers.onDone?.(parsed.data)
          else if (parsed.event === 'error') handlers.onError?.(parsed.data.message || 'stream error')
        }
        sep = buffer.indexOf('\n\n')
      }
    }
  },
}

export const portraitAPI = {
  guide: () => api.get('/portraits/guide'),
  bind: (id: number, data: {
    portrait_type?: 'ai' | 'real_person'
    seedance_asset_id?: string | null
    seedance_asset_group_id?: string | null
    seedance_asset_status?: string | null
  }) => api.put(`/portraits/characters/${id}`, data),
  syncAsset: (id: number, opts?: { force?: boolean; outfit_id?: string | null; candidate_id?: string | null }) =>
    api.post(`/portraits/characters/${id}/sync-asset`, opts || {}),
  assetStatus: (id: number, opts?: { outfit_id?: string | null; candidate_id?: string | null }) => {
    const qs = new URLSearchParams()
    if (opts?.outfit_id) qs.set('outfit_id', opts.outfit_id)
    if (opts?.candidate_id) qs.set('candidate_id', opts.candidate_id)
    const q = qs.toString()
    return api.get(`/portraits/characters/${id}/asset-status${q ? `?${q}` : ''}`)
  },
  cancelAsset: (id: number, opts?: { outfit_id?: string | null; candidate_id?: string | null }) =>
    api.del(`/portraits/characters/${id}/asset`, {
      ...(opts?.outfit_id ? { outfit_id: opts.outfit_id } : {}),
      ...(opts?.candidate_id ? { candidate_id: opts.candidate_id } : {}),
    }),
  adminSummary: () => api.get('/portraits/admin/summary'),
  adminRecords: (params?: { status?: string; config_id?: number | string; q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', String(params.status))
    if (params?.config_id != null && params.config_id !== '') qs.set('config_id', String(params.config_id))
    if (params?.q) qs.set('q', String(params.q))
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    const q = qs.toString()
    return api.get(`/portraits/admin/records${q ? `?${q}` : ''}`)
  },
  adminUpdateQuota: (configId: number, portrait_asset_quota: number) =>
    api.put(`/portraits/admin/keys/${configId}/quota`, { portrait_asset_quota }),
  adminCancelRecord: (id: number) => api.del(`/portraits/admin/records/${id}`),
  adminRecertifyRecord: (id: number) => api.post(`/portraits/admin/records/${id}/recertify`),
}

export const characterAPI = {
  create: (data: {
    drama_id: number
    episode_id?: number
    name: string
    role?: string
    description?: string
    appearance?: string
    personality?: string
    image_prompt?: string
  }) => api.post('/characters', data),
  update: (id: number, data: any) => api.put(`/characters/${id}`, data),
  voiceSample: (id: number, episodeId: number) => api.post(`/characters/${id}/generate-voice-sample`, { episode_id: episodeId }),
  uploadImage: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return uploadForm(`/characters/${id}/upload-image`, form)
  },
  generateImage: (id: number, episodeId: number, prompt?: string) =>
    api.post(`/characters/${id}/generate-image`, { episode_id: episodeId, ...(prompt ? { prompt } : {}) }),
  transformImage: (id: number, episodeId: number, transformType: string, source?: string) =>
    api.post(`/characters/${id}/transform-image`, {
      episode_id: episodeId,
      transform_type: transformType,
      ...(source && source !== 'primary' ? { source } : {}),
    }),
  generateOutfit: (id: number, data: { episode_id: number; costume_asset_id: number; label?: string; prompt?: string; outfit_id?: string }) =>
    api.post(`/characters/${id}/generate-outfit`, data),
  uploadOutfitCandidate: (
    id: number,
    outfitId: string,
    file: File,
    data?: { label?: string; candidate_label?: string; set_as_default?: boolean; costume_asset_id?: number },
  ) => {
    const form = new FormData()
    form.append('file', file)
    if (data?.label) form.append('label', data.label)
    if (data?.candidate_label) form.append('candidate_label', data.candidate_label)
    if (data?.set_as_default != null) form.append('set_as_default', String(data.set_as_default))
    if (data?.costume_asset_id != null) form.append('costume_asset_id', String(data.costume_asset_id))
    return uploadForm(`/characters/${id}/outfits/${encodeURIComponent(outfitId)}/candidates`, form)
  },
  setOutfitDefault: (id: number, outfitId: string, candidateId: string) =>
    api.put(`/characters/${id}/outfits/${encodeURIComponent(outfitId)}/default`, { candidate_id: candidateId }),
  deleteOutfitCandidate: (id: number, outfitId: string, candidateId: string) =>
    api.del(`/characters/${id}/outfits/${encodeURIComponent(outfitId)}/candidates/${encodeURIComponent(candidateId)}`),
  transformPresets: () => api.get('/characters/transform-presets'),
  batchImages: (ids: number[], episodeId: number) => api.post('/characters/batch-generate-images', { character_ids: ids, episode_id: episodeId }),
  del: (id: number) => api.del(`/characters/${id}`),
}

export const sceneAPI = {
  create: (data: {
    drama_id: number
    episode_id?: number
    location: string
    time?: string
    prompt?: string
    description?: string
  }) => api.post('/scenes', data),
  update: (id: number, data: any) => api.put(`/scenes/${id}`, data),
  uploadImage: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return uploadForm(`/scenes/${id}/upload-image`, form)
  },
  generateImage: (id: number, episodeId: number, prompt?: string) =>
    api.post(`/scenes/${id}/generate-image`, { episode_id: episodeId, ...(prompt ? { prompt } : {}) }),
  generateAngle: (id: number, data: { episode_id: number; angle_id: string; prompt?: string }) =>
    api.post(`/scenes/${id}/generate-angle`, data),
  generateAllAngles: (id: number, data: { episode_id: number; prompt?: string; skip_existing?: boolean; angle_ids?: string[] }) =>
    api.post(`/scenes/${id}/generate-all-angles`, data),
  generateAngleSheet: (id: number, data: { episode_id: number; prompt?: string }) =>
    api.post(`/scenes/${id}/generate-angle-sheet`, data),
  anglePresets: () => api.get<{ items: any[] }>('/scenes/angle-presets/list'),
  del: (id: number) => api.del(`/scenes/${id}`),
}

export const assetAPI = {
  categories: () => api.get('/assets/categories'),
  list: async (params?: { drama_id?: number; type?: string; q?: string }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.type) query.set('type', params.type)
    if (params?.q) query.set('q', params.q)
    const data = await api.get(`/assets${query.size ? `?${query.toString()}` : ''}`)
    if (Array.isArray(data)) return data
    return data?.items ?? []
  },
  listWithCounts: async (params?: { drama_id?: number; type?: string; q?: string }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.type) query.set('type', params.type)
    if (params?.q) query.set('q', params.q)
    const data = await api.get(`/assets${query.size ? `?${query.toString()}` : ''}`)
    if (Array.isArray(data)) {
      const counts: Record<string, number> = {}
      for (const item of data) {
        const key = String(item?.type || '')
        if (!key) continue
        counts[key] = (counts[key] || 0) + 1
      }
      return { items: data, counts }
    }
    return {
      items: data?.items ?? [],
      counts: data?.counts ?? {},
    }
  },
  create: (data: any) => api.post('/assets', data),
  update: (id: number, data: any) => api.put(`/assets/${id}`, data),
  del: (id: number) => api.del(`/assets/${id}`),
  deleteImage: (id: number, url: string) => api.del(`/assets/${id}/images`, { url }),
  sync: (dramaId: number) => api.post('/assets/sync', { drama_id: dramaId }),
  upload: (form: FormData) => uploadForm('/assets/upload', form),
  uploadToAsset: (id: number, form: FormData) => uploadForm(`/assets/${id}/upload`, form),
  applyToCharacter: (assetId: number, characterId: number) =>
    api.post(`/assets/${assetId}/apply-character`, { character_id: characterId }),
  applyToScene: (assetId: number, sceneId: number) =>
    api.post(`/assets/${assetId}/apply-scene`, { scene_id: sceneId }),
}

export const imageAPI = {
  generate: (d: any) => api.post('/images', d),
  get: (id: number) => api.get(`/images/${id}`),
  capabilities: () => api.get('/images/studio/capabilities'),
  attachToEntity: (
    id: number,
    data: {
      entity_type: 'character' | 'scene' | 'prop'
      entity_id?: number
      drama_id?: number
      create_entity?: {
        name?: string
        location?: string
        time?: string
        role?: string
        description?: string
        appearance?: string
        prompt?: string
      }
      group_id?: string
      group_label?: string
      set_as_default?: boolean
    },
  ) => api.post(`/images/${id}/attach`, data),
  list: (params?: { drama_id?: number; storyboard_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    return api.get(`/images${query.size ? `?${query.toString()}` : ''}`)
  },
  ledger: (params?: {
    drama_id?: number
    episode_id?: number
    status?: string
    keyword?: string
    limit?: number
    offset?: number
    mine_only?: boolean
    studio_only?: boolean
    user_id?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.episode_id) query.set('episode_id', String(params.episode_id))
    if (params?.status) query.set('status', params.status)
    if (params?.keyword) query.set('keyword', params.keyword)
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.offset) query.set('offset', String(params.offset))
    if (params?.mine_only === false) query.set('mine_only', '0')
    else if (params?.mine_only !== undefined) query.set('mine_only', '1')
    if (params?.studio_only) query.set('studio_only', '1')
    if (params?.user_id) query.set('user_id', String(params.user_id))
    return api.get(`/images/ledger${query.size ? `?${query.toString()}` : ''}`)
  },
  /** 管理员生图记录（含即梦账号）；仅设置页使用 */
  adminRecords: (params?: {
    drama_id?: number
    status?: string
    keyword?: string
    limit?: number
    offset?: number
    studio_only?: boolean
    user_id?: number
    model?: string
  }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.status) query.set('status', params.status)
    if (params?.keyword) query.set('keyword', params.keyword)
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.offset) query.set('offset', String(params.offset))
    if (params?.studio_only === false) query.set('studio_only', '0')
    else if (params?.studio_only !== undefined) query.set('studio_only', '1')
    if (params?.user_id) query.set('user_id', String(params.user_id))
    if (params?.model) query.set('model', params.model)
    return api.get(`/images/admin/records${query.size ? `?${query.toString()}` : ''}`)
  },
  pin: (id: number) => api.post(`/images/${id}/pin`),
  unpin: (id: number) => api.del(`/images/${id}/pin`),
}
export const gridAPI = {
  prompt: (d: any) => api.post('/grid/prompt', d),
  generate: (d: any) => api.post('/grid/generate', d),
  status: (id: number) => api.get(`/grid/status/${id}`),
  split: (d: any) => api.post('/grid/split', d),
}
export const videoAPI = {
  generate: (d: any) => api.post('/videos', d),
  chengmengOptions: () => api.get('/videos/chengmeng-options'),
  grokOptions: () => api.get('/videos/grok-options'),
  jimengOptions: () => api.get('/videos/jimeng-options'),
  xyqOptions: () => api.get('/videos/xyq-options'),
  cozeOptions: () => api.get('/videos/coze-options'),
  funshionOptions: () => api.get('/videos/funshion-options'),
  xingyuemengOptions: () => api.get('/videos/xingyuemeng-options'),
  doubaoTrainingOptions: () => api.get('/videos/doubao-training-options'),
  officialOptions: () => api.get('/videos/official-options'),
  aistarslabOptions: () => api.get('/videos/aistarslab-options'),
  aigcccOptions: () => api.get('/videos/aigccc-options'),
  get: (id: number) => api.get(`/videos/${id}`),
  cancel: (id: number) => api.post(`/videos/${id}/cancel`),
  list: (params?: { drama_id?: number; storyboard_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    return api.get(`/videos${query.size ? `?${query.toString()}` : ''}`)
  },
  ledger: (params?: {
    drama_id?: number
    episode_id?: number
    status?: string
    keyword?: string
    limit?: number
    offset?: number
    mine_only?: boolean
    user_id?: number
    provider?: string
    models?: string
  }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.episode_id) query.set('episode_id', String(params.episode_id))
    if (params?.status) query.set('status', params.status)
    if (params?.keyword) query.set('keyword', params.keyword)
    if (params?.limit != null && Number.isFinite(Number(params.limit))) query.set('limit', String(params.limit))
    if (params?.offset != null && Number.isFinite(Number(params.offset))) query.set('offset', String(params.offset))
    if (params?.provider) query.set('provider', params.provider)
    if (params?.models) query.set('models', params.models)
    if (params?.user_id) query.set('user_id', String(params.user_id))
    if (params?.mine_only === false) query.set('mine_only', '0')
    else if (params?.mine_only !== undefined) query.set('mine_only', '1')
    return api.get(`/videos/ledger${query.size ? `?${query.toString()}` : ''}`)
  },
}

export const repaintAPI = {
  list: () => api.get('/repaint'),
  get: (id: number) => api.get(`/repaint/${id}`),
  create: (file: File, title?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (title?.trim()) form.append('title', title.trim())
    return uploadForm('/repaint', form)
  },
  patch: (id: number, data: { title?: string }) => api.patch(`/repaint/${id}`, data),
  patchAnalysis: (id: number, data: Record<string, unknown>) => api.patch(`/repaint/${id}/analysis`, data),
  analyze: (id: number, opts?: { skip_asr?: boolean }) => api.post(`/repaint/${id}/analyze`, opts || {}),
  confirm: (id: number, stage: string) => api.post(`/repaint/${id}/confirm`, { stage }),
  assetReadiness: (id: number) => api.get(`/repaint/${id}/asset-readiness`),
  listSegments: (id: number) => api.get(`/repaint/${id}/segments`),
  buildSegments: (id: number) => api.post(`/repaint/${id}/segments/build`),
  patchSegment: (id: number, segmentId: number, data: { video_prompt?: string }) =>
    api.patch(`/repaint/${id}/segments/${segmentId}`, data),
  generateSegment: (id: number, segmentId: number) =>
    api.post(`/repaint/${id}/segments/${segmentId}/generate`),
  merge: (id: number) => api.post(`/repaint/${id}/merge`),
}

export const ttsAPI = {
  list: (params: { limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return api.get(`/tts${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get(`/tts/${id}`),
  status: (opts?: { force?: boolean }) => {
    const q = opts?.force ? '?force=1' : ''
    return api.get<{
      state: 'online' | 'offline' | 'unconfigured'
      online: boolean
      configured: boolean
      reachable: boolean
      label: string
      detail: string
      checked_at: string
      http_status?: number | null
    }>(`/tts/status${q}`)
  },
  voices: () => api.get('/tts/voices'),
  generate: (data: Record<string, unknown>) => api.post('/tts', data),
  getConfig: () => api.get('/tts/config'),
  saveConfig: (data: Record<string, unknown>) => api.put('/tts/config', data),
  testConfig: (data: { base_url: string }) => api.post('/tts/config/test', data),
}

/** RunningHub IndexTTS2 云端配音 */
export const ttsRunninghubAPI = {
  list: (params: { limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return api.get(`/tts/runninghub${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get(`/tts/runninghub/${id}`),
  meta: () => api.get('/tts/runninghub/meta'),
  status: () => api.get<{
    state: 'ready' | 'needs_bindings' | 'unconfigured'
    configured: boolean
    ready: boolean
    label: string
    detail: string
  }>('/tts/runninghub/status'),
  generate: (data: Record<string, unknown>) => api.post('/tts/runninghub', data),
  getConfig: () => api.get('/tts/runninghub/config'),
  saveConfig: (data: Record<string, unknown>) => api.put('/tts/runninghub/config', data),
  testConfig: (data: Record<string, unknown>) => api.post('/tts/runninghub/config/test', data),
  syncConfig: (data: Record<string, unknown> = {}) => api.post('/tts/runninghub/config/sync', data),
}

/** RunningHub IndexTTS2 参考音色（AI App apiType=4） */
export const ttsRunninghubRefAPI = {
  list: (params: { limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return api.get(`/tts/runninghub-ref${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get(`/tts/runninghub-ref/${id}`),
  meta: () => api.get('/tts/runninghub-ref/meta'),
  status: () => api.get<{
    state: 'ready' | 'needs_bindings' | 'unconfigured'
    configured: boolean
    ready: boolean
    label: string
    detail: string
    docs_url?: string
  }>('/tts/runninghub-ref/status'),
  generate: (data: Record<string, unknown>) => api.post('/tts/runninghub-ref', data),
  syncConfig: (data: Record<string, unknown> = {}) => api.post('/tts/runninghub-ref/config/sync', data),
}

/** APIMart Suno 配乐 */
export const musicSunoAPI = {
  list: (params: { limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return api.get(`/music/suno${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get(`/music/suno/${id}`),
  certificate: (id: number) => api.get(`/music/suno/${id}/certificate`),
  meta: () => api.get('/music/suno/meta'),
  status: () => api.get<{
    state: 'ready' | 'unconfigured'
    configured: boolean
    ready: boolean
    label: string
    detail: string
  }>('/music/suno/status'),
  generate: (data: Record<string, unknown>) => api.post('/music/suno', data),
  delete: (id: number) => api.del(`/music/suno/${id}`),
  setVisibility: (id: number, visibility: 'private' | 'team' | 'public') =>
    api.patch(`/music/suno/${id}/visibility`, { visibility }),
  adminSummary: () => api.get('/music/suno/admin/summary'),
  adminRecords: (params?: {
    status?: string
    q?: string
    keyword?: string
    limit?: number
    offset?: number
  }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.q) q.set('q', params.q)
    if (params?.keyword) q.set('keyword', params.keyword)
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get(`/music/suno/admin/records${qs ? `?${qs}` : ''}`)
  },
}

export const subtitleRemoverAPI = {
  list: () => api.get('/subtitle-remover'),
  get: (id: number) => api.get(`/subtitle-remover/${id}`),
  downloadUrl: (id: number) => `/api/v1/subtitle-remover/${id}/download`,
  create: (form: FormData, opts?: { onProgress?: (percent: number) => void }) =>
    uploadForm('/subtitle-remover', form, opts),
  getConfig: () => api.get('/subtitle-remover/config'),
  saveConfig: (data: Record<string, unknown>) => api.put('/subtitle-remover/config', data),
  testConfig: (data: { base_url: string; api_key?: string }) => api.post('/subtitle-remover/config/test', data),
}

/** 视频超分 */
export const videoUpscaleAPI = {
  meta: () => api.get('/video-upscale/meta'),
  balance: () => api.get('/video-upscale/balance'),
  list: (params?: { status?: string; range?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.range) q.set('range', params.range)
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get(`/video-upscale${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get(`/video-upscale/${id}`),
  forGenerations: (ids: number[]) => {
    const q = new URLSearchParams()
    q.set('ids', ids.filter(n => Number.isFinite(n) && n > 0).join(','))
    return api.get(`/video-upscale/for-generations?${q.toString()}`)
  },
  fromGeneration: (videoGenerationId: number) =>
    api.post('/video-upscale/from-generation', { video_generation_id: videoGenerationId }),
  downloadUrl: (id: number) => `/api/v1/video-upscale/${id}/download`,
  create: (form: FormData, opts?: { onProgress?: (percent: number) => void }) =>
    uploadForm('/video-upscale', form, opts),
}

/** RunningHub 去字幕/去水印 */
export const subtitleEraseAPI = {
  meta: () => api.get('/subtitle-erase/meta'),
  balance: () => api.get('/subtitle-erase/balance'),
  list: (params?: { status?: string; range?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.range) q.set('range', params.range)
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get(`/subtitle-erase${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get(`/subtitle-erase/${id}`),
  downloadUrl: (id: number) => `/api/v1/subtitle-erase/${id}/download`,
  create: (form: FormData, opts?: { onProgress?: (percent: number) => void }) =>
    uploadForm('/subtitle-erase', form, opts),
}

export const canvasAPI = {
  list: () => api.get<{ items: any[] }>('/canvas/boards'),
  dramasWithoutBoard: () => api.get<{ items: any[] }>('/canvas/dramas-without-board'),
  create: (data: { drama_id: number; title?: string }) => api.post('/canvas/boards', data),
  get: (id: number) => api.get(`/canvas/boards/${id}`),
  byDrama: (dramaId: number) => api.get(`/canvas/boards/by-drama/${dramaId}`),
  patch: (id: number, data: Record<string, unknown>) => api.patch(`/canvas/boards/${id}`, data),
  del: (id: number) => api.del(`/canvas/boards/${id}`),
  pool: (id: number, episodeId?: number | null) => {
    const q = episodeId != null ? `?episode_id=${episodeId}` : ''
    return api.get(`/canvas/boards/${id}/pool${q}`)
  },
  studio: (id: number) => api.get(`/canvas/boards/${id}/studio`),
  saveLayout: (id: number, data: Record<string, unknown>) => api.put(`/canvas/boards/${id}/layout`, data),
  importNodes: (id: number, refs: Array<{ ref_type: string; ref_id: number; x?: number; y?: number }>) =>
    api.post(`/canvas/boards/${id}/nodes/import`, { refs }),
  sync: (id: number, opts?: { revive_removed?: boolean }) =>
    api.post(`/canvas/boards/${id}/sync`, opts || {}),
  addNote: (id: number, data?: { text?: string; x?: number; y?: number }) =>
    api.post(`/canvas/boards/${id}/nodes/note`, data || {}),
  removeNode: (id: number, nodeKey: string) => api.del(`/canvas/boards/${id}/nodes/${encodeURIComponent(nodeKey)}`),
}

export const directorDeskAPI = {
  getScene: (instanceId: string) =>
    api.get<{ scene: any | null }>(`/director-desk/scenes?instance_id=${encodeURIComponent(instanceId)}`),
  saveScene: (instanceId: string, data: {
    state: unknown
    drama_id?: number | null
    episode_id?: number | null
    storyboard_id?: number | null
  }) => api.put(`/director-desk/scenes/${encodeURIComponent(instanceId)}`, data),
  deleteScene: (instanceId: string) =>
    api.del(`/director-desk/scenes/${encodeURIComponent(instanceId)}`),
}

export const narrationAPI = {
  list: () => api.get('/narration'),
  get: (id: number) => api.get(`/narration/${id}`),
  create: (opts: { title?: string; novel_text?: string; file?: File }) => {
    if (opts.file) {
      const form = new FormData()
      form.append('file', opts.file)
      if (opts.title?.trim()) form.append('title', opts.title.trim())
      return uploadForm('/narration', form)
    }
    return api.post('/narration', {
      title: opts.title,
      novel_text: opts.novel_text,
    })
  },
  patch: (id: number, data: Record<string, unknown>) => api.patch(`/narration/${id}`, data),
  segment: (id: number) => api.post(`/narration/${id}/segment`),
  extract: (id: number) => api.post(`/narration/${id}/extract`),
  patchAnalysis: (id: number, analysis: Record<string, unknown>) =>
    api.patch(`/narration/${id}/analysis`, { analysis }),
  tts: (id: number) => api.post(`/narration/${id}/tts`),
  autoVoices: (id: number, data: { force?: boolean } = {}) =>
    api.post(`/narration/${id}/auto-voices`, data),
  previewVoice: (id: number, data: { voice_id: string; text?: string }) =>
    api.post(`/narration/${id}/preview-voice`, data),
  resplitSegments: (id: number) => api.post(`/narration/${id}/resplit-segments`),
  replaceNovel: (id: number, novel_text: string) =>
    api.post(`/narration/${id}/replace-novel`, { novel_text }),
  listVoices: () => api.get('/narration/voices'),
  grokChannels: () => api.get('/narration/grok-channels'),
  assetReadiness: (id: number) => api.get(`/narration/${id}/asset-readiness`),
  generateAllAssets: (id: number) => api.post(`/narration/${id}/assets/generate-all`),
  generateAsset: (id: number, type: 'characters' | 'scenes' | 'props', entityId: string) =>
    api.post(`/narration/${id}/assets/${type}/${entityId}/generate`),
  patchSegment: (id: number, segmentId: number, data: { text?: string; video_prompt?: string }) =>
    api.patch(`/narration/${id}/segments/${segmentId}`, data),
  generateSegment: (id: number, segmentId: number) =>
    api.post(`/narration/${id}/segments/${segmentId}/generate`),
  generateAll: (id: number) => api.post(`/narration/${id}/generate-all`),
  exportJianying: (id: number) => api.post(`/narration/${id}/export-jianying`),
  delete: (id: number) => api.del(`/narration/${id}`),
}

export const jimengSessionAPI = {
  list: () => api.get('/jimeng/sessions'),
  get: () => api.get('/jimeng/session'),
  save: (d: { id?: string; cookie?: string; session_id?: string; label?: string; set_active?: boolean }) => api.put('/jimeng/session', d),
  setActive: (id: string) => api.put(`/jimeng/session/${id}/active`),
  setForce: (id: string) => api.put(`/jimeng/session/${id}/force`),
  clearForce: () => api.del('/jimeng/force-session'),
  remove: (id: string) => api.del(`/jimeng/session/${id}`),
  clear: () => api.del('/jimeng/session'),
  validate: (id?: string) => api.post(id ? `/jimeng/session/${id}/validate` : '/jimeng/session/validate'),
  accessSettings: () => api.get<{
    enabled: boolean
    default_success_rate: number
    teams: { team_id: number; team_name: string; success_rate: number }[]
    available_teams: { id: number; name: string }[]
  }>('/jimeng/access-settings'),
  saveAccessSettings: (d: {
    enabled?: boolean
    default_success_rate?: number
    teams?: { team_id: number; success_rate: number }[]
  }) => api.put('/jimeng/access-settings', d),
}
export const xyqSessionAPI = {
  list: () => api.get('/xyq/sessions'),
  get: () => api.get('/xyq/session'),
  save: (d: {
    id?: string
    access_key?: string
    api_key?: string
    cookie?: string | null
    label?: string
    set_active?: boolean
  }) => api.put('/xyq/session', d),
  setActive: (id: string) => api.put(`/xyq/session/${id}/active`),
  remove: (id: string) => api.del(`/xyq/session/${id}`),
  clear: () => api.del('/xyq/session'),
  validate: (id?: string) => api.post(id ? `/xyq/session/${id}/validate` : '/xyq/session/validate'),
}
export const cozeSessionAPI = {
  list: () => api.get('/coze/sessions'),
  get: () => api.get('/coze/session'),
  save: (d: {
    id?: string
    cookie?: string | null
    api_key?: string
    pat?: string
    base_url?: string | null
    label?: string
    set_active?: boolean
  }) => api.put('/coze/session', d),
  setActive: (id: string) => api.put(`/coze/session/${id}/active`),
  remove: (id: string) => api.del(`/coze/session/${id}`),
  clear: () => api.del('/coze/session'),
  validate: (id?: string) => api.post(id ? `/coze/session/${id}/validate` : '/coze/session/validate'),
}
export const funshionSessionAPI = {
  list: () => api.get('/funshion/sessions'),
  get: () => api.get('/funshion/session'),
  save: (d: {
    id?: string
    token?: string
    authorization?: string
    base_url?: string | null
    project_id?: string | null
    app_id?: string | null
    label?: string
    set_active?: boolean
  }) => api.put('/funshion/session', d),
  setActive: (id: string) => api.put(`/funshion/session/${id}/active`),
  remove: (id: string) => api.del(`/funshion/session/${id}`),
  clear: () => api.del('/funshion/session'),
  validate: (id?: string) => api.post(id ? `/funshion/session/${id}/validate` : '/funshion/session/validate'),
}
export const xingyuemengSessionAPI = {
  list: () => api.get('/xingyuemeng/sessions'),
  get: () => api.get('/xingyuemeng/session'),
  save: (d: {
    id?: string
    token?: string
    label?: string
    team_id?: string | null
    project_id?: string | null
    episode_id?: string | null
    set_active?: boolean
  }) => api.put('/xingyuemeng/session', d),
  setActive: (id: string) => api.put(`/xingyuemeng/session/${id}/active`),
  remove: (id: string) => api.del(`/xingyuemeng/session/${id}`),
  clear: () => api.del('/xingyuemeng/session'),
  validate: (id?: string) => api.post(id ? `/xingyuemeng/session/${id}/validate` : '/xingyuemeng/session/validate'),
}
export const doubaoTrainingSessionAPI = {
  list: () => api.get('/doubao-training/sessions'),
  save: (d: { id?: string; cookie?: string; session_id?: string; label?: string; set_active?: boolean }) => api.put('/doubao-training/session', d),
  setActive: (id: string) => api.put(`/doubao-training/session/${id}/active`),
  remove: (id: string) => api.del(`/doubao-training/session/${id}`),
  clear: () => api.del('/doubao-training/session'),
  validate: (id?: string) => api.post(id ? `/doubao-training/session/${id}/validate` : '/doubao-training/session/validate'),
}
export const composeAPI = {
  shot: (id: number) => api.post(`/compose/storyboards/${id}/compose`),
  all: (epId: number) => api.post(`/compose/episodes/${epId}/compose-all`),
  status: (epId: number) => api.get(`/compose/episodes/${epId}/compose-status`),
}
export const mergeAPI = {
  merge: (epId: number) => api.post(`/merge/episodes/${epId}/merge`),
  status: (epId: number) => api.get(`/merge/episodes/${epId}/merge`),
}
export const aiConfigAPI = {
  list: (t?: string) => api.get(`/ai-configs${t ? `?service_type=${t}` : ''}`),
  create: (d: any) => api.post('/ai-configs', d),
  update: (id: number, d: any) => api.put(`/ai-configs/${id}`, d),
  del: (id: number) => api.del(`/ai-configs/${id}`),
  test: (d: any) => api.post('/ai-configs/test', d),
  aistarslabConfig: (params: { api_key: string; base_url?: string }) => {
    const query = new URLSearchParams({ api_key: params.api_key })
    if (params.base_url) query.set('base_url', params.base_url)
    return api.get(`/ai-configs/aistarslab-config?${query.toString()}`)
  },
  chengmengConfig: (params: { api_key: string; base_url?: string }) => {
    const query = new URLSearchParams({ api_key: params.api_key })
    if (params.base_url) query.set('base_url', params.base_url)
    return api.get(`/ai-configs/chengmeng-config?${query.toString()}`)
  },
  chengmengBalance: (params?: { page_size?: number; light?: boolean }) => {
    const query = new URLSearchParams()
    if (params?.page_size) query.set('page_size', String(params.page_size))
    if (params?.light) query.set('light', '1')
    const qs = query.toString()
    return api.get(`/ai-configs/chengmeng-balance${qs ? `?${qs}` : ''}`)
  },
  aistarslabBalance: (params?: { limit?: number; light?: boolean }) => {
    const query = new URLSearchParams()
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.light) query.set('light', '1')
    const qs = query.toString()
    return api.get(`/ai-configs/aistarslab-balance${qs ? `?${qs}` : ''}`)
  },
  aigcccBalance: (params?: { limit?: number }) => {
    const query = new URLSearchParams()
    if (params?.limit) query.set('limit', String(params.limit))
    const qs = query.toString()
    return api.get(`/ai-configs/aigccc-balance${qs ? `?${qs}` : ''}`)
  },
  officialBalance: (params?: { limit?: number; page?: number; page_size?: number; page_num?: number; light?: boolean }) => {
    const query = new URLSearchParams()
    const limit = params?.limit ?? params?.page_size
    const page = params?.page ?? params?.page_num
    if (limit) query.set('limit', String(limit))
    if (page) query.set('page', String(page))
    if (params?.light) query.set('light', '1')
    const qs = query.toString()
    return api.get(`/ai-configs/official-balance${qs ? `?${qs}` : ''}`)
  },
  officialPnl: (params?: {
    days?: number
    limit?: number
    offset?: number
    sort?: string
    backfill?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.days) query.set('days', String(params.days))
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.offset) query.set('offset', String(params.offset))
    if (params?.sort) query.set('sort', params.sort)
    if (params?.backfill) query.set('backfill', String(params.backfill))
    const qs = query.toString()
    return api.get(`/ai-configs/official-pnl${qs ? `?${qs}` : ''}`)
  },
  officialBillSyncStatus: () => api.get('/ai-configs/official-bill-sync'),
  officialBillSyncRun: (d?: { batch_size?: number; reset_cursor?: boolean }) =>
    api.post('/ai-configs/official-bill-sync/run', d || {}),
  officialKeyCreate: (d: {
    name?: string
    api_key: string
    access_key?: string
    secret_key?: string
    activate?: boolean
  }) => api.post('/ai-configs/official-keys', d),
  officialKeyUpdate: (id: number, d: {
    name?: string
    api_key?: string
    access_key?: string
    secret_key?: string
    clear_secret?: boolean
  }) => api.put(`/ai-configs/official-keys/${id}`, d),
  officialKeyActivate: (id: number) => api.put(`/ai-configs/official-keys/${id}/active`),
  officialKeyDelete: (id: number) => api.del(`/ai-configs/official-keys/${id}`),
  officialKeySyncEnv: () => api.post('/ai-configs/official-keys/sync-env', {}),
  huobaoPreset: (apiKey: string) => api.post('/ai-configs/huobao-preset', { api_key: apiKey }),
}

export const agentConfigAPI = {
  list: () => api.get('/agent-configs'),
  get: (id: number) => api.get(`/agent-configs/${id}`),
  create: (d: any) => api.post('/agent-configs', d),
  update: (id: number, d: any) => api.put(`/agent-configs/${id}`, d),
  del: (id: number) => api.del(`/agent-configs/${id}`),
}

export const skillsAPI = {
  list: () => api.get('/skills'),
  get: (id: string) => api.get(`/skills/${id}`),
  create: (data: { id: string; name: string; description?: string }) => api.post('/skills', data),
  update: (id: string, content: string) => api.put(`/skills/${id}`, { content }),
  del: (id: string) => api.del(`/skills/${id}`),
}

export const voicesAPI = {
  list: (provider?: string) => api.get(`/ai-voices${provider ? `?provider=${provider}` : ''}`),
  sync: () => api.post('/ai-voices/sync', {}),
}

export const authAPI = {
  login: (username: string, password: string) => api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
}

export const usersAPI = {
  list: () => api.get<{ items: any[] }>('/users'),
  create: (data: { username: string; password: string; display_name?: string; role?: string; allowed_ips?: string[] | string }) => api.post('/users', data),
  update: (id: number, data: any) => api.put(`/users/${id}`, data),
  bulkLoginIps: (data: {
    team_id: number
    allowed_ips: string[] | string
    mode?: 'set' | 'merge'
    also_set_team?: boolean
  }) => api.post('/users/bulk-login-ips', data),
}

export const teamsAPI = {
  list: () => api.get<{ items: import('~/composables/useTeam').TeamSummary[]; active_team_id: number | null }>('/teams'),
  directory: () => api.get<{ items: { id: number; name: string }[] }>('/teams/directory'),
  create: (name: string) => api.post<{ id: number; name: string; role: string }>('/teams', { name }),
  update: (teamId: number, data: { name: string }) => api.put(`/teams/${teamId}`, data),
  getLoginIps: (teamId: number) => api.get<{ team_id: number; team_name: string; allowed_ips: string[] }>(`/teams/${teamId}/login-ips`),
  setLoginIps: (teamId: number, allowed_ips: string[] | string) => api.put(`/teams/${teamId}/login-ips`, { allowed_ips }),
  members: (teamId: number) => api.get<{ items: any[] }>(`/teams/${teamId}/members`),
  addMember: (teamId: number, data: { username: string; role?: string }) => api.post(`/teams/${teamId}/members`, data),
  updateMember: (teamId: number, userId: number, role: string) => api.put(`/teams/${teamId}/members/${userId}`, { role }),
  removeMember: (teamId: number, userId: number) => api.del(`/teams/${teamId}/members/${userId}`),
  stats: (teamId: number, params?: { date_from?: string; date_to?: string; user_id?: number }) => {
    const q = new URLSearchParams()
    if (params?.date_from) q.set('date_from', params.date_from)
    if (params?.date_to) q.set('date_to', params.date_to)
    if (params?.user_id) q.set('user_id', String(params.user_id))
    const qs = q.toString()
    return api.get(`/teams/${teamId}/stats${qs ? `?${qs}` : ''}`)
  },
}

export const paymentsAPI = {
  config: () => api.get<{
    wechat_enabled: boolean
    alipay_enabled?: boolean
    recharge_enabled?: boolean
    mch_id?: string
    notify_url?: string
    missing?: string[]
  }>('/payments/config'),
  packages: () => api.get<{ credits_per_yuan: number; items: any[] }>('/payments/packages'),
  createWechatOrder: (data: { package_id: string }) => api.post<any>('/payments/wechat/orders', data),
  createAlipayOrder: (data: { package_id: string }) => api.post<any>('/payments/alipay/orders', data),
  getOrder: (id: number) => api.get<any>(`/payments/orders/${id}`),
}

export const creditsAPI = {
  balance: () => api.get<{ balance: number }>('/credits/balance'),
  transactions: (params?: { all?: boolean; team?: boolean; team_id?: number; user_id?: number; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.all) q.set('all', '1')
    if (params?.team) q.set('team', '1')
    if (params?.team_id) q.set('team_id', String(params.team_id))
    if (params?.user_id) q.set('user_id', String(params.user_id))
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get<{ items: any[]; total: number; scope?: string }>(`/credits/transactions${qs ? `?${qs}` : ''}`)
  },
  pricing: () => api.get<{ items: any[]; aistarslab_channel_enabled?: Record<string, boolean>; chengmeng_model_enabled?: Record<string, boolean> }>('/credits/pricing'),
  updatePricing: (action: string, data: { cost: number; label?: string; description?: string }) =>
    api.put(`/credits/pricing/${encodeURIComponent(action)}`, data),
  setAistarslabChannelEnabled: (channel: string, enabled: boolean) =>
    api.put(`/credits/aistarslab-channels/${encodeURIComponent(channel)}/enabled`, { enabled }),
  setChengmengModelEnabled: (modelId: string, enabled: boolean) =>
    api.put(`/credits/chengmeng-models/${encodeURIComponent(modelId)}/enabled`, { enabled }),
  grant: (data: { user_id: number; amount: number; summary?: string }) =>
    api.post('/credits/grant', data),
}

export const activityAPI = {
  list: (params?: { all?: boolean; team?: boolean; team_id?: number; user_id?: number; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.all) q.set('all', '1')
    if (params?.team) q.set('team', '1')
    if (params?.team_id) q.set('team_id', String(params.team_id))
    if (params?.user_id) q.set('user_id', String(params.user_id))
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get<{ items: any[]; total: number; scope?: string }>(`/activity-logs${qs ? `?${qs}` : ''}`)
  },
}

export const generationLogsAPI = {
  list: (params?: {
    all?: boolean
    team?: boolean
    team_id?: number
    user_id?: number
    kind?: 'all' | 'image' | 'video'
    status?: string
    keyword?: string
    limit?: number
    offset?: number
  }) => {
    const q = new URLSearchParams()
    if (params?.all) q.set('all', '1')
    if (params?.team) q.set('team', '1')
    if (params?.team_id) q.set('team_id', String(params.team_id))
    if (params?.user_id) q.set('user_id', String(params.user_id))
    if (params?.kind && params.kind !== 'all') q.set('kind', params.kind)
    if (params?.status && params.status !== 'all') q.set('status', params.status)
    if (params?.keyword) q.set('keyword', params.keyword)
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get<{
      items: any[]
      stats?: Record<string, number>
      pagination?: { limit: number; offset: number; total: number; has_more: boolean }
      scope?: string
    }>(`/generation-logs${qs ? `?${qs}` : ''}`)
  },
}

export const ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录',
  'drama.create': '创建项目',
  'drama.update': '更新项目',
  'drama.delete': '删除项目',
  'team.create': '创建团队',
  'team.update': '更新团队',
  'team.member.add': '添加团队成员',
  'team.member.remove': '移除团队成员',
  'drama.share': '共享项目',
  'drama.unshare': '取消共享',
  'agent.run': '运行 Agent',
  'character.image': '生成角色图',
  'character.image.batch': '批量生成角色图',
  'character.image.transform': '角色风格转换',
  'character.image.outfit': '角色换装',
  'character.voice_sample': '音色试听',
  'character.image.upload': '上传角色图',
  'scene.image': '生成场景图',
  'scene.image.upload': '上传场景图',
  'scene.image.angle': '场景多角度',
  'scene.image.angle.batch': '场景全部角度',
  'scene.image.angle.sheet': '场景多视角拼板',
  'storyboard.tts': '镜头配音',
  'storyboard.blocking': '场景站位图',
  'image.generate': '生成镜头图',
  'video.generate': '生成视频',
  'video.generate.seedance2': '官方 Seedance 2.0 视频',
  'video.generate.seedance2_fast': '官方 Seedance 2.0 Fast 视频',
  'video.generate.chengmeng': '橙盟 9图过人脸视频',
  'video.generate.chengmeng_seedance2': '橙盟 Seedance 2.0 标准版',
  'grid.generate': '生成宫格图',
  'grid.prompt': '宫格提示词',
  'assistant.chat': '制作助手',
  'portrait.sync': 'Seedance 资产同步',
  'credits.grant': '积分充值',
  'payment.wechat': '微信充值',
  'payment.alipay': '支付宝充值',
  'credits.pricing.update': '更新积分定价',
  'settings.ai_config.create': '新增 AI 配置',
  'settings.ai_config.update': '更新 AI 配置',
  'settings.ai_config.delete': '删除 AI 配置',
  'settings.huobao_preset': '影光工场一键配置',
  'settings.agent_config.save': '保存 Agent 配置',
  'user.create': '创建用户',
  'user.update': '更新用户',
}
