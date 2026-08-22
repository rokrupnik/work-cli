// The registry: names and canonical paths, and nothing else.
//
// It holds no task data by design. Every command re-reads the markdown from the
// project on every run, so the registry can never be stale about anything except
// where a project lives — and `work doctor` reports that.
//
// A JSON file rather than buka's symlink directory. Symlinks are the nicer
// design on a Mac and a liability on Windows, where creating one needs either
// Developer Mode or an elevated process; a registration step that fails with
// ERROR_PRIVILEGE_NOT_HELD on half the team is not a registration step.
import fs from 'node:fs'
import path from 'node:path'
import { canonical, configFile, samePath, ancestors } from './paths.mjs'

export const REGISTRY_VERSION = 1

export class RegistryError extends Error {
  constructor(message, { hint } = {}) {
    super(message)
    this.name = 'RegistryError'
    this.hint = hint
  }
}

/** A project directory is one that contains `work/tasks/`. */
export function looksLikeProject(dir) {
  try {
    return fs.statSync(path.join(dir, 'work', 'tasks')).isDirectory()
  } catch {
    return false
  }
}

export function load(opts = {}) {
  const file = configFile(opts)
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return { version: REGISTRY_VERSION, projects: [], file, existed: false }
    throw new RegistryError(`cannot read the registry at ${file}: ${err.message}`)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new RegistryError(`the registry at ${file} is not valid JSON: ${err.message}`, {
      hint: 'Open it in an editor and fix it, or delete it and re-add your projects.',
    })
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
    throw new RegistryError(`the registry at ${file} does not have the expected shape`, {
      hint: 'Expected {"version": 1, "projects": [{"name": "...", "path": "..."}]}.',
    })
  }

  const projects = []
  for (const p of data.projects) {
    if (!p || typeof p.name !== 'string' || typeof p.path !== 'string') continue
    projects.push({ name: p.name, path: p.path, added: typeof p.added === 'string' ? p.added : undefined })
  }
  projects.sort((a, b) => a.name.localeCompare(b.name))
  return { version: data.version ?? REGISTRY_VERSION, projects, file, existed: true }
}

export function save(registry, opts = {}) {
  const file = configFile(opts)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const out = {
    version: REGISTRY_VERSION,
    projects: [...registry.projects]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ name: p.name, path: p.path, ...(p.added ? { added: p.added } : {}) })),
  }
  // Write-and-rename so an interrupted write cannot leave a half-written
  // registry behind. `rename` within one directory is atomic on every platform
  // this runs on.
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
  return file
}

export function byName(registry, name) {
  const wanted = String(name).toLowerCase()
  return registry.projects.find((p) => p.name.toLowerCase() === wanted) ?? null
}

/** Every registration whose canonical path is `target`. More than one is a bug. */
export function byPath(registry, target, opts = {}) {
  return registry.projects.filter((p) => samePath(canonical(p.path, opts), target, opts))
}

/**
 * Registrations that point at the same directory under different names. Buka
 * warns about this at adopt time; `work` refuses at add time and reports any
 * that got in some other way, because everything keyed by name splits silently.
 */
export function duplicatePaths(registry, opts = {}) {
  const groups = []
  for (const p of registry.projects) {
    const c = canonical(p.path, opts)
    const hit = groups.find((g) => samePath(g.path, c, opts))
    if (hit) hit.names.push(p.name)
    else groups.push({ path: c, names: [p.name] })
  }
  return groups.filter((g) => g.names.length > 1)
}

/**
 * The registered project containing `cwd`, or null.
 *
 * Walks up rather than matching the exact directory: commands are run from
 * wherever you happen to be in a repo, and requiring the root is a step that
 * only exists to be got wrong. The nearest registered ancestor wins, so a
 * project registered inside another project still resolves to itself.
 */
export function infer(registry, cwd, opts = {}) {
  const start = canonical(cwd, { ...opts, cwd })
  const entries = registry.projects.map((p) => ({ entry: p, canonical: canonical(p.path, opts) }))
  for (const dir of ancestors(start)) {
    for (const e of entries) {
      if (samePath(e.canonical, dir, opts)) return e.entry
    }
  }
  return null
}
