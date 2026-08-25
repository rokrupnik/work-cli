// End-to-end through main(): argument parsing, project selection, filters,
// exit codes and the JSON contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, readRegistry, tempConfigDir, copyFixture, snapshot, ALPHA, BETA, FIXTURES, NOW } from './helpers.mjs'

const both = [{ name: 'alpha', path: ALPHA }, { name: 'beta', path: BETA }]

// ------------------------------------------------------------------ selection

test('inside a registered project, the default view is that project', async () => {
  const r = await run([], { cwd: ALPHA, projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /^alpha/m)
  assert.equal(/^beta/m.test(r.out), false)
})

test('the project is inferred from a nested working directory', async () => {
  const r = await run([], { cwd: path.join(ALPHA, 'work', 'tasks', '26-W34'), projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /^alpha/m)
})

test('outside any registered project, every project is shown, and it says so', async () => {
  const r = await run([], { cwd: FIXTURES, projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /^alpha/m)
  assert.match(r.out, /^beta/m)
  assert.match(r.err, /not inside a registered project/)
})

test('--project wins over the working directory', async () => {
  const r = await run(['list', '--project', 'beta'], { cwd: ALPHA, projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /^beta/m)
  assert.equal(/^alpha/m.test(r.out), false)
})

test('--all covers every registered project even from inside one', async () => {
  const r = await run(['list', '--all'], { cwd: ALPHA, projects: both })
  assert.match(r.out, /^alpha/m)
  assert.match(r.out, /^beta/m)
})

test('an unknown project name exits 3 and lists what is registered', async () => {
  const r = await run(['list', '-p', 'gamma'], { projects: both })
  assert.equal(r.code, 3)
  assert.match(r.err, /no registered project named `gamma`/)
  assert.match(r.err, /alpha, beta/)
})

test('with nothing registered, the message says how to register', async () => {
  const r = await run([], { configDir: tempConfigDir() })
  assert.equal(r.code, 3)
  assert.match(r.err, /work project add/)
})

// -------------------------------------------------------------------- filters

test('done work is out of the way by default and available on request', async () => {
  const open = await run(['list'], { cwd: ALPHA, projects: both })
  assert.equal(/T-26-001/.test(open.out), false)

  const all = await run(['list', '--include-done'], { cwd: ALPHA, projects: both })
  assert.match(all.out, /T-26-001/)
  assert.match(all.out, /T-26-003/)

  const done = await run(['list', '--done'], { cwd: ALPHA, projects: both })
  assert.match(done.out, /T-26-001/)
  assert.equal(/T-26-003/.test(done.out), false)
})

test('filters compose', async () => {
  const r = await run(['list', '--owner', 'ANA', '--week', '26-W34'], { cwd: ALPHA, projects: both })
  assert.match(r.out, /T-26-003/)
  assert.equal(/T-26-008/.test(r.out), false, 'wrong week')
  assert.equal(/T-26-006/.test(r.out), false, 'wrong owner')
})

test('--owner is repeatable and comma-separable', async () => {
  const r = await run(['list', '--owner', 'CIT,BOR'], { cwd: ALPHA, projects: both })
  assert.match(r.out, /T-26-006/)
  assert.match(r.out, /T-26-008/)
  assert.equal(/T-26-003/.test(r.out), false)
})

test('--week matches the scheduled week and the folder both', async () => {
  // T-26-006 says `week: 26-W33` and sits in 26-W34. Both are true answers.
  const scheduled = await run(['list', '--week', '26-W33'], { cwd: ALPHA, projects: both })
  assert.match(scheduled.out, /T-26-006/)
  const folder = await run(['list', '--week', '26-W34'], { cwd: ALPHA, projects: both })
  assert.match(folder.out, /T-26-006/)
})

test('--slipped, --unowned, --blocked and --leased each surface their signal', async () => {
  const slipped = await run(['list', '--slipped'], { cwd: ALPHA, projects: both })
  assert.match(slipped.out, /T-26-006/)
  assert.equal(/T-26-003/.test(slipped.out), false)

  const unowned = await run(['list', '--unowned'], { cwd: ALPHA, projects: both })
  assert.match(unowned.out, /T-26-005/)

  const blocked = await run(['list', '--blocked'], { cwd: ALPHA, projects: both })
  assert.match(blocked.out, /T-26-007/)
  assert.match(blocked.out, /T-26-003/, 'the blocker is named in the BLOCKED BY column')

  const leased = await run(['list', '--leased'], { cwd: ALPHA, projects: both })
  assert.match(leased.out, /T-26-009/)
  assert.equal(/T-26-003/.test(leased.out), false)
})

test('the scheduled week and the current folder are both printed', async () => {
  const r = await run(['list', '--slipped'], { cwd: ALPHA, projects: both })
  assert.match(r.out, /SCHEDULED/)
  assert.match(r.out, /FOLDER/)
  const row = r.outLines.find((l) => l.includes('T-26-006'))
  assert.match(row, /26-W33/)
  assert.match(row, /26-W34/)
})

test('inside a section, a blank line separates the weeks', async () => {
  const r = await run(['list'], { cwd: ALPHA, projects: both })
  const lines = r.out.split('\n')

  // BOR holds one 26-W34 task and one 26-W35 task, in that order.
  const i = lines.findIndex((l) => l.includes('T-26-010'))
  assert.ok(i > 0, 'T-26-010 is on screen')
  assert.equal(lines[i + 1], '', 'a blank line where the week changes')
  assert.match(lines[i + 2], /T-26-008/)
})

test('rows of one week are not broken up', async () => {
  const r = await run(['list', '--owner', 'ANA'], { cwd: ALPHA, projects: both })
  const lines = r.out.split('\n')
  // ANA's three open tasks are all 26-W34 and must stay one block.
  const first = lines.findIndex((l) => l.includes('T-26-003'))
  const last = lines.findIndex((l) => l.includes('T-26-009'))
  assert.ok(first > 0 && last > first)
  assert.equal(lines.slice(first, last + 1).some((l) => l === ''), false)
})

test('the multi-project table names the project on every row', async () => {
  const r = await run(['list', '--all', '--group-by', 'owner'], { projects: both })
  assert.match(r.out, /PROJECT/)
})

test('an unknown flag is refused rather than ignored', async () => {
  const r = await run(['list', '--ownr', 'ANA'], { cwd: ALPHA, projects: both })
  assert.equal(r.code, 2)
  assert.match(r.err, /unknown option: --ownr/)
})

test('a bad enum value is refused with the list of good ones', async () => {
  const status = await run(['list', '--status', 'nearly'], { cwd: ALPHA, projects: both })
  assert.equal(status.code, 2)
  assert.match(status.err, /in-progress/)

  const week = await run(['list', '--week', 'next week'], { cwd: ALPHA, projects: both })
  assert.equal(week.code, 2)
  assert.match(week.err, /YY-Wnn/)

  const group = await run(['list', '--group-by', 'phase'], { cwd: ALPHA, projects: both })
  assert.equal(group.code, 2)
})

test('a stray positional is refused', async () => {
  const r = await run(['list', 'ANA'], { cwd: ALPHA, projects: both })
  assert.equal(r.code, 2)
  assert.match(r.err, /unexpected argument: ANA/)
})

test('a leading flag implies list', async () => {
  const r = await run(['--owner', 'ANA'], { cwd: ALPHA, projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /T-26-003/)
})

// ----------------------------------------------------------------------- json

test('--json is a stable object and nothing else is on stdout', async () => {
  const r = await run(['list', '--all', '--include-done', '--json'], { projects: both })
  const data = JSON.parse(r.out)
  assert.equal(data.tool, 'work')
  assert.deepEqual(data.projects.map((p) => p.name), ['alpha', 'beta'])

  const alpha = data.projects[0]
  assert.equal(alpha.counts.total, 10)
  assert.equal(alpha.counts.slipped, 1)
  assert.equal(alpha.counts.unowned, 1)

  const slipped = alpha.tasks.find((t) => t.id === 'T-26-006')
  assert.equal(slipped.week, '26-W33')
  assert.equal(slipped.folderWeek, '26-W34')
  assert.equal(slipped.slipped, true)
  assert.equal(slipped.path, 'work/tasks/26-W34/T-26-006_slipped-thing@CIT.md', 'forward slashes on every platform')
})

// ------------------------------------------------------------------- validate

test('validate: a clean project exits 0, a broken one exits 1', async () => {
  const good = await run(['validate', '-p', 'alpha'], { projects: both })
  assert.equal(good.code, 0)
  assert.match(good.out, /no errors/)

  const bad = await run(['validate', '-p', 'beta'], { projects: both })
  assert.equal(bad.code, 1)
  assert.match(bad.err, /duplicate-task-id/)
})

test('validate: --strict makes the warnings count', async () => {
  const lax = await run(['validate', '-p', 'alpha'], { projects: both })
  assert.equal(lax.code, 0)
  const strict = await run(['validate', '-p', 'alpha', '--strict'], { projects: both })
  assert.equal(strict.code, 1)
})

test('validate: findings go to stderr, the verdict to stdout', async () => {
  const r = await run(['validate', '-p', 'beta'], { projects: both })
  assert.match(r.err, /error/)
  assert.equal(r.outLines.length, 1)
  assert.match(r.out, /task files in beta/)
})

test('validate: --code narrows to one rule', async () => {
  const r = await run(['validate', '-p', 'alpha', '--code', 'slipped-task', '--strict'], { projects: both })
  assert.equal(r.code, 1)
  assert.match(r.err, /slipped-task/)
  assert.equal(/unowned-task/.test(r.err), false)
})

test('validate: --json carries the diagnostics', async () => {
  const r = await run(['validate', '-p', 'beta', '--json'], { projects: both })
  const data = JSON.parse(r.out)
  assert.ok(data.counts.errors > 0)
  assert.equal(data.diagnostics.every((d) => d.severity && d.code && d.message), true)
})

test('validate: --rules lists every rule with its severity', async () => {
  const r = await run(['validate', '--rules'], { projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /slipped-task/)
  assert.match(r.out, /duplicate-task-id/)
})

// -------------------------------------------------------------------- next-id

test('next-id prints one id on stdout', async () => {
  const r = await run(['next-id'], { cwd: ALPHA, projects: both })
  assert.equal(r.code, 0)
  assert.equal(r.out.trim(), 'T-26-013')
})

test('next-id refuses while ids are duplicated, and says why', async () => {
  const r = await run(['next-id', '-p', 'beta'], { projects: both })
  assert.equal(r.code, 1)
  assert.equal(r.out, '')
  assert.match(r.err, /T-26-010/)
  assert.match(r.err, /refusing to allocate/)
})

test('next-id needs one project when several are in scope', async () => {
  const r = await run(['next-id'], { cwd: FIXTURES, projects: both })
  assert.equal(r.code, 2)
  assert.match(r.err, /needs one project/)

  const all = await run(['next-id', '--all'], { cwd: FIXTURES, projects: both })
  assert.equal(all.code, 1, 'beta is still unsafe')
  assert.match(all.out, /alpha\tT-26-013/)
})

// -------------------------------------------------------------------- project

test('project add registers a canonical path and nothing else', async () => {
  const dir = copyFixture(ALPHA, 'gamma')
  const before = snapshot(dir)
  const configDir = tempConfigDir()

  const r = await run(['project', 'add', dir], { configDir })
  assert.equal(r.code, 0)

  const reg = readRegistry(configDir)
  assert.equal(reg.projects.length, 1)
  assert.equal(reg.projects[0].name, 'gamma')
  assert.equal(reg.projects[0].path, fs.realpathSync(dir))
  assert.deepEqual(Object.keys(reg.projects[0]).sort(), ['added', 'name', 'path'])
  assert.equal(snapshot(dir), before, 'the registered project must be untouched')
})

test('project add takes a name, and refuses a third argument', async () => {
  const dir = copyFixture(ALPHA, 'gamma')
  const configDir = tempConfigDir()
  const named = await run(['project', 'add', dir, 'my-name'], { configDir })
  assert.equal(named.code, 0)
  assert.equal(readRegistry(configDir).projects[0].name, 'my-name')

  const extra = await run(['project', 'add', dir, 'x', '# a comment'], { configDir: tempConfigDir() })
  assert.equal(extra.code, 2)
  assert.match(extra.err, /unexpected argument/)
})

test('project add refuses a directory with no work/tasks', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'work-empty-'))
  const r = await run(['project', 'add', empty], { configDir: tempConfigDir() })
  assert.equal(r.code, 3)
  assert.match(r.err, /has no work\/tasks/)
})

test('project add refuses a path that does not exist', async () => {
  const r = await run(['project', 'add', path.join(os.tmpdir(), 'work-nope-99999')], { configDir: tempConfigDir() })
  assert.equal(r.code, 3)
  assert.match(r.err, /no such directory/)
})

test('re-adding the same directory is a no-op, and a second name is refused', async () => {
  const dir = copyFixture(ALPHA, 'gamma')
  const configDir = tempConfigDir()
  await run(['project', 'add', dir], { configDir })

  const again = await run(['project', 'add', dir], { configDir })
  assert.equal(again.code, 0)
  assert.match(again.out, /already registered/)
  assert.equal(readRegistry(configDir).projects.length, 1)

  const alias = await run(['project', 'add', dir, 'gamma2'], { configDir })
  assert.equal(alias.code, 2)
  assert.match(alias.err, /two names/)
  assert.equal(readRegistry(configDir).projects.length, 1)
})

test('a symlink to an already-registered directory is the same project', {
  skip: process.platform === 'win32' && 'symlinks need privileges on Windows',
}, async () => {
  const dir = copyFixture(ALPHA, 'gamma')
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'work-link-')), 'gamma-link')
  fs.symlinkSync(dir, link)

  const configDir = tempConfigDir()
  await run(['project', 'add', dir], { configDir })
  const viaLink = await run(['project', 'add', link, 'other-name'], { configDir })
  assert.equal(viaLink.code, 2)
  assert.match(viaLink.err, /already registered/)
})

test('a name that is taken by another directory is refused', async () => {
  const one = copyFixture(ALPHA, 'one')
  const two = copyFixture(BETA, 'two')
  const configDir = tempConfigDir()
  await run(['project', 'add', one, 'shared'], { configDir })
  const clash = await run(['project', 'add', two, 'shared'], { configDir })
  assert.equal(clash.code, 2)
  assert.match(clash.err, /is taken by/)
})

test('project list marks the project the working directory is in', async () => {
  const r = await run(['project', 'list'], { cwd: ALPHA, projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /\* alpha/)
  assert.match(r.out, /^ {2}beta/m)
})

test('project remove forgets the registration and leaves the directory alone', async () => {
  const dir = copyFixture(ALPHA, 'gamma')
  const before = snapshot(dir)
  const configDir = tempConfigDir()
  await run(['project', 'add', dir], { configDir })

  const r = await run(['project', 'remove', 'gamma'], { configDir })
  assert.equal(r.code, 0)
  assert.deepEqual(readRegistry(configDir).projects, [])
  assert.equal(snapshot(dir), before)
  assert.equal(fs.existsSync(dir), true)
})

test('project show summarises weeks, statuses and owners', async () => {
  const r = await run(['project', 'show', 'alpha'], { projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /26-W34/)
  assert.match(r.out, /x_26-W33/)
  assert.match(r.out, /ANA/)
})

test('a registered path that disappeared is an environment failure, not an empty list', async () => {
  const gone = { name: 'ghost', path: path.join(os.tmpdir(), 'work-ghost-99999') }
  const list = await run(['list', '-p', 'ghost'], { projects: [gone] })
  assert.equal(list.code, 4)
  assert.match(list.err, /missing or unreadable/)

  const projects = await run(['project', 'list'], { projects: [gone] })
  assert.equal(projects.code, 4)
  assert.match(projects.out, /missing/)
})

// --------------------------------------------------------------------- doctor

test('doctor reports the install root, the registry and every project', async () => {
  const r = await run(['doctor'], { projects: both })
  assert.equal(r.code, 0)
  assert.match(r.out, /install root/)
  assert.match(r.out, /registry/)
  assert.match(r.out, /alpha/)
  assert.match(r.out, /no problems/)
})

test('doctor exits 1 when a registration is broken', async () => {
  const r = await run(['doctor'], { projects: [{ name: 'ghost', path: '/definitely/not/here' }] })
  assert.equal(r.code, 1)
  assert.match(r.out, /path does not exist/)
})

test('doctor --json is machine-readable', async () => {
  const r = await run(['doctor', '--json'], { projects: both })
  const data = JSON.parse(r.out)
  assert.equal(data.tool, 'work')
  assert.equal(data.counts.errors, 0)
  assert.deepEqual(data.projects.map((p) => p.name), ['alpha', 'beta'])
})

// ------------------------------------------------------------ help and safety

test('help and --version answer without a registry', async () => {
  const help = await run(['help'], { configDir: tempConfigDir() })
  assert.equal(help.code, 0)
  assert.match(help.out, /work — a read-only view/)

  const v = await run(['--version'], { configDir: tempConfigDir() })
  assert.equal(v.code, 0)
  assert.match(v.out.trim(), /^\d+\.\d+\.\d+$/)
})

test('an unknown command exits 2 and suggests the real ones', async () => {
  const r = await run(['plan'], { projects: both })
  assert.equal(r.code, 2)
  assert.match(r.err, /unknown command `plan`/)
  assert.match(r.err, /validate/)
})

test('a corrupt registry is one clear error, not a different failure per command', async () => {
  const configDir = tempConfigDir()
  fs.writeFileSync(path.join(configDir, 'projects.json'), '{ not json')
  const r = await run(['list'], { configDir })
  assert.equal(r.code, 4)
  assert.match(r.err, /not valid JSON/)
})

test('no command writes anything into a project', async () => {
  const alpha = copyFixture(ALPHA, 'alpha')
  const beta = copyFixture(BETA, 'beta')
  const projects = [{ name: 'alpha', path: alpha }, { name: 'beta', path: beta }]
  const before = snapshot(alpha) + snapshot(beta)
  const configDir = tempConfigDir()

  for (const argv of [
    ['list', '--all', '--include-done'],
    ['list', '--all', '--json'],
    ['validate', '--all'],
    ['next-id', '--all'],
    ['project', 'list'],
    ['project', 'show', 'alpha'],
    ['doctor'],
  ]) {
    await run(argv, { cwd: alpha, projects, configDir, now: NOW })
  }

  assert.equal(snapshot(alpha) + snapshot(beta), before)
})
