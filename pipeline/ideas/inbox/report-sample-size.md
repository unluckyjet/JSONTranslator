---
slug: report-sample-size
title: A mean over two seeds and a mean over fifty render identically, and nothing says which
kind: honesty
---

# A mean over two seeds and a mean over fifty render identically, and nothing says which

## The problem

`emitSummarise` in `src/codegen/data.ts` collapses repeats with

    grouped = frame.groupby(keys, as_index=False, sort=False)[Y_FIELD]
    summary = grouped.mean()

and never counts what it collapsed. The generated script prints the claim verdicts, a methods
sentence, the alt text and the output paths, and at no point does it say how many observations went
into any point.

The gap is visible in the two places the repo already spends effort:

- `emitAltText` in `src/alttext.ts` generates levels 2 and 3 from the data at run time --
  "Values run from ... to ...", "the mean is ..." -- and never states *n*.
- `bootstrap_interval` in `src/codegen/data.ts` writes `nan` when a group has fewer than 2 values,
  and `emitSummarise` then quietly replaces that with the centre: `np.where(np.isfinite(low), low,
  centre)`. So a group with one seed draws a band of zero width, which reads to a reader as perfect
  agreement across seeds rather than as a missing measurement.

Same for `SignificanceSpec`: `compare()` returns `None` and `mark_significance` does `continue` when
a group has fewer than two finite values, so a pair silently vanishes from the figure with no note.

The README's showcase says "mean of five seeds with 95% bootstrap intervals" in prose. The figure
itself does not say five, and neither does the alt text, the caption block, or the LaTeX output.

## The idea

Make the emitted script compute and report per-group *n*, in three places, none of which need a new
spec field:

1. **Printed, always, when `aggregation != "none"`.** One block after `summarise()`: the count per
   group, and the min and max across groups. `n = 5 per point` when it is uniform; `n ranges from 1
   to 5 across 20 points` when it is not.
2. **In the generated alt text**, as part of level 2, since level 2 is "statistics computed from the
   data" and *n* is one.
3. **As a warning when it is small or ragged.** `n = 1` anywhere means the drawn interval is
   fabricated width, and should be an error, not a warning -- the script should refuse rather than
   draw a zero-width band. Unequal *n* across groups is a warning, because an unbalanced comparison
   is a real thing an author may intend and should still disclose.

Optionally, but I would not do it in the first pass: an `n = 5` annotation drawn on the figure. That
is a presentation decision the emitter owns, but it costs space at column width and the printed line
plus the alt text already close the honesty gap.

## Evidence

- [verified] Cumming, Fidler and Vaux, "Error bars in experimental biology", *Journal of Cell
  Biology* 177(1):7-11, 2007, read at https://pmc.ncbi.nlm.nih.gov/articles/PMC2064100/ . Their
  Rule 2 is verbatim: "the value of *n* (i.e., the sample size, or the number of independently
  performed experiments) must be stated in the figure legend." Rule 1 is "when showing error bars,
  always describe in the figure legends what they are" -- this repo already satisfies Rule 1
  through `encodingSentence` in `src/alttext.ts`, which names the interval kind and level. It does
  not satisfy Rule 2.
- [verified, same source] Their Rule 3, "error bars and statistics should only be shown for
  independently repeated experiments, and never for replicates," is the argument for reporting *n*
  rather than only its existence: a reader cannot tell repeats from replicates without the number.
- [unverified] I recall Nature's author guidelines requiring the exact sample size for each
  experimental group to be stated as a discrete number, and requiring error bars and statistics to
  be defined in the legend. A web search returned consistent summaries but nature.com redirects
  through an identity provider and I could not fetch the primary page, so I am not marking this
  verified. It is corroboration, not the load-bearing citation -- Cumming's Rule 2 is.

## Why it fits here

*n* is a fact about the author's data, so it can only be computed on the author's machine, which is
exactly where the emitted script runs. The spec does not change: `aggregation` and `uncertainty`
already declare that repeats are being collapsed, and the count of those repeats is derived, not
declared. Reporting it is generator work, which is the side of the line the generator owns.

## Rough shape

- `src/codegen/data.ts`: `emitSummarise` also emits a `counts` frame and a `report_sample_size()`
  function; the `n = 1` refusal lives next to `bootstrap_interval`'s existing `len(values) < 2`
  branch.
- `src/alttext.ts`: `emitAltText` adds the count to the parts list for the aggregated cases.
- `src/codegen/index.ts`: `main()` calls the report before drawing.
- `src/codegen/decorate.ts`: `mark_significance` prints a line when it skips a pair instead of
  `continue`.
- No schema change.

## How you would know it worked

1. `npm run baseline -- --check` will fail, because every regenerated script differs. That is the
   expected signal; regenerate and read the diff to confirm the new lines appear only where
   `aggregation != "none"`.
2. Render `examples/specs/09-uncertainty-band.json` (mean over seeds with bootstrap intervals). The
   run must print a line naming the per-point *n*, and the alt text written into the PNG metadata
   must contain that number.
3. Render `examples/specs/03-single-run.json` (no group, no aggregation). The run must print nothing
   new, proving the report is scoped to aggregated figures.
4. Feed a CSV where one series has a single seed. The script must exit non-zero with a message
   naming the series, rather than drawing a zero-width band.
5. `npm run render-check` -- all fifteen still run.
