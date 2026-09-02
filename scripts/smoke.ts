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
  series_order: ["baseline", "ours"],
  emphasis: { series: "ours" },
  legend: { position: "outside_right" },
};

const health = await fetch(`${base}/api/health`).then((r) => r.json());
check("GET /api/health", health?.ok === true, health);

const init = await rpc(
  "initialize",
  { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0.2.0" } },
  1,
);
check("MCP initialize", init.result?.serverInfo?.name === "graph-unslopify", init);

const tools = await rpc("tools/list", {}, 2);
const tool = tools.result?.tools?.find((t: { name: string }) => t.name === "figure_to_matplotlib");
check("MCP tools/list exposes figure_to_matplotlib", !!tool, tools);
check(
  "the tool advertises the full figure schema",
  JSON.stringify(tool?.inputSchema ?? {}).includes("series_order"),
  tool?.inputSchema,
);

const call = await rpc("tools/call", { name: "figure_to_matplotlib", arguments: { spec: SPEC } }, 3);
const text: string = call.result?.content?.[0]?.text ?? "";
check("tools/call emits matplotlib", text.includes("import matplotlib") && text.includes("ax.plot("), call);
check("the emitter honours emphasis", text.includes('EMPHASIS = "ours"'), text.slice(0, 200));
check("a clean spec reports no problems", text.startsWith("No problems found."), text.slice(0, 200));

const bad = await rpc(
  "tools/call",
  {
    name: "figure_to_matplotlib",
    arguments: { spec: { ...SPEC, y: { field: "accuracy", label: "Accuracy", scale: "log", limits: [0, 1] } } },
  },
  4,
);
const badText: string = bad.result?.content?.[0]?.text ?? "";
check("a log axis reaching zero is caught", badText.includes("log_scale_nonpositive_limit"), badText.slice(0, 200));

const rejected = await rpc(
  "tools/call",
  { name: "figure_to_matplotlib", arguments: { spec: { kind: "violin" } } },
  5,
);
check("an unknown chart kind is rejected", rejected.result?.isError === true, rejected);

const convert = await fetch(`${base}/api/convert`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(SPEC),
}).then((r) => r.json());
check("POST /api/convert", convert?.status === "translated" && convert?.ok === true, convert);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
