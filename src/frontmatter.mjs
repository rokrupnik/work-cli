// A deliberately small YAML subset — enough for the frontmatter blocks the
// projects actually write, and nothing else.
//
// Not a YAML library on purpose. The frontmatter is a fixed set of fields
// written by hand; a full parser would accept anchors, nested maps and
// multi-document files that the convention has no meaning for, and would turn
// "this file is malformed" into "this file parsed into something nobody
// expected". Anything outside the subset is reported, not guessed at.
//
// The subset:
//   key: value            scalar, quotes stripped, a colon inside is content
//   key: [a, b]           flow list
//   key:                  empty
//   key:                  block list
//     - a
//   key: >- / >           folded block scalar — lines joined with spaces
//   key: |- / |           literal block scalar — line breaks kept
//   # anything            comment
//
// Block scalars are in the subset because real task files use them: the
// buka-derived template carries `writes-production: >-` and `summary: >-`, and
// rejecting those made every task in a whole project look malformed.

const KEY = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(.*)$/
// `>`, `>-`, `|`, `|+`, `|2-` — the style character, then any mix of an
// indentation indicator and a chomping indicator. Neither changes the value in
// any way this tool cares about, so both are accepted and ignored.
const BLOCK = /^([|>])[0-9+-]*$/

/**
 * @returns {{present: boolean, fields: Record<string, {value: any, raw: string, line: number, kind: 'scalar'|'list'|'empty'}>, order: string[], errors: {line: number, message: string}[], bodyStart: number}}
 */
export function parseFrontmatter(text) {
  const fields = Object.create(null)
  const order = []
  const errors = []

  // A BOM is invisible and would otherwise make line 1 not equal `---`. Windows
  // editors write them.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = src.split(/\r?\n/)

  if (lines[0]?.trim() !== '---') {
    return { present: false, fields, order, errors, bodyStart: 0 }
  }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') { end = i; break }
  }
  if (end === -1) {
    errors.push({ line: 1, message: 'frontmatter block is never closed by a `---` line' })
    return { present: true, fields, order, errors, bodyStart: lines.length }
  }

  let last = null
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    const lineNo = i + 1
    const trimmed = line.trim()

    if (trimmed === '') { last = null; continue }
    // `# Optional while an Executor has an isolated worktree:` — the README's own
    // frontmatter example carries commented-out fields. They are not fields.
    if (trimmed.startsWith('#')) { last = null; continue }

    // Continuation of a block list: `blocked-by:` then `  - T-26-049`.
    if (/^\s+-\s/.test(line)) {
      if (!last || last.kind === 'scalar') {
        errors.push({ line: lineNo, message: `list item has no field to belong to: ${trimmed}` })
        continue
      }
      last.kind = 'list'
      last.value.push(unquote(trimmed.replace(/^-\s*/, '').trim()))
      continue
    }

    if (/^\s/.test(line)) {
      errors.push({ line: lineNo, message: `indented line is not a supported value: ${trimmed}` })
      last = null
      continue
    }

    const m = KEY.exec(line)
    if (!m) {
      errors.push({ line: lineNo, message: `not a \`key: value\` line: ${trimmed}` })
      last = null
      continue
    }

    const key = m[1]
    const rest = m[2].trim()
    if (key in fields) {
      errors.push({ line: lineNo, message: `duplicate frontmatter key: ${key}` })
    } else {
      order.push(key)
    }

    const block = BLOCK.exec(rest)
    if (block) {
      const collected = collectBlock(lines, i + 1, end)
      i = collected.next - 1
      fields[key] = {
        value: block[1] === '|' ? collected.lines.join('\n') : fold(collected.lines),
        raw: rest,
        line: lineNo,
        kind: 'scalar',
      }
      last = null
      continue
    }

    if (rest === '') {
      // Could be an empty scalar (`completed:`) or the head of a block list.
      // Which one it is only becomes clear on the next line, so start as empty
      // and let a following `- item` promote it.
      const f = { value: [], raw: '', line: lineNo, kind: 'empty' }
      fields[key] = f
      last = f
      continue
    }

    if (rest.startsWith('[')) {
      const parsed = parseFlowList(rest)
      if (!parsed.ok) errors.push({ line: lineNo, message: `malformed list value for \`${key}\`: ${rest}` })
      fields[key] = { value: parsed.items, raw: rest, line: lineNo, kind: 'list' }
      last = null
      continue
    }

    fields[key] = { value: unquote(rest), raw: rest, line: lineNo, kind: 'scalar' }
    last = null
  }

  // An `empty` field that never got a list item is an empty scalar.
  for (const key of order) {
    const f = fields[key]
    if (f.kind === 'empty' && f.value.length === 0) f.value = ''
  }

  return { present: true, fields, order, errors, bodyStart: end + 1 }
}

/**
 * The indented lines belonging to a block scalar, dedented by the indentation of
 * its first non-blank line. Stops at the first line that is non-blank and not
 * indented — the next key, or the end of the block.
 */
function collectBlock(lines, start, end) {
  const out = []
  let i = start
  let indent = null

  for (; i < end; i++) {
    const line = lines[i]
    if (line.trim() === '') { out.push(''); continue }
    const lead = line.length - line.trimStart().length
    if (lead === 0) break
    if (indent === null) indent = lead
    out.push(line.slice(Math.min(lead, indent)))
  }

  // Trailing blank lines are chomping detail; nothing here depends on them.
  while (out.length && out[out.length - 1] === '') out.pop()
  return { lines: out, next: i }
}

/** Folded style: line breaks become spaces, a blank line becomes a break. */
function fold(lines) {
  const parts = []
  let current = []
  for (const line of lines) {
    if (line === '') {
      if (current.length) { parts.push(current.join(' ')); current = [] }
    } else {
      current.push(line.trim())
    }
  }
  if (current.length) parts.push(current.join(' '))
  return parts.join('\n')
}

function parseFlowList(raw) {
  if (!raw.endsWith(']')) return { ok: false, items: [] }
  const inner = raw.slice(1, -1).trim()
  if (inner === '') return { ok: true, items: [] }
  const items = inner.split(',').map((s) => unquote(s.trim())).filter((s) => s !== '')
  return { ok: true, items }
}

function unquote(s) {
  if (s.length >= 2) {
    const a = s[0]
    if ((a === '"' || a === "'") && s[s.length - 1] === a) return s.slice(1, -1)
  }
  return s
}

/** Scalar value of a field, or '' — lists collapse to their joined form. */
export function scalar(fm, key) {
  const f = fm.fields[key]
  if (!f) return ''
  return Array.isArray(f.value) ? f.value.join(', ') : String(f.value)
}

/** List value of a field. A lone scalar counts as a one-item list. */
export function list(fm, key) {
  const f = fm.fields[key]
  if (!f) return []
  if (Array.isArray(f.value)) return f.value
  const s = String(f.value).trim()
  return s === '' ? [] : [s]
}

export function has(fm, key) {
  return key in fm.fields
}
