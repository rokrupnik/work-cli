#!/usr/bin/env node
// The executable is a shim so that the CLI itself stays importable and testable.
// No shell is involved on any platform: npm writes work / work.cmd / work.ps1
// shims around this file and node runs it directly.
import { main } from '../src/cli.mjs'

const code = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
})
process.exitCode = code
