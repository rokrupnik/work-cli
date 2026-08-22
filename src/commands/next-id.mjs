// `work next-id` — max existing number plus one, computed rather than eyeballed.
import { parseArgs, UsageError } from '../args.mjs'
import { tilde } from '../paths.mjs'
import { resolveProjects } from '../select.mjs'
import { nextId } from '../nextid.mjs'
import { EXIT } from '../exit.mjs'

const SPEC = { project: 'string', all: 'boolean', json: 'boolean', verbose: 'boolean', 'no-color': 'boolean' }
const ALIASES = { p: 'project', v: 'verbose' }

export async function nextIdCommand(argv, ctx) {
  const { flags, positionals } = parseArgs(argv, SPEC, ALIASES)
  if (positionals.length) throw new UsageError(`unexpected argument: ${positionals[0]}`)

  const selection = resolveProjects({
    reg: ctx.registry,
    names: flags.project ?? [],
    all: Boolean(flags.all),
    cwd: ctx.cwd,
    opts: ctx.opts,
  })

  // Task numbering is per project. Printing one id for several projects would be
  // meaningless, so ask for the project rather than pick one.
  if (selection.projects.length > 1) {
    if (!flags.all && !flags.json) {
      throw new UsageError(`next-id needs one project, and ${selection.projects.length} are in scope`, {
        hint: `Pass one: work next-id --project ${selection.projects[0].name}\nOr ask for all of them: work next-id --all`,
      })
    }
  }

  const results = selection.projects.map((entry) => {
    const dir = ctx.canonicalOf(entry)
    return { entry, dir, result: nextId(dir, { now: ctx.now }) }
  })

  if (flags.json) {
    ctx.out(JSON.stringify({
      tool: 'work',
      version: ctx.version,
      generated: ctx.now.toISOString(),
      projects: results.map(({ entry, dir, result }) => ({
        name: entry.name,
        path: dir,
        nextId: result.safe ? result.id : null,
        safe: result.safe,
        highest: result.max,
        scanned: result.scanned,
        duplicates: result.duplicates,
      })),
    }, null, 2))
    return results.every((r) => r.result.safe) ? EXIT.OK : EXIT.VALIDATION
  }

  let bad = false
  for (const { entry, result } of results) {
    if (!result.safe) {
      bad = true
      ctx.err(`${entry.name}: refusing to allocate a number — ${result.duplicates.length} id${result.duplicates.length === 1 ? ' is' : 's are'} already duplicated:`)
      for (const d of result.duplicates) {
        ctx.err(`  ${d.id}`)
        for (const f of d.files) ctx.err(`    ${tilde(f, ctx.opts)}`)
      }
      ctx.err('  Fix those first: while an id means two things, max+1 is not evidence that the next one is free.')
      continue
    }
    const prefix = results.length > 1 ? `${entry.name}\t` : ''
    ctx.out(prefix + result.id)
    if (flags.verbose) {
      ctx.err(`  highest existing: ${result.max ? `${result.max.id}  ${tilde(result.max.file, ctx.opts)}` : '(none)'}`)
      ctx.err(`  scanned ${result.scanned} numbered file${result.scanned === 1 ? '' : 's'} under work/`)
      ctx.err('  nothing was reserved — two callers a second apart get the same id')
    }
  }
  return bad ? EXIT.VALIDATION : EXIT.OK
}
