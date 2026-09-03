---
id: 01
slug: reject-axis-break-on-length-marks
status: ready
priority: P0
title: Reject axis_break on bar, box and violin, where mark length carries the value
source_idea: axis-break-on-bars.md
---

# Reject axis_break on bar, box and violin, where mark length carries the value

## Problem

`axis_break` sits on `base` in `src/schema.ts:333`, so all seven kinds accept it.
`emitAxisBreak` in `src/codegen/compose.ts:176` never asks what kind it is drawing — it
calls `draw_panel(ax, df)` for both halves and then sets `lower.set_ylim(top=from)` and
`upper.set_ylim(bottom=to)`. `src/verify.ts` contains no rule naming `axis_break` at all.

So this spec passes the linter and renders:

```json
{ "kind": "bar", "y": { "field": "accuracy" }, "baseline_zero": true,
  "axis_break": { "axis": "y", "from": 30, "to": 60 } }
```

I rendered it. `probe_bar_break.py` and `probe-bar-break.png` in the repo root are the
output. Every bar is drawn twice, once in each half, with a gap punched through the middle;
`baseline` at 57.4 and `ours` at 62.0 come out near-identical in drawn length, and no bar's
length is proportional to its value any more. This is the failure
`_check_truncated_bars` in `python/graphunslopify/inspect.py:410` is an *error* for —
"A bar's length encodes its value, so a cut baseline overstates differences" — relocated
from the foot of the bar to its middle.

The render-time checker catches it only by accident, and then says the wrong thing. Because
`upper.set_ylim(bottom=60)` makes `min(low, high) > 0`, `_check_truncated_bars` fires with
"the y axis starts at 60 rather than 0 ... Set baseline_zero". `baseline_zero` is already
true and setting it fixes nothing; the fix is to drop the break. It also only fires if the
author runs the Python inspector, which an agent calling the MCP server does not.

## Change

One new `Rule` in `src/verify.ts`, added to the `RULES` array. Name it `composition`, so
guards for `inset`, `layers` and `repeat` have somewhere to live later.

It fires when `spec.axis_break` is set and `hasCategoricalX(spec)` returns true.
`hasCategoricalX` (`src/schema.ts:466`) already returns exactly `bar | box | violin`, which
is exactly the set whose mark length or extent carries the value: a bar's height is its
value, a box's whisker span is a range, a violin's width is a density. Reuse it rather than
re-listing the kinds.

- severity: `error`
- code: `axis_break_on_length_marks`
- The message must name the kind, say that the mark's length or extent encodes the value so
  a cut makes drawn lengths non-proportional, and name the two honest alternatives: a log
  value axis, or `kind: "table"`.
- **No `fix` payload.** Follow the precedent set by `line_implies_continuity` in
  `src/perception.ts:130`, which deliberately carries no patch. A patch here would have to
  delete a field, and the existing test that forbids a fix payload from touching `kind`
  exists because auto-repair of structural fields caused a shipped bug.

Line, scatter and heatmap keep `axis_break` untouched — that is the case
`README.md:158` showcases and the case `scripts/compose-check.ts:99-106` exercises, which
is a `line` spec.

## Acceptance criteria

1. `npm test` passes, and a new test in `test/features.test.ts` asserts `verify()` returns a
   finding with `severity: "error"` and `code: "axis_break_on_length_marks"` for a `bar`
   spec carrying `axis_break: { axis: "y", from: 30, to: 60 }`.
2. The same test file asserts the identical `axis_break` on a `box` spec and on a `violin`
   spec each also produce that error code.
3. The same test file asserts `verify()` returns **no** finding with code
   `axis_break_on_length_marks` for a `line` spec, a `scatter` spec and a `heatmap` spec
   carrying the identical `axis_break`.
4. A test asserts the finding for the `bar` case has no `fix` property.
5. `npm run compose-check` passes unchanged. Its `axis_break` fixture
   (`scripts/compose-check.ts:99`) is a `line` spec, so it must remain legal and must still
   emit and run.
6. `npm run typecheck`, `npm run baseline -- --check`, `npm run render-check`,
   `npm run recipe-check` and `npm run test:python` all pass. None of the fifteen baseline
   specs uses `axis_break`, so `baseline --check` must pass without regenerating anything —
   if it fails, the rule has caught something it should not have.

## Out of scope

- Do **not** touch `_check_panel_consistency` or the `panels_disagree_on_y` false positive
  on axis-break figures. That is spec 07 and it is a different file and severity.
- Do **not** add rules for `inset`, `layers` or `repeat`. Create the `composition` rule
  function, put one check in it, stop.
- Do **not** change `emitAxisBreak`, `BreakSpec`, or anything in `src/codegen/`. The spec is
  now rejected before code is emitted, so the emitter needs no guard.
- Do **not** change `_check_truncated_bars`, including its message. It is wrong for this
  case but correct for the case it was written for.
- Do **not** fix the overlapping `"0"` and `"30"` y tick labels visible at the join in
  `probe-bar-break.png`. That is a real render-time defect in the break emitter and it is
  not in this queue yet; leave it visible rather than fixing it quietly here.
- Do **not** delete `probe_bar_break.py` or `probe-bar-break.png`.

## Evidence

- **[verified] by me, in this repo.** `src/schema.ts:333` puts `axis_break` on `base`;
  `src/codegen/compose.ts:176-211` shows `emitAxisBreak` calling `draw_panel` for both
  halves with no reference to `spec.kind`; `src/verify.ts` has no occurrence of
  `axis_break`. `hasCategoricalX` at `src/schema.ts:466` returns `bar | box | violin`.
- **[verified] by rendering it.** `probe-bar-break.png` is a bar chart with a cut y axis
  produced by this tree's own emitter. I opened it. The distortion is visible and the
  linter passed the spec. This is stronger than the source idea's reasoning-only argument
  and is the primary evidence for this spec.
- **[verified] the repo's existing position.** `python/graphunslopify/inspect.py:410-428`
  makes truncated bar axes an `error`, with the reasoning in its docstring.
  `docs/research.md:53-60` sources that decision to *Truncating Bar Graphs Persistently
  Misleads Viewers* and *Truncating the Y-Axis: Threat or Menace?*, both already in
  `docs/research.md:160-161`. This spec extends a position the repo already took and
  already sourced; it asserts no new empirical claim, so it needs no new citation.
- Downgrade note: the source idea offered a `fix` of `{ axis_break: undefined }` as an
  option. I removed it. Deleting a field through the auto-repair path is untested
  behaviour and the repo has already been burned once by an over-eager patch.
