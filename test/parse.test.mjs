import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, scalar, list } from '../src/frontmatter.mjs'
import { parseTaskFilename, parseWeekFolder, splitOwners, parseTaskId, parseInstant, parseDate } from '../src/convention.mjs'

test('frontmatter: the documented block parses', () => {
  const fm = parseFrontmatter([
    '---',
    'task: T-26-050',
    'title: Build our own consent banner',
    'status: open',
    'assignee: [ROK]',
    'requested-by: Romina',
    'week: 26-W33',
    'created: 2026-08-10',
    'completed:',
    'blocked-by: [T-26-049]',
    '---',
    '',
    '# body',
  ].join('\n'))

  assert.equal(fm.present, true)
  assert.deepEqual(fm.errors, [])
  assert.equal(scalar(fm, 'task'), 'T-26-050')
  assert.equal(scalar(fm, 'title'), 'Build our own consent banner')
  assert.deepEqual(list(fm, 'assignee'), ['ROK'])
  assert.equal(scalar(fm, 'completed'), '')
  assert.deepEqual(list(fm, 'blocked-by'), ['T-26-049'])
})

test('frontmatter: a colon inside a value is part of the value', () => {
  const fm = parseFrontmatter('---\ntitle: Write the IT documentation (docs/dns.md): part two\n---\n')
  assert.equal(scalar(fm, 'title'), 'Write the IT documentation (docs/dns.md): part two')
})

test('frontmatter: commented-out fields are not fields', () => {
  const fm = parseFrontmatter([
    '---',
    'task: T-26-050',
    '# Optional while an Executor has an isolated worktree:',
    '# branch: task/T-26-050_consent-banner',
    '---',
  ].join('\n'))
  assert.deepEqual(fm.errors, [])
  assert.equal('branch' in fm.fields, false)
})

test('frontmatter: block lists parse like flow lists', () => {
  const fm = parseFrontmatter('---\nblocked-by:\n  - T-26-049\n  - T-26-021\n---\n')
  assert.deepEqual(list(fm, 'blocked-by'), ['T-26-049', 'T-26-021'])
})

test('frontmatter: a folded block scalar becomes one line', () => {
  const fm = parseFrontmatter([
    '---',
    'summary: >-',
    '  17 NOHrD templates were measured; 58 of',
    '  128 variants still fall back to the template image',
    'status: open',
    '---',
  ].join('\n'))
  assert.deepEqual(fm.errors, [])
  assert.equal(scalar(fm, 'summary'), '17 NOHrD templates were measured; 58 of 128 variants still fall back to the template image')
  assert.equal(scalar(fm, 'status'), 'open', 'the key after the block is still a key')
})

test('frontmatter: a literal block scalar keeps its line breaks', () => {
  const fm = parseFrontmatter('---\nnotes: |\n  first line\n  second line\nstatus: open\n---\n')
  assert.deepEqual(fm.errors, [])
  assert.equal(scalar(fm, 'notes'), 'first line\nsecond line')
  assert.equal(scalar(fm, 'status'), 'open')
})

test('frontmatter: a blank line inside a folded scalar starts a new paragraph', () => {
  const fm = parseFrontmatter('---\nwhy: >\n  one two\n\n  three\n---\n')
  assert.equal(scalar(fm, 'why'), 'one two\nthree')
})

test('frontmatter: indentation and chomping indicators are accepted and ignored', () => {
  for (const head of ['>', '>-', '>+', '|', '|-', '|+', '|2-']) {
    const fm = parseFrontmatter(`---\nx: ${head}\n  value\n---\n`)
    assert.deepEqual(fm.errors, [], head)
    assert.equal(scalar(fm, 'x'), 'value', head)
  }
})

test('frontmatter: a junk line is reported, not guessed at', () => {
  const fm = parseFrontmatter('---\ntask: T-26-018\nthis is not a field\n---\n')
  assert.equal(fm.errors.length, 1)
  assert.equal(fm.errors[0].line, 3)
  assert.equal(scalar(fm, 'task'), 'T-26-018')
})

test('frontmatter: an unclosed block is an error, not a whole-file parse', () => {
  const fm = parseFrontmatter('---\ntask: T-26-018\n\n# body that never closes the block\n')
  assert.equal(fm.present, true)
  assert.equal(fm.errors.length, 1)
})

test('frontmatter: no leading --- means no frontmatter', () => {
  const fm = parseFrontmatter('# Just prose\n')
  assert.equal(fm.present, false)
})

test('frontmatter: a BOM does not hide the block', () => {
  const fm = parseFrontmatter('﻿---\ntask: T-26-001\n---\n')
  assert.equal(fm.present, true)
  assert.equal(scalar(fm, 'task'), 'T-26-001')
})

test('frontmatter: CRLF line endings parse', () => {
  const fm = parseFrontmatter('---\r\ntask: T-26-001\r\nassignee: [ROK]\r\n---\r\n')
  assert.deepEqual(fm.errors, [])
  assert.equal(scalar(fm, 'task'), 'T-26-001')
  assert.deepEqual(list(fm, 'assignee'), ['ROK'])
})

test('filenames: the four documented shapes', () => {
  assert.deepEqual(parseTaskFilename('T-26-081_tasks-cli.md'), {
    done: false, id: 'T-26-081', year: 26, number: 81, padding: 3, slug: 'tasks-cli', owners: null,
  })
  assert.equal(parseTaskFilename('x_T-26-018_erp-feed@ROK.md').done, true)
  assert.deepEqual(parseTaskFilename('T-26-060_decision@ROK+UROS.md').owners, ['ROK', 'UROS'])
  assert.equal(parseTaskFilename('T-26-005_unowned.md').owners, null)
})

test('filenames: anything else is not a task file', () => {
  for (const name of ['README.md', 'notes.txt', 'T-26-1_short.md', 'T-2026-001_long.md', 'x_README.md']) {
    assert.equal(parseTaskFilename(name), null, name)
  }
})

test('week folders: open and closed', () => {
  assert.deepEqual(parseWeekFolder('26-W34'), { closed: false, week: '26-W34', year: 26, number: 34, folder: '26-W34' })
  assert.equal(parseWeekFolder('x_26-W33').closed, true)
  assert.equal(parseWeekFolder('ideas'), null)
  assert.equal(parseWeekFolder('26-w34'), null)
})

test('owners: an empty @ suffix is zero owners', () => {
  assert.deepEqual(splitOwners('ROK+UROS'), ['ROK', 'UROS'])
  assert.deepEqual(splitOwners(''), [])
  assert.deepEqual(splitOwners('rok'), ['ROK'])
})

test('ids, instants and dates', () => {
  assert.equal(parseTaskId('t-26-081').id, 'T-26-081')
  assert.equal(parseTaskId('T-26-0081').padding, 4)
  assert.equal(parseTaskId('nope'), null)
  assert.ok(parseInstant('2026-08-22T10:30:00+02:00'))
  assert.equal(parseInstant('yesterday afternoon'), null)
  assert.ok(parseDate('2026-08-10'))
  assert.equal(parseDate('18 August'), null)
})
