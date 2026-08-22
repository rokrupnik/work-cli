// Path handling. Everything here has to behave the same on macOS, Windows and
// Linux, so nothing in this file shells out and nothing assumes `/`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Expand a leading `~` and make the path absolute against `cwd`.
 * Shells expand `~` before the process sees it, but a path read out of the
 * registry file — or typed on Windows where nothing expands it — has not been.
 */
export function expandHome(p, { home = os.homedir() } = {}) {
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2))
  return p
}

/**
 * The one true form of a path: absolute, `~` expanded, symlinks resolved,
 * trailing separators dropped. Two registry entries that resolve to the same
 * canonical path are the same project however differently they were typed.
 *
 * Falls back to the merely-absolute form when the path does not exist, so that
 * `project add` can report "no such directory" itself rather than throwing here.
 */
export function canonical(p, { cwd = process.cwd(), home = os.homedir() } = {}) {
  const abs = path.resolve(cwd, expandHome(p, { home }))
  try {
    return fs.realpathSync(abs)
  } catch {
    return abs
  }
}

/**
 * Whether two canonical paths name the same directory.
 *
 * Case matters on Linux and does not on Windows. macOS is the awkward one: APFS
 * is case-INsensitive by default but case-preserving, so `~/Code/rls` and
 * `~/code/rls` are one directory on a stock Mac and two on a case-sensitive
 * volume. Treating darwin as insensitive is the conservative choice — it makes
 * `work` refuse a duplicate registration that would otherwise silently split one
 * project into two names, which is the failure that actually costs something.
 */
export function samePath(a, b, { platform = process.platform } = {}) {
  if (a === b) return true
  if (platform === 'win32' || platform === 'darwin') {
    return a.toLowerCase() === b.toLowerCase()
  }
  return false
}

/** Whether `child` is `parent` or lives underneath it. */
export function isInside(child, parent, { platform = process.platform } = {}) {
  if (samePath(child, parent, { platform })) return true
  const rel = path.relative(parent, child)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  return !path.isAbsolute(rel)
}

/** Every directory from `dir` up to the filesystem root, nearest first. */
export function ancestors(dir) {
  const out = []
  let d = path.resolve(dir)
  for (;;) {
    out.push(d)
    const up = path.dirname(d)
    if (up === d) return out
    d = up
  }
}

/**
 * Where the registry lives.
 *
 *   WORK_CONFIG_DIR   explicit override, any platform (used by the tests)
 *   Windows           %APPDATA%\work        (falls back to ~/AppData/Roaming/work)
 *   macOS / Linux     $XDG_CONFIG_HOME/work (falls back to ~/.config/work)
 *
 * macOS deliberately gets ~/.config rather than ~/Library/Application Support:
 * this is a terminal tool, its config is meant to be opened in an editor, and
 * ~/.config is where the rest of a developer's terminal tools already are.
 */
export function configDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.WORK_CONFIG_DIR) return path.resolve(expandHome(env.WORK_CONFIG_DIR, { home }))
  if (platform === 'win32') {
    const base = env.APPDATA || path.join(home, 'AppData', 'Roaming')
    return path.join(base, 'work')
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config')
  return path.join(base, 'work')
}

export function configFile(opts = {}) {
  return path.join(configDir(opts), 'projects.json')
}

/** Display a path with the home directory folded back to `~`. Cosmetic only. */
export function tilde(p, { home = os.homedir(), platform = process.platform } = {}) {
  if (isInside(p, home, { platform })) {
    const rel = path.relative(home, p)
    return rel === '' ? '~' : '~' + path.sep + rel
  }
  return p
}
