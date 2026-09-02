import { CLAIM_KINDS } from "../src/claims.ts";
import { recipeNames } from "../src/recipes.ts";
import { FIGURE_KINDS } from "../src/schema.ts";

export function GET(): Response {
  return Response.json({
    ok: true,
    service: "graph-unslopify",
    version: "0.5.0",
    tools: [
      "figure_to_matplotlib",
      "validate_spec",
      "list_recipes",
      "suggest_figures",
      "apply_fixes",
      "score_spec",
    ],
    kinds: FIGURE_KINDS,
    claim_kinds: CLAIM_KINDS,
    recipes: recipeNames(),
    outputs: ["png", "svg", "pdf", "gif", "mp4", "html", "tex"],
    cli: "pip install ./python, then graphunslopify describe <file>",
    endpoints: { mcp: "/api/mcp", convert: "/api/convert", health: "/api/health" },
  });
}
