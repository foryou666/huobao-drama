export const ASSET_CATEGORIES = [
  { id: 'character', label: '人物资产' },
  { id: 'scene', label: '场景资产' },
  { id: 'costume', label: '服装资产' },
  { id: 'prop', label: '道具资产' },
  { id: 'reference', label: '参考图' },
  { id: 'voice', label: '音色库' },
]

export function assetCategoryLabel(type) {
  return ASSET_CATEGORIES.find(item => item.id === type)?.label || type || '资产'
}
