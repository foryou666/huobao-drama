import {
  setDirectorDeskHostStateListener,
  useDirectorStore,
  type DirectorState,
} from "../store/directorStore";

interface HostPanoramaPayload {
  edgeId?: unknown;
  sourceNodeId?: unknown;
  imageUrl?: unknown;
  fileName?: unknown;
}

interface HostSessionPayload {
  instanceId?: unknown;
  theme?: unknown;
}

interface HostBlockingLayoutPayload {
  characters?: unknown;
  notes?: unknown;
  force?: unknown;
}

interface HostLoadStatePayload {
  state?: unknown;
}

export interface HostCaptureItemPayload {
  dataUrl?: unknown;
  fileName?: unknown;
}

export interface HostCaptureBatchPayload {
  captures?: HostCaptureItemPayload[];
}

interface HostConnectedPanorama {
  edgeId: string;
  sourceNodeId: string;
}

let initialized = false;
let hostConnectedPanorama: HostConnectedPanorama | null = null;
let removeUnsubscribe: (() => void) | null = null;
let suppressNextPanoramaRemovalNotice = false;
/** 宿主下发服务端快照时，避免立刻回推触发无意义 PUT */
let suppressHostStateNotify = false;

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getHostOrigin() {
  return window.location.origin;
}

function normalizeTheme(value: unknown): "dark" | "light" | null {
  return value === "light" || value === "dark" ? value : null;
}

function applyDirectorDeskTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getInitialHostTheme() {
  try {
    return normalizeTheme(new URLSearchParams(window.location.search).get("theme"));
  } catch {
    return null;
  }
}

function notifyPanoramaRemoved() {
  if (!hostConnectedPanorama) {
    return;
  }

  window.parent?.postMessage(
    {
      type: "storyai:director-desk-panorama-removed",
      payload: hostConnectedPanorama,
    },
    getHostOrigin()
  );
  hostConnectedPanorama = null;
}

function subscribeToPanoramaRemoval() {
  if (removeUnsubscribe) {
    return;
  }

  let previousPanoramaAssetId = useDirectorStore.getState().project.panoramaAssetId;
  removeUnsubscribe = useDirectorStore.subscribe((state) => {
    const nextPanoramaAssetId = state.project.panoramaAssetId;

    if (previousPanoramaAssetId && !nextPanoramaAssetId) {
      if (suppressNextPanoramaRemovalNotice) {
        suppressNextPanoramaRemovalNotice = false;
        hostConnectedPanorama = null;
      } else {
        notifyPanoramaRemoved();
      }
    }

    previousPanoramaAssetId = nextPanoramaAssetId;
  });
}

function importHostBlockingLayout(payload: HostBlockingLayoutPayload) {
  useDirectorStore.getState().importHostBlockingLayout({
    characters: payload.characters as import("./blockingLayoutImport").HostBlockingLayoutPayload["characters"],
    notes: normalizeString(payload.notes),
    force: payload.force === true,
  });
}

function importHostPanorama(payload: HostPanoramaPayload) {
  const imageUrl = normalizeString(payload.imageUrl);
  if (!imageUrl) {
    return;
  }

  const fileName = normalizeString(payload.fileName) || "画布全景图.png";
  const edgeId = normalizeString(payload.edgeId);
  const sourceNodeId = normalizeString(payload.sourceNodeId);

  hostConnectedPanorama = edgeId && sourceNodeId ? { edgeId, sourceNodeId } : null;
  useDirectorStore.getState().addImportedAsset({
    kind: "panorama",
    name: fileName,
    fileName,
    url: imageUrl,
    projectionMode: "backdrop",
  });
}

/** 用户在导演台内手动导入全景后通知宿主，避免异步场景同步覆盖 */
export function notifyHostUserPanoramaImported() {
  hostConnectedPanorama = null;
  window.parent?.postMessage(
    {
      type: "storyai:director-desk-panorama-user-imported",
      payload: {},
    },
    getHostOrigin()
  );
}

function openHostSession(payload: HostSessionPayload) {
  const instanceId = normalizeString(payload.instanceId);
  const theme = normalizeTheme(payload.theme);
  if (theme) {
    applyDirectorDeskTheme(theme);
  }
  suppressNextPanoramaRemovalNotice = Boolean(useDirectorStore.getState().project.panoramaAssetId);
  useDirectorStore.getState().openScopedScene(instanceId || null);
  suppressNextPanoramaRemovalNotice = false;
  hostConnectedPanorama = null;
}

function applyHostPersistedState(payload: HostLoadStatePayload) {
  const state = payload?.state;
  if (!state || typeof state !== "object") {
    return;
  }

  suppressNextPanoramaRemovalNotice = Boolean(useDirectorStore.getState().project.panoramaAssetId);
  suppressHostStateNotify = true;
  try {
    useDirectorStore.getState().hydrateFromPersistedState(state as DirectorState);
  } finally {
    suppressHostStateNotify = false;
    suppressNextPanoramaRemovalNotice = false;
  }
  hostConnectedPanorama = null;
}

export function postDirectorDeskCapturesToHost(
  captures: Array<{
    dataUrl: string;
    fileName?: string;
  }>
) {
  const normalizedCaptures = captures
    .map((capture, index) => {
      const dataUrl = normalizeString(capture.dataUrl);
      if (!dataUrl) {
        return null;
      }

      return {
        dataUrl,
        fileName: normalizeString(capture.fileName) || `director-desk-capture-${index + 1}.png`,
      };
    })
    .filter((capture): capture is { dataUrl: string; fileName: string } => Boolean(capture));

  if (normalizedCaptures.length === 0) {
    return;
  }

  window.parent?.postMessage(
    {
      type: "storyai:director-desk-captures-sent",
      payload: {
        captures: normalizedCaptures,
      },
    },
    getHostOrigin()
  );
}

function handleHostMessage(event: MessageEvent) {
  if (event.origin !== getHostOrigin()) {
    return;
  }

  if (event.data?.type === "storyai:director-desk-session") {
    openHostSession((event.data.payload || {}) as HostSessionPayload);
    return;
  }

  if (event.data?.type === "storyai:director-desk-load-state") {
    applyHostPersistedState((event.data.payload || {}) as HostLoadStatePayload);
    return;
  }

  if (event.data?.type === "storyai:director-desk-panorama") {
    importHostPanorama((event.data.payload || {}) as HostPanoramaPayload);
    return;
  }

  if (event.data?.type === "storyai:director-desk-blocking-layout") {
    importHostBlockingLayout((event.data.payload || {}) as HostBlockingLayoutPayload);
  }
}

export function initDirectorDeskHostBridge() {
  if (initialized) {
    return;
  }

  initialized = true;
  applyDirectorDeskTheme(getInitialHostTheme() ?? "dark");
  window.addEventListener("message", handleHostMessage);
  subscribeToPanoramaRemoval();
  setDirectorDeskHostStateListener((state) => {
    if (suppressHostStateNotify) {
      return;
    }
    window.parent?.postMessage(
      {
        type: "storyai:director-desk-state-changed",
        payload: { state },
      },
      getHostOrigin()
    );
  });
}

export function clearDirectorDeskHostBridge() {
  if (!initialized) {
    return;
  }

  initialized = false;
  hostConnectedPanorama = null;
  suppressNextPanoramaRemovalNotice = false;
  suppressHostStateNotify = false;
  setDirectorDeskHostStateListener(null);
  window.removeEventListener("message", handleHostMessage);
  removeUnsubscribe?.();
  removeUnsubscribe = null;
}
