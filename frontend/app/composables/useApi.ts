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
  del: <T = any>(p: string) => req<T>('DELETE', p),
}

export const mediaAPI = {
  resolveUrls: (paths: string[]) => api.post<{ urls: Record<string, string> }>('/media/resolve-urls', { paths }),
  resolveUrl: (path: string) => api.get<{ path: string; url: string }>(`/media/url?path=${encodeURIComponent(path)}`),
}

export const dramaAPI = {
  list: (opts?: { includeArchived?: boolean }) =>
    api.get<{ items: any[] }>(`/dramas${opts?.includeArchived ? '?include_archived=1' : ''}`),
  get: (id: number) => api.get(`/dramas/${id}`),
  create: (data: any) => api.post('/dramas', data),
  update: (id: number, data: any) => api.put(`/dramas/${id}`, data),
  del: (id: number) => api.del(`/dramas/${id}`),
  archive: (id: number) => api.post(`/dramas/${id}/archive`),
  restore: (id: number) => api.post(`/dramas/${id}/restore`),
  shares: (id: number) => api.get(`/dramas/${id}/shares`),
  addShare: (id: number, teamId: number) => api.post(`/dramas/${id}/shares`, { team_id: teamId }),
  removeShare: (id: number, teamId: number) => api.del(`/dramas/${id}/shares/${teamId}`),
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

async function uploadForm(path: string, form: FormData) {
  const headers: Record<string, string> = {}
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = String(teamId)
  const resp = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: form })
  const json = await resp.json()
  if (!resp.ok || (json.code && json.code >= 400)) {
    if (resp.status === 401) {
      clearAuthSession()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    throw new Error(json.message || `${resp.status}`)
  }
  return json.data ?? json
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
  syncAsset: (id: number, opts?: { force?: boolean }) =>
    api.post(`/portraits/characters/${id}/sync-asset`, opts || {}),
  assetStatus: (id: number) => api.get(`/portraits/characters/${id}/asset-status`),
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
  list: (params?: { drama_id?: number; type?: string; q?: string }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.type) query.set('type', params.type)
    if (params?.q) query.set('q', params.q)
    return api.get(`/assets${query.size ? `?${query.toString()}` : ''}`)
  },
  create: (data: any) => api.post('/assets', data),
  update: (id: number, data: any) => api.put(`/assets/${id}`, data),
  del: (id: number) => api.del(`/assets/${id}`),
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
    return api.get(`/images/ledger${query.size ? `?${query.toString()}` : ''}`)
  },
}
export const gridAPI = {
  prompt: (d: any) => api.post('/grid/prompt', d),
  generate: (d: any) => api.post('/grid/generate', d),
  status: (id: number) => api.get(`/grid/status/${id}`),
  split: (d: any) => api.post('/grid/split', d),
}
export const videoAPI = {
  generate: (d: any) => api.post('/videos', d),
  get: (id: number) => api.get(`/videos/${id}`),
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
    return api.get(`/videos/ledger${query.size ? `?${query.toString()}` : ''}`)
  },
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
  create: (data: { username: string; password: string; display_name?: string; role?: string }) => api.post('/users', data),
  update: (id: number, data: any) => api.put(`/users/${id}`, data),
}

export const teamsAPI = {
  list: () => api.get<{ items: import('~/composables/useTeam').TeamSummary[]; active_team_id: number | null }>('/teams'),
  directory: () => api.get<{ items: { id: number; name: string }[] }>('/teams/directory'),
  create: (name: string) => api.post<{ id: number; name: string; role: string }>('/teams', { name }),
  update: (teamId: number, data: { name: string }) => api.put(`/teams/${teamId}`, data),
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
  pricing: () => api.get<{ items: any[] }>('/credits/pricing'),
  updatePricing: (action: string, data: { cost: number; label?: string; description?: string }) =>
    api.put(`/credits/pricing/${encodeURIComponent(action)}`, data),
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
  'video.generate.chengmeng': '橙盟 9图过人脸视频',
  'grid.generate': '生成宫格图',
  'grid.prompt': '宫格提示词',
  'assistant.chat': '制作助手',
  'portrait.sync': 'Seedance 资产同步',
  'credits.grant': '积分充值',
  'credits.pricing.update': '更新积分定价',
  'settings.ai_config.create': '新增 AI 配置',
  'settings.ai_config.update': '更新 AI 配置',
  'settings.ai_config.delete': '删除 AI 配置',
  'settings.huobao_preset': '红果一键配置',
  'settings.agent_config.save': '保存 Agent 配置',
  'user.create': '创建用户',
  'user.update': '更新用户',
}
