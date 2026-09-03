---
slug: axis-break-on-bars
title: A bar chart with a cut axis draws break marks over a gap that is not there, and nothing rejects it
kind: honesty
---

# A bar chart with a cut axis draws break marks over a gap that is not there, and nothing rejects it

## The problem

`axis_break` lives on `base` in `src/schema.ts`, so all seven kinds accept it, including `bar`.
`emitAxisBreak` in `src/codegen/compose.ts:176` calls `draw_panel(ax, df)` for both halves without
asking what kind it is drawing, and `src/codegen/draw.ts` emits a `draw_panel` for every plotted
kind (its own header says "One `draw_panel` function per chart kind"), so a bar spec with a break
emits a script that runs.

`src/verify.ts` has no rule mentioning `axis_break` at all. Grep it: `axis_break`, `inset`, `layers`
and `repeat` appear nowhere in the rule list. So the spec-time checker, which is the only thing an
agent sees when it calls the MCP server, passes this silently.

I built the spec and ran it rather than reasoning about it, and the actual output is worse than a
truncated bar chart. This spec:

    { "kind": "bar", "x": {"field":"model",...}, "y": {"field":"accuracy",...},
      "aggregation": "mean", "axis_break": { "axis": "y", "from": 30, "to": 60 } }

produces, on `examples/data/training.csv`:

- `verify()` returns exactly one finding, `legend_without_group`, which is unrelated.
- The emitted `draw_with_break` sets `lower.set_ylim(top=30)` and `upper.set_ylim(bottom=60)`.
- `main()` then calls `decorate_panel(upper, ...)`, and `decorate_panel` contains
  `ax.set_ylim(bottom=0)` because `baseline_zero` is true. That overwrites the break.
- Measured limits on the rendered figure: upper `(0.0, 67.09)`, lower `(0.0, 30.0)`.

So the figure is two stacked panels that both start at zero, one clipped at 30 and one at 67, with
slanted break marks drawn between them asserting a discontinuity that does not exist. The range
0 to 30 is drawn twice. A reader who trusts the marks reads a gap; a reader who reads the ticks sees
the same values repeated. This is not truncation in disguise, it is a figure whose axis annotation
contradicts its own axis.

Three consequences worth the auditor knowing, all measured rather than inferred:

1. `truncated_bar_axis` in `python/graphunslopify/inspect.py` does not fire, precisely because
   `baseline_zero` won the fight and the upper axes starts at 0. Called directly on an upper axes
   that kept `bottom=60`, it does fire. So the check is correct and the emitter defeats it.
2. `_check_panel_consistency` reports `panels_disagree_on_y` on this figure, and on every axis-break
   figure including the legitimate `line` one in `scripts/compose-check.ts`, because a break is two
   axes with deliberately different limits by construction. That is a standing false positive
   against a feature the README showcases.
3. The generated alt text reads "Bar chart of Accuracy in % against Model. Values run from 8.48 to
   82. The mean is 59.2." It does not mention the break at all. That gap is general and has its own
   idea file, `disclose-composition-in-alt-text`.

## The idea

Add a rule to `src/verify.ts`, severity `error`, rejecting `axis_break` when `spec.kind` is a kind
whose mark length carries the value. `bar` certainly, and I would argue `box` and `violin`, since a
box's whisker span and a violin's width are read as extents. Line, scatter and heatmap keep the
break, which is the case the README illustrates and defends.

The message should say why: a bar's length is its value, so removing a slice of the axis removes a
slice of every bar, and the honest alternatives are a log value axis, a table, or dropping
`baseline_zero` and accepting a line chart.

That rule is the minimum shippable version and it is enough on its own. Because `baseline_zero`
already defeats the break, the emitter has never actually drawn a coherent broken bar chart, so
nothing needs to learn how. The rule makes an unimplemented and incoherent combination
unrepresentable rather than teaching the emitter to render a thing that should not exist.

Two adjacent fixes, separable if the auditor wants a smaller diff:

- Teach `_check_panel_consistency` to skip break axes. `emitAxisBreak` is the only thing that makes
  two axes with deliberately different limits, so it can label them, using the same mechanism that
  already excludes `<colorbar>`.
- Make the `decorate_panel` and `draw_with_break` conflict impossible rather than latent. Even on a
  line chart, any future feature that sets limits in `decorate_panel` will silently overwrite the
  break the same way. Ordering the calls, or having `draw_with_break` re-apply its limits last, is a
  one-line guard.

The argument against the rule: someone will want a broken bar axis for a single outlier at 100 times
the others. The counter is that the repo already made this call for baseline truncation and made it
an error, and that the emitter cannot currently draw the thing being asked for anyway.

## Evidence

- no source, reasoning only, and the reasoning is a measurement rather than an argument. Everything
  above was produced by translating the quoted spec with `src/translate.ts`, running the emitted
  script against `examples/data/training.csv`, and reading back the axes limits: upper
  `(0.0, 67.09)`, lower `(0.0, 30.0)`, with the break marks drawn between them. The implementer can
  reproduce it in three commands.
- The position that bar truncation is an error rather than a warning is the repo's own, already
  argued in `docs/research.md` under "Misrepresentation" and sourced there to *Truncating Bar Graphs
  Persistently Misleads Viewers* and *Truncating the Y-Axis: Threat or Menace?*. I did not re-fetch
  either. They are the repo's existing citations, and this idea extends a position they already
  justify rather than making a new empirical claim.

## Why it fits here

The spec says "cut the axis between 30 and 60", which is meaning. Whether that is permissible for
the mark the author chose is a correctness question the linter owns, exactly like
`truncated_bar_axis`. No data crosses the wire, because this is decidable from the spec alone, which
is why it belongs in `verify.ts` and not in the Python inspector.

## Rough shape

- `src/verify.ts`: one new `Rule` added to the `RULES` array. Name it `composition` so future
  `inset`, `layers` and `repeat` guards have a home.
- `test/`: a case per kind. Fires on bar, box, violin; silent on line, scatter, heatmap.
- `python/graphunslopify/inspect.py`: `_check_panel_consistency` gains a break exclusion.
- `src/codegen/compose.ts`: `emitAxisBreak` labels its two axes and re-applies its limits after
  decoration.
- No schema change.

## How you would know it worked

1. `npm test` — `verify()` returns an `error` finding for a `bar` spec carrying `axis_break`, and no
   such finding for the same spec as `kind: "line"`.
2. `npm run compose-check` — still passes. The one `axis_break` fixture there is a `line` spec, so it
   stays legal; if a bar fixture is ever added it is the bug, not the rule.
3. The before-and-after the auditor should demand: translate the bar-plus-break spec above and run
   it. Today it renders a PNG and prints two findings, neither about the break. After the change it
   must be rejected at `validate_spec` time and never reach the emitter.
4. For the false positive: render the `axis_break` fixture from `scripts/compose-check.ts`, run
   `inspect_figure` on the result, and see zero `panels_disagree_on_y` findings where today there is
   one.
5. For the overwrite guard: render that same legal line-plus-break fixture and assert the upper axes
   reports `get_ylim()[0] == 60`, not 0.
