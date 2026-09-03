# Thirteen kinds and five capabilities

Ordered so each batch ships and pushes on its own. The six open P0 specs stay in
the queue; this runs beside them rather than instead of them.

## What a kind costs

The compiler names most of the work. `FigureSpec` is a discriminated union and
several switches end in `const unhandled: never`, so adding a variant fails
typecheck at every site that must handle it.

    src/schema.ts        the variant, the union, FIGURE_KINDS
    src/codegen/draw.ts  an emit function and a case
    src/perception.ts    which channel it reads by, for the Cleveland ranking
    src/codegen/*.ts     wherever the compiler points
    test + recipe        one round trip, one known-good spec

## Batches

- [x] 1. Distribution family: `ecdf`, `raincloud`, `ridgeline`
- [x] 2. Paired and ranked: `forest`, `paired_difference`, `slope`, `dumbbell`
- [ ] 3. Diagnostics: `calibration`, `qq`, `kaplan_meier`, `scaling_fit`
- [ ] 4. Structure: `waterfall`, `confusion_matrix`, `sparkline_grid`
- [ ] 5. Capabilities: effect size, bank to 45, hexbin, figure diff, units

## Rules carried from the existing work

The spec says meaning, the generator owns presentation. No colour, font size or
line width reaches the schema.

A kind that can mislead gets a rule in `verify.ts` at the same time, not later.
`forest` without intervals, `confusion_matrix` without a stated normalisation
and `ecdf` are the obvious ones.

Every batch runs the seven checks and then CI before the next starts.

## Status

Batches 1 and 2 shipped. Batch 3 next.
