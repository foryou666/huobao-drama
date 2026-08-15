/**
 * Host ↔ 3D导演台 iframe 通信（storyai-3d-director-desk hostBridge）
 * @see vendor/storyai-3d-director-desk/src/editor/io/hostBridge.ts
 */

export type DirectorDeskTheme = 'dark' | 'light'

export type DirectorDeskSessionPayload = {
  instanceId?: string
  theme?: DirectorDeskTheme
}

export type DirectorDeskPanoramaPayload = {
  edgeId?: string
  sourceNodeId?: string
  imageUrl?: string
  fileName?: string
}

export type DirectorDeskCaptureItem = {
  dataUrl: string
  fileName?: string
}

export type DirectorDeskBlockingCharacter = {
  characterId: number | string
  name: string
  zone?: string
  facing?: string
  color?: string
  position?: [number, number, number]
  rotationY?: number
}

export type DirectorDeskBlockingLayoutPayload = {
  characters?: DirectorDeskBlockingCharacter[]
  notes?: string
  force?: boolean
}

const MESSAGE_SESSION = 'storyai:director-desk-session'
const MESSAGE_LOAD_STATE = 'storyai:director-desk-load-state'
const MESSAGE_STATE_CHANGED = 'storyai:director-desk-state-changed'
const MESSAGE_PANORAMA = 'storyai:director-desk-panorama'
const MESSAGE_BLOCKING_LAYOUT = 'storyai:director-desk-blocking-layout'
const MESSAGE_CAPTURES = 'storyai:director-desk-captures-sent'
const MESSAGE_PANORAMA_REMOVED = 'storyai:director-desk-panorama-removed'
const MESSAGE_PANORAMA_USER_IMPORTED = 'storyai:director-desk-panorama-user-imported'
const MESSAGE_TOAST = 'storyai:director-desk-toast'
const MESSAGE_READY = 'storyai:director-desk-ready'
const MESSAGE_CLOSE = 'storyai:director-desk-close'

function hostOrigin() {
  if (typeof window === 'undefined') return '*'
  return window.location.origin
}

export function buildDirectorDeskInstanceId(opts?: {
  dramaId?: string | number | null
  episodeId?: string | number | null
  storyboardId?: string | number | null
}) {
  const parts = ['hg']
  if (opts?.dramaId) parts.push(`d${opts.dramaId}`)
  if (opts?.episodeId) parts.push(`e${opts.episodeId}`)
  if (opts?.storyboardId) parts.push(`s${opts.storyboardId}`)
  return parts.length > 1 ? parts.join(':') : 'hg:standalone'
}

export function directorDeskIframeSrc(theme: DirectorDeskTheme = 'dark') {
  const params = new URLSearchParams({ theme })
  return `/director-3d/index.html?${params.toString()}`
}

export function postDirectorDeskSession(
  iframe: HTMLIFrameElement | null | undefined,
  payload: DirectorDeskSessionPayload,
) {
  iframe?.contentWindow?.postMessage(
    { type: MESSAGE_SESSION, payload },
    hostOrigin(),
  )
}

export function postDirectorDeskLoadState(
  iframe: HTMLIFrameElement | null | undefined,
  state: unknown,
) {
  if (!state || typeof state !== 'object') return
  iframe?.contentWindow?.postMessage(
    { type: MESSAGE_LOAD_STATE, payload: { state } },
    hostOrigin(),
  )
}

export function postDirectorDeskPanorama(
  iframe: HTMLIFrameElement | null | undefined,
  payload: DirectorDeskPanoramaPayload,
) {
  iframe?.contentWindow?.postMessage(
    { type: MESSAGE_PANORAMA, payload },
    hostOrigin(),
  )
}

export function postDirectorDeskBlockingLayout(
  iframe: HTMLIFrameElement | null | undefined,
  payload: DirectorDeskBlockingLayoutPayload,
) {
  if (!payload?.characters?.length) return
  iframe?.contentWindow?.postMessage(
    { type: MESSAGE_BLOCKING_LAYOUT, payload },
    hostOrigin(),
  )
}

export type DirectorDeskHostHandlers = {
  onCaptures?: (captures: DirectorDeskCaptureItem[]) => void
  onPanoramaRemoved?: (payload: { edgeId: string; sourceNodeId: string }) => void
  onPanoramaUserImported?: () => void
  onToast?: (payload: { level?: string; message: string }) => void
  onStateChanged?: (state: unknown) => void
  onReady?: () => void
  onClose?: () => void
}

export function bindDirectorDeskHostListener(handlers: DirectorDeskHostHandlers) {
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== hostOrigin()) return
    const type = event.data?.type
    if (type === MESSAGE_READY) {
      handlers.onReady?.()
      return
    }
    if (type === MESSAGE_CLOSE) {
      handlers.onClose?.()
      return
    }
    if (type === MESSAGE_STATE_CHANGED) {
      const state = event.data?.payload?.state
      if (state && typeof state === 'object') {
        handlers.onStateChanged?.(state)
      }
      return
    }
    if (type === MESSAGE_CAPTURES) {
      const captures = event.data?.payload?.captures
      if (Array.isArray(captures) && captures.length) {
        handlers.onCaptures?.(captures)
      }
      return
    }
    if (type === MESSAGE_PANORAMA_USER_IMPORTED) {
      handlers.onPanoramaUserImported?.()
      return
    }
    if (type === MESSAGE_TOAST) {
      const message = String(event.data?.payload?.message || '').trim()
      if (message) {
        handlers.onToast?.({
          level: String(event.data?.payload?.level || ''),
          message,
        })
      }
      return
    }
    if (type === MESSAGE_PANORAMA_REMOVED) {
      const payload = event.data?.payload
      if (payload?.edgeId && payload?.sourceNodeId) {
        handlers.onPanoramaRemoved?.(payload)
      }
    }
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
