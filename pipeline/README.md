# The pipeline

A standing loop that researches improvements, audits them, implements them, and
pushes what survives review. State lives on disk so a new session can resume it
without reading the old conversation.

    ideas/inbox/  ->  specs/  ->  (implementation)  ->  done/
                  \                              \
                   ideas/rejected/                specs/ with status: needs_rework

## The four roles

**Research** writes one file per idea into `ideas/inbox/`. It never edits code.
An idea names a real source and says what that source actually claims.

**Audit** reads the inbox. It checks the claim is real, that the idea fits this
repo rather than some other one, and that it is worth the diff. What survives
becomes a spec in `specs/` with numbered acceptance criteria. What does not
moves to `ideas/rejected/` with the reason. The auditor owns the queue order.

**Implementation** takes the top ready spec, writes the code, and stops. It does
not decide whether its own work passed.

**Review** reads the spec and the diff. It checks each acceptance criterion
against the code, runs the full check suite, and either pushes or sets the spec
to `needs_rework` with what was missing. A spec that comes back keeps its place
in the queue rather than going to the end.

## Why the roles are separate

The one who writes the code is the worst judge of whether it works. Four of this
repo's emitter bugs passed unit tests and rendered a valid PNG, and were only
caught by opening the image. Review is a different agent with the spec in hand
and no memory of having written the thing.

## Files

    queue.md          ordered index, regenerated from specs/ frontmatter
    log.md            append-only, one line per state change
    specs/NN-slug.md  the contract for one change
    done/NN-slug.md   shipped, with the review verdict kept

## Gate

Nothing is pushed unless all seven checks pass: typecheck, npm test,
test:python, baseline --check, render-check, recipe-check, compose-check.
A spec whose acceptance criteria cannot be checked by running something is not
a spec yet, and the auditor sends it back.
