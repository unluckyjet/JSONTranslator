---
slug: correct-for-multiple-comparisons
title: Every significance pair is tested against a flat alpha, so five categories buy ten chances at a star
kind: honesty
---

# Every significance pair is tested against a flat alpha, so five categories buy ten chances at a star

## The problem

`SignificanceSpec` in `src/schema.ts` takes `pairs: z.array(z.tuple([...])).min(1)` -- a minimum of
one and no maximum -- plus a single `alpha` defaulting to 0.05. `emitSignificance` in
`src/codegen/decorate.ts:194` then loops:

    for left_name, right_name in SIGNIFICANCE_PAIRS:
        ...
        p = compare(...)
        ...
        mark = "n.s." if p > SIGNIFICANCE_ALPHA else ("***" if p < 0.001 else "**" if p < 0.01 else "*")

Each pair is compared against the same nominal threshold, independently, with no adjustment for how
many comparisons are on the figure. An author who lists all pairs among five categories gets ten
tests; under the null the chance that at least one crosses 0.05 is about 40%. The figure then
carries a star that means nothing, drawn by a tool whose entire premise is that it does not let a
figure assert what the data does not support.

This is worse than an ordinary uncorrected analysis, because the bracket-and-star notation reads as
a verdict. `docs/research.md` argues that `truncated_bar_axis` is an error rather than a warning
because readers keep misreading truncated bars even after being taught. An uncorrected star is the
same species of problem: the notation is a strong signal and the caveat is invisible.

`src/verify.ts` has exactly one rule about `significance`, `significance_without_uncertainty`, and
it says nothing about how many pairs there are.

## The idea

Two changes, one statistical and one interface.

**Adjust, and say so.** Add a `correction` field to `SignificanceSpec`, an enum of
`"none" | "holm" | "benjamini_hochberg"`, defaulting to `"holm"`. The default matters: the current
behaviour is `"none"`, and leaving it as the default means the honest path is opt-in. Holm is the
conservative family-wise default; Benjamini-Hochberg is the right choice when the figure is
exploratory and the author wants power. `"none"` stays available and should trigger a warning in
`verify.ts` when `pairs.length > 1`, so choosing it is a decision rather than an omission.

Both procedures are a sort and a running comparison over the p-values -- a dozen lines of numpy in
`emitSignificance`, no scipy required, so the `bootstrap` method keeps its "needs numpy and nothing
else" property. The script should print both the raw and the adjusted p-value per pair, so the
adjustment is auditable:

    baseline vs ours: p = 0.021, holm-adjusted p = 0.084 (n.s., 4 comparisons)

**Cap the fan-out.** A warning in `verify.ts` when `pairs.length` is large -- the exact threshold is
the auditor's call, but past roughly six brackets the figure is unreadable anyway and the
`mark_significance` code stacks them at `reach * 0.06` intervals, which will run off the top of the
axes.

## Evidence

- [verified] Zgraggen, Zhao, Zeleznik and Kraska, "Investigating the Effect of the Multiple
  Comparisons Problem in Visual Analysis", CHI 2018, doi 10.1145/3173574.3174053. I read the paper
  PDF at https://cs.brown.edu/research/ptc/assets/publications/zgraggeninvestigating.pdf . The
  abstract states verbatim: "This problem is well-known in Statistics as the multiple comparisons
  problem (MCP) but overlooked in visual analysis. We present a way to evaluate MCP in visualization
  tools by measuring the accuracy of user reported insights on synthetic datasets with known ground
  truth labels. In our experiment, over 60% of user insights were false." That paper is about
  interactive exploration rather than static figures, so it is evidence that the problem is real and
  under-addressed in visualisation tooling specifically; it is not evidence about star-annotated bar
  charts. I am not stretching it further than that.
- [unverified] The two procedures themselves. I recall Holm (1979), "A simple sequentially rejective
  multiple test procedure", *Scandinavian Journal of Statistics*, and Benjamini and Hochberg (1995),
  "Controlling the false discovery rate: a practical and powerful approach to multiple testing",
  *Journal of the Royal Statistical Society Series B*. I did not fetch either, so treat the years,
  the journals and the exact titles as recall. The procedures are textbook and the implementer
  should confirm the algorithm against a primary source or against `statsmodels.stats.multitest`
  before writing the numpy, rather than trusting this file.
- no source, reasoning only, for the 40% figure: 1 - 0.95^10 = 0.401, which assumes ten independent
  tests under the null. Real pairwise comparisons among five groups are not independent, so the true
  family-wise error rate is somewhat lower. The point stands; the number is illustrative.

## Why it fits here

`correction` is meaning, not presentation: it says what "significant" is being taken to mean on this
figure, in the same way `uncertainty.kind` says what the band means and `claim.tolerance` says how
close counts. The generator keeps owning the bracket geometry, the star glyphs and the stacking. The
test still runs in the emitted script on the author's data.

It also repairs an asymmetry. `ClaimSpec` forces `within_tolerance` to declare its tolerance --
`claim_without_tolerance` is an *error*. `SignificanceSpec` currently lets a figure declare ten
hypotheses and defines none of the bookkeeping.

## Rough shape

- `src/schema.ts`: one enum field on `SignificanceSpec`.
- `src/codegen/decorate.ts`: `emitSignificance` collects all p-values first, adjusts, then draws;
  currently it draws inside the loop, so the loop has to split in two.
- `src/verify.ts`: a warning for `correction: "none"` with more than one pair, and a warning for a
  large `pairs` count.
- `src/recipes.ts`: whichever recipe uses `significance` gains the field.
- Nothing in `python/graphunslopify` changes.

## How you would know it worked

1. `npm test` -- `verify()` warns on a spec with three pairs and `correction: "none"`, and is silent
   with `correction: "holm"`.
2. `npm run typecheck` and `npm run recipe-check` -- the recipe carrying `significance` still
   validates against the widened schema.
3. Render a bar spec with four pairs against a CSV generated from a single distribution, so every
   true difference is zero. With `correction: "none"` some run will produce a star; with `"holm"`
   the same data must print `n.s.` for every pair, and the printed line must show raw and adjusted
   p-values side by side.
4. Cross-check the adjusted values once, by hand or against `statsmodels.stats.multitest.multipletests`,
   on a fixed vector of p-values in a Python test under `npm run test:python`.
