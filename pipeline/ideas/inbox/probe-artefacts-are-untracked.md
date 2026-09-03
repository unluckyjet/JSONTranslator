---
slug: probe-artefacts-are-untracked
title: Two specs cite probe artefacts that a clean checkout does not have
kind: agent-ergonomics
---

# Two specs cite probe artefacts that a clean checkout does not have

## The problem

Spec 01 rests its strongest evidence on "I rendered it", naming `probe_bar_break.py`
and `probe-bar-break.png` in the repo root. Spec 07 refers to a render defect visible in
the same PNG. Neither file was ever tracked: `git ls-files | grep -i probe` and
`git log --all -- 'probe*'` are both empty, and they are not in `.gitignore` either.

So the load-bearing evidence for one shipped spec and one queued spec cannot be checked
from this checkout. The audit still passed spec 01, because the rule was verifiable
directly, but spec 07's citation is now a dead reference.

## The idea

Decide where probe artefacts live and make the pipeline honour it. Either the auditor
commits them under something like `pipeline/evidence/`, or specs are forbidden from
citing an untracked file as evidence and must quote measured numbers inline instead.

The second is probably better. A committed PNG per rendered probe would bloat the repo,
and the numbers are what the argument rests on anyway.

## Evidence

Found by the code auditor on spec 01, which checked whether the cited files existed
rather than taking the citation on trust.

## Why it fits here

This is a pipeline rule, not a product change. It belongs in `pipeline/README.md` under
what the auditor may accept as evidence.

## Rough shape

`pipeline/README.md` and the auditor's brief. No source code changes. Spec 07 needs its
evidence section rewritten to quote numbers rather than point at a missing file.

## How you would know it worked

Every evidence bullet in `pipeline/specs/` either quotes a measurement inline or names a
tracked file. A grep for cited paths finds all of them on disk.
