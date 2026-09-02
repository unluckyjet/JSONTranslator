export function GET(): Response {
  return Response.json({
    ok: true,
    service: "graph-unslopify",
    version: "0.3.0",
    tool: "figure_to_matplotlib",
    kinds: ["line", "scatter", "bar"],
    endpoints: { mcp: "/api/mcp", convert: "/api/convert", health: "/api/health" },
  });
}
