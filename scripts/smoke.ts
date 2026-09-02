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
    console.log(`      ${JSON.stringify(detail)}`);
  }
}

async function rpc(method: string, params: unknown, id: number): Promise<unknown> {
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

const health = await fetch(`${base}/api/health`).then((r) => r.json());
check("GET /api/health", health?.ok === true, health);

const init = (await rpc(
  "initialize",
  {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.1.0" },
  },
  1,
)) as { result?: { serverInfo?: { name?: string } } };
check("MCP initialize", init.result?.serverInfo?.name === "graph-unslopify", init);

const tools = (await rpc("tools/list", {}, 2)) as {
  result?: { tools?: { name: string }[] };
};
check("MCP tools/list exposes pass_json", !!tools.result?.tools?.some((t) => t.name === "pass_json"), tools);

const call = (await rpc(
  "tools/call",
  { name: "pass_json", arguments: { payload: { kind: "line", x: [1, 2, 3], y: [4, 5, 6] } } },
  3,
)) as { result?: { content?: { text?: string }[] } };
const callText = call.result?.content?.[0]?.text ?? "";
check("MCP tools/call returns the acknowledgement", callText.includes("json successfully passed"), call);

const convert = await fetch(`${base}/api/convert`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ kind: "bar", values: [1, 2] }),
}).then((r) => r.json());
check("POST /api/convert", convert?.message === "json successfully passed", convert);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
