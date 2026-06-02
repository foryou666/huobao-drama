/**
 * 视频提示词构图校正：避免 Seedance 把参考图+特写描述理解成裁脸大特写。
 * 在发送 API 前对已有 prompt 做软修正，不修改 DB 原文。
 */

const FRAMING_SUFFIX =
  ', full face visible head and shoulders in frame no cropped forehead or chin, prefer MS MCU medium shot framing, avoid continuous ECU close-up except final hook shot'

const HOOK_HINT_RE = /钩子|瞳孔|闪白|flash white|强逆光|悬念|反转/i
const CLOSE_UP_CN_RE = /大特写|极特写|特写/g
const CLOSE_UP_EN_RE = /\bECU\b|\bCU\b(?![A-Za-z])|extreme close[-\s]?up/gi
const EXTREME_PUSH_CN_RE = /极速推镜/g
const EXTREME_PUSH_EN_RE = /extreme fast push-in(?: then stop)?/gi

function countCloseUpHits(text: string): number {
  const cn = text.match(CLOSE_UP_CN_RE)?.length ?? 0
  const en = text.match(CLOSE_UP_EN_RE)?.length ?? 0
  const push = (text.match(EXTREME_PUSH_CN_RE)?.length ?? 0) + (text.match(EXTREME_PUSH_EN_RE)?.length ?? 0)
  return cn + en + push
}

function splitIndustrialBlocks(text: string): { header: string; blocks: string[] } {
  const trimmed = String(text || '').trim()
  if (!trimmed.includes('【镜头')) {
    return { header: trimmed, blocks: [] }
  }
  const firstIdx = trimmed.search(/【镜头/)
  const header = trimmed.slice(0, firstIdx)
  const rest = trimmed.slice(firstIdx)
  const blocks = rest.match(/【镜头[\s\S]*?(?=【镜头|$)/g) || []
  return { header, blocks }
}

function isHookBlock(block: string, index: number, total: number): boolean {
  if (index === total - 1) return true
  if (index === total - 2 && HOOK_HINT_RE.test(block)) return true
  return HOOK_HINT_RE.test(block)
}

function softenBlock(block: string, hook: boolean): string {
  if (hook) return block

  let out = block
  out = out.replace(/景别与角度：大特写/g, '景别与角度：中近景')
  out = out.replace(/景别与角度：极特写/g, '景别与角度：中近景')
  out = out.replace(/景别与角度：特写/g, '景别与角度：中近景')
  out = out.replace(/景别与角度：近景/g, '景别与角度：中近景')
  out = out.replace(EXTREME_PUSH_CN_RE, '微推')
  out = out.replace(EXTREME_PUSH_EN_RE, 'slow push-in to medium close-up')
  out = out.replace(/\bECU\b/g, 'MCU')
  out = out.replace(/\bCU\b(?![A-Za-z])/g, 'MCU')
  out = out.replace(CLOSE_UP_CN_RE, '中近景')
  return out
}

function augmentAiLines(block: string, hook: boolean): string {
  return block.replace(/AI 补充提示词：([^\n]+)/g, (match, body: string) => {
    if (/full face|head and shoulders|face fully|no cropped/i.test(body)) return match
    const extra = hook
      ? ', full face visible, dynamic camera'
      : ', full face visible, head and shoulders in frame, MS or MCU framing, no cropped face'
    return `AI 补充提示词：${body.trimEnd()}${extra}`
  })
}

function injectFramingIntoHeader(header: string): string {
  if (/full face visible/i.test(header)) return header

  const lines = header.split('\n')
  const styleIdx = lines.findIndex(l => /9:16|真人实拍|AI historical|cinematic/i.test(l))
  if (styleIdx >= 0) {
    lines[styleIdx] = `${lines[styleIdx].replace(/\s*$/, '')}${FRAMING_SUFFIX}`
    return lines.join('\n')
  }

  if (header.trim()) {
    return `${header.replace(/\s*$/, '')}\n【构图约束】竖屏9:16，人物面部完整可见（含额头与下巴），默认中景MS/中近景MCU，禁止连续大特写裁脸；仅末段钩子镜可用ECU。${FRAMING_SUFFIX}`
  }
  return `【构图约束】竖屏9:16，面部完整入镜，默认MS/MCU。${FRAMING_SUFFIX}`
}

/** 对工业级或多段 prompt 做构图软修正，供 Seedance / 橙盟发送前调用 */
export function normalizeVideoPromptFraming(prompt: string): string {
  let text = String(prompt || '').trim()
  if (!text) return text

  const { header, blocks } = splitIndustrialBlocks(text)

  if (!blocks.length) {
    if (countCloseUpHits(text) >= 2) {
      text = text.replace(/景别与角度：(?:大特写|极特写|特写)/g, '景别与角度：中近景')
      text = text.replace(EXTREME_PUSH_CN_RE, '微推')
      text = text.replace(EXTREME_PUSH_EN_RE, 'slow push-in to medium close-up')
      text = text.replace(/\bECU\b/g, 'MCU')
      text = text.replace(/\bCU\b(?![A-Za-z])/g, 'MCU')
    }
    return injectFramingIntoHeader(text)
  }

  const closeUpDensity = countCloseUpHits(blocks.join('\n'))
  const shouldSoften = closeUpDensity >= 3 || blocks.filter(b => /特写|ECU|\bCU\b/i.test(b)).length >= Math.ceil(blocks.length * 0.5)

  const normalizedBlocks = blocks.map((block, i) => {
    const hook = isHookBlock(block, i, blocks.length)
    let next = shouldSoften ? softenBlock(block, hook) : block
    next = augmentAiLines(next, hook)
    return next
  })

  const normalizedHeader = injectFramingIntoHeader(header)
  return `${normalizedHeader}${normalizedBlocks.join('')}`.trim()
}
