import { suggestFigures } from "../src/suggest.ts";

/**
 * Ranked candidate figures for a data profile.
 *
 * The same thing suggest_figures does over MCP, over plain HTTP, so the Python
 * builder can call it without speaking MCP.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const payload = body as { profile?: unknown; limit?: number };
  const profile = payload?.profile ?? body;
  if (!profile || typeof profile !== "object" || !("columns" in profile)) {
    return Response.json(
      { error: "expected a profile with a columns array, as graphunslopify describe prints" },
      { status: 400 },
    );
  }

  const limit = Math.min(Math.max(payload?.limit ?? 3, 1), 5);
  return Response.json(suggestFigures(profile as never, limit));
}
