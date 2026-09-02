// The naming convention, in one place: what a week folder is called, what a task
// file is called, and how a task id is shaped. Everything else reads these.

/** `26-W34`, or `x_26-W33` for a closed week. */
export const WEEK_FOLDER = /^(x_)?(\d{2})-W(\d{2})$/
/**
 * `T-26-081_slug@ANA+BOR.md`, `x_T-26-018_slug@ANA.md`, or no `@OWNER` at all.
 * Three digits minimum, more allowed: the counter is documented as `NNN` but a
 * project that passes 999 keeps counting, and `T-26-1_x.md` is a typo rather
 * than a task.
 */
export const TASK_FILE = /^(x_)?(T-(\d{2})-(\d{3,}))_([^@]*?)(?:@([^.]*))?\.md$/i
/** A bare id, wherever one is referenced. */
export const TASK_ID = /^T-(\d{2})-(\d{3,})$/

// The state machine in work/README.md. `open`, `in-progress` and `done` are the
// original three; the rest arrived with the agent workflow. Anything outside the
// set is reported rather than shrugged at — a status nothing recognises is a
// status no filter will ever match.
//
// The order here is the order of the lifecycle, and `notify` sits BEFORE `done`
// on purpose. `done` brings the `x_` filename prefix, which sorts the file to
// the bottom of its week folder; a debt to a human parked down there among the
// finished work is a debt nobody reads. Before `done`, the file stays at the top
// until the mail is actually sent.
export const STATUSES = [
  'open',
  'planning',
  'ready',
  'in-progress',
  'review',
  'integrating',
  'changes-requested',
  'needs-info',
  'blocked',
  'notify',
  'done',
]

/** Statuses that mean an Executor-style seat is holding the task right now. */
export const ACTIVE_STATUSES = ['in-progress', 'review', 'integrating']

/**
 * Stalled, whoever's fault it is. Two statuses rather than one because the
 * distinction is the only thing that makes the reading useful: `blocked` is our
 * move and we cannot make it (a task dependency, a technical obstacle),
 * `needs-info` is somebody else's — a named person owes an answer, a decision or
 * a file. On the day rfx-odoo split them, every one of its stalled tasks was
 * waiting on a person, so the undivided status had been answering no question at
 * all. `--blocked` spans both: a filter that silently dropped half the stalled
 * work the day the convention grew would be worse than no filter.
 */
export const WAITING_STATUSES = ['blocked', 'needs-info']

/**
 * Statuses that cannot name nobody. `notify` would not know who to write to and
 * `needs-info` would not know who to ask, so both require a `requested-by:`.
 */
export const REQUESTER_REQUIRED_STATUSES = ['notify', 'needs-info']

/**
 * Where a `notified:` date is meaningful: while the notice is still owed, and
 * afterwards on the closed task. Anywhere else it is a leftover.
 */
export const NOTIFIABLE_STATUSES = ['notify', 'done']

/** Frontmatter every task file must carry. Anything beyond this is optional. */
export const REQUIRED_FIELDS = ['task', 'title', 'status', 'assignee', 'week', 'created']

/** Optional coordination fields. Tolerated and displayed, never acted on. */
export const LEASE_FIELDS = ['branch', 'worktree', 'execution-owner', 'leased-at', 'parallel-with']

/** At most two Executor worktrees may be active — work/README.md. */
export const MAX_ACTIVE_LEASES = 2

export function parseWeekFolder(name) {
  const m = WEEK_FOLDER.exec(name)
  if (!m) return null
  return { closed: Boolean(m[1]), week: `${m[2]}-W${m[3]}`, year: Number(m[2]), number: Number(m[3]), folder: name }
}

export function parseTaskFilename(name) {
  const m = TASK_FILE.exec(name)
  if (!m) return null
  const owners = m[6] === undefined ? null : splitOwners(m[6])
  return {
    done: Boolean(m[1]),
    id: m[2].toUpperCase(),
    year: Number(m[3]),
    number: Number(m[4]),
    padding: m[4].length,
    slug: m[5],
    owners,
  }
}

/** `ANA+BOR` -> ['ANA','BOR']. An empty `@` suffix is zero owners, not one. */
export function splitOwners(s) {
  return String(s)
    .split('+')
    .map((o) => o.trim().toUpperCase())
    .filter((o) => o !== '')
}

export function parseTaskId(s) {
  const m = TASK_ID.exec(String(s).trim().toUpperCase())
  if (!m) return null
  return { id: `T-${m[1]}-${m[2]}`, year: Number(m[1]), number: Number(m[2]), padding: m[2].length }
}

export function isWeek(s) {
  return /^\d{2}-W\d{2}$/.test(String(s).trim())
}

/** ISO-8601-ish instant, as `leased-at` is documented to hold. */
export function parseInstant(s) {
  const raw = String(s).trim()
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([.,]\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw)) return null
  const d = new Date(raw.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Plain `YYYY-MM-DD`, as `created` and `completed` hold. */
export function parseDate(s) {
  const raw = String(s).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
