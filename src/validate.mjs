// The invariants, as data. Each rule has a stable code so a diagnostic can be
// grepped, suppressed by a reader, or pointed at in a commit message.
//
// Validation never writes. In particular it never "fixes" the week mismatch: per
// work/README.md that mismatch IS the record that a task slipped, and a tool
// that normalised it would delete the only trace of the slip.
import {
  STATUSES,
  REQUIRED_FIELDS,
  LEASE_FIELDS,
  MAX_ACTIVE_LEASES,
  ACTIVE_STATUSES,
  REQUESTER_REQUIRED_STATUSES,
  NOTIFIABLE_STATUSES,
  isWeek,
  parseDate,
  parseInstant,
  parseTaskId,
} from './convention.mjs'

export const RULES = [
  ['error', 'unreadable-file', 'the task file could not be read'],
  ['error', 'missing-frontmatter', 'the file has no frontmatter block'],
  ['error', 'malformed-frontmatter', 'the frontmatter block is not `key: value` throughout'],
  ['error', 'missing-field', 'a required frontmatter field is absent or empty'],
  ['error', 'id-mismatch', 'the filename id and `task:` disagree'],
  ['error', 'duplicate-task-id', 'two files in one project claim the same task id'],
  ['error', 'owner-mismatch', 'the filename `@OWNER` and `assignee:` disagree'],
  ['error', 'done-prefix-mismatch', 'the `x_` prefix and `status: done` disagree'],
  ['error', 'done-without-completed', '`status: done` with no `completed:` date'],
  ['error', 'completed-on-open', 'a task that is not done carries a `completed:` value'],
  ['error', 'invalid-status', '`status:` is not one of the documented states'],
  ['error', 'invalid-date', '`created:`, `completed:` or `notified:` is not `YYYY-MM-DD`'],
  ['error', 'notify-without-requester', '`status: notify` or `needs-info` with nobody in `requested-by:`'],
  ['error', 'invalid-week', '`week:` is not `YY-Wnn`'],
  ['error', 'invalid-week-folder', 'a directory under work/tasks/ is not `YY-Wnn` or `x_YY-Wnn`'],
  ['error', 'missing-blocked-by', '`blocked-by:` names a task id that does not exist in this project'],
  ['error', 'ambiguous-reference', '`blocked-by:` names an id that more than one file claims'],
  ['error', 'malformed-reference', '`blocked-by:` or `blocks:` holds something that is not a task id'],
  ['error', 'self-reference', 'a task blocks or is blocked by itself'],
  ['error', 'malformed-lease', 'an optional lease or parallelisation field is malformed'],
  ['error', 'project-path-missing', 'a registered project path does not exist or is not readable'],
  ['error', 'duplicate-project-path', 'two registered names point at the same directory'],
  ['warning', 'slipped-task', '`week:` and the week folder differ — the task slipped'],
  ['warning', 'unowned-task', 'an open task with no owner'],
  ['warning', 'notified-out-of-state', '`notified:` is set on a task that is neither `notify` nor `done`'],
  ['warning', 'open-task-in-closed-week', 'a task that is not done sits in an `x_` week folder'],
  ['warning', 'lease-limit-exceeded', `more than ${MAX_ACTIVE_LEASES} Executor leases are active`],
  ['warning', 'stale-lease', 'a lease is older than the staleness threshold'],
  ['warning', 'incomplete-lease', 'lease fields are present but not the coherent set'],
  ['warning', 'unrecognised-file', 'an entry under work/tasks/ does not follow the naming convention'],
]

const SEVERITY = new Map(RULES.map(([sev, code]) => [code, sev]))

function diag(code, task, message, extra = {}) {
  return {
    severity: SEVERITY.get(code) ?? 'error',
    code,
    message,
    project: task?.project,
    id: task?.id,
    file: task?.file,
    relPath: task?.relPath,
    ...extra,
  }
}

/**
 * @param {ReturnType<import('./scan.mjs').scanProject>} scan
 * @param {{now?: Date, staleLeaseHours?: number}} [options]
 */
export function validateScan(scan, { now = new Date(), staleLeaseHours = 24 } = {}) {
  const out = []
  const { project, tasks, strays } = scan

  if (scan.readError) {
    out.push({ severity: 'error', code: 'project-path-missing', project: project.name, message: scan.readError })
    return out
  }

  for (const stray of strays) {
    const isFolder = stray.kind === 'unknown-week-folder' || stray.kind === 'nested-directory'
    if (isFolder) {
      // A directory that hides task files is a structural error: every task in
      // it is invisible to every command. One that holds anything else — an
      // `archive/` of pre-convention notes — is a warning, said once.
      const hidden = stray.hiddenTasks ?? 0
      out.push({
        severity: hidden > 0 ? 'error' : 'warning',
        code: 'invalid-week-folder',
        project: project.name,
        file: stray.file,
        message: hidden > 0
          ? `work/tasks/${stray.name} is not a week folder (expected YY-Wnn or x_YY-Wnn) and hides ${hidden} task file${hidden === 1 ? '' : 's'}`
          : `work/tasks/${stray.name} is not a week folder; nothing in it is read`,
      })
      continue
    }
    out.push({
      severity: 'warning',
      code: 'unrecognised-file',
      project: project.name,
      file: stray.file,
      message: `work/tasks/${stray.name} does not match T-YY-NNN_slug[@OWNER].md`,
    })
  }

  // Index by id first: several rules need to know whether an id is unique.
  const byId = new Map()
  for (const t of tasks) {
    if (!byId.has(t.id)) byId.set(t.id, [])
    byId.get(t.id).push(t)
  }
  for (const [id, group] of byId) {
    if (group.length < 2) continue
    out.push({
      severity: 'error',
      code: 'duplicate-task-id',
      project: project.name,
      id,
      file: group[0].file,
      message: `${id} is claimed by ${group.length} files: ${group.map((t) => t.relPath).join(', ')}`,
      hint: 'The id is the identity within a project. Renumber one of them; never reuse.',
    })
  }

  for (const t of tasks) out.push(...validateTask(t, { byId, now, staleLeaseHours }))

  // Lease pressure is a per-project property, so it cannot be checked per file.
  const active = tasks.filter((t) => !t.done && t.leased)
  if (active.length > MAX_ACTIVE_LEASES) {
    out.push({
      severity: 'warning',
      code: 'lease-limit-exceeded',
      project: project.name,
      message: `${active.length} active Executor leases (${active.map((t) => t.id).join(', ')}); work/README.md allows at most ${MAX_ACTIVE_LEASES}`,
    })
  }

  return out
}

function validateTask(t, { byId, now, staleLeaseHours }) {
  const out = []

  if (t.readError) {
    out.push(diag('unreadable-file', t, `${t.relPath}: ${t.readError}`))
    return out
  }
  if (!t.frontmatter.present) {
    out.push(diag('missing-frontmatter', t, `${t.relPath} has no \`---\` frontmatter block`))
    return out
  }
  for (const err of t.frontmatter.errors) {
    out.push(diag('malformed-frontmatter', t, `${t.relPath}:${err.line}: ${err.message}`, { line: err.line }))
  }

  for (const field of REQUIRED_FIELDS) {
    const f = t.frontmatter.fields[field]
    const empty = !f || (f.kind === 'list' ? false : String(f.value).trim() === '')
    // `assignee: []` is a meaningful value — nobody owns it — not an omission.
    if (field === 'assignee' && f) continue
    if (empty) out.push(diag('missing-field', t, `${t.relPath}: \`${field}:\` is missing or empty`))
  }

  if (t.fmId && t.fmId !== t.id) {
    out.push(diag('id-mismatch', t, `${t.relPath}: filename says ${t.id}, \`task:\` says ${t.fmId}`))
  }

  // Filename owners vs assignee, as sets: `@ANA+BOR` and `assignee: [BOR, ANA]`
  // are the same assignment written in two orders, and one real task does
  // exactly that.
  if (t.fileOwners !== null) {
    const a = [...new Set(t.fileOwners)].sort()
    const b = [...new Set(t.assignee)].sort()
    if (a.join('+') !== b.join('+')) {
      out.push(diag(
        'owner-mismatch',
        t,
        `${t.relPath}: filename says @${a.join('+') || '(none)'}, \`assignee:\` says [${b.join(', ')}]`,
      ))
    }
  } else if (t.assignee.length) {
    out.push(diag('owner-mismatch', t, `${t.relPath}: \`assignee: [${t.assignee.join(', ')}]\` but the filename carries no @OWNER`))
  }

  if (t.status && !STATUSES.includes(t.status)) {
    out.push(diag('invalid-status', t, `${t.relPath}: unknown status \`${t.status}\``, {
      hint: `Known: ${STATUSES.join(', ')}`,
    }))
  }

  const isDone = t.status === 'done'
  if (isDone !== t.fileDone) {
    out.push(diag(
      'done-prefix-mismatch',
      t,
      isDone
        ? `${t.relPath}: \`status: done\` but the filename has no \`x_\` prefix`
        : `${t.relPath}: filename is prefixed \`x_\` but \`status:\` is \`${t.status || '(empty)'}\``,
    ))
  }
  if (isDone && !t.completed) {
    out.push(diag('done-without-completed', t, `${t.relPath}: \`status: done\` with no \`completed:\` date`))
  }
  if (!isDone && t.completed) {
    out.push(diag('completed-on-open', t, `${t.relPath}: \`completed: ${t.completed}\` on a task whose status is \`${t.status || '(empty)'}\``))
  }

  for (const field of ['created', 'completed', 'notified']) {
    const v = t[field]
    if (v && !parseDate(v)) out.push(diag('invalid-date', t, `${t.relPath}: \`${field}: ${v}\` is not YYYY-MM-DD`))
  }

  // `notify` cannot say who to write to and `needs-info` cannot say who to ask
  // without a requester. Both statuses exist to name the next human, so one that
  // names nobody is the status doing nothing.
  if (REQUESTER_REQUIRED_STATUSES.includes(t.status) && !t.requestedBy) {
    out.push(diag(
      'notify-without-requester',
      t,
      `${t.relPath}: \`status: ${t.status}\` with an empty \`requested-by:\``,
      { hint: t.status === 'notify' ? 'Nobody to notify.' : 'Nobody to ask.' },
    ))
  }
  // A `notified:` date anywhere else is a leftover from an earlier state, not a
  // record of anything. Deliberately not the mirror rule — a `done` task with a
  // requester and no `notified:` would fire on every task closed before the
  // field existed, and a warning that is on everywhere is a warning nobody
  // reads.
  if (t.notified && !NOTIFIABLE_STATUSES.includes(t.status)) {
    out.push(diag(
      'notified-out-of-state',
      t,
      `${t.id} has \`notified: ${t.notified}\` while its status is \`${t.status || '(empty)'}\``,
    ))
  }
  if (t.week && !isWeek(t.week)) {
    out.push(diag('invalid-week', t, `${t.relPath}: \`week: ${t.week}\` is not YY-Wnn`))
  }

  // The slipped-task signal. Informational by design: it is a true statement
  // about the project, not a defect in the file.
  if (t.slipped && isWeek(t.week)) {
    out.push(diag('slipped-task', t, `${t.id} is scheduled for ${t.week} and sits in ${t.folder}`))
  }
  if (!t.done && t.unowned) {
    out.push(diag('unowned-task', t, `${t.id} (${t.status || 'no status'}) has no owner`))
  }
  if (t.folderClosed && !t.done) {
    out.push(diag('open-task-in-closed-week', t, `${t.id} is \`${t.status || 'no status'}\` inside the closed week ${t.folder}`))
  }

  for (const [field, refs] of [['blocked-by', t.blockedBy], ['blocks', t.blocks]]) {
    for (const ref of refs) {
      if (!parseTaskId(ref)) {
        out.push(diag('malformed-reference', t, `${t.relPath}: \`${field}\` entry \`${ref}\` is not a T-YY-NNN id`))
        continue
      }
      if (ref === t.id) {
        out.push(diag('self-reference', t, `${t.relPath}: \`${field}\` names the task itself`))
        continue
      }
      const hits = byId.get(ref)
      if (!hits) {
        out.push(diag('missing-blocked-by', t, `${t.relPath}: \`${field}: ${ref}\` — no such task in this project`))
      } else if (hits.length > 1) {
        out.push(diag('ambiguous-reference', t, `${t.relPath}: \`${field}: ${ref}\` is ambiguous — ${hits.length} files claim that id`))
      }
    }
  }

  out.push(...validateLease(t, { now, staleLeaseHours }))
  return out
}

function validateLease(t, { now, staleLeaseHours }) {
  const out = []
  const lease = t.lease
  const present = LEASE_FIELDS.filter((k) => k in lease && String(lease[k] ?? '').length > 0)
  if (!present.length) return out

  const leasedAt = lease['leased-at']
  if (leasedAt) {
    const at = parseInstant(leasedAt)
    if (!at) {
      out.push(diag('malformed-lease', t, `${t.relPath}: \`leased-at: ${leasedAt}\` is not an ISO-8601 instant`))
    } else if (!t.done) {
      const hours = (now.getTime() - at.getTime()) / 3_600_000
      if (hours > staleLeaseHours) {
        out.push(diag('stale-lease', t, `${t.id} has been leased to ${lease['execution-owner'] || 'someone'} for ${Math.floor(hours)}h`))
      }
    }
  }

  for (const ref of lease['parallel-with'] ?? []) {
    if (!parseTaskId(ref)) {
      out.push(diag('malformed-lease', t, `${t.relPath}: \`parallel-with\` entry \`${ref}\` is not a T-YY-NNN id`))
    }
  }

  // A lease is a set of fields that only mean something together: a branch with
  // no worktree, or a worktree with nobody holding it, is a half-written
  // coordination record and the thing a stuck task looks like.
  if (!t.done) {
    const core = ['branch', 'worktree', 'execution-owner', 'leased-at']
    const missing = core.filter((k) => !lease[k])
    if (missing.length && missing.length < core.length) {
      out.push(diag('incomplete-lease', t, `${t.id} has lease fields ${present.join(', ')} but no ${missing.join(', ')}`))
    }
    if (present.length && !ACTIVE_STATUSES.includes(t.status)) {
      out.push(diag('incomplete-lease', t, `${t.id} carries lease fields while its status is \`${t.status || '(empty)'}\``))
    }
  }

  return out
}

/** Registry-level checks — the ones that are about registration, not markdown. */
export function validateRegistry(registry, { duplicates = [], missing = [] } = {}) {
  const out = []
  for (const g of duplicates) {
    out.push({
      severity: 'error',
      code: 'duplicate-project-path',
      message: `${g.path} is registered under ${g.names.length} names: ${g.names.join(', ')}`,
      hint: 'Everything keyed by project name splits silently. Remove all but one.',
    })
  }
  for (const m of missing) {
    out.push({
      severity: 'error',
      code: 'project-path-missing',
      project: m.name,
      message: `${m.name} -> ${m.path}: ${m.reason}`,
      hint: `work project remove ${m.name}`,
    })
  }
  return out
}

export function counts(diagnostics) {
  let errors = 0
  let warnings = 0
  for (const d of diagnostics) {
    if (d.severity === 'error') errors++
    else warnings++
  }
  return { errors, warnings, total: diagnostics.length }
}
