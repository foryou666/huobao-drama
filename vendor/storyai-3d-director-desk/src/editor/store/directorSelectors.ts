import type { RightPanelKind } from "../schema/directorProject";
import type { DirectorState } from "./directorStore";

export function selectRightPanelKind(state: DirectorState): RightPanelKind {
  if (state.selectedCrowdId) return "character";

  const selected = state.project.objects.find((item) => item.id === state.selectedObjectId);
  const selectedAsset = selected?.assetRefId
    ? state.project.assets.find((asset) => asset.id === selected.assetRefId)
    : undefined;

  // 选中角色/道具/机位时优先显示对应面板，避免「场景模式」挡住角色统一缩放
  if (selected?.kind === "character") return "character";
  if (selected?.kind === "prop" || selectedAsset?.sourceType === "model") return "prop";
  if (selected?.kind === "camera") return "camera";

  if (state.viewMode === "director" && state.directorInspectorMode === "scene") {
    return "scene";
  }

  if (state.viewMode === "camera") return "camera";
  return "scene";
}
