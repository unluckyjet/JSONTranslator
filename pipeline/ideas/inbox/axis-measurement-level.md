---
slug: axis-measurement-level
title: The spec carries column names and no measurement level, which is why one suggestion had to give up its patch
kind: agent-ergonomics
---

# The spec carries column names and no measurement level, which is why one suggestion had to give up its patch

## The problem

The README documents this gap in its own words, in the section about the stock chart:

> The spec carries column names and no column types, so nothing in it can tell a trading day from a
> category. There is no clever fix here, only a wrong one, so the suggestion now carries no patch and
> stays advice.

That was the right call at the time -- `apply_fixes` was turning a year of daily prices into 252
bars. But it left `line_implies_continuity` in `src/perception.ts` as the only suggestion in the
file with no `patch`, and a test now sweeps every rule to make sure no fix payload ever touches
`kind`. The tool knows the right question and has no way to ask it.

The same missing information costs elsewhere:

- `AxisSpec.temporal` is a boolean bolted onto one specific case. Four rules in `verify.ts`
  (`temporal_y_axis`, `temporal_x_on_categories`, `temporal_log_axis`, `temporal_axis_limits`) exist
  to keep that boolean from meaning something impossible. It is one measurement level modelled as a
  flag, with the other levels absent.
- `hasCategoricalX(spec)` in `src/schema.ts` derives categoricalness from the *chart kind* rather
  than from the data: bar, box and violin are categorical, everything else is not. So a bar chart of
  a genuinely ordered x and a bar chart of unordered names are indistinguishable to every rule.
- `SortSpec.by` offers `"category"` ordering with no way to say whether the categories have an
  intrinsic order to sort by.
- `designCost` in `perception.ts` cannot charge for the mismatch between an encoding and the level
  of the thing encoded, which is the single most common design error a type system catches.

## The idea

Add a `level` field to `AxisSpec`: `"quantitative" | "ordinal" | "nominal" | "temporal"`, with no
default -- or, if a default is required for backward compatibility, `"quantitative"` on y and an
inferred value on x. `temporal: true` becomes `level: "temporal"` and the existing boolean is
deprecated rather than removed, so committed specs keep working.

What it buys, concretely:

1. `line_implies_continuity` gets its patch back, gated: suggest `kind: "bar"` only when
   `x.level === "nominal"`. On `"temporal"` or `"quantitative"` the suggestion should not fire at
   all. The 252-bar disaster becomes unrepresentable rather than avoided by removing the fix.
2. New error: a `bar`, `box` or `violin` whose x is `"quantitative"`. Binning a continuous variable
   into bars without saying so is a real misrepresentation, and today nothing catches it.
3. New error: a `line` whose x is `"nominal"`. That is the misleading-continuity case stated as a
   fact rather than as advice.
4. The four `temporal_*` rules collapse into the general level rules.
5. `sort.by: "category"` becomes meaningful on an ordinal axis and suspicious on a nominal one.
6. `designCost` can charge for an encoding-level mismatch, which is closer to what Draco actually
   does than the current hand-set weights.

The counter-argument the auditor should weigh: this is a schema change to the most-used object in
the spec, it touches `verify.ts`, `perception.ts`, `suggest.ts`, `describe.py` and every recipe, and
it asks the agent to supply one more thing per axis. My answer is that `graphunslopify describe`
already computes distinct-value counts and roles from the CSV, so it can propose the level and the
agent mostly accepts it -- the field is filled by the profiler, not typed by hand.

## Evidence

- [verified] Satyanarayan, Moritz, Wongsuphasawat and Heer, "Vega-Lite: A Grammar of Interactive
  Graphics", IEEE InfoVis 2017, read at https://idl.cs.washington.edu/files/2017-VegaLite-InfoVis.pdf
  (extracted the PDF text locally). The paper states verbatim: "The field string denotes a data
  attribute to visualize, along with a given data-type (one of nominal, ordinal, quantitative or
  temporal)." And on what the type does: "For x and y channels, either a linear scale (for
  quantitative data) or an ordinal scale (for ordinal and nominal data) is instantiated, along with
  an axis." Also: "For example, quantitative color encodings use a single-hue luminance ramp, while
  nominal color encodings use a categorical palette with varied hues." That is precisely the
  division this proposal wants -- the type is declared as meaning, and the renderer derives scale,
  axis and palette from it.
- Note that `docs/research.md` already cites this paper, for the composition operators. The type
  system is the part of it this repo did not adopt.
- no source, reasoning only, for the repo-specific half: the README quotes above and the absence of
  a patch on `line_implies_continuity` in `src/perception.ts` are code facts I read.

## Why it fits here

Measurement level is meaning, not presentation. "This column is a set of unordered names" is a
statement about the data, in the same family as `unit` and `label`, which `AxisSpec` already carries.
Nothing about it names a colour, a scale type in matplotlib terms, or a tick format -- the generator
still decides that a nominal x gets an index-based axis and a temporal x gets `ConciseDateFormatter`.
No data crosses the wire; the level is declared, and `describe` computes a suggestion from the local
CSV.

## Rough shape

- `src/schema.ts`: one enum on `AxisSpec`; `temporal` becomes a deprecated alias.
- `src/verify.ts`: the four `temporal_*` rules generalise; two new kind-vs-level errors.
- `src/perception.ts`: `line_implies_continuity` regains a gated patch; `designCost` gains a
  mismatch charge.
- `src/schema.ts`: `hasCategoricalX` reads the level instead of the kind.
- `python/graphunslopify/describe.py`: the starting spec proposes a level per column.
- `src/recipes.ts` and `examples/specs/`: every spec gains the field.
- The existing test that forbids a fix payload touching `kind` must be amended deliberately, with a
  comment explaining why the gate is now safe, since that test exists to prevent a specific past bug.

## How you would know it worked

1. `npm test` -- the previously destructive case is the regression test: a `line` spec over a
   temporal x must produce **no** `line_implies_continuity` suggestion and no patch, while a `line`
   spec over `x.level: "nominal"` must produce the suggestion *with* a `kind: "bar"` patch.
2. `npm test` -- new errors fire for `bar` with `x.level: "quantitative"` and for `line` with
   `x.level: "nominal"`.
3. `npm run recipe-check` and `npm run compose-check` -- all eleven recipes and the composition
   fixtures still validate after the field is added.
4. `npm run test:python` -- `graphunslopify describe examples/data/*.csv` proposes `temporal` for the
   date column in the price data and `nominal` for the model column, and the printed starting spec
   round-trips through `validate_spec` with no findings.
5. `npm run baseline -- --check` after regenerating, to confirm no emitted script changed except
   where a level genuinely alters the axis handling.
