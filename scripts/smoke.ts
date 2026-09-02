/**
 * End-to-end check against a running deployment. Speaks the MCP Streamable HTTP
 * wire protocol directly, so a pass means a real MCP client can connect.
 *
 *   node scripts/smoke.ts https://your-app.vercel.app
 */

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const mcpUrl = `${base}/api/mcp`;

let failures = 0;

function check(name: string, ok: boolean, detail: unknown): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures += 1;
    console.log(`      ${String(JSON.stringify(detail)).slice(0, 400)}`);
  }
}

async function rpc(method: string, params: unknown, id: number): Promise<any> {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`${method} -> HTTP ${response.status}: ${text.slice(0, 300)}`);

  // Streamable HTTP may answer as JSON or as a single SSE event.
  if (text.startsWith("event:") || text.startsWith("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    if (!line) throw new Error(`${method} -> SSE with no data frame: ${text.slice(0, 300)}`);
    return JSON.parse(line.slice("data:".length).trim());
  }
  return JSON.parse(text);
}

const SPEC = {
  kind: "line",
  x: { field: "epoch", label: "Training epoch" },
  y: { field: "accuracy", label: "Test accuracy", unit: "%" },
  group: "model",
  aggregation: "mean",
  uncertainty: { kind: "ci", level: 0.95, over: "seed", display: "band" },
  series_order: ["baseline", "ours"],
  emphasis: { series: "ours" },
  reference_lines: [{ axis: "y", value: 50, meaning: "chance", label: "chance" }],
  annotate: [{ at: "max", series: "ours", text: "best" }],
  legend: { position: "outside_right" },
};

const health = await fetch(`${base}/api/health`).then((r) => r.json());
check("GET /api/health", health?.ok === true, health);
check("health lists all six kinds", (health?.kinds ?? []).length === 6, health?.kinds);

const init = await rpc(
  "initialize",
  { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0.4.0" } },
  1,
);
check("MCP initialize", init.result?.serverInfo?.name === "graph-unslopify", init);

const tools = await rpc("tools/list", {}, 2);
const names: string[] = (tools.result?.tools ?? []).map((t: { name: string }) => t.name);
for (const wanted of [
  "figure_to_matplotlib",
  "validate_spec",
  "list_recipes",
  "suggest_figures",
  "apply_fixes",
  "score_spec",
]) {
  check(`tools/list exposes ${wanted}`, names.includes(wanted), names);
}

const tool = tools.result?.tools?.find((t: { name: string }) => t.name === "figure_to_matplotlib");
const schema = JSON.stringify(tool?.inputSchema ?? {});
check("the schema advertises uncertainty", schema.includes("uncertainty"), schema.slice(0, 200));
check("the schema advertises faceting", schema.includes("facet"), schema.slice(0, 200));
check("the schema carries worked examples", schema.includes("Training epoch"), schema.slice(0, 200));

const recipes = await rpc("tools/call", { name: "list_recipes", arguments: {} }, 3);
const recipeText: string = recipes.result?.content?.[0]?.text ?? "";
check("list_recipes returns a catalogue", recipeText.includes("training_curve"), recipeText.slice(0, 200));

const one = await rpc("tools/call", { name: "list_recipes", arguments: { name: "pareto" } }, 4);
check(
  "a named recipe comes back whole",
  (one.result?.content?.[0]?.text ?? "").includes("frontier"),
  one,
);

const valid = await rpc("tools/call", { name: "validate_spec", arguments: { spec: SPEC } }, 5);
check("validate_spec accepts a good spec", valid.result?.isError !== true, valid);

const invalid = await rpc(
  "tools/call",
  { name: "validate_spec", arguments: { spec: { ...SPEC, uncertainty: { kind: "std" }, aggregation: "none" } } },
  6,
);
check(
  "validate_spec catches uncertainty without aggregation",
  (invalid.result?.content?.[0]?.text ?? "").includes("uncertainty_without_aggregation"),
  invalid,
);

const call = await rpc("tools/call", { name: "figure_to_matplotlib", arguments: { spec: SPEC } }, 7);
const text: string = call.result?.content?.[0]?.text ?? "";
check("tools/call emits matplotlib", text.includes("import matplotlib") && text.includes("ax.plot("), call);
check("the emitter honours emphasis", text.includes('EMPHASIS = "ours"'), text.slice(0, 200));
check("uncertainty becomes a bootstrap band", text.includes("bootstrap_interval") && text.includes("fill_between"), text.slice(0, 200));
check("the reference line is drawn", text.includes("axhline"), text.slice(0, 200));
check("the annotation resolves at runtime", text.includes("def locate("), text.slice(0, 200));

const suggested = await rpc(
  "tools/call",
  { name: "figure_to_matplotlib", arguments: { spec: { kind: "line", x: { field: "e", label: "E" }, y: { field: "acc", label: "A" }, data: { columns: ["e", "accuracy"] } } } },
  8,
);
check(
  "an unknown field suggests the right column",
  (suggested.result?.content?.[0]?.text ?? "").includes('Did you mean "accuracy"'),
  suggested,
);

const rejected = await rpc(
  "tools/call",
  { name: "figure_to_matplotlib", arguments: { spec: { kind: "sankey" } } },
  9,
);
check("an unknown chart kind is rejected", rejected.result?.isError === true, rejected);

const ranked = await rpc(
  "tools/call",
  {
    name: "suggest_figures",
    arguments: {
      profile: {
        columns: [
          { name: "model", role: "category", distinct: 4 },
          { name: "seed", role: "ordinal", distinct: 3 },
          { name: "epoch", role: "ordinal", distinct: 30 },
          { name: "accuracy", role: "measure", distinct: 200 },
        ],
        repeats: [{ x: "epoch", group: "model", repeated_rows: 240 }],
      },
    },
  },
  10,
);
const rankedText: string = ranked.result?.content?.[0]?.text ?? "";
check("suggest_figures ranks candidates", rankedText.includes("cost 0"), rankedText.slice(0, 200));
check(
  "the top suggestion aggregates over the repeats",
  rankedText.includes('"aggregation": "mean"'),
  rankedText.slice(0, 300),
);

const repaired = await rpc(
  "tools/call",
  {
    name: "apply_fixes",
    arguments: {
      spec: {
        kind: "bar",
        x: { field: "dataset", label: "Dataset" },
        y: { field: "acc", label: "Accuracy" },
        group: "model",
        stacked: true,
        aggregation: "mean",
        series_order: ["a", "b", "c", "d", "e", "f"],
      },
    },
  },
  11,
);
const repairedText: string = repaired.result?.content?.[0]?.text ?? "";
check("apply_fixes unstacks the bar", repairedText.includes("stacked_costs_a_baseline"), repairedText.slice(0, 200));
check("apply_fixes leaves nothing open", repairedText.includes("Nothing left open"), repairedText.slice(0, 300));

const claimed = await rpc(
  "tools/call",
  {
    name: "figure_to_matplotlib",
    arguments: {
      spec: {
        ...SPEC,
        claims: [{ kind: "beats_everywhere", subject: "ours", reference: "baseline" }],
        output: { latex: true },
      },
    },
  },
  12,
);
const claimedText: string = claimed.result?.content?.[0]?.text ?? "";
check("claims reach the script", claimedText.includes("def verify_claims"), claimedText.slice(0, 200));
check("alt text is generated", claimedText.includes("ENCODING_SENTENCE"), claimedText.slice(0, 200));
check("latex is written", claimedText.includes("def write_latex"), claimedText.slice(0, 200));

const convert = await fetch(`${base}/api/convert`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(SPEC),
}).then((r) => r.json());
check("POST /api/convert", convert?.status === "translated" && convert?.ok === true, convert);

console.log("");
console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
