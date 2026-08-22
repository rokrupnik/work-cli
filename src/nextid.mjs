// The portable replacement for
//   ls work/tasks/**/T-*.md | grep -o 'T-[0-9]\{2\}-[0-9]\{3\}' | sort | tail -1
// which is bash-with-globstar and cannot be run as written in PowerShell — the
// reason a number got picked by eye and collided with an already-pushed one.
import { scanIds } from './scan.mjs'

/**
 * Highest existing task number anywhere under `work/`, plus one.
 *
 * Deliberately read-only: nothing is reserved and nothing is written, so two
 * people running this a second apart both get the same answer. The number is
 * only safe once one of them has created the file. This is stated rather than
 * papered over with a lock file, because a lock file in a git repo is a lie the
 * moment two clones exist.
 *
 * @param {string} projectDir
 * @param {{now?: Date}} [options]
 */
export function nextId(projectDir, { now = new Date() } = {}) {
  const found = scanIds(projectDir)

  const byId = new Map()
  for (const f of found) {
    if (!byId.has(f.id)) byId.set(f.id, [])
    byId.get(f.id).push(f)
  }
  const duplicates = [...byId.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => ({ id, files: group.map((g) => g.file) }))
    .sort((a, b) => a.id.localeCompare(b.id))

  let max = null
  let padding = 0
  let maxYear = 0
  for (const f of found) {
    if (f.padding > padding) padding = f.padding
    if (f.year > maxYear) maxYear = f.year
    // The counter is global and monotonic across weeks AND years, so the highest
    // NUMBER wins outright — comparing by year first would hand out a number
    // that an older-year file already holds.
    if (!max || f.number > max.number) max = f
  }
  if (!padding) padding = 3

  const currentYear = now.getUTCFullYear() % 100
  // Never go backwards: a clock set wrong, or a project seeded with next year's
  // ids, must not make the prefix regress.
  const year = Math.max(maxYear, currentYear)
  const number = (max?.number ?? 0) + 1
  const id = `T-${String(year).padStart(2, '0')}-${String(number).padStart(padding, '0')}`

  return {
    id,
    number,
    year,
    padding,
    scanned: found.length,
    max: max ? { id: max.id, file: max.file } : null,
    duplicates,
    safe: duplicates.length === 0,
  }
}
