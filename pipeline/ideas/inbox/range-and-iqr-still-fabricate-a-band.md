---
slug: range-and-iqr-still-fabricate-a-band
title: range and iqr still draw a zero-width band on one observation, and say nothing
kind: honesty
---

# range and iqr still draw a zero-width band on one observation, and say nothing

## The problem

Spec 02 stopped `summarise()` substituting the centre for an unmeasurable interval,
which fixes `ci`, `sem` and `std`. It does not fix `range` or `iqr`.

For a single observation `spread.min()`, `spread.max()` and both quartiles all return
that one value. So `low` and `high` come out finite and equal rather than NaN. The band
is drawn pinched to a hairline, which is the exact artefact spec 02 set out to remove,
and `report_missing_interval` stays silent because it tests `np.isfinite(_low)`.

Two of the five uncertainty kinds still fabricate agreement, and in those two the
disclosure line is misleadingly absent.

## The idea

Detect the empty interval at its source rather than by checking for NaN. A group with
fewer than two observations has no measurable spread whatever the kind, so the count is
the honest test. Compute the per-group size once in `summarise()` and use it to blank
`_low` and `_high` for undersized groups across every kind.

That also makes `report_missing_interval` correct by construction instead of correct by
coincidence for three kinds out of five.

## Evidence

Found by the code auditor on spec 02, verified by rendering: generated scripts for
`uncertainty.kind: "range"` and `"iqr"` on `test/fixtures/single-seed.csv` print no
`uncertainty:` line at all and draw a hairline band for the `solo` series.

## Why it fits here

Same function, same problem, and it finishes the job spec 02 started. No schema change:
`uncertainty.over` already says which column the repeats live in.

## Rough shape

`src/codegen/data.ts`, `emitSummarise`. A group-size array alongside `centre`, then blank
the bounds where it is under two. The existing spec 02 tests should keep passing
unchanged, and `range` and `iqr` need the same coverage on the same fixture.

## How you would know it worked

Generating for the single-seed fixture with `kind: "range"` and again with `"iqr"` prints
the disclosure line and draws no band for `solo`, matching what `ci` already does.
