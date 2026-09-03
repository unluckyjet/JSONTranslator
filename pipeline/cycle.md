# One cycle

A cycle keeps working until it is genuinely blocked. It does not stop after one
spec, and it does not stop between a verdict and the fix for that verdict.

## 0. Orient

    npm run queue
    git status --porcelain

If the tree is dirty, the top spec's status says what that means. `in_progress`
means an audit is reading the diff right now: leave it completely alone, write
nothing, not even the log line. Anything else means the diff is yours to finish.

## 1. Refill if the queue is thin

Fewer than 3 open specs, launch research in the background and do not wait. Tell
the auditor to skip anything already named in a spec's `source_idea`, in
`specs/` or in `done/`, or it will re-judge work it already approved.

## 2. Take the top spec

`needs_rework` outranks `ready`. Set `status: in_progress` before any handoff,
on a rework as well as a fresh start, or step 0 cannot tell the two apart.

## 3. Build it

Only what the acceptance criteria name. A better idea found along the way goes
to `ideas/inbox/` as its own file rather than into this diff.

## 4. Verify

Run the seven checks. Then measure the behaviour the spec is actually about, by
running the thing and reading the numbers. A passing test is not evidence on its
own: the first defect in spec 02 survived an `assert.match` that passed on one
print or five.

**Send it to a separate audit agent when the change is subtle**, meaning it
touches the emitter, changes what a figure claims, or has a failure mode that
renders cleanly. Skip the audit for a mechanical change with an obvious check.

**Two audits per spec, then decide it yourself.** The audits on spec 02 each
found a real wrong number and were worth their cost, but the third and fourth
round cost an hour while seven other P0s waited. After two rejections, verify it
yourself with measurements written into the spec, and ship or split it.

## 5. Land or fix, immediately

Green and correct, commit and push to main, move the spec to `done/` with the
evidence.

Failed, **fix it now**. Do not record the verdict and wait for the next fire.
The one-spec-per-cycle rule exists so two different specs cannot collide in one
working tree; finishing the spec already in your hands is not a second spec.

## 6. Take the next one

Go back to step 0 and keep going. Stop only when the queue is empty, an audit is
in flight, or research has not delivered yet. Append one line to
`pipeline/log.md` for each spec that lands or bounces.

## The seven checks

    npm run typecheck
    npm test
    npm run test:python
    npm run baseline -- --check
    npm run render-check
    npm run recipe-check
    npm run compose-check

**The seven are local. CI is the eighth.** Three commits shipped red because
every local check passed and nobody looked at GitHub. After pushing:

    gh run list --limit 1

Wait for it, and fix a red build before taking the next spec. On this machine
`gh` is at `/c/Program Files/GitHub CLI/gh.exe`, so quote the path.

Never run bare `npm run baseline`. `scripts/baseline.ts` hardcodes `python3`,
which on Windows is a Store stub that exits 49, and the run empties
`examples/baseline/README.md` on its way out. Use `PYTHON=python npm run
baseline` to regenerate.
