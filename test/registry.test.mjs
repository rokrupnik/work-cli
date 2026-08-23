import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as registry from '../src/registry.mjs'
import { tempConfigDir, ALPHA, BETA } from './helpers.mjs'

const withDir = (dir) => ({ env: { WORK_CONFIG_DIR: dir } })

test('an absent registry is an empty one, not an error', () => {
  const reg = registry.load(withDir(path.join(os.tmpdir(), 'work-no-such-config-99999')))
  assert.deepEqual(reg.projects, [])
  assert.equal(reg.existed, false)
})

test('save then load round-trips, sorted by name', () => {
  const dir = tempConfigDir()
  registry.save({ projects: [{ name: 'zeta', path: BETA }, { name: 'alpha', path: ALPHA }] }, withDir(dir))
  const reg = registry.load(withDir(dir))
  assert.deepEqual(reg.projects.map((p) => p.name), ['alpha', 'zeta'])
  assert.equal(reg.version, registry.REGISTRY_VERSION)
})

test('the file on disk holds paths only', () => {
  const dir = tempConfigDir()
  registry.save({ projects: [{ name: 'alpha', path: ALPHA, added: '2026-08-22' }] }, withDir(dir))
  const raw = fs.readFileSync(path.join(dir, 'projects.json'), 'utf8')
  const data = JSON.parse(raw)
  assert.deepEqual(Object.keys(data).sort(), ['projects', 'version'])
  assert.deepEqual(Object.keys(data.projects[0]).sort(), ['added', 'name', 'path'])
  // Nothing about any task may reach this file.
  assert.equal(/T-26-|status|assignee|title/.test(raw), false)
})

test('a registry that is not JSON is a clear error', () => {
  const dir = tempConfigDir()
  fs.writeFileSync(path.join(dir, 'projects.json'), 'nope')
  assert.throws(() => registry.load(withDir(dir)), registry.RegistryError)
})

test('a registry with the wrong shape is a clear error', () => {
  const dir = tempConfigDir()
  fs.writeFileSync(path.join(dir, 'projects.json'), '{"version":1}')
  assert.throws(() => registry.load(withDir(dir)), /expected shape/)
})

test('byName is case-insensitive; a project name is not a password', () => {
  const reg = { projects: [{ name: 'acme-shop', path: ALPHA }] }
  assert.equal(registry.byName(reg, 'Acme-Shop').name, 'acme-shop')
  assert.equal(registry.byName(reg, 'nope'), null)
})

test('infer walks up from a nested directory', () => {
  const reg = { projects: [{ name: 'alpha', path: ALPHA }, { name: 'beta', path: BETA }] }
  const deep = path.join(ALPHA, 'work', 'tasks', '26-W34')
  assert.equal(registry.infer(reg, deep).name, 'alpha')
  assert.equal(registry.infer(reg, ALPHA).name, 'alpha')
  assert.equal(registry.infer(reg, os.tmpdir()), null)
})

test('infer prefers the nearest registration when one project sits inside another', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'work-outer-'))
  const inner = path.join(outer, 'packages', 'inner')
  for (const d of [outer, inner]) fs.mkdirSync(path.join(d, 'work', 'tasks'), { recursive: true })
  const reg = { projects: [{ name: 'outer', path: outer }, { name: 'inner', path: inner }] }
  assert.equal(registry.infer(reg, inner).name, 'inner')
  assert.equal(registry.infer(reg, outer).name, 'outer')
})

test('duplicatePaths finds one directory registered twice', () => {
  const reg = { projects: [{ name: 'a', path: ALPHA }, { name: 'b', path: ALPHA }, { name: 'c', path: BETA }] }
  const dupes = registry.duplicatePaths(reg)
  assert.equal(dupes.length, 1)
  assert.deepEqual(dupes[0].names.sort(), ['a', 'b'])
})

test('duplicatePaths follows platform casing rules', () => {
  const reg = { projects: [{ name: 'a', path: '/code/Acme' }, { name: 'b', path: '/code/acme' }] }
  assert.equal(registry.duplicatePaths(reg, { platform: 'win32' }).length, 1)
  assert.equal(registry.duplicatePaths(reg, { platform: 'darwin' }).length, 1)
  assert.equal(registry.duplicatePaths(reg, { platform: 'linux' }).length, 0)
})

test('looksLikeProject asks one question: is there a work/tasks directory', () => {
  assert.equal(registry.looksLikeProject(ALPHA), true)
  assert.equal(registry.looksLikeProject(path.join(ALPHA, 'work')), false)
  assert.equal(registry.looksLikeProject(os.tmpdir()), false)
})

test('save is atomic enough to survive an interrupted write', () => {
  const dir = tempConfigDir()
  registry.save({ projects: [{ name: 'alpha', path: ALPHA }] }, withDir(dir))
  // No temporary file is left behind for the next load to trip over.
  assert.deepEqual(fs.readdirSync(dir), ['projects.json'])
})
