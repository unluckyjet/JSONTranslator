import { designCost } from "./perception.ts";
import { FigureSpec } from "./schema.ts";
import { hasErrors, verify, type Finding } from "./verify.ts";

/**
 * Candidate figures for a data profile, ranked.
 *
 * This is the constraint-and-weight shape Draco uses. Hard constraints reject a
 * design outright, soft constraints carry a cost, and the lowest total wins.
 * The difference from a rule list is that this can compare two designs, which
 * is what an agent staring at a fresh CSV actually needs.
 *
 * Input is the JSON that `graphunslopify describe` prints, so the agent does
 * not have to reshape anything between the two calls.
 */

export type Column = {
  name: string;
  role: "measure" | "category" | "ordinal" | "flag" | "identifier";
  distinct: number;
  min?: number;
  max?: number;
};

export type Profile = {
  columns: Column[];
  repeats?: { x: string; group: string; repeated_rows: number }[];
};

export type Candidate = {
  spec: Record<string, unknown>;
  cost: number;
  why: string;
  reasons: string[];
};

function titleCase(field: string): string {
  const words = field.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A unit guessed from the column name, which is better than none at all. */
function guessUnit(field: string): string | undefined {
  const name = field.toLowerCase();
  if (/(_ms|latency|duration|time)$/.test(name)) return "ms";
  if (/(_s|seconds)$/.test(name)) return "s";
  if (/(accuracy|acc|precision|recall|f1|rate|pct|percent)/.test(name)) return "%";
  if (/(_m|params|millions)$/.test(name)) return "M";
  return undefined;
}

function axis(field: string): Record<string, unknown> {
  const unit = guessUnit(field);
  return unit ? { field, label: titleCase(field), unit } : { field, label: titleCase(field) };
}

export function suggestFigures(profile: Profile, limit = 3): Candidate[] {
  const measures = profile.columns.filter((c) => c.role === "measure");
  const categories = profile.columns.filter((c) => c.role === "category");
  const ordinals = profile.columns
    .filter((c) => c.role === "ordinal")
    .sort((a, b) => b.distinct - a.distinct);

  const repeats = profile.repeats ?? [];
  const candidates: { spec: Record<string, unknown>; why: string }[] = [];

  const group = categories[0]?.name;
  const replicate = ordinals.length > 1 ? ordinals[ordinals.length - 1]!.name : undefined;

  // A curve along the longest ordinal, which is what a training run looks like.
  if (ordinals.length && measures.length) {
    const x = ordinals[0]!.name;
    const y = measures[0]!.name;
    const repeated = repeats.some((r) => r.x === x && r.group === group);
    const spec: Record<string, unknown> = {
      kind: "line",
      x: axis(x),
      y: axis(y),
      ...(group ? { group } : {}),
      ...(repeated ? { aggregation: "mean" } : {}),
      ...(repeated && replicate
        ? { uncertainty: { kind: "ci", over: replicate, display: "band" } }
        : {}),
    };
    candidates.push({
      spec,
      why: repeated
        ? `${x} repeats within each ${group}, so this averages and shows the spread`
        : `${x} has the most steps, so it reads as the axis a curve travels along`,
    });
  }

  // One bar per category, which is the comparison a table would otherwise make.
  if (categories.length && measures.length) {
    const x = categories[0]!.name;
    const y = measures[0]!.name;
    const second = categories[1]?.name;
    candidates.push({
      spec: {
        kind: "bar",
        x: axis(x),
        y: axis(y),
        ...(second ? { group: second } : {}),
        aggregation: "mean",
        uncertainty: { kind: "sem", display: "bar" },
        sort: { by: "value", direction: "desc" },
      },
      why: `${x} is categorical, so bars put the comparison on a shared baseline`,
    });
  }

  // Two measures against each other, which is where a trade-off lives.
  if (measures.length >= 2) {
    candidates.push({
      spec: {
        kind: "scatter",
        x: axis(measures[0]!.name),
        y: axis(measures[1]!.name),
        ...(group ? { group } : {}),
        frontier: { x: "min", y: "max" },
      },
      why: `${measures[0]!.name} and ${measures[1]!.name} are both measured, so this shows the trade-off`,
    });
  }

  // The distribution behind a summary, which a bar chart hides.
  if (categories.length && measures.length) {
    candidates.push({
      spec: {
        kind: "box",
        x: axis(categories[0]!.name),
        y: axis(measures[0]!.name),
        show_points: true,
      },
      why: `shows the spread within each ${categories[0]!.name} rather than only its average`,
    });
  }

  // A grid, when two low-cardinality keys index one measure.
  const gridKeys = [...ordinals, ...categories].filter((c) => c.distinct <= 12);
  if (gridKeys.length >= 2 && measures.length) {
    candidates.push({
      spec: {
        kind: "heatmap",
        x: axis(gridKeys[0]!.name),
        y: axis(gridKeys[1]!.name),
        value: measures[0]!.name,
        value_label: titleCase(measures[0]!.name),
        aggregation: "mean",
        annotate_cells: true,
      },
      why: `${gridKeys[0]!.name} and ${gridKeys[1]!.name} form a small grid over ${measures[0]!.name}`,
    });
  }

  const scored: Candidate[] = [];
  for (const candidate of candidates) {
    const parsed = FigureSpec.safeParse(candidate.spec);
    if (!parsed.success) continue;
    const findings = verify(parsed.data);
    if (hasErrors(findings)) continue;

    const { total, reasons } = designCost(parsed.data);
    const warnings = findings.filter((f) => f.severity === "warning").length;
    scored.push({
      spec: candidate.spec,
      cost: total + warnings,
      why: candidate.why,
      reasons: [...reasons, ...(warnings ? [`${warnings} lint warning(s)`] : [])],
    });
  }

  return scored.sort((a, b) => a.cost - b.cost).slice(0, limit);
}

/**
 * Apply a finding's fix to a spec.
 *
 * Shallow merge, one level deep for nested objects, which covers every fix the
 * linter currently emits and refuses to guess beyond that.
 */
export function applyFix(
  spec: Record<string, unknown>,
  fix: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...spec };
  for (const [key, value] of Object.entries(fix)) {
    const existing = merged[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      merged[key] = { ...(existing as object), ...(value as object) };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export type RepairResult = {
  spec: Record<string, unknown>;
  applied: string[];
  remaining: { code: string; message: string }[];
  rounds: number;
};

/**
 * Repeatedly apply every fix the linter offers, up to a budget.
 *
 * The budget matters. The agent literature describes models that recognise an
 * error, fail to fix it, and keep trying until they give up, so this stops and
 * says what it could not repair instead of looping.
 */
export function repair(spec: Record<string, unknown>, budget = 3): RepairResult {
  let current = spec;
  const applied: string[] = [];

  for (let round = 1; round <= budget; round += 1) {
    const parsed = FigureSpec.safeParse(current);
    if (!parsed.success) {
      return {
        spec: current,
        applied,
        remaining: parsed.error.issues.map((i) => ({
          code: "invalid_spec",
          message: `${i.path.join(".") || "(root)"}: ${i.message}`,
        })),
        rounds: round,
      };
    }

    const findings = verify(parsed.data);
    const fixable = findings.filter(
      (f): f is Finding & { fix: Record<string, unknown> } => !!f.fix && !applied.includes(f.code),
    );
    if (!fixable.length) {
      return {
        spec: current,
        applied,
        remaining: findings.map((f) => ({ code: f.code, message: f.message })),
        rounds: round,
      };
    }

    for (const finding of fixable) {
      current = applyFix(current, finding.fix);
      applied.push(finding.code);
    }
  }

  const parsed = FigureSpec.safeParse(current);
  const findings = parsed.success ? verify(parsed.data) : [];
  return {
    spec: current,
    applied,
    remaining: findings.map((f) => ({ code: f.code, message: f.message })),
    rounds: budget,
  };
}
