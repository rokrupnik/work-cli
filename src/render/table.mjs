// Terminal-width-aware columns. No dependency and no cursor control: the output
// is plain lines, so it pipes, greps and redirects the same as it prints.
import { width, strip } from './color.mjs'

/**
 * Work out the column widths once, for every row that will be printed.
 *
 * Separating layout from rendering is what lets a grouped view stay aligned:
 * laying out each group on its own gives every group different column widths,
 * and the eye cannot compare down a column that moves.
 *
 * @param {object[]} rows
 * @param {{key: string, header: string, min?: number, max?: number, flex?: boolean, align?: 'left'|'right'}[]} columns
 * @param {{width?: number, gap?: number, indent?: string}} [options]
 */
export function layout(rows, columns, { width: total = 100, gap = 2, indent = '' } = {}) {
  const cols = columns.map((c) => ({ min: 3, max: Infinity, flex: false, priority: 0, align: 'left', ...c }))
  const widths = cols.map((c) =>
    Math.min(c.max, Math.max(width(c.header), ...rows.map((r) => width(r[c.key] ?? '')), c.min)),
  )

  const budget = total - indent.length
  let over = widths.reduce((a, b) => a + b, 0) + gap * (cols.length - 1) - budget

  // Shrink the flexible columns — TITLE, in practice — before anything else, and
  // never below their minimum. A truncated id is useless; a truncated title is
  // still a title.
  if (over > 0) {
    // `priority` decides what gives way first: the lowest goes first, so a long
    // dependency list is clipped before the title is.
    const flex = cols
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.flex)
      .sort((a, b) => (a.c.priority ?? 0) - (b.c.priority ?? 0))
    for (const { c, i } of flex) {
      if (over <= 0) break
      const take = Math.min(widths[i] - c.min, over)
      widths[i] -= take
      over -= take
    }
  }

  const line = (cells) =>
    indent +
    cells
      .map((cell, i) => pad(fit(cell, widths[i]), widths[i], cols[i].align))
      .join(' '.repeat(gap))
      .replace(/\s+$/, '')

  return {
    cols,
    widths,
    header: () => line(cols.map((c) => c.header)),
    row: (r) => line(cols.map((c) => r[c.key] ?? '')),
  }
}

/** One-shot convenience: layout plus header plus every row. */
export function renderTable(rows, columns, options = {}) {
  if (!rows.length) return []
  const l = layout(rows, columns, options)
  const head = options.color ? options.color.bold(l.header()) : l.header()
  return [head, ...rows.map((r) => l.row(r))]
}

/** Truncate to `n` printed columns, marking the cut. */
export function fit(s, n) {
  const raw = String(s ?? '')
  if (width(raw) <= n) return raw
  if (n <= 1) return strip(raw).slice(0, Math.max(0, n))
  // Only plain strings are ever truncated — colour is applied to whole cells and
  // never to the flexible ones — so slicing the stripped form is safe.
  return strip(raw).slice(0, n - 1) + '…'
}

function pad(s, n, align) {
  const w = width(s)
  if (w >= n) return s
  const fill = ' '.repeat(n - w)
  return align === 'right' ? fill + s : s + fill
}

/** Usable width of a stream, with a stable fallback for pipes and CI. */
export function streamWidth(stream, env = process.env) {
  const fromEnv = Number(env.COLUMNS)
  if (Number.isFinite(fromEnv) && fromEnv > 20) return fromEnv
  if (stream?.isTTY && Number.isFinite(stream.columns) && stream.columns > 20) return stream.columns
  return 100
}
