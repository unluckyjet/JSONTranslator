---
slug: baseline-script-hardcodes-python3
title: The baseline script names python3 and empties the gallery README when it is missing
kind: agent-ergonomics
---

# The baseline script names python3 and empties the gallery README when it is missing

## The problem

`scripts/baseline.ts:26` reads `const python = process.env.PYTHON ?? "python3"`. Every
other check script goes through `resolvePython()` from `scripts/python.ts`, which tries
`python3` then `python` and honours `PYTHON`. This is the one that was missed.

On Windows `python3` is an App Execution Alias that prints a Microsoft Store advert and
exits 49, so all fifteen figures fail. Worse, the run still finishes and rewrites
`examples/baseline/README.md` with an empty findings table, deleting fifteen rows. The
failure is loud but the damage is quiet, and `git checkout` is the only thing that
noticed.

## The idea

Use `resolvePython()`, like the other four scripts. Separately, do not rewrite the
findings table when no figure was built; a run that produced nothing has nothing to say
about findings.

## Evidence

Hit while building spec 02. `npm run baseline` reported "15 of 15 failed" with the Store
stub message and `git diff` showed 15 deletions from `examples/baseline/README.md`.
`PYTHON=python npm run baseline` then succeeded on all fifteen.

## Why it fits here

It is the same fix already applied to `test:python`, in the last script that still
hardcodes an interpreter name.

## Rough shape

`scripts/baseline.ts`, the import and line 26. Then a guard around the README write.
No product code changes.

## How you would know it worked

`npm run baseline` builds all fifteen on a machine with no `python3` on PATH. Forcing a
failure leaves `examples/baseline/README.md` untouched rather than emptied.
