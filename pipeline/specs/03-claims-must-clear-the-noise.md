---
id: 03
slug: claims-must-clear-the-noise
status: ready
priority: P0
title: A claim reports HOLDS from the means alone while every interval overlaps
source_idea: claims-must-clear-the-noise.md
---

# A claim reports HOLDS from the means alone while every interval overlaps

## Problem

`_aligned` in `src/claims.ts:94` builds every claim's comparison from a point summary and
nothing else:

```python
pivot = frame.pivot_table(index=X_FIELD, columns=GROUP, values=Y_FIELD, aggfunc="mean")
```

Meanwhile `emitSummarise` at `src/codegen/data.ts:190-191` has already computed
`summary["_low"]` and `summary["_high"]` from the `uncertainty` spec. Grep for `_low` in
`src/claims.ts`: no hits. The two never meet. The spread is drawn on the figure and ignored
by the verdict.

The consequence is concrete on the README's own showcase spec (`README.md:76-96`): four
methods, mean of five seeds, 95% bootstrap intervals, and
`{ "kind": "beats_everywhere", "subject": "ours", "reference": "baseline" }`. If `ours` sits
0.2pp above `baseline` at all twenty epochs while the two bands overlap completely at all
twenty, the script prints:

```
HOLDS     ours is above baseline at every x (0 of 20 x values are not above baseline)
```

`alt_text()` at `src/alttext.ts:171` then filters only on `claim.get("_verdict") is not
True`, so that sentence is quoted into the alt text and embedded in the PNG, SVG and PDF
metadata. The figure draws its own uncertainty and then certifies a claim that uncertainty
does not separate, which is worse than never drawing the bands, because the bands are what
persuades the reader to trust the verdict.

`docs/research.md:123-131` says claims exist because "a caption asserting a gain while the
axis is truncated cannot be caught by pixel inspection". This is the same failure one level
in: a caption asserting a gain the spread does not separate.

## Change

A qualifier, not a new verdict. The claim still HOLDS on the summary.

1. **Measure the overlap.** In `src/claims.ts`, when the summarised frame carries `_low`
   and `_high` (it does exactly when `uncertainty` is set), count at how many aligned x
   values the subject's and reference's intervals overlap. Two intervals overlap when
   `subject_low <= reference_high and reference_low <= subject_high`.
2. **Report what was measured, not a p-value.** `verify_claims` prints a continuation line
   under a holding claim whose intervals overlap:

   ```
   HOLDS     ours is above baseline at every x (0 of 20 x values are not above baseline)
             but the intervals overlap at 20 of 20 x values, so the spread does not separate them
   ```

   The wording must not convert overlap into a significance statement. Non-overlapping
   intervals imply a difference; overlapping intervals do **not** imply no difference. The
   line discloses the count it measured and stops.
3. **Carry the qualifier into the alt text, or drop the claim from it.** `alt_text()` at
   `src/alttext.ts:171` must not quote a qualified claim as a bare assertion. Either append
   the qualifier or omit the claim; pick one and apply it consistently.
4. **Call site.** `check_claim` currently returns a 2-tuple and is unpacked as
   `verdict, _ = check_claim(summary, claim)` in the emitted `main()`, generated at
   `src/codegen/index.ts:418`. If the return shape changes, that line changes with it.
   `verify_claims` at `src/claims.ts:159` is the other caller.
5. **One spec-time warning** in `src/verify.ts`: `claims` present, `aggregation` set to
   something other than `"none"`, and `uncertainty` absent. Code
   `claims_without_uncertainty`, severity `warning`. The message says the claim will be
   tested against a summary whose spread was discarded.

`designCost` already charges `no_uncertainty_over_repeats: 5` for the same shape
(`src/perception.ts:172` and `src/perception.ts:205-210`), but that is a soft ranking cost
applied when comparing candidate designs, not a finding an agent sees from `validate_spec`.
This is the same concern where it has teeth. Do not remove or change the soft weight.

## Acceptance criteria

1. A fixture CSV is committed in which `ours` exceeds `baseline` at every x by less than the
   width of the bootstrap interval. Running the script generated from a spec with
   `aggregation: "mean"`, `uncertainty: { kind: "ci", over: "seed" }` and
   `claims: [{ kind: "beats_everywhere", subject: "ours", reference: "baseline" }]` prints
   `HOLDS` followed by a line containing the overlap count, and exits 0.
2. On that same run, the alt text printed by the script (the line beginning `alt text:`)
   does not contain the unqualified sentence "Ours is above baseline at every x" — either
   the qualifier is attached or the claim is absent.
3. A mirror fixture where the intervals are disjoint at every x, same spec: the printed
   block contains `HOLDS` and contains **no** overlap qualifier line, and the alt text
   quotes the claim as before.
4. A spec with `claims` and `aggregation: "mean"` but no `uncertainty` still prints `HOLDS`
   with no qualifier line, proving the overlap test is skipped rather than crashing when
   `_low` is absent.
5. `npm test` passes, and a test asserts `verify()` returns a `warning` with code
   `claims_without_uncertainty` for a spec with `claims` + `aggregation: "mean"` + no
   `uncertainty`, and returns no such finding once `uncertainty` is added.
6. `npm run render-check` passes: all fifteen baseline scripts still run to completion and
   exit 0. This is disclosure, not a hard failure.
7. `npm run typecheck`, `npm run test:python`, `npm run recipe-check` and
   `npm run compose-check` pass, and `npm run baseline -- --check` passes after
   regenerating.

## Out of scope

- Do **not** downgrade a qualified claim from `HOLDS` to `FAILS`. Overlap does not disprove
  a difference and the tool must not commit that error in the opposite direction.
- Do **not** compute or print a p-value, a significance verdict, or a confidence level for
  the overlap. Print counts.
- Do **not** run the overlap test when `_low`/`_high` are absent. No `uncertainty`, no
  qualifier.
- Do **not** change `SOFT_WEIGHTS` or `designCost` in `src/perception.ts`.
- Do **not** touch `SignificanceSpec`, `emitSignificance` or the star markers. That is
  spec 05.
- Do **not** add a spec field.

## Evidence

- **[verified] by me, in this repo.** `src/claims.ts:94` is the `pivot_table` on `Y_FIELD`
  alone; `src/codegen/data.ts:190-191` is where `_low`/`_high` are written;
  `src/alttext.ts:171` is the `_verdict is not True` filter; `src/codegen/index.ts:418` is
  the `verdict, _ = check_claim(...)` call site. `src/claims.ts` contains no occurrence of
  `_low` or `_high`.
- **[verified] Cumming, Fidler and Vaux, "Error bars in experimental biology", *Journal of
  Cell Biology* 177(1):7-11, 2007.** I fetched
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2064100/ and confirmed the authors, journal,
  volume, issue, pages and year. Rule 7 verbatim: "with 95% CIs and *n* = 3, overlap of one
  full arm indicates P near 0.05, and overlap of half an arm indicates P near 0.01." Rule 6
  verbatim: "when *n* = 3, and double the SE bars do not overlap, P < 0.05, and if double
  the SE bars just touch, P is close to 0.05."

  This source cuts both ways, and that is why the change is a qualifier rather than a
  verdict. Overlap is diagnostic enough to be worth printing, which is why Rule 7 exists at
  all. But the mapping from overlap to a p-value is explicitly conditioned on *n*, so the
  tool must print what it measured and let the author judge, rather than convert overlap
  into significance.
- **[verified] `SOFT_WEIGHTS.no_uncertainty_over_repeats: 5` exists** at
  `src/perception.ts:172` and is charged at `src/perception.ts:205-210`. The source idea's
  claim about it is correct.
