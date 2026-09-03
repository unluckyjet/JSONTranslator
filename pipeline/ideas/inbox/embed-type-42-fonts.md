---
slug: embed-type-42-fonts
title: Every PDF this tool writes uses Type 3 fonts, which IEEE explicitly refuses
kind: new-check
---

# Every PDF this tool writes uses Type 3 fonts, which IEEE explicitly refuses

## The problem

`src/codegen/theme.ts` is described in its own header as "Every presentation decision in one place."
It sets font sizes, line widths, tick widths and axis line widths through `PRESETS[*].rc`. It does
not set `pdf.fonttype` or `ps.fonttype`. Grep the whole of `src/` for `fonttype`: zero hits.

matplotlib's default for both is 3. I checked the interpreter in this environment rather than
trusting the docs:

    $ python -c "import matplotlib; print(matplotlib.__version__, matplotlib.rcParams['pdf.fonttype'], matplotlib.rcParams['ps.fonttype'])"
    3.11.1 3 3

`OutputSpec.formats` defaults to `["png", "svg", "pdf"]`, and `VENUES` includes `ieee`. So the
default output of a tool that advertises "Venue presets set the column width and the font floor from
the real submission guides" is a PDF that at least one of those venues will not accept.

This is not an aesthetic complaint. It fails at the submission portal, after the paper is written,
and the error message the author gets names a font rather than a figure, so the cause is not obvious.
The repo already treats venue submission requirements as first-class -- `VENUE_RULES` encodes column
widths and font floors from the guides -- and this is the same class of requirement sitting one
field away, unset.

`svg.fonttype` defaults to `path`, which converts text to outlines. That is safe for rendering but
makes the SVG's text unselectable and unsearchable, which matters for accessibility tooling and for
anyone editing a figure downstream. Worth deciding deliberately in the same change rather than
leaving at the default by accident.

## The idea

Two parts, and the first is nearly free.

**Set it.** Add `"pdf.fonttype": 42` and `"ps.fonttype": 42` to the `rc` block in both presets in
`src/codegen/theme.ts`. Type 42 is TrueType, which embeds a real font program rather than a bitmap
glyph procedure. The cost is a slightly larger PDF. That is the whole change.

**Check it.** Add a check to `python/graphunslopify/inspect.py`, or more likely to
`scripts/render-check.ts`, that opens the written PDF and asserts no Type 3 font is present. The
honest version of this check reads the PDF's font dictionaries; a cheaper version greps the
uncompressed PDF for `/Subtype /Type3`. Either way it is a check on the artefact, which is where
this repo already puts checks that need the output rather than the spec.

Consider also a `verify.ts` warning when `style.venue` is `"ieee"` and `pdf` is not in
`output.formats`, since IEEE wants vector figures -- but I have not confirmed that requirement and
would leave it out of this idea rather than assert it.

## Evidence

- [verified] The matplotlib default. Not from documentation -- matplotlib's docs site returned 403
  to my fetches -- but by running the interpreter in this repo's own environment, output quoted
  above: matplotlib 3.11.1, `pdf.fonttype = 3`, `ps.fonttype = 3`, `svg.fonttype = path`. This is
  primary evidence for the exact version the project runs against.
- [verified] The IEEE requirement. Fetched https://attend.ieee.org/iwem-2026/paper-submission , an
  IEEE-hosted conference submission page, which states verbatim: "Embedded Type 1 or True Type fonts
  are required in the submitted PDF file as subset fonts. Type 3 fonts (bitmaps) will not be
  accepted." Caveat on scope, stated plainly: this is one IEEE conference's page, not the IEEE
  Xplore PDF specification itself. It is boilerplate that appears across IEEE conference sites and I
  am confident it reflects the general IEEE PDF eXpress requirement, but the implementer should
  confirm against the IEEE Author Center before writing the *general* claim into `docs/research.md`.
  The narrow claim -- at least one IEEE venue rejects Type 3 in submitted PDFs -- is verified.
- [unverified] I recall similar Type 3 restrictions in ACM and some Elsevier workflows, and that
  Type 3 is the most common cause of a font-embedding rejection for figures exported from matplotlib
  and MATLAB. Search results agreed with this but they were blog posts, not primary policy, so I am
  not marking it verified.

## Why it fits here

This is presentation in the purest sense, so it belongs entirely to the generator, and
`theme.ts` is the file whose whole job is "every presentation decision in one place." The spec does
not change and should not. No data is involved. It also fits the repo's existing framing that a
venue preset should encode what a venue actually requires rather than what looks right.

Priced honestly for the auditor: this is a compliance fix, not an honesty fix. It does not close a
way a figure can mislead a reader. It closes a way a correct figure gets bounced. The diff is two
lines plus a test, so the ratio is good, but it should not outrank the honesty items in the queue.

## Rough shape

- `src/codegen/theme.ts`: two entries in each of the two `PRESETS` `rc` blocks.
- `scripts/render-check.ts`: assert the emitted PDF carries no Type 3 font.
- `docs/research.md`: a row under a submission-policy heading, with the IEEE quote and its scope
  caveat, since that file is the repo's contract that every rule traces to a source.
- No schema change.

## How you would know it worked

1. `npm run baseline -- --check` fails until regenerated; the diff is exactly the two rc lines in
   every script, which is the cheapest possible confirmation that the change reached the emitter.
2. Render any baseline spec and inspect the PDF:
   `python -c "from pypdf import PdfReader; r=PdfReader('figure.pdf'); print([f for p in r.pages for f in p['/Resources']['/Font'].values()])"`
   -- or `pdffonts figure.pdf` where poppler is available. No entry may report Type 3. Before the
   change, the same command on a committed baseline PDF should report Type 3, which is the
   before-and-after the auditor should ask for.
3. `npm run render-check` -- all fifteen still run and still write PDFs.
4. Visual check on one figure at column width, confirming glyph shapes and metrics did not shift.
   Type 42 renders through the same font, so nothing should move, but the check is cheap.
