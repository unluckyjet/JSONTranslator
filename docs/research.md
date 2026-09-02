# What people complain about, and which check answers it

Every rule in this repo traces to a documented complaint rather than to taste.
This is the mapping, so a future change to a threshold has to argue with a source.

One honest note on method. X and similar platforms produced almost nothing usable, a single
throwaway joke about AI adding y-axes to misleading graphs. The substantive material is in papers,
publisher policy documents, and Retraction Watch, so that is what these rules are built on.

## Defects invisible in the code

A validation-driven chart-generation study discarded 33% of its candidates, and the unresolved
problems were low contrast, overplotting, unreadable axes, and unclear legends. Retargeting work
describes "pervasive element occlusion", specifically overlapping x tick labels and legends
covering data points. The recurring reviewer sentence is that a figure is unreadable at
single-column width, because 12pt in the draft becomes about 5pt once the journal scales the figure
to 89mm. Generated code also fails silently: it runs, writes a valid file, and the file is wrong.

| Complaint | Check | Where |
| --- | --- | --- |
| Unreadable at column width | `text_too_small`, `text_near_minimum` | `python/graphunslopify/inspect.py` |
| Overlapping tick labels | `tick_labels_collide` | same |
| Legend covering data | `legend_covers_data` | same |
| Overplotting | `overplotting` | same |
| Silent code failure | the script runs or it does not | `scripts/render-check.ts` |

`inspect_figure` takes `target_width_in`, so a 10-inch figure destined for a 3.4-inch column is
measured at the size it will actually be printed, not the size it was drawn.

## Series a reader cannot separate

Roughly one man in twelve has a colour vision deficiency. The standing advice is that colour must
never be the only channel and the figure has to survive greyscale.

`colour.py` converts to CIELAB and measures CIEDE2000, then repeats the measurement under simulated
protanopia, deuteranopia and tritanopia using the Machado, Oliveira and Fernandes (2009) matrices.
White against black scores exactly 100, which is the known reference value for the metric.

Two things fell out of running this on our own output. Red against green scores 6.7 under
deuteranopia, comfortably below the threshold of 11. And Okabe-Ito, which is colourblind-safe, is
not greyscale-safe: adjacent entries sit within 0.06 relative luminance, so three of them merge in
a black and white print. That is why `SECOND_CHANNEL_THRESHOLD` is 2 and the emitter assigns line
styles or markers past two series.

This check also catches, automatically, the bug fixed in `382c85b` where emphasis painted three
series the same grey. That one was found by hand, by opening a PNG.

## Misrepresentation

Truncated bar axes mislead viewers even after they have been explicitly taught about truncation,
with 83.5% still showing the effect. Vision-language models are fooled by the same axis
manipulations across 16,000 responses.

`truncated_bar_axis` is therefore an error, not a warning. Line charts are exempt, because the
literature genuinely disagrees about truncation there and a zoomed line axis is often the honest
choice, but `axis_exaggeration` warns when the visible span is under 10% of the values' magnitude.

## Disclosure and reproducibility

Undisclosed AI figure generation is a policy violation at every major publisher that has issued
guidance, and the standard is that anything representing results must be fully reproducible by the
authors. NEJM retracted a case study in May 2026 over an AI-altered image, and two 2024 papers were
retracted for anatomically wrong AI figures.

This is where the architecture does the work rather than a check. The tool emits a script instead of
an image, so the script is the reproducibility record. On top of that each script carries its tool
version and a spec hash, embeds the full spec in the PNG, SVG and PDF metadata, and prints a
methods sentence ready to paste.

## Chart type confusion

The largest single error class in generated charts is sub-chart-type confusion at 23%, mostly
stacked against grouped bars, then improper bar spacing at 18% and misaligned gridline counts at
15%.

Nothing to check here yet, because the discriminated union in `src/schema.ts` makes the confusion
unrepresentable. Stacked bars do not exist. When they land they should be a boolean on `BarSpec`
rather than a separate `kind`, so a model choosing "bar" cannot accidentally choose the other one.

## Why not ask a model

PlotGen and similar systems loop a multimodal model over the rendered image. Every check here is
geometric or colorimetric, which is faster, cheaper, and gives the same answer twice. A model is
worth reaching for only for the subjective residue, and so far there has not been any.

## Sources

- [Generating Statistical Charts with Validation-Driven LLM Workflows](https://arxiv.org/html/2605.00800)
- [Challenges and Opportunities with LLM-Assisted Visualization Retargeting](https://arxiv.org/pdf/2507.01436)
- [PlotGen: Multi-Agent LLM-based Scientific Data Visualization via Multimodal Feedback](https://arxiv.org/html/2502.00988v1)
- [The ethics of erroneous AI-generated scientific figures](https://link.springer.com/article/10.1007/s10676-025-09835-4)
- [AI-Generated Figures in Academic Publishing: Policies, Tools, and Practical Guidelines](https://arxiv.org/pdf/2603.16159)
- [NEJM retracts case study for AI-manipulated imagery, Retraction Watch](https://retractionwatch.com/2026/05/01/nejm-retracts-case-study-for-ai-manipulated-imagery/)
- [Truncating the Y-Axis: Threat or Menace?](https://arxiv.org/pdf/1907.02035)
- [Truncating Bar Graphs Persistently Misleads Viewers](https://www.sciencedirect.com/science/article/abs/pii/S2211368120300978)
- [The Perils of Chart Deception: How Misleading Visualizations Affect Vision-Language Models](https://arxiv.org/html/2508.09716v1)
- Machado, Oliveira and Fernandes (2009), *A Physiologically-based Model for Simulation of Color Vision Deficiency*, for the dichromacy matrices in `colour.py`.
