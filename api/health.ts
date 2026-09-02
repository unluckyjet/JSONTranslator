export function GET(): Response {
  return Response.json({
    ok: true,
    service: "graph-unslopify",
    version: "0.1.0",
    endpoints: { mcp: "/api/mcp", convert: "/api/convert", health: "/api/health" },
  });
}
