// `work project …` — registration. Adding a project writes one line to the
// registry and touches nothing inside the project itself: no template, no
// AGENTS.md, no settings file, no directory created. Adopting here means
// "remember where this is", and nothing more.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, UsageError } from '../args.mjs'
import { canonical, tilde, configFile } from '../paths.mjs'
import * as registry from '../registry.mjs'
import { scanProject } from '../scan.mjs'
import { EXIT } from '../exit.mjs'

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export async function projectCommand(argv, ctx) {
  const sub = argv[0]
  const rest = argv.slice(1)
  switch (sub) {
    case 'add': return add(rest, ctx)
    case 'list': case 'ls': case undefined: return list(rest, ctx)
    case 'remove': case 'rm': return remove(rest, ctx)
    case 'show': return show(rest, ctx)
    default:
      throw new UsageError(`unknown subcommand: work project ${sub}`, {
        hint: 'Known: add, list, remove, show',
      })
  }
}

async function add(argv, ctx) {
  const { flags, positionals } = parseArgs(argv, { json: 'boolean', 'no-color': 'boolean' })
  if (!positionals.length) {
    throw new UsageError('work project add <path> [name]')
  }
  // A third positional is refused rather than absorbed. buka learned this the
  // hard way: an unquoted trailing shell comment became the project name and one
  // directory quietly acquired two identities.
  if (positionals.length > 2) {
    throw new UsageError(`unexpected argument: ${positionals[2]}`, {
      hint: 'work project add <path> [name] — quote a path with spaces.',
    })
  }

  const [rawPath, rawName] = positionals
  const dir = canonical(rawPath, { ...ctx.opts, cwd: ctx.cwd })

  let stat
  try {
    stat = fs.statSync(dir)
  } catch {
    throw new UsageError(`no such directory: ${rawPath}`, { hint: `Resolved to ${dir}`, code: EXIT.NO_PROJECT })
  }
  if (!stat.isDirectory()) throw new UsageError(`not a directory: ${dir}`, { code: EXIT.NO_PROJECT })

  if (!registry.looksLikeProject(dir)) {
    throw new UsageError(`${tilde(dir, ctx.opts)} has no work/tasks/ directory`, {
      hint: 'work reads <project>/work/tasks/<YY-Wnn>/*.md. Point it at the repository root.',
      code: EXIT.NO_PROJECT,
    })
  }

  // Already registered? Say so and stop — the alternative is a second name for
  // one directory, which splits every per-project view without warning.
  const existing = registry.byPath(ctx.registry, dir, ctx.opts)
  if (existing.length) {
    const names = existing.map((p) => p.name).join(', ')
    const name = rawName ?? existing[0].name
    if (existing.some((p) => p.name.toLowerCase() === String(name).toLowerCase())) {
      ctx.out(`${existing[0].name} is already registered  ${ctx.color.dim(tilde(dir, ctx.opts))}`)
      return EXIT.OK
    }
    throw new UsageError(`${tilde(dir, ctx.opts)} is already registered as \`${names}\``, {
      hint: `Registering it again as \`${rawName}\` would give one directory two names, and everything keyed by name would split.\nRename instead:  work project remove ${existing[0].name} && work project add ${rawPath} ${rawName}`,
    })
  }

  const name = rawName ?? path.basename(dir)
  if (!NAME_OK.test(name)) {
    throw new UsageError(`\`${name}\` is not a usable project name`, {
      hint: 'Letters, digits, dot, dash and underscore; must start with a letter or digit.',
    })
  }
  const clash = registry.byName(ctx.registry, name)
  if (clash) {
    throw new UsageError(`the name \`${name}\` is taken by ${tilde(canonical(clash.path, ctx.opts), ctx.opts)}`, {
      hint: `Pick another:  work project add ${rawPath} <name>`,
    })
  }

  const entry = { name, path: dir, added: ctx.now.toISOString().slice(0, 10) }
  const next = { ...ctx.registry, projects: [...ctx.registry.projects, entry] }
  const file = registry.save(next, ctx.opts)

  const scan = scanProject({ name, dir })
  ctx.out(`registered ${ctx.color.bold(name)}  ${ctx.color.dim(tilde(dir, ctx.opts))}`)
  ctx.out(ctx.color.dim(`  ${scan.tasks.length} task file${scan.tasks.length === 1 ? '' : 's'} across ${scan.weeks.length} week folder${scan.weeks.length === 1 ? '' : 's'}`))
  ctx.out(ctx.color.dim(`  registry: ${tilde(file, ctx.opts)}  (paths only — no task data is copied)`))
  ctx.out(ctx.color.dim(`  nothing inside ${name} was modified`))
  return EXIT.OK
}

async function list(argv, ctx) {
  const { flags, positionals } = parseArgs(argv, { json: 'boolean', 'no-color': 'boolean' })
  if (positionals.length) throw new UsageError(`unexpected argument: ${positionals[0]}`)

  const rows = ctx.registry.projects.map((p) => {
    const dir = canonical(p.path, ctx.opts)
    let state = 'ok'
    if (!fs.existsSync(dir)) state = 'missing'
    else if (!registry.looksLikeProject(dir)) state = 'no work/tasks'
    const tasks = state === 'ok' ? scanProject({ name: p.name, dir }).tasks : []
    return {
      name: p.name,
      path: dir,
      state,
      total: tasks.length,
      open: tasks.filter((t) => !t.done).length,
    }
  })

  if (flags.json) {
    ctx.out(JSON.stringify({
      tool: 'work',
      version: ctx.version,
      registry: configFile(ctx.opts),
      projects: rows,
    }, null, 2))
    return rows.some((r) => r.state !== 'ok') ? EXIT.ENVIRONMENT : EXIT.OK
  }

  if (!rows.length) {
    ctx.out('no projects are registered')
    ctx.out(ctx.color.dim(`registry: ${tilde(configFile(ctx.opts), ctx.opts)}`))
    ctx.out('')
    ctx.out('  work project add <path> [name]')
    return EXIT.OK
  }

  const here = registry.infer(ctx.registry, ctx.cwd, ctx.opts)
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 4)
  for (const r of rows) {
    const mark = here && here.name === r.name ? ctx.color.green('*') : ' '
    // Pad the plain text and colour afterwards: an escape sequence has no
    // printed width, and padding it would misalign every coloured row.
    const plain = r.state === 'ok' ? `${r.open} open / ${r.total}` : r.state
    const counts = (r.state === 'ok' ? ctx.color.dim : ctx.color.red)(plain.padEnd(18))
    ctx.out(`${mark} ${r.name.padEnd(nameWidth)}  ${counts}  ${ctx.color.dim(tilde(r.path, ctx.opts))}`)
  }
  ctx.out('')
  ctx.out(ctx.color.dim(`registry: ${tilde(configFile(ctx.opts), ctx.opts)}`))
  if (here) ctx.out(ctx.color.dim(`* the project containing the working directory`))
  return rows.some((r) => r.state !== 'ok') ? EXIT.ENVIRONMENT : EXIT.OK
}

async function remove(argv, ctx) {
  const { positionals } = parseArgs(argv, { 'no-color': 'boolean' })
  if (positionals.length !== 1) throw new UsageError('work project remove <name>')
  const name = positionals[0]
  const hit = registry.byName(ctx.registry, name)
  if (!hit) {
    throw new UsageError(`no registered project named \`${name}\``, {
      hint: ctx.registry.projects.length ? `Registered: ${ctx.registry.projects.map((p) => p.name).join(', ')}` : undefined,
      code: EXIT.NO_PROJECT,
    })
  }
  const next = { ...ctx.registry, projects: ctx.registry.projects.filter((p) => p !== hit) }
  registry.save(next, ctx.opts)
  ctx.out(`removed ${hit.name}`)
  ctx.out(ctx.color.dim(`  ${tilde(canonical(hit.path, ctx.opts), ctx.opts)} is untouched — only the registration is gone`))
  return EXIT.OK
}

async function show(argv, ctx) {
  const { flags, positionals } = parseArgs(argv, { json: 'boolean', 'no-color': 'boolean' })
  if (positionals.length !== 1) throw new UsageError('work project show <name>')
  const hit = registry.byName(ctx.registry, positionals[0])
  if (!hit) {
    throw new UsageError(`no registered project named \`${positionals[0]}\``, { code: EXIT.NO_PROJECT })
  }
  const dir = canonical(hit.path, ctx.opts)
  const scan = scanProject({ name: hit.name, dir })

  const byStatus = new Map()
  for (const t of scan.tasks) byStatus.set(t.status || '(none)', (byStatus.get(t.status || '(none)') ?? 0) + 1)
  const owners = new Map()
  for (const t of scan.tasks.filter((t) => !t.done)) {
    for (const o of t.owners.length ? t.owners : ['(unowned)']) owners.set(o, (owners.get(o) ?? 0) + 1)
  }

  if (flags.json) {
    ctx.out(JSON.stringify({
      name: hit.name,
      path: dir,
      registered: hit.added ?? null,
      error: scan.readError ?? null,
      weeks: scan.weeks.map((w) => ({ folder: w.folder, week: w.week, closed: w.closed })),
      counts: {
        total: scan.tasks.length,
        open: scan.tasks.filter((t) => !t.done).length,
        byStatus: Object.fromEntries(byStatus),
        byOwner: Object.fromEntries(owners),
      },
    }, null, 2))
    return scan.readError ? EXIT.ENVIRONMENT : EXIT.OK
  }

  ctx.out(`${ctx.color.bold(hit.name)}  ${ctx.color.dim(tilde(dir, ctx.opts))}`)
  if (hit.added) ctx.out(ctx.color.dim(`registered ${hit.added}`))
  if (scan.readError) {
    ctx.err(scan.readError)
    return EXIT.ENVIRONMENT
  }
  ctx.out('')
  ctx.out(`weeks    ${scan.weeks.map((w) => (w.closed ? ctx.color.dim(w.folder) : w.folder)).join('  ') || '(none)'}`)
  ctx.out(`tasks    ${scan.tasks.length}  (${scan.tasks.filter((t) => !t.done).length} open)`)
  ctx.out(`status   ${[...byStatus.entries()].sort().map(([k, v]) => `${k} ${v}`).join('  ')}`)
  ctx.out(`open by  ${[...owners.entries()].sort().map(([k, v]) => `${k} ${v}`).join('  ') || '(nobody)'}`)
  if (scan.strays.length) {
    ctx.out(ctx.color.yellow(`strays   ${scan.strays.length} entr${scan.strays.length === 1 ? 'y' : 'ies'} under work/tasks/ that the convention does not name`))
  }
  return EXIT.OK
}
