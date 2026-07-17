/** 顶部「工具箱」下拉菜单项 */
export function buildToolboxNavItems(opts = {}) {
  const items = [
    {
      to: '/tts',
      label: 'AI 配音',
      refHint: '音色库参考 · 情绪控制 · IndexTTS2',
    },
    {
      to: '/narration',
      label: '解说工作流',
      refHint: '原文 TTS · 实体抽取 · Grok · 剪映',
    },
    {
      to: '/director',
      label: '3D 导演台',
      refHint: '站位预演 · 机位截图 · Blocking',
    },
  ]
  if (opts.isAdmin) {
    items.push({
      to: '/videos/repaint',
      label: '视频转绘',
      refHint: '原片分析 · 资产重绘 · 通道1 拼接',
    })
    items.push({
      to: '/subtitle-remover',
      label: '去字幕',
      refHint: '本机 VSR · 硬字幕/水印去除',
    })
  }
  return items
}
