---
slug: table-highlight-inside-the-noise
title: The table bolds a winner by idxmax alone, and its uncertainty field is dead code
kind: honesty
---

# The table bolds a winner by idxmax alone, and its uncertainty field is dead code

## The problem

Two facts, both verified in the tree.

**One.** `mark_winners` in `src/codegen/compose.ts:269` picks the winner with nothing but

    best = values.idxmax() if HIGHER_IS_BETTER else values.idxmin()

so 82.41 beats 82.40 and gets bold in the markdown, bold in the LaTeX, and bold in the rendered
image. A results table is read for exactly that bold cell -- the README says so: "`highlight` bolds
the winner in each row or column" and "a printed number is exact rather than estimated, so it
outranks every graphical channel for reading one value." An exact number that is exactly 0.01 ahead,
presented as the winner, is the most emphatic way this tool can currently assert something the data
does not support.

**Two.** `TableSpec` in `src/schema.ts` declares `uncertainty: UncertaintySpec.optional()`, and
nothing in the table code path reads it. Grep `src/codegen/compose.ts` for `uncertainty`, `_low` or
`_high`: zero hits. `emitTable` builds its own `groupby(...).mean()` in `build_table` and never
calls `summarise()`, which is where `_low`/`_high` are produced. So the field is accepted by the
schema, described in the schema's own documentation, and silently does nothing.

Worse, the `uncertainty` rule in `src/verify.ts` matches on `"uncertainty" in spec`, so it *does*
apply to tables: a table spec with `uncertainty` and `aggregation: "none"` gets an
`uncertainty_without_aggregation` error, enforcing a contract for a feature that is not implemented.
An agent that reads the schema, sets the field, satisfies the linter, and gets a table with no
intervals in it has been told a lie by the tool.

## The idea

Implement the field, then let it govern the bolding.

1. **Render the spread.** `build_table` computes the same interval `summarise()` does and each cell
   becomes `82.41 ± 0.31` (or the interval, for an asymmetric `iqr`/`range`/`ci`), in the markdown,
   the LaTeX and the image. The format is a presentation decision the generator owns.
2. **Do not bold a winner that is not separated.** When `uncertainty` is present, `mark_winners`
   bolds the best cell only when its interval clears every other cell's interval in that row (or
   column). When it does not, the honest output is to bold every cell that is tied with the leader
   -- a shared best -- rather than to bold nothing, since "these are indistinguishable" is itself
   the finding.
3. **Say so.** The printed output names which rows had a clear winner and which had a tie, so the
   author writing the caption knows not to write "ours is best on every benchmark."

If the auditor decides implementing `uncertainty` on tables is too large, the minimum shippable
version is smaller and still worth it: make `verify.ts` raise an error saying `uncertainty` is not
supported on `kind: "table"`, so the schema stops promising something it does not deliver. Silently
ignoring a declared field is the worst of the three options.

## Evidence

- no source, reasoning only, and the reasoning is that the repo has already argued this position for
  every other kind. `docs/research.md` says the tool "could plot a mean over seeds and throw the
  spread away silently, which is arguably worse than not aggregating at all", and four lint rules
  exist to keep the statistics honest around `uncertainty`. The table is the one kind where the
  spread is still thrown away silently, and it is also the kind that states its numbers most
  emphatically.
- The dead-field claim is a code fact, not a literature claim: `TableSpec.uncertainty` is declared in
  `src/schema.ts`; `emitTable` in `src/codegen/compose.ts` never references it; the table branch of
  `src/codegen/index.ts:294` calls `build_table` / `write_table` / `render_table_image` and never
  `summarise`.
- [unverified] I recall the "no bold without separation" convention being standard practice in ML
  results tables and stated explicitly in some venue author guides, but I did not find and read a
  guideline that says it, so I am not marking it verified and the idea does not rest on it.

## Why it fits here

`highlight: "best_per_row"` says *what the reader should be shown*, which is meaning. How a winner
is decided, and whether the numbers support calling one, is a correctness question the generator
owns -- the same division as `reference_lines.meaning`, where the spec says "target" and the emitter
picks the dash pattern. `uncertainty` is already the repo's vocabulary for spread. The comparison
happens in the emitted script, on the author's rows.

## Rough shape

- `src/codegen/compose.ts`: `build_table` returns a centre table plus low/high tables;
  `mark_winners` takes the intervals; `write_table` and `render_table_image` format the cell.
- `src/schema.ts`: no new field. Possibly a `tie` policy field if the auditor wants the tie
  behaviour configurable, but I would hard-code "bold the tied set" first.
- `src/verify.ts`: either nothing, or the fallback error if the feature is deferred.
- `scripts/compose-check.ts`: the `table` fixture gains an `uncertainty` block so the path is
  exercised. There is no table entry in `src/recipes.ts` today; adding one would be a reasonable
  companion change but is not required by this idea.

## How you would know it worked

1. `npm run compose-check` -- the table fixtures still emit and run.
2. Render the `table` fixture from `scripts/compose-check.ts` against a CSV with several seeds
   per cell. The written `.md` must contain
   a `±` (or an interval) in every cell, and the `.tex` the LaTeX equivalent.
3. Two fixtures, same spec: one where the leader's interval clears the runner-up's, one where they
   overlap. In the first, exactly one cell per row is bold. In the second, both are bold and the
   printed output names the row as a tie.
4. `npm test` -- assert `verify()` no longer reports `uncertainty_without_aggregation` in a way that
   promises unimplemented behaviour, i.e. either the feature is implemented or a clear
   not-supported error replaces it.
5. `npm run baseline -- --check` after regenerating the table example.
