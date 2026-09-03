# One cycle

What a single fire does, start to finish. Anything that can invoke Claude runs
this the same way: the in-session cron, a scheduled task, or you typing "run a
cycle". A cycle does one spec and exits. It never starts a second one.

## 0. Orient

    npm run queue
    git status --porcelain

Prints the open count and the next item. If the rules are not already in
context, read `pipeline/task_plan.md` before deciding anything.

**A dirty tree needs the top spec's status to interpret it.**

`in_progress` means an audit is in flight. Stop. The code auditor judges by
`git diff`, so a second spec's edits landing in the same working tree would be
read as scope creep on the first, and a PASS would commit half-finished work
alongside it. Write nothing at all, not even the log line, because a file
appearing mid-review is exactly what the auditor is told to flag. Log the
skipped cycles once the verdict lands.

`needs_rework` means a verdict came back and those changes are the base to
build on. Carry on into step 2 and finish it. Do not revert them and do not
start again from a clean tree.

## 1. Refill if the queue is thin

Fewer than 3 open specs, launch research in the background and do not wait for
it. This cycle builds from what is already in the queue; the ideas land in time
for the next one. That is the whole pipelining trick, and it is why nothing here
needs an always-on process.

Files sitting in `ideas/inbox/`, run the auditor over them first. Tell it to skip
anything already named in a spec's `source_idea`, in `specs/` or in `done/`.
Survivors stay in the inbox after they are turned into specs, so a later pass
will re-judge work it already approved unless it is told not to.

## 2. Take the top spec

`needs_rework` outranks `ready`, so a near miss gets finished before anything
new starts. Set `status: in_progress` and rerun `npm run queue`.

## 3. Build it

Only what the acceptance criteria name. An idea that grew a better idea during
implementation goes to `ideas/inbox/` as its own file; it does not get smuggled
into this diff.

## 4. Hand it to the code auditor

A separate agent, given the spec and the diff and nothing else. Not the
reasoning, not the story of what was hard. It judges each numbered criterion
against the code and runs the seven checks.

The separation is the point. Four of this repo's emitter bugs passed their unit
tests and wrote a valid PNG. Whoever wrote the code cannot see them.

## 5. Land or bounce

Every criterion met and all seven checks green, commit and push to main, then
move the spec to `done/` with the verdict kept in the file.

Anything failed, set `status: needs_rework`, append exactly what was missing,
and leave it in `specs/`. It keeps its queue position.

## 6. Log and exit

Append one line to `pipeline/log.md`. Stop. The next fire takes the next item.

## The seven checks

    npm run typecheck
    npm test
    npm run test:python
    npm run baseline -- --check
    npm run render-check
    npm run recipe-check
    npm run compose-check
