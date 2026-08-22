// `work doctor` — is this installation sane, and does every registration still
// point at something. It reports; it repairs nothing.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs, UsageError } from '../args.mjs'
import { canonical, tilde, configDir, configFile } from '../paths.mjs'
import * as registry from '../registry.mjs'
import { scanProject } from '../scan.mjs'
import { EXIT } from '../exit.mjs'

export async function doctorCommand(argv, ctx) {
  const { flags, positionals } = parseArgs(argv, { json: 'boolean', 'no-color': 'boolean' })
  if (positionals.length) throw new UsageError(`unexpected argument: ${positionals[0]}`)

  const checks = []
  const ok = (label, detail) => checks.push({ level: 'ok', label, detail })
  const warn = (label, detail) => checks.push({ level: 'warn', label, detail })
  const bad = (label, detail) => checks.push({ level: 'error', label, detail })

  // 1. Where is the code actually running from. Derived from this module's own
  //    URL rather than from argv[0] or cwd: npm installs the CLI behind a shim,
  //    and a root derived from the shim's directory is the classic way for a
  //    globally installed tool to look installed and behave as if it is not.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = path.resolve(here, '..', '..')
  ok('install root', tilde(root, ctx.opts))
  ok('node', `${process.version}  ${tilde(process.execPath, ctx.opts)}`)
  ok('platform', `${process.platform} ${process.arch}`)

  if (fs.existsSync(path.join(root, 'package.json')) && fs.existsSync(path.join(root, 'bin', 'work.mjs'))) {
    ok('layout', 'package.json and bin/work.mjs found next to the source')
  } else {
    bad('layout', `the install root does not look like a work checkout: ${root}`)
  }

  // 2. The registry.
  const file = configFile(ctx.opts)
  const dir = configDir(ctx.opts)
  if (ctx.opts.env?.WORK_CONFIG_DIR) {
    warn('registry', `${tilde(file, ctx.opts)}  (WORK_CONFIG_DIR is set)`)
  } else if (ctx.registry.existed) {
    ok('registry', tilde(file, ctx.opts))
  } else {
    warn('registry', `${tilde(file, ctx.opts)}  (does not exist yet — nothing registered)`)
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    ok('registry writable', tilde(dir, ctx.opts))
  } catch {
    if (ctx.registry.existed) bad('registry writable', `cannot write to ${tilde(dir, ctx.opts)}`)
  }

  // 3. Every registration, resolved.
  const dupes = registry.duplicatePaths(ctx.registry, ctx.opts)
  for (const g of dupes) {
    bad('duplicate path', `${tilde(g.path, ctx.opts)} is registered as ${g.names.join(', ')}`)
  }

  const projects = []
  for (const p of ctx.registry.projects) {
    const target = canonical(p.path, ctx.opts)
    const entry = { name: p.name, path: target, state: 'ok', tasks: 0, weeks: 0 }
    if (!fs.existsSync(target)) {
      entry.state = 'missing'
      bad(p.name, `path does not exist: ${tilde(target, ctx.opts)}`)
    } else if (!registry.looksLikeProject(target)) {
      entry.state = 'no-tasks-dir'
      bad(p.name, `no work/tasks/ under ${tilde(target, ctx.opts)}`)
    } else {
      const scan = scanProject({ name: p.name, dir: target })
      entry.tasks = scan.tasks.length
      entry.weeks = scan.weeks.length
      if (p.path !== target) {
        // Registered as a symlink or a relative path; harmless, but worth
        // knowing when two entries look different and are the same directory.
        warn(p.name, `stored as ${tilde(p.path, ctx.opts)}, resolves to ${tilde(target, ctx.opts)}`)
      }
      ok(p.name, `${scan.tasks.length} tasks · ${scan.weeks.length} weeks · ${tilde(target, ctx.opts)}`)
      if (scan.strays.length) warn(p.name, `${scan.strays.length} entries under work/tasks/ do not follow the naming convention`)
    }
    projects.push(entry)
  }
  if (!ctx.registry.projects.length) warn('projects', 'none registered — try: work project add <path>')

  // 4. Does `work` on PATH point at this checkout? Answered by looking at PATH
  //    entries, never by running a shell: `which` does not exist on Windows and
  //    `where` behaves differently, and neither is needed to read a directory.
  const resolved = whichWork(ctx.opts.env ?? process.env)
  if (!resolved.length) {
    warn('work on PATH', 'not found — the CLI is being run some other way (npx, node bin/work.mjs)')
  } else {
    const target = canonical(resolved[0], ctx.opts)
    const mine = target.startsWith(root) || linksInto(resolved[0], root, ctx.opts)
    if (mine) ok('work on PATH', `${tilde(resolved[0], ctx.opts)} -> this checkout`)
    else warn('work on PATH', `${tilde(resolved[0], ctx.opts)} does not resolve into ${tilde(root, ctx.opts)}`)
    for (const extra of resolved.slice(1)) {
      warn('work on PATH', `shadowed: ${tilde(extra, ctx.opts)} also matches`)
    }
  }

  const errors = checks.filter((c) => c.level === 'error').length
  const warnings = checks.filter((c) => c.level === 'warn').length

  if (flags.json) {
    ctx.out(JSON.stringify({
      tool: 'work', version: ctx.version, root, registry: file,
      counts: { errors, warnings }, checks, projects,
    }, null, 2))
    return errors ? EXIT.VALIDATION : EXIT.OK
  }

  const width = Math.max(...checks.map((c) => c.label.length))
  for (const c of checks) {
    const mark = c.level === 'ok' ? ctx.color.green('ok  ') : c.level === 'warn' ? ctx.color.yellow('warn') : ctx.color.red('err ')
    ctx.out(`${mark}  ${c.label.padEnd(width)}  ${c.detail}`)
  }
  ctx.out('')
  ctx.out(errors ? ctx.color.red(`${errors} problem${errors === 1 ? '' : 's'}`) : ctx.color.green('no problems'))
  return errors ? EXIT.VALIDATION : EXIT.OK
}

/**
 * Every `work` executable on PATH, in order. PATHEXT is honoured so the Windows
 * shims (`work.cmd`, `work.ps1`) are found; on POSIX the extensionless name is
 * the only candidate.
 */
function whichWork(env) {
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
    : ['']
  const found = []
  for (const entry of String(env.PATH ?? '').split(sep)) {
    if (!entry) continue
    for (const ext of ['', ...exts]) {
      const candidate = path.join(entry.replace(/^"|"$/g, ''), 'work' + ext)
      try {
        if (fs.statSync(candidate).isFile() && !found.includes(candidate)) found.push(candidate)
      } catch { /* not there */ }
    }
  }
  return found
}

function linksInto(file, root, opts) {
  try {
    return canonical(fs.realpathSync(file), opts).startsWith(root)
  } catch {
    return false
  }
}
