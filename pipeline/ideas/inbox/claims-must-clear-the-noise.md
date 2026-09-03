---
slug: claims-must-clear-the-noise
title: A claim can HOLD on the means while every confidence band overlaps
kind: honesty
---

# A claim can HOLD on the means while every confidence band overlaps

## The problem

`src/claims.ts` is the best thing in this repo: it moves the caption's assertion into the spec and
tests it against the data. But `_aligned()` builds its comparison with

    pivot = frame.pivot_table(index=X_FIELD, columns=GROUP, values=Y_FIELD, aggfunc="mean")

so every claim is tested against a point summary and nothing else. Meanwhile `emitSummarise` in
`src/codegen/data.ts:190` computes `summary["_low"]` and `summary["_high"]` from the `uncertainty`
spec, and `check_claim` never looks at either column.

The consequence is precise. Take the README's own showcase spec: four methods, mean of five seeds,
95% bootstrap intervals, and `{ "kind": "beats_everywhere", "subject": "ours", "reference":
"baseline" }`. If `ours` sits 0.2pp above `baseline` at all twenty epochs and the two bands overlap
completely at all twenty, the script prints:

    HOLDS     ours is above baseline at every x (0 of 20 x values are not above baseline)

and `alt_text()` then quotes that sentence into the exported alt text, because `alt_text` only
filters on `claim.get("_verdict") is not True`. A figure that draws its own uncertainty and then
certifies a claim the uncertainty does not support is worse than one that never drew the bands,
because the bands are what makes the reader trust the verdict.

`docs/research.md` says the point of claims is that "a caption asserting a gain while the axis is
truncated cannot be caught by pixel inspection." This is the same failure one level in: a caption
asserting a gain the spread does not separate.

## The idea

Give `verify_claims` a third verdict rather than new machinery. Today `check_claim` returns
`(holds, detail)` with `holds` in `{True, False, None}`. Add a separation test that runs only when
`_low`/`_high` are present on the summarised frame, and report:

    HOLDS     ours is above baseline at every x (0 of 20 x values are not above baseline)
              but the intervals overlap at 20 of 20 x values, so the spread does not separate them

The wording matters and should not overreach. Non-overlapping intervals imply a difference;
overlapping intervals do **not** imply no difference — that inference is a known error and the
tool must not commit it in the opposite direction. So the line is a disclosure, not a failure
verdict: the claim still HOLDS on the summary, and the reader is told what the spread does and does
not license. Whether it downgrades to a failure is the auditor's call; I would keep it as a
qualifier and let the author decide.

Two guards fall out of this:

- A qualified claim should not be quoted verbatim into the alt text without its qualifier. Either
  drop it from `alt_text()` or carry the qualifier with it.
- A spec-time warning in `src/verify.ts`: `claims` present, `aggregation` set, and no
  `uncertainty` — the claim is being tested on a summary whose spread was thrown away. The repo
  already charges `no_uncertainty_over_repeats` a weight of 5 in `perception.ts`; this is the same
  concern where it has teeth.

## Evidence

- [verified] Cumming, Fidler & Vaux, "Error bars in experimental biology", *Journal of Cell Biology*
  177(1):7-11, 2007, read at https://pmc.ncbi.nlm.nih.gov/articles/PMC2064100/ . Their Rule 7 is
  "with 95% CIs and *n* = 3, overlap of one full arm indicates P ≈ 0.05, and overlap of half an arm
  indicates P ≈ 0.01." Two things follow. Overlap is diagnostic enough to be worth printing, and
  the mapping from overlap to a p-value is sensitive to *n* — which is why this should print what
  it measured (how many x values overlap, by how much) rather than convert it into a significance
  claim. Their Rule 6, "when *n* = 3, and double the SE bars don't overlap, P < 0.05", is the same
  caution from the other side.
- no source, reasoning only, for the code path: `check_claim` in `src/claims.ts` reads only
  `Y_FIELD` through `pivot_table`; `_low`/`_high` are written in `src/codegen/data.ts` and consumed
  only by `draw.ts` and `decorate.ts` for drawing. The two never meet.

## Why it fits here

The spec already says what it means — `claims` is the meaning. The generator already owns how the
spread is computed and drawn. This only asks the verdict to read a column the same script already
produced. Nothing crosses the wire; the test runs in the emitted Python on the author's machine,
where the seeds are.

## Rough shape

- `src/claims.ts`: `emitClaimTests` gains an overlap measurement and `check_claim` returns a third
  element, or a dict. `verify_claims` prints the qualifier line.
- `src/alttext.ts`: `alt_text()` stops quoting a qualified claim unqualified.
- `src/verify.ts`: one warning for claims-with-aggregation-without-uncertainty.
- No new spec field. Possibly no schema change at all.

## How you would know it worked

1. Build a fixture CSV where `ours` beats `baseline` at every x by less than the bootstrap interval
   width. Render it. The printed block must read `HOLDS` followed by the overlap qualifier, and the
   exported alt text must not contain the bare sentence "Ours is above baseline at every x."
2. Build the mirror fixture where the bands are disjoint. Same spec. The qualifier must be absent.
3. `npm run render-check` — both scripts run to completion and exit 0, since this is disclosure, not
   a hard failure.
4. `npm test` — the new `verify.ts` warning fires on a spec with `claims` + `aggregation: "mean"` +
   no `uncertainty`, and does not fire once `uncertainty` is added.
