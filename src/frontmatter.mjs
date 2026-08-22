// A deliberately small YAML subset — enough for the frontmatter block that
// work/README.md documents, and nothing else.
//
// Not a YAML library on purpose. The frontmatter is a fixed set of scalar and
// flat-list fields written by hand; a full parser would accept anchors, nested
// maps and multi-document files that the convention has no meaning for, and
// would turn "this file is malformed" into "this file parsed into something
// nobody expected". Anything outside the subset is reported, not guessed at.

const KEY = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(.*)$/

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
