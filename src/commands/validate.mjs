// `work validate` — the conventions, checked. Read-only, like everything else:
// it reports and never repairs, because several of the things it reports (a
// slipped week, an unowned task) are true records that a repair would erase.
import { parseArgs, manyLower, UsageError } from '../args.mjs'
import { tilde } from '../paths.mjs'
import * as registry from '../registry.mjs'
import { resolveProjects, scanAll } from '../select.mjs'
import { validateScan, validateRegistry, counts, RULES } from '../validate.mjs'
import { diagnosticToJson } from '../json.mjs'
import { EXIT } from '../exit.mjs'

const SPEC = {
  project: 'string',
  all: 'boolean',
  strict: 'boolean',
  'errors-only': 'boolean',
  code: 'string',
  'stale-hours': 'string',
  json: 'boolean',
  rules: 'boolean',
  'no-color': 'boolean',
}
const ALIASES = { p: 'project', a: 'all' }

export async function validateCommand(argv, ctx) {
  const { flags, positionals } = parseArgs(argv, SPEC, ALIASES)
  if (positionals.length) throw new UsageError(`unexpected argument: ${positionals[0]}`)

  if (flags.rules) {
    for (const [severity, code, description] of RULES) {
      ctx.out(`${severity.padEnd(8)} ${code.padEnd(26)} ${description}`)
    }
    return EXIT.OK
  }

  const staleHours = flags['stale-hours'] ? Number(flags['stale-hours'][0]) : 24
  if (!Number.isFinite(staleHours) || staleHours <= 0) {
    throw new UsageError('--stale-hours needs a positive number of hours')
  }
  const only = manyLower(flags, 'code')

  const selection = resolveProjects({
    reg: ctx.registry,
    names: flags.project ?? [],
    all: Boolean(flags.all),
    cwd: ctx.cwd,
    opts: ctx.opts,
  })

  const diagnostics = []

  // Registry-level checks run whenever more than the current project is in
  // scope — a duplicate registration is not a property of any one project.
  if (selection.reason !== 'cwd' || selection.projects.length > 1) {
    diagnostics.push(
      ...validateRegistry(ctx.registry, {
        duplicates: registry.duplicatePaths(ctx.registry, ctx.opts),
        missing: missingProjects(ctx),
      }),
    )
  }

  const scans = scanAll(selection.projects, ctx.opts)
  for (const scan of scans) {
    diagnostics.push(...validateScan(scan, { now: ctx.now, staleLeaseHours: staleHours }))
  }

  const shown = diagnostics.filter((d) => {
    if (only && !only.has(d.code)) return false
    if (flags['errors-only'] && d.severity !== 'error') return false
    return true
  })
  const tally = counts(shown)

  if (flags.json) {
    ctx.out(JSON.stringify({
      tool: 'work',
      version: ctx.version,
      generated: ctx.now.toISOString(),
      projects: scans.map((s) => ({ name: s.project.name, path: s.project.dir, tasks: s.tasks.length })),
      counts: tally,
      diagnostics: shown.map(diagnosticToJson),
    }, null, 2))
  } else {
    report(shown, scans, tally, ctx)
  }

  if (tally.errors > 0) return EXIT.VALIDATION
  if (flags.strict && tally.warnings > 0) return EXIT.VALIDATION
  return EXIT.OK
}

function missingProjects(ctx) {
  const out = []
  for (const p of ctx.registry.projects) {
    if (!registry.looksLikeProject(ctx.canonicalOf(p))) {
      out.push({ name: p.name, path: ctx.canonicalOf(p), reason: 'no work/tasks/ directory here' })
    }
  }
  return out
}

/**
 * Findings go to stderr and the summary to stdout, so that
 *   work validate > /dev/null
 * still shows what is wrong, and
 *   work validate --json | jq
 * is not polluted by either.
 */
function report(diagnostics, scans, tally, ctx) {
  const { color } = ctx

  const byProject = new Map()
  for (const d of diagnostics) {
    const key = d.project ?? '(registry)'
    if (!byProject.has(key)) byProject.set(key, [])
    byProject.get(key).push(d)
  }

  for (const [project, list] of byProject) {
    ctx.err('')
    ctx.err(color.bold(project))
    for (const d of list) {
      const tag = d.severity === 'error' ? color.red('error') : color.yellow('warn ')
      ctx.err(`  ${tag} ${color.dim(d.code.padEnd(24))} ${d.message}`)
      // Add the location only when the message does not already carry it. Most
      // messages lead with the project-relative path, and repeating it as an
      // absolute path underneath doubles the height of the report for nothing.
      if (d.file && !(d.relPath && d.message.includes(d.relPath))) {
        ctx.err(`        ${color.dim(tilde(d.file, ctx.opts) + (d.line ? ':' + d.line : ''))}`)
      }
      if (d.hint) ctx.err(`        ${color.dim(d.hint)}`)
    }
  }

  const files = scans.reduce((n, s) => n + s.tasks.length, 0)
  const where = scans.map((s) => s.project.name).join(', ')
  const verdict = tally.errors
    ? color.red(`${tally.errors} error${tally.errors === 1 ? '' : 's'}`)
    : color.green('no errors')
  const warn = tally.warnings ? `, ${color.yellow(`${tally.warnings} warning${tally.warnings === 1 ? '' : 's'}`)}` : ''
  ctx.out(`${files} task file${files === 1 ? '' : 's'} in ${where}: ${verdict}${warn}`)
}
