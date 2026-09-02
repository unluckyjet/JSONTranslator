import { ProfileSchema, suggestFigures } from "../src/suggest.ts";

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

  const envelope = unwrap(body);
  const parsed = ProfileSchema.safeParse(envelope.profile ?? body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "expected a profile with a columns array, as graphunslopify describe prints",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join(".") || "(root)",
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const limit = Math.min(Math.max(envelope.limit ?? 3, 1), 5);
  return Response.json(suggestFigures(parsed.data, limit));
}

/** The profile may arrive bare or wrapped. Reading both fields is all that needs deciding. */
function unwrap(body: unknown): { profile?: unknown; limit?: number } {
  if (body === null || typeof body !== "object") return {};
  const limit = "limit" in body ? body.limit : undefined;
  return {
    profile: "profile" in body ? body.profile : undefined,
    limit: typeof limit === "number" ? limit : undefined,
  };
}
