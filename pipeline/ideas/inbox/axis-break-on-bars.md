---
slug: axis-break-on-bars
title: A cut axis on a bar chart is truncation wearing a disguise, and nothing rejects it
kind: honesty
---

# A cut axis on a bar chart is truncation wearing a disguise, and nothing rejects it

## The problem

`axis_break` lives on `base` in `src/schema.ts`, so every one of the seven kinds accepts it,
including `bar`. `src/codegen/compose.ts:176` (`emitAxisBreak`) calls `draw_panel(ax, df)` for both
halves without ever asking what kind it is drawing, so a bar spec with
`"axis_break": { "axis": "y", "from": 30, "to": 60 }` renders bars with a chunk cut out of the
middle and slanted marks pasted over the wound.

`src/verify.ts` has no rule that mentions `axis_break` at all. Grep it: `axis_break`, `inset`,
`layers` and `repeat` appear nowhere in the rule list. So the spec-time checker, which is the only
thing an agent sees when it calls the MCP server, passes this silently.

This is the exact failure the repo already treats as an error elsewhere. `truncated_bar_axis` in
`python/graphunslopify/inspect.py` is an *error*, not a warning, with the comment "A bar's length
encodes its value, so a cut baseline overstates differences." A break at y=30..60 does the same
damage in the middle of the bar instead of at its foot: every bar's drawn length stops being
proportional to its value, and the ratio between two bars becomes arbitrary.

Two honest caveats, because I traced the code rather than assuming:

1. The render-time checker may catch this *by accident*. `emitAxisBreak` emits
   `upper.set_ylim(bottom=to)`, so on the upper axes `min(low, high) > 0` and `_check_truncated_bars`
   fires. But the message it prints is "the y axis starts at 60 rather than 0 ... Set baseline_zero",
   which is the wrong instruction — `baseline_zero` is already true, and the fix is to drop the
   break. And it only fires if the author runs the Python inspector at all.
2. Related, and worth the auditor knowing: `_check_panel_consistency` counts the two halves of a
   break as two panels, so it reports `panels_disagree_on_y` on *every* axis-break figure, bar or
   not. That is a standing false positive against a feature the README showcases.

## The idea

Add a spec-time rule in `src/verify.ts`, severity `error`, that rejects `axis_break` when
`spec.kind` is one of the kinds whose mark length carries the value — `bar` certainly, and I would
argue `box` and `violin` too, since a box's whisker span and a violin's width are read as extents.
Line, scatter and heatmap keep the break, which is the case the README already illustrates and
defends.

The finding should carry a `fix` of `{ axis_break: undefined }` — or, if the emitter cannot express
removal, no patch at all, following the precedent set by `line_implies_continuity`, which
deliberately dropped its patch rather than guess.

Separately, teach `_check_panel_consistency` to skip axes produced by a break. The break emitter is
the only thing that makes two axes with deliberately different y limits, so it can label them (a
matplotlib axes label, the same mechanism already used to exclude `<colorbar>`).

The argument against: someone will want a broken bar axis for a single outlier that is 100x the
others. The counter is that the repo already made this call for baseline truncation and made it an
error. If the range is genuinely bimodal on a bar chart, the honest moves are a log value axis or a
table, and the rule message should say so.

## Evidence

- no source, reasoning only: the reasoning is internal to this repo's own stated position. `docs/research.md`
  under "Misrepresentation" already commits to bar truncation being an error rather than a warning,
  citing *Truncating Bar Graphs Persistently Misleads Viewers* and *Truncating the Y-Axis: Threat or
  Menace?*. I did not re-fetch either source; they are the repo's existing citations and I am
  extending the position they already justify, not asserting a new empirical claim. The new claim
  here is a code fact, which I verified: `emitAxisBreak` is kind-agnostic and `verify.ts` contains
  no rule naming `axis_break`.
- no source, reasoning only, for the `panels_disagree_on_y` false positive: `emitAxisBreak` sets
  different y limits on the two axes by construction, and `_check_panel_consistency` compares
  `get_ylim()` across all visible axes with data that are not `<colorbar>`. Those two facts are
  enough; it does not need a paper.

## Why it fits here

The spec says "cut the axis between 30 and 60", which is meaning. Whether that is *permissible* for
the mark the author chose is a correctness question the generator and linter own, exactly like
`truncated_bar_axis`. No data crosses the wire: this is decidable from the spec alone, which is why
it belongs in `verify.ts` rather than in the Python inspector.

## Rough shape

- `src/verify.ts`: one new `Rule`, added to the `RULES` array. Probably named `composition` so
  `inset`/`layers`/`repeat` guards can join it later.
- `test/` : a case per kind asserting the rule fires on bar/box/violin and stays quiet on
  line/scatter/heatmap.
- `python/graphunslopify/inspect.py`: `_check_panel_consistency` gains an exclusion, mirroring the
  `<colorbar>` one.
- `src/codegen/compose.ts`: `emitAxisBreak` sets a label on the two axes so the inspector can
  recognise them.
- No schema change.

## How you would know it worked

1. `npm test` — a new test asserting `verify()` returns an `error` finding for a `bar` spec carrying
   `axis_break`, and returns none for the equivalent `line` spec.
2. `npm run compose-check` — should still pass, since the existing composition fixtures use
   `axis_break` on a line chart. If any fixture uses it on a bar, that fixture is the bug and should
   change.
3. `npm run render-check` on a bar-plus-break spec should now be unreachable, because the spec is
   rejected before code is emitted.
4. For the false positive: render `examples/specs/` figure that uses `axis_break`, run
   `inspect_figure` on it, and see zero `panels_disagree_on_y` findings where today there is one.
