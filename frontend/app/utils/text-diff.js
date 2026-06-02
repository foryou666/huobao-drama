/**
 * 轻量文本 diff：行级对齐 + 变更行内字符级着色
 */

function lcsOps(a, b, eq = (x, y) => x === y) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = eq(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      ops.push({ type: 'same', value: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', value: a[i] })
      i += 1
    } else {
      ops.push({ type: 'add', value: b[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'remove', value: a[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'add', value: b[j] })
    j += 1
  }
  return ops
}

export function diffChars(oldText, newText) {
  const oldChars = [...String(oldText ?? '')]
  const newChars = [...String(newText ?? '')]
  if (oldChars.length * newChars.length > 1_500_000) {
    return [
      { type: 'remove', value: String(oldText ?? '') },
      { type: 'add', value: String(newText ?? '') },
    ]
  }
  return lcsOps(oldChars, newChars)
}

export function diffLines(oldText, newText) {
  const oldLines = String(oldText ?? '').split('\n')
  const newLines = String(newText ?? '').split('\n')
  return lcsOps(oldLines, newLines)
}

/** 左右并排：左旧右新 */
export function buildSideBySideDiff(oldText, newText) {
  const raw = diffLines(oldText, newText)
  const rows = []
  for (let i = 0; i < raw.length; i += 1) {
    const op = raw[i]
    if (op.type === 'same') {
      rows.push({ type: 'same', before: op.value, after: op.value })
      continue
    }
    if (op.type === 'remove' && raw[i + 1]?.type === 'add') {
      const charOps = diffChars(op.value, raw[i + 1].value)
      rows.push({
        type: 'change',
        before: op.value,
        after: raw[i + 1].value,
        beforeParts: charOps.filter(p => p.type !== 'add'),
        afterParts: charOps.filter(p => p.type !== 'remove'),
      })
      i += 1
      continue
    }
    if (op.type === 'remove') {
      rows.push({ type: 'remove', before: op.value, after: '' })
      continue
    }
    rows.push({ type: 'add', before: '', after: op.value })
  }
  return rows
}

export function countDiffStats(oldText, newText) {
  const rows = buildSideBySideDiff(oldText, newText)
  let added = 0
  let removed = 0
  let changed = 0
  for (const row of rows) {
    if (row.type === 'add') added += 1
    else if (row.type === 'remove') removed += 1
    else if (row.type === 'change') changed += 1
  }
  return { added, removed, changed, total: rows.length }
}
