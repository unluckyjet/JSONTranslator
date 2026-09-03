---
slug: composition-rule-ignores-which-axis
title: The cut-axis refusal states a reason that is false when the break is on the category axis
kind: honesty
---

# The cut-axis refusal states a reason that is false when the break is on the category axis

## The problem

`composition` in `src/verify.ts` fires on `spec.axis_break && hasCategoricalX(spec)`
without looking at `axis_break.axis`. On `{ kind: "bar", axis_break: { axis: "x" } }`
with a vertical bar, x is the category axis, so a break there shortens no bar at all.
The rule still says "cutting the x axis leaves the drawn lengths no longer
proportional", which is not true of that figure.

Rejecting the spec is still right, since numeric `from`/`to` on a categorical axis is
incoherent. The message is what is wrong, and a wrong reason teaches the agent the
wrong lesson.

## The idea

Compare `axis_break.axis` against the value axis implied by `orientation`, and give the
two cases different messages. A break on the value axis keeps today's wording. A break
on the category axis says the axis holds categories, so a numeric range cannot cut it.

## Evidence

Found by the code auditor on spec 01, reading the rule rather than the tests. No
external source needed; this is an internal consistency defect.

## Why it fits here

Same rule, same file. It sharpens a message rather than adding a field, so the schema
does not move.

## Rough shape

`src/verify.ts`, the `composition` rule. Needs the orientation lookup the bar rules
already use. Two tests, one per axis.

## How you would know it worked

`verify()` on a vertical bar with `axis_break: { axis: "x" }` returns a message naming
categories, not drawn lengths. The existing spec 01 tests keep passing unchanged.
