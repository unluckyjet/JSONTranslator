---
slug: facet-plus-axis-break-drops-the-facet
title: A faceted figure with a cut axis silently draws one pooled panel
kind: honesty
---

# A faceted figure with a cut axis silently draws one pooled panel

## The problem

`emitMain`'s axis-break branch in `src/codegen/index.ts:332-346` sets
`blocks = [(None, df)]` and calls `draw_with_break(fig, df)` on the whole frame. It never
consults `panels()`. So a spec declaring both `facet` and `axis_break` gets one pair of
stacked axes over the pooled data, and the facet is discarded without a word.

`verify()` says nothing. The figure renders, exits 0, and is not the figure the spec
asked for. Pooling also changes the numbers: on a faceted single-seed fixture every group
gains observations from the other panels, so groups that had one row now have two and the
missing-interval report correctly says nothing about a figure that should have had plenty
to say.

## The idea

Reject the combination in `verify()`, in the `composition` rule spec 01 created for
exactly this kind of guard. A cut axis needs two stacked axes per panel, and the layout
does not support that today, so refusing is honest and cheap.

If the combination is wanted later, that is a layout change and a bigger spec.

## Evidence

Found by the code auditor on spec 02, round 3, and reproduced there: a `facet` +
`axis_break` spec translates, runs, and draws one pooled pair of axes.

## Why it fits here

`composition` already exists and already holds one check of this shape. This is the
second, and it needs no schema change.

## Rough shape

`src/verify.ts`, the `composition` rule. One branch, one test. Check `inset` and `repeat`
against `axis_break` too while there, and say either way rather than guessing.

## How you would know it worked

A spec with both `facet` and `axis_break` returns an error naming both fields. A spec with
either alone is unaffected, and `compose-check` stays green.
