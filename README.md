# work

A terminal view over `work/tasks/` markdown, across every project you register.

The task files are already structured — `work/README.md` in the projects that use
them puts it plainly: *"the filename is the interface for humans; the frontmatter
is the interface for tooling."* This is the consumer of that second half. It reads
the markdown on every run and answers the questions the folder layout answers
badly: who has what open, what is blocked on what, what slipped.

It is a **view**. It never writes to a project, and it has no database of its own.
The markdown is the source of truth; the moment a tool can edit a task from
outside the file, the two drift, and that is the exact failure the file-based
setup was chosen to avoid. If you want to change a task, open the file.

```
$ work
rls-astro  ~/code/rls/rls-astro

  TASK      TITLE                                                        SCHEDULED  FOLDER  STATUS       BLOCKED BY

ROK  (21)
  T-26-050  Build our own consent banner                                 26-W34     26-W34  open         T-26-072
  T-26-071  Rename the configurator tables and columns to what everyth…  26-W34     26-W34  in-progress  —

YUN  (2)
  T-26-029  Re-export the four homepage card images at a usable resolu…  26-W33     26-W34  open         —

(unowned)  (1)
  T-26-081  Build a portable task overview CLI                           26-W34     26-W34  blocked      —

32 shown · 32 open · 48 done  ·  3 blocked · 1 slipped · 1 unowned
```

`T-26-029` above is scheduled for `26-W33` and sitting in `26-W34`. That is a
slipped task, and the disagreement between those two columns is the only record
of the slip. `work` surfaces it and never normalises it away.

## What it does, and what it deliberately does not

**Does** — discover registered projects, parse their task markdown, show and
filter an overview across one project or all of them, validate the conventions,
compute the next free task id, and surface owners, blockers, schedules, slips and
Executor leases.

**Does not** — plan, execute or review work; invoke an agent; create worktrees;
touch branches, commits, merges or deploys; change a task's state; edit or create
a task file; or copy task data into a store of its own. It is a visibility and
validation tool, not an orchestrator.

## Install

Requires Node.js 22 or newer (20.10+ works). No runtime dependencies.

```bash
git clone <this> ~/code/work
cd ~/code/work
npm link
```

`npm link` puts a `work` shim in your npm global bin directory and points it at
this checkout, so edits here take effect immediately. Then:

```bash
work doctor
```

which prints the install root, where the registry lives, every registered
project, and whether the `work` your shell finds is actually this one.

**Windows.** The same two commands. `npm link` writes `work.cmd` and `work.ps1`
shims next to `work`, and `work doctor` honours `PATHEXT` when it checks which
one your shell will pick.

If `work: command not found`, your npm global bin directory is not on `PATH`:

```bash
npm config get prefix
```

Add `<prefix>/bin` (POSIX) or `<prefix>` (Windows) to `PATH`.

### Verify that `work` is this project

```bash
work doctor
```

The `work on PATH` line resolves the shim through its symlink and says whether it
lands in this checkout. `npm ls -g --depth=0` lists it as a global link.

### Uninstall

```bash
cd ~/code/work
npm unlink -g work
```

The registry file is left alone — remove it by hand if you want it gone. Removing
`work` never affects a registered project.

### Install a copy instead of a link

```bash
npm install -g ~/code/work
```

Use this when you want the CLI to stay put while you edit the checkout. It is not
published to npm and is not meant to be.

## Registering projects

A project is any directory with `work/tasks/<YY-Wnn>/*.md` under it.

```bash
work project add ~/code/rls/rls-astro          # name defaults to the directory
work project add ~/code/other-repo shorthand   # or give it one
work project list
work project show rls-astro
work project remove rls-astro
```

Adding a project stores **one line**: a name and a canonical absolute path.
Nothing is written into the project — no template, no `AGENTS.md`, no settings
file, no directory. Removing it deletes the registration and nothing else.

Registering one directory under two names is refused. Everything keyed by project
name would split silently, and a warning you can ignore is not enough.

### Where the registry lives

| Platform | Path |
|---|---|
| macOS | `~/.config/work/projects.json` (or `$XDG_CONFIG_HOME/work/`) |
| Linux | `$XDG_CONFIG_HOME/work/projects.json`, else `~/.config/work/` |
| Windows | `%APPDATA%\work\projects.json` (usually `C:\Users\<you>\AppData\Roaming\work\`) |

`WORK_CONFIG_DIR` overrides all three — the tests use it, and so can a script
that wants an isolated registry.

macOS gets `~/.config` rather than `~/Library/Application Support` on purpose:
this is a terminal tool, its registry is meant to be opened in an editor, and
`~/.config` is where the rest of your terminal tools already are.

The file:

```json
{
  "version": 1,
  "projects": [
    { "name": "rls-astro", "path": "/Users/rok/code/rls/rls-astro", "added": "2026-08-22" }
  ]
}
```

Paths only. No task ever enters this file.

A JSON file rather than a directory of symlinks: symlinks are the nicer design on
a Mac and a liability on Windows, where creating one needs Developer Mode or an
elevated process. A registration step that fails for half a team is not a
registration step.

## Commands

```
work                            the overview for wherever you are
work list [filters]             the same, spelled out
work validate [filters]         check the conventions
work next-id                    highest task number + 1
work project add <path> [name]
work project list
work project show <name>
work project remove <name>
work doctor
work help [command]
```

### Which project you get

| | |
|---|---|
| Inside a registered project | that project — inferred by walking up from the working directory |
| Outside one | **every** registered project, with a note on stderr saying why |
| `--project <name>` / `-p` | wins over both, from anywhere; repeatable |
| `--all` / `-a` | every registered project |

The "outside means all" rule is a choice, and it is the documented one: when you
are nowhere in particular, everything is the useful answer, and the note on stderr
means the output is never mistaken for a filtered one.

Task numbering is per project. Whenever more than one project is on screen, the
`PROJECT` column is there too, so two projects' `T-26-004`s can never be confused.

### Filters

All of them compose; `--owner ROK --blocked` is one question, not two.

```
-o, --owner <NAME>       repeatable, comma-separable; --owner none for unowned
-s, --status <STATE>     open planning ready in-progress review integrating
                         changes-requested blocked done
-w, --week <YY-Wnn>      matches the scheduled week AND the current folder
    --blocked            status: blocked, or a non-empty blocked-by
    --unowned            no @OWNER and no assignee
    --slipped            week: and the week folder disagree
    --leased             carries Executor worktree fields
    --active             in-progress, review or integrating
    --done               only finished tasks
    --include-done       open and finished together
-g, --group-by <KEY>     owner (default) | week | status | project | folder | none
    --json               stable machine-readable output
    --no-color           accepted by every command; NO_COLOR is honoured too
```

Finished tasks are hidden by default. Two thirds of a mature corpus is done, and
printing all of it buries the twenty lines that are live.

`--week 26-W34` matches a task scheduled for that week *and* a task sitting in
that folder. For a slipped task both are true answers, and dropping either would
hide exactly the task the slip signal exists to surface.

### Output

Human output goes to **stdout**, one plain line at a time — it pipes and greps.
Columns are laid out to the terminal width (or `COLUMNS`, or 100 when neither is
available), and `TITLE` and `BLOCKED BY` give way before anything else does.

`--json` is the stable contract; the human table can be re-laid out at any time,
that cannot. Paths in JSON always use forward slashes, on every platform.

Diagnostics — validation findings, "this project's path is gone", "you are not
inside a project" — go to **stderr**, so `work validate > report.txt` still shows
you what is wrong and `work list --json | jq` is never polluted.

## Validation

```bash
work validate              # the current project
work validate --all        # every registered project
work validate --strict     # warnings fail too
work validate --rules      # every rule and its severity
```

Errors are things that are wrong. Warnings are things that are true and worth
seeing — a task that slipped is not a defect in the file.

| Severity | Code | What it means |
|---|---|---|
| error | `unreadable-file` | the task file could not be read |
| error | `missing-frontmatter` | the file has no frontmatter block |
| error | `malformed-frontmatter` | the block is not `key: value` throughout |
| error | `missing-field` | `task`, `title`, `status`, `assignee`, `week` or `created` is absent or empty |
| error | `id-mismatch` | the filename id and `task:` disagree |
| error | `duplicate-task-id` | two files in one project claim the same id |
| error | `owner-mismatch` | the filename `@OWNER` and `assignee:` disagree (compared as sets, so `@ROK+UROS` and `[UROS, ROK]` agree) |
| error | `done-prefix-mismatch` | the `x_` prefix and `status: done` disagree, either way round |
| error | `done-without-completed` | `status: done` with no `completed:` date |
| error | `completed-on-open` | a task that is not done carries a `completed:` value |
| error | `invalid-status` | a status outside the documented state machine |
| error | `invalid-date` | `created:` or `completed:` is not `YYYY-MM-DD` |
| error | `invalid-week` | `week:` is not `YY-Wnn` |
| error | `invalid-week-folder` | a directory under `work/tasks/` is not a week folder **and hides task files** — every task in it is invisible (a warning when it hides none, e.g. an `archive/` of pre-convention notes) |
| error | `missing-blocked-by` | `blocked-by:`/`blocks:` names an id no file in the project has |
| error | `ambiguous-reference` | it names an id more than one file claims |
| error | `malformed-reference` | it holds something that is not a task id |
| error | `self-reference` | a task blocks or is blocked by itself |
| error | `malformed-lease` | `leased-at:` is not ISO-8601, or `parallel-with:` is not ids |
| error | `duplicate-project-path` | two registered names point at one directory |
| error | `project-path-missing` | a registered path is gone or has no `work/tasks/` |
| warning | `slipped-task` | `week:` and the week folder differ |
| warning | `unowned-task` | an open task with no owner |
| warning | `open-task-in-closed-week` | a live task inside an `x_` week folder |
| warning | `lease-limit-exceeded` | more than two Executor leases are active |
| warning | `stale-lease` | a lease older than `--stale-hours` (default 24) |
| warning | `incomplete-lease` | some lease fields but not a coherent set |
| warning | `unrecognised-file` | an entry under `work/tasks/` the convention does not name |

Validation never rewrites a project. In particular it never "fixes" a slipped
week: that mismatch is the record, and repairing it would delete the only trace.

## Next task id

```bash
$ work next-id
T-26-082
```

Scans every numbered file under `work/` — open tasks, done tasks, archived weeks
and ideas that already took a number — takes the highest number, adds one, and
keeps the project's own prefix and zero-padding. A gap is never reused.

This replaces the documented shell one-liner
(`ls work/tasks/**/T-*.md | grep -o … | sort | tail -1`), which is bash with
globstar and cannot run as written in PowerShell — the reason a number once got
picked by eye and collided with an already-pushed one.

**It does not reserve the number.** Nothing is written and nothing is locked, so
two people running it a second apart get the same answer. It becomes yours when
you create the file. A lock file in a git repo is a lie the moment two clones
exist, so there isn't one.

If any id in the project is already duplicated, `next-id` refuses and exits 1:
while one number means two things, max+1 is not evidence that the next one is
free.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the command did what it was asked |
| 1 | the command ran and the answer is "no" — validation errors, doctor problems, an unsafe `next-id` |
| 2 | the command was written wrong — unknown flag or subcommand, a value that is not a week |
| 3 | no project could be resolved, or the named one is not registered |
| 4 | the environment is wrong — an unreadable registry, a registered path that is gone |

The 1/2 split is the one that matters in CI: `work validate` returning 1 is a
finding to act on; returning 2 means the pipeline is calling it wrongly and the
findings were never produced.

```yaml
- run: work validate --project my-repo --strict
```

## The conventions it reads

```
<project>/work/tasks/26-W34/T-26-081_tasks-cli@ROK.md
<project>/work/tasks/x_26-W33/x_T-26-018_erp-feed@ROK+UROS.md
                     │        │  │        │           └── owners; none at all means unowned
                     │        │  │        └── slug
                     │        │  └── id: stable, per project, never reused
                     │        └── x_ prefix: done
                     └── x_ prefix: the week is closed
```

Frontmatter, as documented by the projects themselves:

```yaml
task: T-26-050
title: Build our own consent banner
status: open            # open planning ready in-progress review
                        # integrating changes-requested blocked done
assignee: [ROK]         # empty list = unowned
requested-by: Romina    # who asked; not the assignee
week: 26-W33            # the week it was SCHEDULED for
created: 2026-08-10
completed:              # set when status flips to done
blocked-by: [T-26-049]
# while an Executor holds a worktree:
branch: task/T-26-050_consent-banner
worktree: .worktrees/T-26-050
execution-owner: executor-1
leased-at: 2026-08-22T10:30:00+02:00
parallel-with: [T-26-051]
```

Values may be plain scalars, `[flow, lists]`, `- block` lists, or `>`/`|` block
scalars — the buka-derived template writes `summary: >-` and `writes-production: >-`,
and those are part of the subset rather than a malformed file.

The lease fields are tolerated, displayed and checked for coherence — and that is
all. `work` does not create worktrees, dispatch anything, or move a task between
states.

Identity is the **id**, never the title and never the path. A task keeps its
number when it moves between weeks; that is the whole point of the number.

## Development

```bash
npm test           # node --test, 111 tests, no test framework
npm run work -- list --all   # run without linking
```

```
bin/work.mjs           the executable shim; npm wraps this
src/cli.mjs            argument dispatch and error handling
src/args.mjs           the argv parser — an unknown flag is an error
src/paths.mjs          canonical paths, platform casing, config location
src/registry.mjs       load/save/infer over projects.json
src/convention.mjs     the naming rules, in one place
src/frontmatter.mjs    a small, strict YAML subset
src/scan.mjs           reading a project off disk
src/select.mjs         project selection and task filtering
src/validate.mjs       the rules, as data
src/nextid.mjs         max + 1
src/exit.mjs           exit codes
src/json.mjs           the stable machine contract
src/render/            colour and width-aware columns
src/commands/          one file per command
test/fixtures/alpha    a well-kept project
test/fixtures/beta     one that trips every rule
```

The whole CLI is driven in-process through `main()` in the tests — no subprocess,
no shell — so the same suite runs unchanged on Windows.

### Portability rules this code keeps

- Nothing spawns a shell or a process. No `grep`, `find`, `tail`, `ls`, no
  globstar, no inline `VAR=value` prefixes.
- Every path goes through `node:path`; no separator is ever hard-coded.
- Paths are canonicalised through `fs.realpathSync`, and compared
  case-insensitively on Windows and macOS, case-sensitively on Linux. macOS is
  treated as insensitive because APFS is, by default — which makes `work` refuse
  a duplicate registration that would otherwise split one project in two.
- The directory walk is iterative with a depth bound, so a symlink loop cannot
  hang it.
- Zero runtime dependencies.
