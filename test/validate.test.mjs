import test from 'node:test'
import assert from 'node:assert/strict'
import { scanProject } from '../src/scan.mjs'
import { validateScan, validateRegistry, counts, RULES } from '../src/validate.mjs'
import { ALPHA, BETA, NOW } from './helpers.mjs'

const codesFor = (dir, name, options) =>
  validateScan(scanProject({ name, dir }), { now: NOW, ...options })

const has = (diags, code) => diags.filter((d) => d.code === code)

test('a well-kept project has no errors', () => {
  const diags = codesFor(ALPHA, 'alpha')
  const errors = diags.filter((d) => d.severity === 'error')
  assert.deepEqual(errors.map((d) => `${d.code} ${d.message}`), [])
})

test('the informational signals are warnings, not errors', () => {
  const diags = codesFor(ALPHA, 'alpha')
  assert.equal(has(diags, 'slipped-task').length, 1)
  assert.equal(has(diags, 'slipped-task')[0].severity, 'warning')
  assert.equal(has(diags, 'slipped-task')[0].id, 'T-26-006')
  assert.equal(has(diags, 'unowned-task').length, 1)
  assert.equal(has(diags, 'unowned-task')[0].id, 'T-26-005')
})

test('a healthy lease raises nothing', () => {
  const diags = codesFor(ALPHA, 'alpha')
  assert.deepEqual(has(diags, 'stale-lease'), [])
  assert.deepEqual(has(diags, 'incomplete-lease'), [])
  assert.deepEqual(has(diags, 'malformed-lease'), [])
})

test('owner comparison is by set, not by string', () => {
  // T-26-004 is @ANA+BOR on disk and `assignee: [BOR, ANA]` inside.
  assert.deepEqual(has(codesFor(ALPHA, 'alpha'), 'owner-mismatch'), [])
})

test('every documented rule fires on the broken fixture', () => {
  const diags = codesFor(BETA, 'beta')
  const seen = new Set(diags.map((d) => d.code))
  const expected = [
    'duplicate-task-id',
    'id-mismatch',
    'owner-mismatch',
    'done-prefix-mismatch',
    'done-without-completed',
    'completed-on-open',
    'missing-frontmatter',
    'malformed-frontmatter',
    'invalid-status',
    'invalid-date',
    'invalid-week',
    'invalid-week-folder',
    'missing-blocked-by',
    'ambiguous-reference',
    'malformed-lease',
    'stale-lease',
    'incomplete-lease',
    'lease-limit-exceeded',
    'open-task-in-closed-week',
    'unrecognised-file',
  ]
  for (const code of expected) assert.equal(seen.has(code), true, `expected ${code}`)
})

test('a non-week folder is an error only when it hides task files', () => {
  const diags = has(codesFor(BETA, 'beta'), 'invalid-week-folder')
  assert.equal(diags.length, 2)
  const hiding = diags.find((d) => /backlog/.test(d.message))
  const harmless = diags.find((d) => /notes/.test(d.message))
  assert.equal(hiding.severity, 'error')
  assert.match(hiding.message, /hides 1 task file/)
  assert.equal(harmless.severity, 'warning')
})

test('block scalars in the frontmatter are not a malformed file', () => {
  const diags = codesFor(ALPHA, 'alpha')
  assert.deepEqual(has(diags, 'malformed-frontmatter'), [])
})

test('notify and needs-info must name a person', () => {
  const diags = has(codesFor(BETA, 'beta'), 'notify-without-requester')
  assert.deepEqual(diags.map((d) => d.id).sort(), ['T-26-031', 'T-26-032'])
  assert.equal(diags.every((d) => d.severity === 'error'), true)
  // The ones that do name a person raise nothing.
  assert.deepEqual(has(codesFor(ALPHA, 'alpha'), 'notify-without-requester'), [])
})

test('a notified: date outside notify or done is a warning', () => {
  const diags = has(codesFor(BETA, 'beta'), 'notified-out-of-state')
  assert.equal(diags.length, 1)
  assert.equal(diags[0].id, 'T-26-033')
  assert.equal(diags[0].severity, 'warning')
  // On `notify` and on `done` it is exactly where it belongs.
  assert.deepEqual(has(codesFor(ALPHA, 'alpha'), 'notified-out-of-state'), [])
})

test('notified: is held to the same date format as created and completed', () => {
  const diags = has(codesFor(BETA, 'beta'), 'invalid-date')
  const bad = diags.find((d) => d.id === 'T-26-034')
  assert.ok(bad, 'the non-date is reported')
  assert.equal(bad.severity, 'error')
  assert.match(bad.message, /notified: sometime last week/)
})

test('a closed task that recorded its notice is not a finding', () => {
  const errors = codesFor(ALPHA, 'alpha').filter((d) => d.severity === 'error')
  assert.deepEqual(errors, [])
})

test('the duplicate id names both files', () => {
  const [d] = has(codesFor(BETA, 'beta'), 'duplicate-task-id')
  assert.equal(d.id, 'T-26-010')
  assert.match(d.message, /duplicate-one/)
  assert.match(d.message, /duplicate-two/)
})

test('a reference to a duplicated id is ambiguous, not missing', () => {
  const diags = codesFor(BETA, 'beta')
  const amb = has(diags, 'ambiguous-reference')
  assert.equal(amb.length, 1)
  assert.equal(amb[0].id, 'T-26-021')
  assert.equal(has(diags, 'missing-blocked-by')[0].id, 'T-26-020')
})

test('the done prefix and the status are checked in both directions', () => {
  const msgs = has(codesFor(BETA, 'beta'), 'done-prefix-mismatch').map((d) => d.message)
  assert.equal(msgs.length, 2)
  assert.equal(msgs.some((m) => /no `x_` prefix/.test(m)), true)
  assert.equal(msgs.some((m) => /prefixed `x_`/.test(m)), true)
})

test('lease staleness is a threshold, and the threshold is a knob', () => {
  const strict = has(codesFor(BETA, 'beta', { staleLeaseHours: 1 }), 'stale-lease')
  const loose = has(codesFor(BETA, 'beta', { staleLeaseHours: 24 * 30 }), 'stale-lease')
  assert.ok(strict.length > loose.length)
  assert.equal(loose.length, 0)
})

test('the lease limit is a project-level finding', () => {
  const [d] = has(codesFor(BETA, 'beta'), 'lease-limit-exceeded')
  assert.equal(d.project, 'beta')
  assert.equal(d.id, undefined)
  assert.match(d.message, /allows at most 2/)
})

test('registry findings: duplicate paths and missing projects', () => {
  const diags = validateRegistry({}, {
    duplicates: [{ path: '/code/acme', names: ['acme', 'acme-shop'] }],
    missing: [{ name: 'ghost', path: '/gone', reason: 'no work/tasks/ directory here' }],
  })
  assert.deepEqual(diags.map((d) => d.code), ['duplicate-project-path', 'project-path-missing'])
  assert.equal(diags.every((d) => d.severity === 'error'), true)
})

test('every rule code used is a declared rule', () => {
  const declared = new Set(RULES.map(([, code]) => code))
  const used = new Set([...codesFor(ALPHA, 'alpha'), ...codesFor(BETA, 'beta')].map((d) => d.code))
  for (const code of used) assert.equal(declared.has(code), true, `${code} is not declared in RULES`)
})

test('counts split errors from warnings', () => {
  const c = counts(codesFor(BETA, 'beta'))
  assert.ok(c.errors > 0)
  assert.ok(c.warnings > 0)
  assert.equal(c.total, c.errors + c.warnings)
})
