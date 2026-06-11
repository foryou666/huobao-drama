export function buildOutfitChangePrompt(charName: string, costumeName: string, customPrompt?: string | null): string {
  const layoutRules = [
    '严格以参考图1为基准：保持同一人物的五官、发型、年龄、体态、肤色与身份特征；',
    '面部表情改为自然、平静、无眼泪的正常神态，不得保留哭泣、流泪、红肿眼眶等悲伤表情；',
    '必须完整保留参考图1的画面构图与版式（如三视图、多视角拼板、特写+全身等），不得改成单张单人肖像；',
    '必须保持参考图1的画风与写实程度（若为真人摄影/写实立绘，输出也必须是同等写实，禁止变成插画/CG/动漫风）；',
    '参考图2仅提供目标服装的款式、颜色、面料与细节，将参考图1中破损、脏污、撕裂的旧服装完整替换为参考图2的整洁定稿服装；',
    '去除旧服装上的污渍、破洞、绳绑、束缚等临时状态；双手自然垂放或按角色站姿自然摆放；',
    '除服装与表情外，背景、光照、镜头角度、人物站姿与各视图布局均与参考图1一致。',
  ].join('')

  if (customPrompt?.trim()) {
    return `角色「${charName}」换装为「${costumeName}」。${customPrompt.trim()}。${layoutRules}`
  }

  return [
    `角色「${charName}」换装为「${costumeName}」。`,
    layoutRules,
  ].join('')
}

export function slugifyOutfitId(name: string, assetId?: number | null): string {
  const base = String(name || 'outfit')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .slice(0, 32) || 'outfit'
  return assetId ? `costume_${assetId}` : `${base}_${Date.now()}`
}
