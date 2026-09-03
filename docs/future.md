# Future ideas

Things worth building that nobody is building right now. Nothing here is
scheduled. The queue in `pipeline/` is what is actually being worked on, and it
is full of figures that mislead, which outranks everything below.

## A desktop companion with live review

Not a port. Porting means reimplementing the emitter somewhere else, and two
emitters drift. That is why `Figure.render()` posts to the API rather than
generating locally, and the same reasoning applies at a larger scale.

A fork that runs on the desktop and lets other people send feedback on a figure
while it is being edited. A co-author opens the figure, leaves a note on the
truncated axis, and the author sees it against the figure rather than in a
separate thread saying "the third one looks off".

What makes it worth building is that figure review today happens in email, in
review threads, and in comments on a PDF, all of which are detached from the
thing being reviewed. A reviewer cannot point at an axis. The checker already
knows the axis is truncated and can already name the fix; a human reviewer
should be able to attach a comment to the same place, and the two kinds of
feedback should sit in one list.

Sketch:

- The spec and the rendered figure are what travel. The CSV does not.
- The 53 spec rules and the 11 render checks show as findings anchored on the
  figure, and a human comment is another finding in the same list.
- A finding that carries a patch has an apply button. `apply_fixes` already
  returns machine-readable patches, so most of that work is done.
- Re-render on save, so the loop is fast enough that an author fixes things
  rather than promising to.
- Version the spec, not the PNG. A review thread survives a re-render.

The privacy property falls out for free and is worth stating plainly. A
collaborator can review the figure and the spec without ever receiving the data
file. That is a real thing to offer a lab that cannot share raw data, and it is
the reason this should be a desktop application rather than an upload.

Open questions, unresolved on purpose:

- Where do comments live when the spec is in git and the reviewer is not?
- Does the reviewer need the emitter installed, or only the author?
- Real time across machines needs a server, which fights the local-only
  constraint. A shared file in a synced folder might be enough and might not.

## Chart kinds that close an honesty gap

These are ranked by how much of a real mistake they prevent, not by how
interesting they are to build.

**Forest plot.** Effect size and interval per row, reference line at zero. An
ablation table is a forest plot that somebody drew as a table and dropped the
intervals from. It forces effect sizes with uncertainty, and rows whose
intervals overlap become visible instead of hidden behind a bolded number.

**Paired-difference plot.** For paired data, draw the differences and their
interval, not the two groups. This is the commonest statistical mistake in
papers. Two overlapping distributions get shown beside a p-value that was
computed on the differences. The overlap a reader sees is not the overlap that was
tested.

**ECDF.** No bin width, no bandwidth, every observation on the page. A
histogram's bin choice invents and destroys modes, and it is exactly the kind of
presentation decision the generator should own rather than leave to an author
adjusting until the story appears.

**Confusion matrix as its own kind.** It is a heatmap today. It should not be,
because row-normalised, column-normalised and raw counts make three different
claims, and nothing currently forces the author to say which one is on screen.

**Calibration diagram.** Predicted probability against observed frequency, with
the diagonal and the expected calibration error printed. Papers assert
calibration constantly and show it almost never.

## Chart kinds that are simply useful

- **Raincloud**: violin, box and raw points together. Cheap over the violin path.
- **Ridgeline**: many distributions along an ordinal axis.
- **Slope and dumbbell**: before and after read by position rather than length.
- **Waterfall**: ablation contributions from a baseline, disclosing that the
  order of the components changes the picture.
- **Kaplan-Meier**: censoring marks and an at-risk table.
- **Q-Q plot**: check the distributional assumption before making the claim that
  depends on it.
- **Scaling-law fit**: log-log with the fitted exponent and its interval printed
  rather than eyeballed.
- **Sparkline grid**: sixty-four attention heads on one shared scale.

## Capabilities rather than kinds

**Effect size everywhere.** A star says a difference is unlikely by chance and
says nothing about whether it matters. Cohen's d or Cliff's delta beside every
comparison.

**Bank to 45 degrees.** Cleveland measured that slope judgements are most
accurate near 45 degrees. The generator already owns the aspect ratio, so it can
bank the axes and say that it did.

**Switch to hexbin when overplotted.** The render checker already detects
overplotting and currently only complains. It could change the encoding.

**Figure diff.** Regenerate against new data and report which claims flipped.
For a paper in revision that is worth more than any new chart type.

**Unit propagation.** A ratio of two percentages is not a percentage.

## Why none of this is scheduled

Six specs are open and five of them are P0, meaning a figure can currently
mislead a reader in a way that passes every check. A wrong number printed in a
paper costs more than a slow iteration loop or a missing chart type. The
inspector in particular should be built on a set of checks that are worth
trusting, which is what the current queue is for.
