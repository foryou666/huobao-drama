export const ASSET_CATEGORIES = [
  { id: 'character', label: '人物资产' },
  { id: 'scene', label: '场景资产' },
  { id: 'costume', label: '服装资产' },
  { id: 'prop', label: '道具资产' },
  { id: 'reference', label: '参考图' },
  { id: 'voice', label: '音色库' },
] as const

export type AssetCategory = typeof ASSET_CATEGORIES[number]['id']

export function assetCategoryLabel(category?: string | null): string {
  return ASSET_CATEGORIES.find(item => item.id === category)?.label || category || '资产'
}

export function isAssetCategory(value?: string | null): value is AssetCategory {
  return ASSET_CATEGORIES.some(item => item.id === value)
}
