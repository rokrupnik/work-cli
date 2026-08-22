// Exit codes, in one place, because scripts and CI depend on them.
//
//   0  the command did what it was asked
//   1  the command ran and the answer is "no" — validation found errors, doctor
//      found problems, next-id could not guarantee a safe number
//   2  the command was written wrong — unknown flag, unknown subcommand, a value
//      that is not a week
//   3  no project could be resolved, or the named one is not registered
//   4  the environment is wrong — an unreadable registry, a registered path that
//      is no longer there
//
// The 1/2 split is the one that matters in CI: `work validate` returning 1 is a
// finding to act on, returning 2 means the pipeline is invoking it incorrectly
// and the findings were never produced.
export const EXIT = {
  OK: 0,
  VALIDATION: 1,
  USAGE: 2,
  NO_PROJECT: 3,
  ENVIRONMENT: 4,
}
