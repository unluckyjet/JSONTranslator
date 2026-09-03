---
slug: disclose-composition-in-alt-text
title: Alt text describes a continuous axis on a figure whose axis is cut
kind: accessibility
---

# Alt text describes a continuous axis on a figure whose axis is cut

## The problem

`encodingSentence` in `src/alttext.ts` builds level 1 of the alt text from the spec. Read its
`parts` list: it covers kind, axis labels and units, `group` and `series_order`, log and symlog
scales, `uncertainty`, `emphasis`, `reference_lines`, and `facet`. It covers nothing else.

The five composition features are absent. `axis_break`, `inset`, `layers`, `repeat` and
`series_from_columns` are all in `base` or on the spec, all change what a sighted reader sees, and
none of them reach the alt text.

I ran it rather than reading it. A bar spec carrying
`"axis_break": { "axis": "y", "from": 30, "to": 60 }` printed:

    alt text: Bar chart of Accuracy in % against Model. Values run from 8.48 to 82. The mean is 59.2.

A sighted reader sees slanted marks and knows the axis is cut. A screen-reader user is told the
values run from 8.48 to 82 on an axis that is not continuous, with no signal that any of it is
missing. The repo argues in `docs/research.md` and in `src/codegen/compose.ts:170` that the break
marks are the whole point — "without them a reader takes the axis for continuous and misreads every
distance across the gap" — and then omits the equivalent signal from the channel that has no marks
to look at.

The same holds for the others. An inset is a magnified duplicate of one region; alt text that does
not say so describes a chart with a stray rectangle. A layer adds observations or a rug over the
figure's own marks. `repeat` produces one panel per metric, and unlike `facet` — which *is*
disclosed — nothing announces it.

This is not a hypothetical accessibility gap. `docs/research.md` records that PNAS and others now
require alternative text, and the repo treats level 1 as the part it can derive with certainty from
the spec. These five fields are level 1 information sitting in the spec, unread.

## The idea

Extend `encodingSentence` with a clause per composition feature, in the same declarative style as
the existing `facet` and `reference_lines` clauses. Sketch of the wording, which should be argued
over:

- `axis_break`: "The vertical axis is cut between 30 and 60, so distances across the gap are not
  comparable." The second half is the part that matters and is the sentence equivalent of the
  slanted marks.
- `inset`: "A magnified copy of the region x 14 to 20, y 65 to 85 is drawn in the lower right."
- `layers`: one clause naming each layer's mark and its label, skipping unlabelled ones the way the
  legend does.
- `repeat`: "Split into one panel per metric, being accuracy, loss and latency_ms", mirroring the
  existing facet clause.
- `series_from_columns`: worth a clause only if it changes what the reader sees; it may not, since
  it produces an ordinary grouped figure. I would leave it out of the first pass.

Two things this should not do. It should not become a paragraph — the file's own comment says each
clause becomes its own sentence so a screen reader pauses between them, and five more clauses on a
composed figure is a lot. If length becomes the problem, the honest trade is to put the composition
clauses before the statistics rather than to drop them. And it must not invent: `inset` corners and
break bounds are in the spec, so this is transcription, not inference.

## Evidence

- no source, reasoning only, for the gap itself. It is a measurement: I translated a spec with
  `axis_break` and ran the emitted script, and the printed alt text is quoted verbatim above. The
  absent clauses are visible by reading the `parts` list in `src/alttext.ts`.
- The standard being applied is the repo's own, already sourced in `docs/research.md`: the
  four-level alt text model behind MatplotAlt, where level 1 is "encodings and axes", and the repo's
  stated rule that levels 1 to 3 are derivable while level 4 is left to the author. A cut axis is an
  axis fact, so it is level 1 by that model's own division. I did not re-fetch the MatplotAlt paper;
  it is an existing citation in the repo and I am applying the model it already adopted rather than
  making a new claim about it.
- [unverified] I did not confirm any specific journal policy requiring alt text to disclose axis
  discontinuities. I am not aware of one and would not want the auditor to assume it exists. The
  argument here is internal consistency: the repo already spends code drawing break marks so a
  sighted reader cannot be misled, and the alt text is the same disclosure for a reader who cannot
  see them.

## Why it fits here

Purely spec-derived. `encodingSentence` takes a `FigureSpec` and returns a string, with no data
involved, which is why it runs on the server while levels 2 and 3 run in the emitted script. The
spec already carries the meaning — "cut the axis between 30 and 60" — and this only reads a field
that is already there. No presentation decision moves across the line.

It is also the cheapest of the composition ideas in the inbox: one function, no schema change, no
Python.

## Rough shape

- `src/alttext.ts`: four new clauses in `encodingSentence`.
- `test/`: assert each clause appears for a spec carrying that field and is absent otherwise.
- `src/codegen/index.ts` and `compose.ts` need no change, since they embed whatever
  `encodingSentence` returns as `ENCODING_SENTENCE`.
- No schema change.

## How you would know it worked

1. `npm test` — a unit test on `encodingSentence` for each of the four fields, asserting the clause
   is present, and a negative case asserting a plain line spec's sentence is byte-identical to
   today's.
2. `npm run compose-check` — the `axis_break`, `inset`, `layers` and `repeat` fixtures all still run,
   and each now prints an alt text line containing its clause.
3. `npm run baseline -- --check` fails until regenerated. The diff must be confined to
   `ENCODING_SENTENCE` in the scripts for specs that use these features, and must be empty for the
   fifteen baseline specs, none of which use them — that emptiness is the regression guard.
4. Read the four sentences out loud. If a clause is longer than the axis clause it qualifies, it is
   the wrong wording.
