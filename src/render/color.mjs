// Colour, off by default anywhere it could end up in a file or a CI log.
//
// The escape byte is built rather than written literally, so nothing in this
// repo carries a raw control character that a diff, an editor or a review tool
// would render as invisible.
const CSI = String.fromCharCode(27) + '['
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')

const CODES = {
  reset: 0, bold: 1, dim: 2,
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, grey: 90,
}

export function makeColor({ stream, env = process.env, force } = {}) {
  const enabled = force !== undefined
    ? force
    : Boolean(stream?.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb'
  const c = {}
  for (const [name, code] of Object.entries(CODES)) {
    c[name] = enabled ? (s) => `${CSI}${code}m${s}${CSI}0m` : (s) => String(s)
  }
  c.enabled = enabled
  return c
}

/** Printed width, ignoring escape sequences. */
export function width(s) {
  return String(s).replace(ANSI, '').length
}

export function strip(s) {
  return String(s).replace(ANSI, '')
}
