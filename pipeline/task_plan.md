# Task plan: the standing improvement loop

## Goal
Keep a queue of audited, sourced improvements to GraphUnslopify moving from idea
to pushed commit, without a human in the middle of each step, and without ever
pushing something that fails a check.

## The cycle
- [ ] 1. Research fills `ideas/inbox/` with sourced ideas
- [ ] 2. Audit turns the survivors into `specs/` with numbered acceptance criteria
- [ ] 3. Implement the top ready spec, then stop
- [ ] 4. Review checks the diff against the criteria and runs the seven checks
- [ ] 5. Push on pass, or set `status: needs_rework` and keep its queue place
- [ ] 6. Immediately take the next spec. Research and audit keep running behind.

Steps 1 and 2 run in the background while 3 to 5 run in front, so the queue is
never empty when implementation finishes.

## Rules that do not change
- The one who writes the code never decides whether it passed.
- Nothing is pushed unless all seven checks pass.
- A spec whose acceptance criteria cannot be checked by running something goes
  back to the auditor. "Looks better" is not a criterion.
- A reworked spec keeps its position rather than going to the back.
- The spec describes meaning. The generator owns presentation. An idea that puts
  a colour or a font size in the schema is rejected on sight.

## The seven checks
    npm run typecheck
    npm test
    npm run test:python
    npm run baseline -- --check
    npm run render-check
    npm run recipe-check
    npm run compose-check

## Key questions
1. Does an idea close a way a figure can mislead, or is it decoration?
2. Is the citation real? A fabricated source poisons `docs/research.md`.
3. Would this survive a reader opening the PNG, not just the tests passing?

## Decisions made
- Queue lives in files, not in chat. A compacted context or a new session
  resumes by reading `pipeline/queue.md`.
- `queue.md` is generated from spec frontmatter by `npm run queue`, so the index
  can never disagree with the specs.
- Review runs as a separate agent with the spec and no memory of writing the
  code. Four of this repo's bugs passed tests and rendered a valid PNG.

## Errors encountered
(appended as they happen)

## Status
**Phase 1.** Scaffolding built and verified. Research agent running.
