---
slug: alt-text-promises-a-band-that-is-absent
title: Alt text describes a confidence band on points that no longer have one
kind: accessibility
---

# Alt text describes a confidence band on points that no longer have one

## The problem

`encodingSentence` writes "Shaded 95 percent confidence intervals", or "as error bars"
for `display: "bar"`, from the spec alone. That was true when every point got a band,
because the emitter substituted the centre when it could not measure one.

Spec 02 stopped that substitution, correctly. Points with fewer than two observations now
have no band at all. The alt text still promises one.

A sighted reader sees the gap. A screen-reader user is told the interval is there. That
inverts the accessibility argument the feature exists for.

## The idea

The sentence is built from the spec, but the count is only known at runtime, which is
exactly the split the four-level alt-text model already handles: level 1 from the spec,
levels 2 and 3 from the data. `report_missing_interval` already computes the number. Feed
it into the runtime half of the alt text so the sentence says the band covers the points
that had repeats, and names how many did not.

## Evidence

Found by the code auditor on spec 02, round 3, which observed the emitted `ALT_TEXT`
promising intervals on a figure where five of ten points had none. This mismatch was
created by spec 02 removing the fabricated mark.

## Why it fits here

The alt-text machinery already separates spec-derived from data-derived sentences. This
belongs on the data-derived side.

## Rough shape

`src/alttext.ts` and wherever the runtime alt text is assembled. No schema change. Should
not overlap spec 08, which owns the per-group n accounting; this is about one clause of
one sentence agreeing with what was drawn.

## How you would know it worked

Generating for `test/fixtures/single-seed.csv` produces alt text that does not claim an
interval for the points that have none.
