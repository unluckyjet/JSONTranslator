import { ingest } from "../src/core.ts";

/**
 * Plain HTTP twin of the `pass_json` MCP tool, so the service can be exercised
 * with curl and by clients that do not speak MCP.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "request body is not valid JSON" }, { status: 400 });
  }

  const payload =
    body !== null && typeof body === "object" && "payload" in body
      ? (body as { payload: unknown }).payload
      : body;

  const result = ingest(payload);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
