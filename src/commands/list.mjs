// `work list` — the overview.
//
// Everything here is a projection of files that were read this run. The command
// never opens a file for writing, and there is no cache: the markdown is the
// source of truth and re-reading it every time is what keeps it so.
import { parseArgs, manyLower, UsageError } from '../args.mjs'
import { canonical, tilde } from '../paths.mjs'
import {
  resolveProjects, scanAll, filterTasks, sortTasks, isBlocked, isAwaitingNotice, checkWeeks,
} from '../select.mjs'
import { layout, streamWidth } from '../render/table.mjs'
import { STATUSES, ACTIVE_STATUSES } from '../convention.mjs'
import { taskToJson } from '../json.mjs'

const SPEC = {
  project: 'string',
  all: 'boolean',
  owner: 'string',
  status: 'string',
  week: 'string',
  blocked: 'boolean',
  notify: 'boolean',
  unowned: 'boolean',
  slipped: 'boolean',
  leased: 'boolean',
  active: 'boolean',
  done: 'boolean',
  'include-done': 'boolean',
  'group-by': 'string',
  json: 'boolean',
  'no-color': 'boolean',
}
const ALIASES = { p: 'project', o: 'owner', s: 'status', w: 'week', a: 'all', g: 'group-by' }

const GROUPINGS = ['owner', 'week', 'status', 'project', 'folder', 'none']

export async function listCommand(argv, ctx) {
  const { flags, positionals } = parseArgs(argv, SPEC, ALIASES)
  if (positionals.length) {
    throw new UsageError(`unexpected argument: ${positionals[0]}`, {
      hint: 'Filters are flags: work list --owner ANA --status open',
    })
  }

  const groupBy = flags['group-by'] ? String(flags['group-by'][flags['group-by'].length - 1]).toLowerCase() : 'owner'
  if (!GROUPINGS.includes(groupBy)) {
    throw new UsageError(`unknown --group-by value: ${groupBy}`, { hint: `Known: ${GROUPINGS.join(', ')}` })
  }

  const statuses = manyLower(flags, 'status')
  if (statuses) {
    for (const s of statuses) {
      if (!STATUSES.includes(s)) {
        throw new UsageError(`unknown --status value: ${s}`, { hint: `Known: ${STATUSES.join(', ')}` })
      }
    }
  }
  const weeks = manyLower(flags, 'week')
  checkWeeks(weeks)

  const selection = resolveProjects({
    reg: ctx.registry,
    names: flags.project ?? [],
    all: Boolean(flags.all),
    cwd: ctx.cwd,
    opts: ctx.opts,
  })
  const scans = scanAll(selection.projects, ctx.opts)

  // `--status done` or `--done` obviously wants the done ones; otherwise closed
  // work is out of the way by default. Two thirds of a mature corpus is done and
  // printing it every time buries the twenty lines that are live.
  const wantsDone = Boolean(flags.done) || Boolean(flags['include-done']) || (statuses?.has('done') ?? false)
  const filter = {
    includeDone: wantsDone,
    onlyDone: Boolean(flags.done) && !flags['include-done'],
    owners: manyLower(flags, 'owner'),
    statuses,
    weeks,
    blocked: Boolean(flags.blocked),
    notify: Boolean(flags.notify),
    unowned: Boolean(flags.unowned),
    slipped: Boolean(flags.slipped),
    leased: Boolean(flags.leased),
    active: Boolean(flags.active),
  }

  const views = scans.map((scan) => {
    const shown = sortTasks(filterTasks(scan.tasks, filter))
    return { scan, shown }
  })

  if (flags.json) {
    ctx.out(JSON.stringify(jsonPayload(views, selection, ctx), null, 2))
    return exitFor(views)
  }

  renderHuman(views, selection, ctx, { groupBy, filtered: isFiltered(flags) })
  return exitFor(views)
}

function exitFor(views) {
  // A missing project directory is an environment problem and must not look
  // like an empty backlog.
  return views.some((v) => v.scan.readError) ? 4 : 0
}

function isFiltered(flags) {
  return ['owner', 'status', 'week', 'blocked', 'notify', 'unowned', 'slipped', 'leased', 'active', 'done'].some((k) => flags[k])
}

function renderHuman(views, selection, ctx, { groupBy, filtered }) {
  const { color } = ctx
  const multi = views.length > 1
  const total = streamWidth(ctx.stdout, ctx.env)

  if (selection.reason === 'outside') {
    ctx.err(color.dim(`(not inside a registered project — showing all ${views.length})`))
  }

  let first = true
  for (const { scan, shown } of views) {
    if (!first) ctx.out('')
    first = false

    ctx.out(`${color.bold(scan.project.name)}  ${color.dim(tilde(scan.project.dir, ctx.opts))}`)

    if (scan.readError) {
      ctx.err(`${scan.project.name}: ${scan.readError}`)
      ctx.out(color.dim('  (unreadable)'))
      continue
    }

    if (!shown.length) {
      ctx.out(color.dim(filtered ? '  nothing matches those filters' : '  no open tasks'))
      ctx.out(summaryLine(scan, shown, color))
      continue
    }

    // Lay out once, across every row this project will print, so the columns
    // line up across group boundaries.
    const columns = columnsFor({ multi, groupBy })
    const groups = groupTasks(shown, groupBy)
    const grouped = groups.length > 1 || groups[0].label !== null
    const rowsByGroup = groups.map((g) => ({ ...g, rows: g.tasks.map((t) => rowFor(t, color)) }))
    const table = layout(rowsByGroup.flatMap((g) => g.rows), columns, {
      width: total,
      indent: grouped ? '  ' : '',
    })

    ctx.out('')
    ctx.out(color.bold(table.header()))
    for (const group of rowsByGroup) {
      if (group.label !== null) {
        ctx.out('')
        ctx.out(color.cyan(group.label) + color.dim(`  (${group.tasks.length})`))
      }
      // A blank line wherever the scheduled week changes. Inside one person's
      // section the week boundary is the only thing separating this week's work
      // from what is parked in a later one, and without the break the two run
      // together into a single wall of rows.
      let previousWeek = null
      group.rows.forEach((r, i) => {
        const week = scheduledWeek(group.tasks[i])
        if (previousWeek !== null && week !== previousWeek) ctx.out('')
        previousWeek = week
        ctx.out(table.row(r))
      })
    }

    ctx.out('')
    ctx.out(summaryLine(scan, shown, color))
    for (const note of notesFor(scan, color)) ctx.out(note)
  }
}

/**
 * The week a row is grouped under: the week it is scheduled for, falling back to
 * the folder it sits in when the frontmatter carries none. The same key
 * sortTasks() orders by, so the breaks always land between blocks and never in
 * the middle of one.
 */
function scheduledWeek(t) {
  return t.week || t.folderWeek
}

function columnsFor({ multi, groupBy }) {
  const cols = []
  if (multi && groupBy !== 'project') cols.push({ key: 'project', header: 'PROJECT', max: 18 })
  if (groupBy !== 'owner') cols.push({ key: 'owner', header: 'OWNER', max: 14 })
  cols.push({ key: 'id', header: 'TASK', min: 8 })
  cols.push({ key: 'title', header: 'TITLE', flex: true, priority: 10, min: 20 })
  if (groupBy !== 'week') cols.push({ key: 'week', header: 'SCHEDULED', min: 7 })
  if (groupBy !== 'folder') cols.push({ key: 'folder', header: 'FOLDER', min: 6 })
  if (groupBy !== 'status') cols.push({ key: 'status', header: 'STATUS', min: 6 })
  cols.push({ key: 'blockedBy', header: 'BLOCKED BY', flex: true, priority: 0, min: 10, max: 26 })
  return cols
}

function rowFor(t, color) {
  // The scheduled week and the folder are printed side by side and left to
  // disagree. That disagreement is the slip, per work/README.md; the colour only
  // makes it easier to spot, it does not create the signal.
  const folder = t.slipped ? color.yellow(t.folder) : color.dim(t.folder)
  return {
    project: t.project,
    owner: t.owners.length ? t.owners.join('+') : color.dim('(unowned)'),
    id: t.id,
    title: t.title || color.dim('(no title)'),
    week: t.week || color.dim('—'),
    folder,
    status: colorStatus(t.status, color),
    blockedBy: t.blockedBy.length ? t.blockedBy.join(', ') : color.dim('—'),
  }
}

function colorStatus(status, color) {
  // `needs-info` is not `blocked` in a different shade: red is our obstacle,
  // magenta is somebody else's move. And `notify` is deliberately not green —
  // green is `done`, and a debt that reads as finished is the exact mistake
  // putting `notify` before `done` exists to prevent.
  if (status === 'blocked') return color.red(status)
  if (status === 'needs-info') return color.magenta(status)
  if (status === 'notify') return color.blue(status)
  if (status === 'done') return color.green(status)
  if (ACTIVE_STATUSES.includes(status)) return color.yellow(status)
  if (!status) return color.dim('(none)')
  return status
}

function groupTasks(tasks, groupBy) {
  if (groupBy === 'none') return [{ label: null, tasks }]
  const key = {
    owner: (t) => (t.owners.length ? t.owners.join('+') : '(unowned)'),
    week: (t) => t.week || '(no week)',
    status: (t) => t.status || '(no status)',
    project: (t) => t.project,
    folder: (t) => t.folder,
  }[groupBy]

  const groups = new Map()
  for (const t of tasks) {
    const k = key(t)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  }
  // `(unowned)` last: it is a signal worth seeing, not the first thing to read.
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([label, list]) => ({ label, tasks: list }))
}

const rank = (label) => (label.startsWith('(') ? 1 : 0)

function summaryLine(scan, shown, color) {
  const all = scan.tasks
  const open = all.filter((t) => !t.done)
  const parts = [
    `${shown.length} shown`,
    `${open.length} open`,
    `${all.length - open.length} done`,
  ]
  const signals = []
  const blocked = open.filter(isBlocked).length
  const toNotify = open.filter(isAwaitingNotice).length
  const slipped = all.filter((t) => t.slipped).length
  const unowned = open.filter((t) => t.unowned).length
  const leased = open.filter((t) => t.leased).length
  if (blocked) signals.push(`${blocked} blocked`)
  if (toNotify) signals.push(`${toNotify} to notify`)
  if (slipped) signals.push(`${slipped} slipped`)
  if (unowned) signals.push(`${unowned} unowned`)
  if (leased) signals.push(`${leased} leased`)
  const line = parts.join(' · ') + (signals.length ? '  ·  ' + signals.join(' · ') : '')
  return color.dim(line)
}

function notesFor(scan, color) {
  const notes = []
  const active = scan.tasks.filter((t) => !t.done && t.leased)
  if (active.length > 2) {
    notes.push(color.yellow(`${active.length} Executor leases are active (${active.map((t) => t.id).join(', ')}); work/README.md allows two`))
  }
  return notes
}

function jsonPayload(views, selection, ctx) {
  return {
    tool: 'work',
    version: ctx.version,
    generated: ctx.now.toISOString(),
    selection: selection.reason,
    projects: views.map(({ scan, shown }) => ({
      name: scan.project.name,
      path: canonical(scan.project.dir, ctx.opts),
      error: scan.readError ?? null,
      counts: {
        total: scan.tasks.length,
        open: scan.tasks.filter((t) => !t.done).length,
        done: scan.tasks.filter((t) => t.done).length,
        shown: shown.length,
        blocked: scan.tasks.filter((t) => !t.done && isBlocked(t)).length,
        notify: scan.tasks.filter((t) => !t.done && isAwaitingNotice(t)).length,
        slipped: scan.tasks.filter((t) => t.slipped).length,
        unowned: scan.tasks.filter((t) => !t.done && t.unowned).length,
        leased: scan.tasks.filter((t) => !t.done && t.leased).length,
      },
      tasks: shown.map(taskToJson),
    })),
  }
}
