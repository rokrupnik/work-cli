// Dispatch. Everything the commands need — streams, cwd, clock, the loaded
// registry — arrives in one context object, so the whole CLI is callable from a
// test without a subprocess and without touching the real registry.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UsageError } from './args.mjs'
import { canonical, tilde } from './paths.mjs'
import * as registry from './registry.mjs'
import { makeColor } from './render/color.mjs'
import { SelectionError } from './select.mjs'
import { EXIT } from './exit.mjs'
import { listCommand } from './commands/list.mjs'
import { validateCommand } from './commands/validate.mjs'
import { nextIdCommand } from './commands/next-id.mjs'
import { projectCommand } from './commands/project.mjs'
import { doctorCommand } from './commands/doctor.mjs'
import { helpCommand } from './commands/help.mjs'

const COMMANDS = {
  list: listCommand,
  ls: listCommand,
  validate: validateCommand,
  check: validateCommand,
  'next-id': nextIdCommand,
  nextid: nextIdCommand,
  project: projectCommand,
  projects: projectCommand,
  doctor: doctorCommand,
  help: helpCommand,
}

export function version() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  try {
    return JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

/**
 * @param {string[]} argv
 * @param {{cwd: string, env: object, stdout: object, stderr: object, now?: Date}} io
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, io) {
  const env = io.env ?? {}
  const opts = { env, platform: io.platform ?? process.platform, home: io.home }
  const wantsColor = !argv.includes('--no-color')
  const color = makeColor({ stream: io.stdout, env, force: wantsColor ? undefined : false })

  const ctx = {
    cwd: io.cwd,
    env,
    opts,
    color,
    now: io.now ?? new Date(),
    version: version(),
    stdout: io.stdout,
    stderr: io.stderr,
    out: (line = '') => io.stdout.write(line + '\n'),
    err: (line = '') => io.stderr.write(line + '\n'),
    canonicalOf: (entry) => canonical(entry.path, opts),
  }

  // `--no-color` is accepted anywhere and consumed here, so no command has to
  // remember to declare it.
  const args = argv.filter((a) => a !== '--no-color')

  if (args.includes('--version') || args[0] === '-V') {
    ctx.out(ctx.version)
    return EXIT.OK
  }
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    // Bare `work` is the overview, not a wall of help: the whole point is to be
    // one word away from the answer. `work help` is the wall.
    if (!args.length) return run(listCommand, [], ctx)
    return helpCommand([], ctx)
  }

  let name = args[0]
  let rest = args.slice(1)
  // `work --owner ANA` — a leading flag means the implicit `list`.
  if (name.startsWith('-')) {
    rest = args
    name = 'list'
  }

  const command = COMMANDS[name]
  if (!command) {
    ctx.err(`work: unknown command \`${name}\``)
    ctx.err(`Try one of: ${Object.keys(COMMANDS).filter((k) => !['ls', 'check', 'nextid', 'projects'].includes(k)).join(', ')}`)
    ctx.err('Or: work help')
    return EXIT.USAGE
  }
  if (rest.includes('--help') || rest.includes('-h')) return helpCommand([name], ctx)

  return run(command, rest, ctx)
}

async function run(command, args, ctx) {
  // The registry is loaded once, before dispatch, so a broken one is a single
  // clear error rather than a different failure per command.
  try {
    ctx.registry = registry.load(ctx.opts)
  } catch (err) {
    if (err instanceof registry.RegistryError) {
      ctx.err(`work: ${err.message}`)
      if (err.hint) ctx.err(err.hint)
      return EXIT.ENVIRONMENT
    }
    throw err
  }

  try {
    return await command(args, ctx)
  } catch (err) {
    if (err instanceof UsageError) {
      ctx.err(`work: ${err.message}`)
      if (err.hint) ctx.err(err.hint)
      return err.code ?? EXIT.USAGE
    }
    if (err instanceof SelectionError) {
      ctx.err(`work: ${err.message}`)
      if (err.hint) ctx.err(err.hint)
      return err.code ?? EXIT.NO_PROJECT
    }
    if (err instanceof registry.RegistryError) {
      ctx.err(`work: ${err.message}`)
      if (err.hint) ctx.err(err.hint)
      return EXIT.ENVIRONMENT
    }
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
      ctx.err(`work: permission denied: ${tilde(err.path ?? '', ctx.opts)}`)
      return EXIT.ENVIRONMENT
    }
    throw err
  }
}
