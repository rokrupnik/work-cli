// Reading a project off disk. Nothing here writes, and nothing here spawns a
// process: `node:fs` does every traversal, so the same code runs under
// PowerShell, cmd.exe, zsh and bash without a `find`, a `grep` or a glob.
import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, scalar, list, has } from './frontmatter.mjs'
import {
  parseWeekFolder,
  parseTaskFilename,
  splitOwners,
  LEASE_FIELDS,
  WAITING_STATUSES,
} from './convention.mjs'

/** `<project>/work/tasks` */
export function tasksDir(projectDir) {
  return path.join(projectDir, 'work', 'tasks')
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
    throw err
  }
}

/**
 * Scan one registered project.
 *
 * @returns {{project: {name: string, dir: string}, tasks: object[], weeks: object[], strays: object[], readError: string|null}}
 *   `strays` are entries under work/tasks/ that the convention does not name —
 *   reported, never parsed and never silently skipped.
 */
export function scanProject(project) {
  const dir = project.dir
  const root = tasksDir(dir)
  const out = { project, tasks: [], weeks: [], strays: [], readError: null }

  const top = readDir(root)
  if (top === null) {
    out.readError = `no work/tasks/ directory at ${root}`
    return out
  }

  for (const entry of top.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(root, entry.name)

    if (!isDirectory(entry, full)) {
      out.strays.push({ kind: 'file-outside-week', name: entry.name, file: full })
      continue
    }

    const week = parseWeekFolder(entry.name)
    if (!week) {
      // How bad this is depends on what is inside. A directory of task-shaped
      // files is invisible to every command and that is an error; a holding
      // area of something else — `archive/` full of pre-convention files — is
      // worth mentioning once and no more.
      out.strays.push({
        kind: 'unknown-week-folder',
        name: entry.name,
        file: full,
        hiddenTasks: countTaskFiles(full),
      })
      continue
    }
    out.weeks.push(week)

    const files = readDir(full) ?? []
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.name.startsWith('.')) continue
      const file = path.join(full, f.name)
      if (isDirectory(f, file)) {
        out.strays.push({ kind: 'nested-directory', name: path.join(entry.name, f.name), file })
        continue
      }
      if (!f.name.toLowerCase().endsWith('.md')) {
        out.strays.push({ kind: 'not-markdown', name: path.join(entry.name, f.name), file })
        continue
      }
      const named = parseTaskFilename(f.name)
      if (!named) {
        out.strays.push({ kind: 'unrecognised-filename', name: path.join(entry.name, f.name), file })
        continue
      }
      out.tasks.push(readTask({ project, week, file, filename: f.name, named }))
    }
  }

  out.weeks.sort((a, b) => weekKey(a.week).localeCompare(weekKey(b.week)))
  return out
}

/** Task-shaped files sitting directly inside a directory. */
function countTaskFiles(dir) {
  let n = 0
  for (const entry of readDir(dir) ?? []) {
    if (entry.isDirectory()) continue
    if (parseTaskFilename(entry.name)) n++
  }
  return n
}

function isDirectory(entry, full) {
  if (entry.isDirectory()) return true
  // A symlinked week folder is a directory as far as this tool cares.
  if (entry.isSymbolicLink()) {
    try { return fs.statSync(full).isDirectory() } catch { return false }
  }
  return false
}

/** Sortable form of `26-W34` — the pieces are fixed-width already. */
export function weekKey(week) {
  return String(week ?? '')
}

function readTask({ project, week, file, filename, named }) {
  let text = ''
  let readError = null
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    readError = err.message
  }

  const fm = parseFrontmatter(text)
  const status = scalar(fm, 'status').trim().toLowerCase()
  const fmWeek = scalar(fm, 'week').trim()
  const assignee = list(fm, 'assignee').flatMap((a) => splitOwners(a))
  const fileOwners = named.owners

  const lease = {}
  for (const key of LEASE_FIELDS) {
    if (has(fm, key)) {
      lease[key] = key === 'parallel-with' ? list(fm, key) : scalar(fm, key).trim()
    }
  }

  return {
    project: project.name,
    projectDir: project.dir,
    file,
    filename,
    relPath: path.relative(project.dir, file),
    folder: week.folder,
    folderWeek: week.week,
    folderClosed: week.closed,

    id: named.id,
    idYear: named.year,
    idNumber: named.number,
    idPadding: named.padding,
    slug: named.slug,
    fileDone: named.done,
    fileOwners,

    frontmatter: fm,
    readError,
    fmId: scalar(fm, 'task').trim().toUpperCase(),
    title: scalar(fm, 'title').trim(),
    status,
    assignee,
    requestedBy: scalar(fm, 'requested-by').trim(),
    gmailThreadId: scalar(fm, 'gmail-thread-id').trim(),
    week: fmWeek,
    created: scalar(fm, 'created').trim(),
    completed: scalar(fm, 'completed').trim(),
    notified: scalar(fm, 'notified').trim(),
    blockedBy: list(fm, 'blocked-by').map((s) => s.trim().toUpperCase()).filter(Boolean),
    blocks: list(fm, 'blocks').map((s) => s.trim().toUpperCase()).filter(Boolean),
    lease,

    // Derived. The owner shown is the filename's when it has one, because the
    // filename is the interface humans read; validation reports the two
    // disagreeing separately rather than picking a winner quietly.
    get owners() { return fileOwners && fileOwners.length ? fileOwners : assignee },
    get done() { return status === 'done' || named.done },
    // A slipped task: scheduled for one week, sitting in another. work/README.md
    // is explicit that this is the record of the slip and must not be tidied
    // away, so it is surfaced and never normalised.
    get slipped() { return Boolean(fmWeek) && fmWeek !== week.week },
    get unowned() { return (fileOwners && fileOwners.length ? fileOwners : assignee).length === 0 },
    get leased() { return LEASE_FIELDS.some((k) => k in lease && String(lease[k] ?? '').length > 0) },
    // Stalled, either on us or on somebody else. See WAITING_STATUSES.
    get waiting() { return WAITING_STATUSES.includes(status) },
    // Shipped and verified; what is left is telling whoever asked for it.
    get awaitingNotice() { return status === 'notify' },
  }
}

/**
 * Every `T-YY-NNN` id that exists anywhere under `work/`, whether it is a
 * scheduled task, an archived one or an idea that was given a number. Used by
 * `next-id`, which must not hand out a number that any of them already holds.
 *
 * Walks with an explicit stack rather than a recursive glob: no `**`, no shell,
 * and a depth bound so a symlink loop cannot hang the CLI.
 */
export function scanIds(projectDir, { maxDepth = 8 } = {}) {
  const root = path.join(projectDir, 'work')
  const found = []
  const seenDirs = new Set()
  const stack = [{ dir: root, depth: 0 }]

  while (stack.length) {
    const { dir, depth } = stack.pop()
    if (depth > maxDepth) continue
    let real
    try { real = fs.realpathSync(dir) } catch { continue }
    if (seenDirs.has(real)) continue
    seenDirs.add(real)

    const entries = readDir(dir)
    if (!entries) continue
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (isDirectory(entry, full)) { stack.push({ dir: full, depth: depth + 1 }); continue }
      if (!entry.name.toLowerCase().endsWith('.md')) continue

      const named = parseTaskFilename(entry.name)
      if (named) {
        found.push({ id: named.id, number: named.number, year: named.year, padding: named.padding, file: full, from: 'filename' })
        continue
      }
      // An id can also exist only in frontmatter — an idea file that was given a
      // number, or a task whose filename does not carry one. Cheap to check and
      // the whole point is that no number is missed.
      const id = frontmatterId(full)
      if (id) found.push({ ...id, file: full, from: 'frontmatter' })
    }
  }
  return found
}

function frontmatterId(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch { return null }
  if (!text.startsWith('---') && text.charCodeAt(0) !== 0xfeff) return null
  const fm = parseFrontmatter(text)
  if (!fm.present) return null
  const raw = scalar(fm, 'task').trim().toUpperCase()
  const m = /^T-(\d{2})-(\d{3,})$/.exec(raw)
  if (!m) return null
  return { id: raw, year: Number(m[1]), number: Number(m[2]), padding: m[2].length }
}
