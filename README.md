# GraphUnslopify

An MCP server that turns a semantic figure specification into runnable matplotlib code.
Live at [json-translator-three.vercel.app](https://json-translator-three.vercel.app).

An agent says what a figure means. The generator decides how it is drawn. There is no colour, line
width, or font size anywhere in the spec, which is the point. If an agent could set them, every
figure in your paper would disagree with every other one.

## First pass

![Grouped horizontal bar chart of favourite ice cream flavours, split by age group](docs/first-pass.png)

*First pass with the translation tool with JSON*

## Same spec, after the improvements

![The same chart with the Adults series hatched](docs/second-pass.png)

Identical JSON. The only thing that changed is the tool. Adults is hatched now, and that is not
decoration.

## Why the hatching matters

Print the first version in black and white and it falls apart.

| First pass | After |
| --- | --- |
| ![First pass in greyscale, both series the same grey](docs/first-pass-greyscale.png) | ![Second pass in greyscale, one series hatched](docs/second-pass-greyscale.png) |

On the left you cannot tell Kids from Adults without counting bar positions. Okabe-Ito is
colourblind-safe but not greyscale-safe. Blue and vermillion sit 0.07 apart in relative luminance,
under the 0.10 a reader needs.

Reordering the palette does not rescue this. Searching all 40,320 orderings, the best possible one
still leaves four series 0.094 apart. Luminance runs out, a second channel does not. So lines get
dash patterns, scatter gets marker shapes, and bars get hatching, on any chart with more than one
series. The first entry in each cycle is the plain form, so a single-series chart is untouched.

## What it caught along the way

Every one of these was a real defect in the generated output, found by rendering the figure and
looking at it. Every one survived both the unit tests and a successful render.

**Horizontal bars had their axis labels swapped.** The y axis showed epochs under the label "Test
accuracy". The script ran fine and wrote a valid PNG.

**Bar categories came out alphabetical.** pandas sorts group keys by default, so a chart over
baseline, +augment, +distill, ours rendered as +augment, +distill, baseline, ours.

**Horizontal bars read bottom to top.** matplotlib stacks the first category at the bottom, so the
same chart was wrong in two directions at once.

**Training curves drew a sawtooth.** A line chart over several seeds plotted every repeated x value
instead of collapsing them, silently. That is the single most common figure in an ML paper.

**Emphasis erased three series.** Muting every non-emphasised series to one grey reads fine with two
series and produces a legend listing three identical grey lines with four.

**The emphasised series came out dotted.** Cycling dash patterns by index handed "ours" a dotted
line while the baseline it argued against stayed solid.

**A legend under the axes was a tall column,** roughly doubling the height of a four-series figure.

**The colour check was dead code for every bar chart.** A bar legend hands back a `BarContainer`
rather than a patch, so the extractor found no colour and returned nothing. It surfaced only because
the ice cream chart came back clean when it should not have. The Python tests had plotted lines
exclusively.

## What checks the work now

Four layers, because each one catches what the layer below cannot.

**The spec, on the server.** Twelve rules that need no data. A log axis whose lower limit reaches
zero, inverted limits, a bar baselined at zero on a log axis, a field missing from `data.columns`,
`emphasis` naming a series absent from `series_order`, sub-300 dpi output, more than eight series,
and a linear trendline fitted across a log axis.

**The rendered figure, on your machine.** Run `pip install ./python` and the generated script checks
itself. Text below 5pt at the width it will actually be printed, tick labels whose bounding boxes
overlap, a legend covering plotted points, marker ink density, series a reader cannot separate,
series that merge in greyscale, and axis integrity.

Colour separation goes through CIELAB and CIEDE2000, then repeats under simulated protanopia,
deuteranopia and tritanopia. White against black scores exactly 100, the metric's known reference.
Red against green scores 6.7 under deuteranopia, well under the threshold of 11.

**Integrity rules come from the retraction literature.** A truncated bar axis is an error, not a
style note, because readers keep misreading truncated bars even after being taught about the effect.
Line charts are exempt, since truncation is defensible there, but a heavily zoomed line axis warns.

**Provenance, in the artifact.** Each script carries its tool version and a spec hash, embeds the
full spec in the PNG, SVG and PDF metadata, and prints a methods sentence ready to paste. A reviewer
can recover exactly what produced any figure. The deeper answer is architectural. The tool emits a
script rather than an image, so the script is the reproducibility record.

`docs/research.md` maps every rule to the paper or policy behind it, so changing a threshold means
arguing with a source rather than with taste.

## Using it

```bash
claude mcp add --transport http graph-unslopify https://json-translator-three.vercel.app/api/mcp
```

Or without MCP:

```bash
curl -X POST https://json-translator-three.vercel.app/api/convert \
  -H 'content-type: application/json' \
  -d '{"kind":"line","x":{"field":"epoch","label":"Epoch"},"y":{"field":"acc","label":"Accuracy"}}'
```

The spec behind the chart above:

```json
{
  "kind": "bar",
  "title": "Favourite ice cream flavour",
  "x": { "field": "flavour", "label": "Flavour" },
  "y": { "field": "votes", "label": "Votes" },
  "group": "age_group",
  "series_order": ["Kids", "Adults"],
  "aggregation": "mean",
  "orientation": "horizontal",
  "legend": { "position": "lower_right", "title": "Age group" }
}
```

Only `kind`, `x` and `y` are required. `series_order` pins colour assignment so a model keeps its
colour across every figure in a paper. `emphasis` names the series you are arguing for and the
generator foregrounds it. `aggregation` collapses repeated x values.

Your data never leaves your machine. You get back a script that reads your own CSV.

Line, scatter and bar for now. Box and heatmap are deliberately absent until the verifier has proven
what a rule costs to write.

## Running it locally

```bash
npm install
npm test                              # 36 TypeScript tests
npm run typecheck

pip install -r requirements.txt ./python
python -m pytest python/tests -q      # 26 Python tests

PORT=3999 node scripts/serve.ts       # offline server, no Vercel login
node scripts/smoke.ts http://localhost:3999
node scripts/render-check.ts python   # 16 figures against real matplotlib
npm run baseline                      # rebuild examples/baseline from the live API
```

`examples/README.md` covers the baseline gallery and why its images are committed.

Every commit is pushed automatically by `.githooks/post-commit`, wired up through
`git config core.hooksPath .githooks`.

## A note on mcp-handler

Vercel's published docs still show the v1 API, with a three-argument `createMcpHandler` and a
`basePath` option. Version 2 dropped both, and it peers on `@modelcontextprotocol/server`, not
`@modelcontextprotocol/sdk`. Read `node_modules/mcp-handler/dist/index.d.mts` rather than the docs.
