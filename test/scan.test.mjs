import test from 'node:test'
import assert from 'node:assert/strict'
import { scanProject, scanIds } from '../src/scan.mjs'
import { nextId } from '../src/nextid.mjs'
import { ALPHA, BETA, NOW } from './helpers.mjs'

const alpha = () => scanProject({ name: 'alpha', dir: ALPHA })
const beta = () => scanProject({ name: 'beta', dir: BETA })

test('scan: every week folder and task file is found', () => {
  const s = alpha()
  assert.equal(s.readError, null)
  assert.deepEqual(s.weeks.map((w) => w.folder), ['x_26-W33', '26-W34', '26-W35'])
  assert.equal(s.tasks.length, 10)
  assert.deepEqual(s.strays, [])
})

test('scan: ideas are not tasks', () => {
  // T-26-012 lives in work/ideas/, so it must not appear in the overview even
  // though it carries a number.
  assert.equal(alpha().tasks.some((t) => t.id === 'T-26-012'), false)
})

test('scan: derived fields', () => {
  const byId = new Map(alpha().tasks.map((t) => [t.id, t]))

  const slipped = byId.get('T-26-006')
  assert.equal(slipped.week, '26-W33')
  assert.equal(slipped.folderWeek, '26-W34')
  assert.equal(slipped.slipped, true)

  const onTime = byId.get('T-26-003')
  assert.equal(onTime.slipped, false)

  assert.equal(byId.get('T-26-005').unowned, true)
  assert.deepEqual(byId.get('T-26-004').owners, ['ANA', 'BOR'])
  assert.equal(byId.get('T-26-001').done, true)
  assert.equal(byId.get('T-26-001').folderClosed, true)
  assert.equal(byId.get('T-26-009').leased, true)
  assert.equal(byId.get('T-26-003').leased, false)
  assert.deepEqual(byId.get('T-26-007').blockedBy, ['T-26-003'])
})

test('scan: strays are reported, never parsed and never silently dropped', () => {
  const s = beta()
  const kinds = s.strays.map((x) => x.kind).sort()
  assert.deepEqual(kinds, ['unknown-week-folder', 'unknown-week-folder', 'unrecognised-filename'])
  // A directory that is not a week folder contributes no tasks, whatever is in it.
  assert.equal(s.tasks.some((t) => t.file.includes('notes')), false)
  assert.equal(s.tasks.some((t) => t.id === 'T-26-030'), false)
  // How many task files each one hides is what decides the severity later.
  const byName = new Map(s.strays.map((x) => [x.name, x]))
  assert.equal(byName.get('backlog').hiddenTasks, 1)
  assert.equal(byName.get('notes').hiddenTasks, 0)
})

test('scan: a missing project is an error, not an empty backlog', () => {
  const s = scanProject({ name: 'ghost', dir: '/definitely/not/here' })
  assert.match(s.readError, /no work\/tasks/)
  assert.deepEqual(s.tasks, [])
})

test('scanIds: sees tasks, archived tasks and numbered ideas', () => {
  const ids = new Set(scanIds(ALPHA).map((f) => f.id))
  assert.equal(ids.has('T-26-001'), true, 'archived task')
  assert.equal(ids.has('T-26-009'), true, 'open task')
  assert.equal(ids.has('T-26-012'), true, 'numbered idea')
})

test('next-id: max plus one, and it counts the idea', () => {
  const r = nextId(ALPHA, { now: NOW })
  assert.equal(r.safe, true)
  assert.equal(r.max.id, 'T-26-012')
  assert.equal(r.id, 'T-26-013')
  assert.equal(r.padding, 3)
})

test('next-id: a gap is never reused', () => {
  // alpha jumps from T-26-010 to T-26-012; the answer is still max + 1.
  const ids = new Set(scanIds(ALPHA).map((f) => f.id))
  assert.equal(ids.has('T-26-011'), false)
  assert.equal(nextId(ALPHA, { now: NOW }).id, 'T-26-013')
})

test('next-id: refuses to allocate while an id is duplicated', () => {
  const r = nextId(BETA, { now: NOW })
  assert.equal(r.safe, false)
  assert.equal(r.duplicates.length, 1)
  assert.equal(r.duplicates[0].id, 'T-26-010')
})

test('next-id: the year never goes backwards', () => {
  const later = nextId(ALPHA, { now: new Date('2031-01-05T00:00:00Z') })
  assert.equal(later.id, 'T-31-013')
  const earlier = nextId(ALPHA, { now: new Date('2020-01-05T00:00:00Z') })
  assert.equal(earlier.id, 'T-26-013', 'a wrong clock must not regress the prefix')
})
