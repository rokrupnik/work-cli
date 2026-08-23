// Path behaviour, including the Windows and macOS cases, tested on whatever
// platform happens to be running: every function takes the platform as an
// argument precisely so that neither OS is needed to check the other's rules.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonical, samePath, isInside, ancestors, configDir, configFile, expandHome, tilde } from '../src/paths.mjs'

test('samePath: Linux is case-sensitive, Windows and macOS are not', () => {
  const a = '/Users/you/Code/acme'
  const b = '/users/you/code/acme'
  assert.equal(samePath(a, b, { platform: 'linux' }), false)
  assert.equal(samePath(a, b, { platform: 'darwin' }), true)
  assert.equal(samePath(a, b, { platform: 'win32' }), true)
  assert.equal(samePath(a, a, { platform: 'linux' }), true)
})

test('samePath: Windows drive letters compare case-insensitively', () => {
  assert.equal(samePath('C:\\code\\acme', 'c:\\Code\\ACME', { platform: 'win32' }), true)
})

test('isInside: a nested directory is inside, a sibling is not', () => {
  const root = path.join(os.tmpdir(), 'work-isinside')
  assert.equal(isInside(path.join(root, 'src', 'lib'), root), true)
  assert.equal(isInside(root, root), true)
  assert.equal(isInside(path.join(os.tmpdir(), 'work-isinside-other'), root), false)
})

test('ancestors: walks up to the root and stops', () => {
  const list = ancestors(path.join(os.tmpdir(), 'a', 'b', 'c'))
  assert.equal(list[0], path.join(os.tmpdir(), 'a', 'b', 'c'))
  assert.equal(list[list.length - 1], path.parse(os.tmpdir()).root)
  assert.equal(new Set(list).size, list.length)
})

test('expandHome: a leading tilde expands, an embedded one does not', () => {
  assert.equal(expandHome('~/code/acme', { home: '/home/you' }), path.join('/home/you', 'code/acme'))
  assert.equal(expandHome('~', { home: '/home/you' }), '/home/you')
  assert.equal(expandHome('/opt/~/x', { home: '/home/you' }), '/opt/~/x')
})

test('configDir: documented location per platform', () => {
  assert.equal(
    configDir({ env: {}, platform: 'win32', home: 'C:\\Users\\you' }),
    path.join('C:\\Users\\you', 'AppData', 'Roaming', 'work'),
  )
  assert.equal(
    configDir({ env: { APPDATA: 'D:\\Roaming' }, platform: 'win32', home: 'C:\\Users\\you' }),
    path.join('D:\\Roaming', 'work'),
  )
  assert.equal(
    configDir({ env: {}, platform: 'darwin', home: '/Users/you' }),
    path.join('/Users/you', '.config', 'work'),
  )
  assert.equal(
    configDir({ env: { XDG_CONFIG_HOME: '/cfg' }, platform: 'linux', home: '/home/you' }),
    path.join('/cfg', 'work'),
  )
})

test('configDir: WORK_CONFIG_DIR overrides every platform default', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(
      configFile({ env: { WORK_CONFIG_DIR: path.join(os.tmpdir(), 'wc') }, platform, home: os.homedir() }),
      path.join(os.tmpdir(), 'wc', 'projects.json'),
    )
  }
})

test('canonical: resolves a symlink to its target', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'work-symlink-'))
  const real = path.join(base, 'real')
  const link = path.join(base, 'link')
  fs.mkdirSync(real)
  fs.symlinkSync(real, link)
  assert.equal(canonical(link), fs.realpathSync(real))
})

test('canonical: a path that does not exist still becomes absolute', () => {
  const missing = path.join(os.tmpdir(), 'work-does-not-exist-12345')
  assert.equal(canonical(missing), missing)
  assert.equal(path.isAbsolute(canonical('relative/thing', { cwd: os.tmpdir() })), true)
})

test('tilde: folds the home directory back for display', () => {
  assert.equal(tilde(path.join('/home/you', 'code', 'work'), { home: '/home/you', platform: 'linux' }), `~${path.sep}code${path.sep}work`)
  assert.equal(tilde('/opt/other', { home: '/home/you', platform: 'linux' }), '/opt/other')
})
