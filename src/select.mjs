// Which projects a command operates on, and which tasks survive the filters.
import fs from 'node:fs'
import { canonical, tilde } from './paths.mjs'
import * as registry from './registry.mjs'
import { scanProject, weekKey } from './scan.mjs'
import { ACTIVE_STATUSES } from './convention.mjs'

export class SelectionError extends Error {
  constructor(message, { hint, code = 3 } = {}) {
    super(message)
    this.name = 'SelectionError'
    this.hint = hint
    this.code = code
  }
}

/**
 * Resolve the projects in scope.
 *
 * The documented rule, one behaviour and no guessing:
 *   --project <name>   wins over everything, from anywhere
 *   --all              every registered project
 *   inside a project   that project
 *   outside            every registered project, with a note on stderr
 *
 * "Outside a project means all projects" rather than an error, because the
 * useful thing to see when you are nowhere in particular is everything, and the
 * note says which rule fired so the output is never mistaken for a filtered one.
 */
export function resolveProjects({ reg, names = [], all = false, cwd, opts = {} }) {
  if (names.length) {
    const picked = []
    for (const name of names) {
      const hit = registry.byName(reg, name)
      if (!hit) {
        throw new SelectionError(`no registered project named \`${name}\``, {
          hint: reg.projects.length
            ? `Registered: ${reg.projects.map((p) => p.name).join(', ')}`
            : 'Nothing is registered yet. Try: work project add <path>',
        })
      }
      if (!picked.some((p) => p.name === hit.name)) picked.push(hit)
    }
    return { projects: picked, reason: 'explicit' }
  }

  if (!reg.projects.length) {
    throw new SelectionError('no projects are registered', {
      hint: `Register one with:  work project add <path>\nThe registry lives at ${reg.file}`,
    })
  }

  if (all) return { projects: reg.projects, reason: 'all' }

  const here = registry.infer(reg, cwd, opts)
  if (here) return { projects: [here], reason: 'cwd' }
  return { projects: reg.projects, reason: 'outside' }
}

/** Read each selected project off disk. Missing paths become a scan error, not a throw. */
export function scanAll(projects, opts = {}) {
  return projects.map((entry) => {
    const dir = canonical(entry.path, opts)
    let ok = false
    try {
      ok = fs.statSync(dir).isDirectory()
    } catch { ok = false }
    if (!ok) {
      return {
        project: { name: entry.name, dir },
        tasks: [],
        weeks: [],
        strays: [],
        readError: `registered path is missing or unreadable: ${tilde(dir, opts)}`,
      }
    }
    return scanProject({ name: entry.name, dir })
  })
}

/**
 * Filters, all of them ANDed. Composing is the point: `--owner ROK --blocked`
 * is "Rok's blocked work", not two separate questions.
 */
export function filterTasks(tasks, f = {}) {
  return tasks.filter((t) => {
    if (!f.includeDone && t.done) return false
    if (f.onlyDone && !t.done) return false
    if (f.owners) {
      const owners = t.owners.map((o) => o.toLowerCase())
      if (f.owners.has('none') || f.owners.has('-')) {
        if (owners.length) return false
      } else if (!owners.some((o) => f.owners.has(o))) return false
    }
    if (f.statuses && !f.statuses.has(t.status)) return false
    if (f.weeks) {
      // A week filter matches the week the task is SCHEDULED for and the folder
      // it currently sits in. For a slipped task both are true answers to "what
      // is in 26-W34", and dropping either one hides exactly the task the
      // slipped-week signal exists to surface.
      const hit = f.weeks.has(String(t.week).toLowerCase()) || f.weeks.has(String(t.folderWeek).toLowerCase())
      if (!hit) return false
    }
    if (f.blocked && !isBlocked(t)) return false
    if (f.unowned && !t.unowned) return false
    if (f.slipped && !t.slipped) return false
    if (f.leased && !t.leased) return false
    if (f.active && !ACTIVE_STATUSES.includes(t.status)) return false
    return true
  })
}

export function isBlocked(t) {
  return t.status === 'blocked' || t.blockedBy.length > 0
}

export function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      (a.owners[0] ?? '~').localeCompare(b.owners[0] ?? '~') ||
      weekKey(a.week || a.folderWeek).localeCompare(weekKey(b.week || b.folderWeek)) ||
      a.idNumber - b.idNumber,
  )
}

/** Validate a `--week` argument early rather than silently matching nothing. */
export function checkWeeks(weeks) {
  if (!weeks) return
  for (const w of weeks) {
    // Lenient about the case of the `W` here — filters are typed by hand.
    // `week:` inside a file is still held to the documented `YY-Wnn`.
    if (!/^\d{2}-w\d{2}$/i.test(w)) {
      throw new SelectionError(`\`--week ${w}\` is not a week (expected YY-Wnn, e.g. 26-W34)`, { code: 2 })
    }
  }
}
