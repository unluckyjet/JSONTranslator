---
slug: axis-break-on-table
title: A table accepts a cut axis and nothing rejects it
kind: new-check
---

# A table accepts a cut axis and nothing rejects it

## The problem

`axis_break` sits on `base` in `src/schema.ts`, so `kind: "table"` accepts it.
`hasCategoricalX` returns false for a table, so the new `composition` rule skips it.
A table has no axes to cut, so the field is meaningless there and passes the linter in
silence.

## The idea

Extend the `composition` rule to reject `axis_break` on a table. Probably `inset` too,
for the same reason, but check before assuming.

## Evidence

Found by the code auditor on spec 01. Verified against the schema: `axis_break` is on
`base`, and `hasCategoricalX` excludes table.

## Why it fits here

The `composition` rule was created with room for exactly this. Spec 01 deliberately put
one check in it and stopped.

## Rough shape

`src/verify.ts`, the `composition` rule. One more branch, one test. Check first whether
`inset`, `layers` and `repeat` are equally meaningless on a table, and say so either way
rather than guessing.

## How you would know it worked

A table spec carrying `axis_break` returns an error code. A table spec without one is
unaffected, and the seven checks stay green.
