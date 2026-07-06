/** 视频转绘工作流步骤（与后端 stage 字段对应） */
export const REPAINT_STAGES = [
  { id: 'analysis', label: '分析', desc: '切镜 · 台词 · 实体清单', checkpoint: 1 },
  { id: 'assets', label: '资产', desc: '角色三视图 · 场景 · 道具', checkpoint: 2 },
  { id: 'prompts', label: '分段', desc: 'Prompt 与 @图片 绑定', checkpoint: 3 },
  { id: 'generate', label: '生成', desc: 'Seedance 通道1 分段视频', checkpoint: 4 },
  { id: 'merge', label: '成片', desc: '拼接与下载', checkpoint: null },
]

export const REPAINT_STAGE_LABELS = Object.fromEntries(
  REPAINT_STAGES.map(item => [item.id, item.label]),
)

/** 后端 stage 值 → 步骤索引 */
export function repaintStageIndex(stage) {
  const order = ['upload', 'analysis', 'assets', 'prompts', 'generate', 'merge', 'completed']
  const idx = order.indexOf(String(stage || 'upload'))
  if (idx <= 0) return 0
  if (stage === 'completed') return REPAINT_STAGES.length - 1
  const mapped = REPAINT_STAGES.findIndex(item => item.id === stage)
  return mapped >= 0 ? mapped : 0
}

export function canEnterRepaintStage(currentStage, targetStageId) {
  const order = ['upload', 'analysis', 'assets', 'prompts', 'generate', 'merge', 'completed']
  const currentIdx = order.indexOf(String(currentStage || 'upload'))
  const targetIdx = order.indexOf(targetStageId === 'merge' && currentStage === 'completed' ? 'merge' : targetStageId)
  if (targetIdx < 0) return false
  return targetIdx <= Math.max(currentIdx, order.indexOf('analysis'))
}
