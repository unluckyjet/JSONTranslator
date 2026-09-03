---
id: 02
slug: no-fabricated-uncertainty-band
status: needs_rework
priority: P0
title: A group with fewer than two observations draws a zero-width band that reads as perfect agreement
source_idea: report-sample-size.md
---

# A group with fewer than two observations draws a zero-width band that reads as perfect agreement

## Problem

`bootstrap_interval` in `src/codegen/data.ts:207-211` refuses to resample a group with fewer
than two finite values, and correctly appends `np.nan` for its low and high:

```python
values = block[Y_FIELD].dropna().to_numpy(dtype=float)
if len(values) < 2:
    lows.append(np.nan)
    highs.append(np.nan)
    continue
```

`emitSummarise` then throws that refusal away, at `src/codegen/data.ts:190-191`:

```python
summary["_low"] = np.where(np.isfinite(low), low, centre)
summary["_high"] = np.where(np.isfinite(high), high, centre)
```

Substituting the centre turns "no interval could be measured" into "the interval is exactly
zero". `emitDraw` in `src/codegen/draw.ts:133-146` then calls `fill_between(x, _low, _high)`
and draws a band of zero height, and `src/codegen/draw.ts:147-160` draws an errorbar with
zero-length whiskers for `display: "bar"`. `error_pair` in `src/codegen/decorate.ts:82-92`
does the same for bar charts.

A reader sees a curve with a band that pinches to a hairline at those points and reads
perfect agreement across seeds. The truth is that there was one seed. This is the tool
fabricating precision, in the one feature `docs/research.md:74-86` calls "the biggest gap"
it closed.

The substitution is not limited to `ci`. Every `uncertainty.kind` routes through the same
two lines, so `sem` with one observation (`spread.sem(ddof=1)` is NaN) reaches it too.

## Change

In `src/codegen/data.ts`, stop substituting the centre. Assign `_low` and `_high` from
`low` and `high` directly, so a group with no measurable interval keeps `NaN`.

Then make the three drawing paths tolerate `NaN` rather than drawing a degenerate mark:

- `src/codegen/draw.ts:133-146`, the `fill_between` band. `fill_between` already leaves a
  gap where either bound is `NaN`; confirm by rendering rather than by reading.
- `src/codegen/draw.ts:147-160`, the `errorbar` path. `yerr` containing `NaN` must not
  raise and must not draw a cap. Mask the non-finite rows out of the `x`, `y` and `yerr`
  arrays if matplotlib does not handle it cleanly.
- `src/codegen/decorate.ts:82-92`, `error_pair` for bar charts. Same treatment.

And disclose it. `summarise()` counts the rows it collapsed per group anyway; emit one
printed line when any summarised point has no interval, naming how many points and which
series, for example:

```
uncertainty: 3 of 20 points have fewer than 2 observations, so no interval is drawn for them (series: solo)
```

The script must still exit 0. Once the band is gone there is nothing misleading left — a
missing band correctly says no spread was measured — and a hard exit would block an author
whose single-seed point is legitimate. This is a deliberate choice against the source
idea, which asked for a non-zero exit; see Evidence.

## Acceptance criteria

1. `npm test` passes, and a new test in `test/features.test.ts` asserts that the Python
   emitted for a `line` spec with `aggregation: "mean"` and
   `uncertainty: { kind: "ci", over: "seed" }` does **not** contain the string
   `np.where(np.isfinite(low), low, centre)`.
2. A fixture CSV is committed under `test/` or `examples/data/` in which one series has
   exactly one row per x value and at least one other series has three or more. Running the
   script generated for it prints a line naming the number of points with no interval and
   the affected series name, and exits 0.
3. On that same fixture, a check asserts the emitted script's `summarise()` output has
   non-finite `_low` for the single-observation series' rows and finite `_low` for the
   multi-observation series' rows. A short Python test under `npm run test:python` is the
   natural home.
4. On that same fixture, rendering with `uncertainty.display: "bar"` completes without
   raising, proving the `errorbar` path tolerates `NaN` in `yerr`.
5. `npm run render-check` passes: all fifteen baseline scripts still run to completion.
6. `npm run baseline -- --check` passes after regenerating. The diff to the committed
   scripts must be confined to the `_low`/`_high` assignment, the drawing paths named above,
   and the new printed line. If any baseline script's *figure* changes, that baseline
   contained a fabricated band and the change is correct — say so in the review.
7. `npm run typecheck`, `npm test`, `npm run test:python`, `npm run recipe-check` and
   `npm run compose-check` all pass.

## Out of scope

- Do **not** add the per-group *n* report, the alt-text *n*, or any row-loss accounting.
  That is spec 08, which introduces `report_counts()` and owns the printed accounting
  block. This spec prints one line about missing intervals and nothing else.
- Do **not** add a spec field. `aggregation` and `uncertainty` already declare everything
  this needs.
- Do **not** change `mark_significance`'s silent `continue` when `compare()` returns `None`
  (`src/codegen/decorate.ts:206-207`). That is spec 08.
- Do **not** change `bootstrap_interval`'s `len(values) < 2` threshold or the bootstrap
  itself.
- Do **not** draw an "n = 1" annotation on the figure.

## Evidence

- **[verified] by me, in this repo.** `src/codegen/data.ts:207-211` shows the `NaN` being
  produced; `src/codegen/data.ts:190-191` shows it being overwritten with the centre;
  `src/codegen/draw.ts:133-160` and `src/codegen/decorate.ts:82-92` are the three consumers.
- **[verified] Cumming, Fidler and Vaux, "Error bars in experimental biology", *Journal of
  Cell Biology* 177(1):7-11, 2007.** I fetched https://pmc.ncbi.nlm.nih.gov/articles/PMC2064100/
  and confirmed the authors, journal, volume, issue, pages and year, and confirmed Rule 3
  verbatim: "error bars and statistics should only be shown for independently repeated
  experiments, and never for replicates." A band drawn where there was no repeat is the
  clearest possible violation of that rule — the tool is showing an error bar for something
  that was not repeated at all.
- Downgrade note: the source idea argued `n = 1` "should be an error, not a warning -- the
  script should refuse rather than draw a zero-width band." I kept the diagnosis and
  changed the remedy. The misleading artefact is the zero-width band, not the single
  observation; removing the band removes the misreading, and Cumming's Rule 3 asks that no
  bar be shown, not that the figure be refused. A non-zero exit on the author's own machine
  for data they may legitimately have is a cost with no remaining honesty benefit.

## Rework required

Audit returned NEEDS_REWORK. All seven acceptance criteria pass on their literal
text and all seven checks are green. The failure is against the Change section,
"emit one printed line", which no criterion tests.

**The disclosure line prints more than once per figure.** `report_missing_interval`
is called from inside `summarise()`, and the emitted script calls `summarise()`
twice: once in `draw_panel` and again in `main` for alt text and claims. Running
the fixture prints the identical line twice, back to back. Reproduced for ci/band,
ci/bar, sem and std.

Faceted is worse. `draw_panel` runs per panel, so the line prints once per panel
with a panel-local denominator and no figure total. A 2-panel facet prints
"3 of 6 points" twice when the figure has 6 of 12. A 6-panel facet prints six
partial lines.

Fix by hoisting the report to a single figure-level call, or by guarding it with a
module-level flag. Either way the denominator must be the whole figure, not a
panel.

Criterion 2 asserted presence with `assert.match`, which passes on one print or
five. **The test must assert the count, not the presence.** Add that.

Nothing else changes. The auditor confirmed the rest is correct, including that
NaN genuinely reaches all three drawing calls: it monkeypatched `fill_between`
and `errorbar` and measured 5 NaN in both band bounds for the solo series, 10/10
NaN in the line errorbar yerr, and 2 NaN in the bar chart error pair. It also
proved every baseline figure was unchangeable rather than merely unchanged, by
showing `examples/data/training.csv` has exactly 3 seeds in every (model, epoch)
group, which makes the old `np.where` and the new bare `low` provably identical
arrays.

## Rework required, round 2

The first defect is fixed and measured fixed. The auditor generated and ran
scripts itself and counted the disclosure lines: exactly one for plain line and
bar kinds, band and errorbar display, for ci, sem and std, and one saying
"10 of 20" on a two-panel facet rather than "5 of 10" twice. main's own
summarise() does not append.

**The accumulator still double-counts on two composition paths.** Same defect
class the last round named, on paths neither of us checked.

1. `src/codegen/compose.ts:189-190`, `draw_with_break` runs
   `for ax in (upper, lower): draw_panel(ax, df)`, so one dataset is noted
   twice. Measured `uncertainty: 10 of 20 points` where the truth is 5 of 10.
2. `src/codegen/compose.ts:142`, `add_inset` calls `draw_panel(zoom, frame)` on
   the frame already drawn on the parent axes. Same doubling, same measurement.

The numerator is the unarguable part. Five points lack an interval and the
script says ten. Both numbers vary with how many axes the figure happens to use
rather than with the data, which is what "the denominator must be the whole
figure" forbids.

Both ship. `verify()` returns no error for `line + aggregation + ci +
axis_break` or `+ inset`. Nothing in the repo would have caught it, because
`scripts/compose-check.ts`'s inset and axis_break cases carry no uncertainty.

Make `note_missing_interval` idempotent per data block, or note from the panel
loop in `emitMain` rather than from inside `draw_panel`. Then add coverage: an
`uncertainty` case to the compose-check inset and axis_break fixtures, or an
equivalent test.

Also required, smaller:

3. `test/fixtures/` is untracked. Criterion 2 says the fixture is committed. It
   must be `git add`ed with the change or the suite breaks for everyone else.
4. The count assertion only protects `ci`. The auditor verified sem, std and the
   bar kind by hand and they are correct, but nothing guards them. Add cases.

Not blocking, carried forward: range and iqr still draw the hairline band and
the disclosure is silent exactly there, because min, max and both quartiles of
one observation are finite and equal rather than NaN, so the isfinite test
counts zero. Already filed as range-and-iqr-still-fabricate-a-band; the auditor
reached it independently.

## Rework required, round 3

All four round-2 items are fixed and measured fixed. The cut axis and the inset
both report 5 of 10 where they said 10 of 20. The fixtures are staged. The count
assertion now covers ci, sem, std and the bar kind, all reproduced independently.
All seven criteria hold and all seven checks are green.

**One case of the same class remains, and it is the mechanism's fault.**
`repeated_panels` returns `[(field, df) for field in REPEAT_FIELDS]`, the same
DataFrame object for every panel, because repeat splits columns rather than rows.
Keying on `id(source)` therefore collapses N metric panels into one. Measured on
`repeat: {fields: ["accuracy", "loss"]}` over a single-seed CSV: the figure draws
20 points with 10 unmeasurable and the line says 5 of 10. The series list is
panel-one-only too, so a series unmeasurable on the second metric alone vanishes
from the message.

The auditor enumerated the four places a frame reaches `draw_panel` (the panel
loop, the inset, and both halves of the break) and this is the only remaining
one, so the class is closed rather than open.

**Key on the panel, not on the frame.** Frame identity was the wrong choice: it
happens to work for the cut axis and the inset and happens to fail for repeat.
The panel loop already carries `index`, and the axis-break branch is a single
panel that never enters the loop. Setting a module-level panel key beside the
existing `globals()["Y_FIELD"] = name` and keying on that counts once per panel
whatever the axes do, which is the invariant round 2 asked for.

Then add coverage: a `repeat` + `uncertainty` case in the shape of the existing
cut-axis and inset tests, asserting the whole-figure denominator.
