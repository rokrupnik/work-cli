import { EXIT } from '../exit.mjs'
import { configFile } from '../paths.mjs'
import { STATUSES } from '../convention.mjs'

export function helpCommand(argv, ctx) {
  const topic = argv[0]
  ctx.out(topic ? topicHelp(topic, ctx) : general(ctx))
  return EXIT.OK
}

function general(ctx) {
  return `work — a read-only view over work/tasks/ markdown, across registered projects.

USAGE
  work [list] [filters]           the overview
  work validate [filters]         check the conventions
  work next-id                    highest task number + 1
  work project <add|list|remove|show>
  work doctor                     is this installation sane
  work help [command]

SCOPE
  Inside a registered project      that project
  Outside one                      every registered project
  --project <name> / -p            wins over both, from anywhere
  --all / -a                       every registered project

LIST FILTERS  (all of them compose)
  -o, --owner <NAME>      owner, repeatable; --owner none for unowned
  -s, --status <STATE>    ${STATUSES.join(', ')}
  -w, --week <YY-Wnn>     scheduled week or current folder
      --blocked           blocked, needs-info, waits-info, or a blocked-by
      --notify            shipped; the requester has not been told yet
      --unowned           no @OWNER and no assignee
      --slipped           week: and the week folder disagree
      --leased            carries Executor worktree fields
      --active            in-progress, review or integrating
      --done              only finished tasks
      --include-done      open and finished together
  -g, --group-by <KEY>    owner (default), week, status, project, folder, none
      --json              stable machine-readable output

EXIT CODES
  0 ok   1 findings   2 usage   3 no such project   4 environment

The registry holds names and paths only — never task data:
  ${configFile(ctx.opts)}

work never writes to a project. It cannot create, edit, close or move a task.`
}

function topicHelp(topic, ctx) {
  switch (topic) {
    case 'list':
      return `work list — the overview.

  work                            open tasks in the current project
  work list --all                 every registered project
  work list --owner ANA           what one person has open
  work list --blocked             what is stalled, and on what
  work list --notify              shipped, and still owed a word to the requester
  work list --week 26-W34         a week, scheduled or landed-in
  work list --slipped             scheduled for one week, sitting in another
  work list --unowned             open work nobody owns
  work list --leased              tasks with an Executor worktree attached
  work list --group-by week       regroup; the grouped column leaves the table
  work list --json                for scripts

Inside a section, rows run in scheduled-week order with a blank line at each
change of week.

--blocked spans every stalled state: blocked is our move and we cannot make it;
needs-info means the stakeholder still has to be asked; waits-info means the
question was sent and a reply, decision or file is now owed.

--notify is the debt to a human. It sits before done because done adds the x_
prefix, which sorts the file to the bottom of the week folder where nobody
reads it.

The SCHEDULED and FOLDER columns are printed side by side and left to
disagree. That disagreement is the record that a task slipped — work never
normalises it away.`

    case 'validate':
      return `work validate — the conventions, checked. Never repairs anything.

  work validate                   the current project
  work validate --all             every registered project
  work validate --strict          warnings fail too
  work validate --errors-only     drop the informational findings
  work validate --code slipped-task
  work validate --code notify-without-requester
  work validate --stale-hours 8   how old a lease may be
  work validate --rules           list every rule and its severity
  work validate --json

Findings go to stderr, the one-line verdict to stdout.
Exit 0 when there are no errors, 1 when there are (or, with --strict, warnings).`

    case 'next-id':
      return `work next-id — the highest task number anywhere under work/, plus one.

  work next-id
  work next-id --project acme-shop
  work next-id --all              one line per project, name<TAB>id
  work next-id --verbose          where the highest number came from

Scans open, done and archived tasks, and ideas that carry a number.
Nothing is reserved and nothing is written, so two callers a second apart
get the same id. It becomes yours when you create the file.

Refuses to answer (exit 1) when an id is already duplicated: while one number
means two things, max+1 is not evidence that the next one is free.`

    case 'project':
      return `work project — registration. Nothing inside a project is ever modified.

  work project add <path> [name]  register; name defaults to the directory
  work project list               what is registered, and what is live
  work project show <name>        weeks, statuses, owners
  work project remove <name>      forget it; the directory is untouched

A project is any directory with work/tasks/<YY-Wnn>/*.md under it.
Registering stores a canonical absolute path under a name, in
  ${configFile(ctx.opts)}
and nothing else. Registering one directory twice is refused: two names for
one project split every per-project view without warning.`

    case 'doctor':
      return `work doctor — install root, registry location and writability, every
registered path, and whether \`work\` on PATH resolves to this checkout.
Exit 1 if anything is broken.`

    default:
      return `no help topic \`${topic}\`. Try: list, validate, next-id, project, doctor`
  }
}
