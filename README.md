# GraphUnslopify

An MCP server that turns a JSON figure spec into matplotlib code.
Live at [json-translator-three.vercel.app](https://json-translator-three.vercel.app).

![Grouped horizontal bar chart of favourite ice cream flavours, split by age group](docs/first-pass.png)

*First pass with the translation tool with JSON*

Nothing in the spec sets a colour, a line width, or a font size. The generator picks those, which is
how two figures in one paper end up agreeing with each other.

![The same chart with the Adults series hatched](docs/second-pass.png)

*Same JSON, after the improvements*

Adults is hatched now. The spec did not change, the tool did.

| First pass | After |
| --- | --- |
| ![First pass in greyscale, both series the same grey](docs/first-pass-greyscale.png) | ![Second pass in greyscale, one series hatched](docs/second-pass-greyscale.png) |

*Both of them printed in black and white*

This is why the hatching is there. Okabe-Ito is colourblind-safe but not greyscale-safe, so blue and
vermillion land 0.07 apart in relative luminance, under the 0.10 a reader needs. Reordering the
palette does not save it. Of all 40,320 orderings the best still leaves four series 0.094 apart.
Hatching does save it, at any number of series.

The spec behind the chart:

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

`series_order` pins colour assignment so a model keeps its colour across every figure.
`aggregation` collapses repeated x values, which is what a curve over several seeds needs.

Your data never leaves your machine. You get back a script that reads your own CSV.

```bash
claude mcp add --transport http graph-unslopify https://json-translator-three.vercel.app/api/mcp
```

`docs/research.md` explains what each check is for. `examples/README.md` covers the baseline gallery.
