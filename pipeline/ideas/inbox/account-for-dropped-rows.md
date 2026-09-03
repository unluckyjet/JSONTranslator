---
slug: account-for-dropped-rows
title: The script drops rows in six places and reports the loss in none of them
kind: honesty
---

# The script drops rows in six places and reports the loss in none of them

## The problem

The generated script discards data silently at every stage of its pipeline. Grepping `src/codegen`
for `dropna` and `isfinite`:

- `data.ts:209` -- `bootstrap_interval` drops non-finite values per group before resampling.
- `decorate.ts:37` -- the trendline fit keeps only `np.isfinite(x) & np.isfinite(y)`.
- `decorate.ts:54` -- the Pareto frontier drops rows with `dropna()`.
- `decorate.ts:158-160` -- `compare()` filters both arms to finite values before the test.
- `decorate.ts:247` -- the annotation locator drops rows.
- `draw.ts:42, 346` -- series names and box/violin groups drop NaN.
- `index.ts:276, 313` -- facet names and series names drop NaN.

`emitPrepare` in `data.ts` is the only place that reacts to row loss at all, and only in the total
case:

    if df.empty:
        raise SystemExit("every row was filtered out")

So a `filter` clause that removes 90% of the rows produces a figure with no note. A column with 40%
missing values produces a figure whose points are computed from 60% of the data with no note. A
`log` scale on a column containing zeros makes matplotlib drop those points from the drawn line with
no note, and the axis limits then silently exclude them. None of this is visible in the PNG, in the
alt text, or in the printed output.

This is a gap in the repo's own reproducibility argument. `docs/research.md` says "the tool emits a
script instead of an image, so the script is the reproducibility record", and each script carries a
tool version and a spec hash. The script records what it was *asked* to do. It does not record what
it actually used.

## The idea

Emit a provenance report that the script prints before it draws, and that the alt text can draw on.
Something like:

    data: results.csv, sha256 3f2a1c...
      2400 rows read
      1200 rows after filter (dataset == "cifar")
      1188 rows with a finite accuracy (12 dropped)
      1188 rows drawn

Then two thresholds, whose exact values are the auditor's call:

- A **warning** when the fraction of rows lost to non-finite values exceeds some share. Missing data
  is normal; missing data that changes the answer is not, and the reader deserves to know which
  regime the figure is in.
- An **error** when a group ends up with zero usable rows after the drops but is still named in
  `series_order`, `claims`, or `significance.pairs`. Today that series just disappears from the
  legend and the claim reports `UNTESTED`, which is easy to skim past.

Related and cheap while the code is open: a log-scaled axis whose column contains non-positive
values should say how many points it is refusing to draw. Right now `log_scale_nonpositive_limit` in
`verify.ts` only checks the declared `limits`, not the data -- the data check can only happen in the
emitted script.

## Evidence

- no source, reasoning only. The reasoning is that this repo already decided the script is the
  reproducibility record, and a record that omits the denominator is not one. Every fact above is a
  file-and-line in this repo, listed at the top, rather than a claim about the literature.
- A weaker supporting note, [unverified]: I recall that reporting checklists at several publishers
  require exclusion criteria and the number of excluded observations to be stated. I could not fetch
  a primary policy page for this (nature.com redirects through an identity provider), so I am not
  leaning on it. The idea does not need it -- it stands on the repo's own stated goal.

## Why it fits here

The counts can only be computed where the data is, which is the author's machine, which is where the
script runs. The spec is unchanged: `filter`, `transform` and the axis scales already declare the
intent, and the accounting is derived from executing that intent. Reporting it is a generator
responsibility in exactly the way the spec hash and tool version already are.

It also composes with two ideas already in the inbox. Once row counts exist, `report-sample-size`
gets its *n* almost free, and `claims-must-clear-the-noise` can say a claim was tested on 60% of the
rows.

## Rough shape

- `src/codegen/data.ts`: `emitLoad` and `emitPrepare` thread a small counter object; a new
  `report_provenance()` function prints it.
- `src/codegen/index.ts`: `main()` calls it before drawing; the existing spec-hash printing is the
  natural place to attach it.
- `src/codegen/draw.ts` and `decorate.ts`: the local `dropna` calls report into the same counter
  rather than dropping silently. This is the largest part of the diff and the part most likely to be
  cut to scope -- the load-and-filter accounting alone is worth shipping on its own.
- No schema change.

## How you would know it worked

1. `npm run render-check` -- all fifteen baseline scripts still run to completion, and each now
   prints a provenance block whose "rows read" matches `wc -l` on its CSV minus the header.
2. Take `examples/specs/` any spec with a `filter`, poison its CSV by setting 10% of the y column to
   empty, and render. The printed block must name the exact number dropped, and the run must still
   exit 0 with a warning rather than failing.
3. Poison a whole series to empty. The run must exit non-zero naming that series, rather than
   drawing a figure with a silently missing line.
4. `npm run baseline -- --check` fails until the committed scripts are regenerated; the diff should
   be additive and confined to the load, prepare and main paths.
