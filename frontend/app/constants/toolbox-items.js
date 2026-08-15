/** 顶部「工具箱」下拉菜单项 */
export function buildToolboxNavItems(opts = {}) {
  const items = [
    {
      to: '/auto-produce',
      label: '一键出片',
    },
    {
      to: '/tts/runninghub',
      label: '旁白配音',
    },
    {
      to: '/tts/runninghub-ref',
      label: '旁白配音(参考音色)',
    },
    {
      to: '/music',
      label: '背景音乐生成',
    },
    {
      to: '/video-upscale',
      label: '视频超分',
    },
    {
      to: '/subtitle-erase',
      label: '去字幕',
    },
    {
      to: '/narration',
      label: '解说工作流',
    },
    {
      to: '/director',
      label: '3D 导演台',
    },
  ]
  if (opts.isAdmin) {
    items.push({
      to: '/videos/repaint',
      label: '视频转绘(管理员)',
      adminOnly: true,
    })
  }
  return items
}
