# GraphUnslopify

An MCP server that turns a semantic figure specification into runnable matplotlib code.

Live at [json-translator-three.vercel.app](https://json-translator-three.vercel.app).

An agent says what the figure means. The generator decides how it is drawn. There is no colour, no
line width, and no font size anywhere in the spec, and that is the whole point. If an agent could
set them, every figure in your paper would disagree with every other one.

Your data never leaves your machine. The tool hands back a Python script that reads your own CSV,
so there is nothing to upload and nothing stored.

## The tool

`figure_to_matplotlib` takes a `spec` and returns two things. A runnable script, and a list of
problems found in the spec before anything was drawn.

```json
{
  "kind": "line",
  "x": { "field": "epoch", "label": "Training epoch" },
  "y": { "field": "accuracy", "label": "Test accuracy", "unit": "%" },
  "group": "model",
  "aggregation": "mean",
  "series_order": ["baseline", "ours"],
  "emphasis": { "series": "ours" },
  "legend": { "position": "outside_right" },
  "data": { "path": "results.csv", "columns": ["epoch", "accuracy", "model"] }
}
```

Only `kind`, `x`, and `y` are required. Defaults land on single-column width, 600 dpi, PNG plus SVG
plus PDF, no grid, and the top and right spines removed.

Three fields carry most of the value. `series_order` pins colour assignment, so a model is the same
colour in figure 2 as it was in figure 1. `emphasis` names the one series you are arguing for, and
the generator foregrounds it and mutes the rest; you say which series matters, it decides what that
looks like. `aggregation` collapses repeated x values, which is what you want for a curve measured
over several seeds.

Supply `data.columns` and every field reference gets checked before you run anything.

## What it checks

Twelve rules run on the spec alone, no rendering needed. An error means the script will fail or the
figure will misrepresent the data. A warning means it will run and a reviewer will still object.

A log axis whose lower limit reaches zero. Inverted limits. A bar chart baselined at zero on a log
value axis, which cannot work. A field missing from `data.columns`. `emphasis` naming a series
absent from `series_order`, or used with no group at all. An unaggregated bar chart. Raster output
below 300 dpi. More than eight series. A linear trendline fitted across a log axis.

Errors do not block the script. You still get code, plus `ok: false` and the reason.

Whether the data actually has repeated x values is not knowable from the spec, so that check ships
inside the generated script and runs where the data is.

## Scope

Line, scatter, and bar. Box and heatmap are deliberately absent. Each kind costs a renderer plus
verification rules plus render coverage, and it is worth knowing what a rule costs before
committing to six of them.

## Connecting a client

```bash
claude mcp add --transport http graph-unslopify https://json-translator-three.vercel.app/api/mcp
```

Cursor or Windsurf, in `mcp.json`:

```json
{
  "mcpServers": {
    "graph-unslopify": {
      "url": "https://json-translator-three.vercel.app/api/mcp"
    }
  }
}
```

## Calling it without MCP

```bash
curl -X POST https://json-translator-three.vercel.app/api/convert \
  -H 'content-type: application/json' \
  -d '{"kind":"line","x":{"field":"epoch","label":"Epoch"},"y":{"field":"acc","label":"Accuracy"}}'
```

You get 200 when the spec is clean, 422 when it parsed but has errors, and 400 when it did not
parse.

## Running it locally

```bash
npm install
npm test          # 28 unit tests, and python compiles every sample script
npm run typecheck
```

Unit tests say nothing about whether the MCP wiring works, so start the offline server and drive a
real handshake at it:

```bash
PORT=3999 node scripts/serve.ts
node scripts/smoke.ts http://localhost:3999
```

`scripts/serve.ts` copies Vercel's file routing onto a plain Node server, so no Vercel login is
needed. `scripts/smoke.ts` sends `initialize`, `tools/list`, and `tools/call` over the wire and
runs ten checks. Point it at a deployed URL to check a release the same way.

Compiling the generated Python only proves it parses. A wrong keyword argument survives that and
dies at runtime, and a swapped axis label survives even running. So there is a third layer:

```bash
node scripts/render-check.ts /path/to/python-with-matplotlib
```

That writes a synthetic CSV, generates sixteen scripts covering every branch of the emitter, runs
each one, and checks a PNG landed.

Even that is not the last word. A chart with swapped axis labels renders perfectly and writes a
valid PNG, so the fourth layer is a committed gallery of images you look at:

```bash
npm install                              # once
pip install -r requirements.txt          # into a venv
npm run baseline                         # rebuild examples/baseline from the live API
```

Four of the emitter's bugs so far survived the unit tests, and three of those survived a successful
render too. All of them were caught by opening the PNG. See `examples/README.md`.

## Layout

`src/schema.ts` is the contract, a discriminated union on `kind`. `src/verify.ts` holds the rules.
`src/codegen.ts` owns every presentation number, including the palette, which is Okabe-Ito with the
yellow removed because it is unreadable on white. `src/translate.ts` is the only entry point and
does parse, check, emit. The three files under `api/` call it and hold no logic of their own.

Adding a chart kind means one variant in the schema, one emitter function, its rules in
`src/verify.ts`, a case in `scripts/render-check.ts`, and a spec in `examples/specs`.

Every commit is pushed automatically by `.githooks/post-commit`, wired up through
`git config core.hooksPath .githooks`. A push failure prints a warning and exits 0, because a
commit that already happened must not be undone by a network problem.

## A note on mcp-handler

Vercel's published docs still show the v1 API, with a three-argument `createMcpHandler` and a
`basePath` option. Version 2 dropped both. It also peers on `@modelcontextprotocol/server`, not
`@modelcontextprotocol/sdk`, which is an easy hour to lose. If you extend the server, read
`node_modules/mcp-handler/dist/index.d.mts` rather than the docs.
