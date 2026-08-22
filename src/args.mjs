// A small argv parser. No dependency, no clever DSL — the command surface is
// fixed and small enough that a table of known flags is the whole design.
//
// The rule that matters: an unknown flag is an error, never a positional. A
// typo'd `--ownr ROK` that silently degraded to "no filter" would print the
// wrong overview and look like a correct one.

export class UsageError extends Error {
  constructor(message, { hint, code } = {}) {
    super(message)
    this.name = 'UsageError'
    this.hint = hint
    // Most usage problems are exit 2. A few — "no such project" — are better
    // reported as 3, so the caller can tell "you typed it wrong" from
    // "the thing you named is not registered".
    this.code = code
  }
}

/**
 * @param {string[]} argv
 * @param {Record<string, 'boolean'|'string'>} spec  known flags, long form
 * @param {Record<string, string>} [aliases]         short form -> long form
 */
export function parseArgs(argv, spec, aliases = {}) {
  const flags = Object.create(null)
  const positionals = []
  let onlyPositionals = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (onlyPositionals) { positionals.push(arg); continue }
    if (arg === '--') { onlyPositionals = true; continue }

    if (!arg.startsWith('-') || arg === '-') { positionals.push(arg); continue }

    let name = arg.startsWith('--') ? arg.slice(2) : arg.slice(1)
    let inline
    const eq = name.indexOf('=')
    if (eq !== -1) { inline = name.slice(eq + 1); name = name.slice(0, eq) }
    if (aliases[name]) name = aliases[name]

    const kind = spec[name]
    if (!kind) throw new UsageError(`unknown option: ${arg}`)

    if (kind === 'boolean') {
      if (inline !== undefined) throw new UsageError(`option --${name} takes no value`)
      flags[name] = true
      continue
    }

    let value = inline
    if (value === undefined) {
      value = argv[++i]
      if (value === undefined) throw new UsageError(`option --${name} needs a value`)
    }
    // Repeatable string flags accumulate: `--owner ROK --owner UROS` is a set,
    // not a last-one-wins. Filters that quietly drop earlier values are how a
    // report ends up narrower than the command that produced it looks.
    if (flags[name] === undefined) flags[name] = [value]
    else flags[name].push(value)
  }

  return { flags, positionals }
}

/** First value of a string flag, or undefined. */
export function one(flags, name) {
  const v = flags[name]
  return Array.isArray(v) ? v[v.length - 1] : v
}

/** All values of a repeatable string flag, split on commas, as a lowercase set. */
export function manyLower(flags, name) {
  const v = flags[name]
  if (!v) return null
  const out = new Set()
  for (const item of v) {
    for (const part of String(item).split(',')) {
      const t = part.trim()
      if (t) out.add(t.toLowerCase())
    }
  }
  return out.size ? out : null
}
