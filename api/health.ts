import { FIGURE_KINDS } from "../src/schema.ts";
import { recipeNames } from "../src/recipes.ts";

export function GET(): Response {
  return Response.json({
    ok: true,
    service: "graph-unslopify",
    version: "0.4.0",
    tools: ["figure_to_matplotlib", "validate_spec", "list_recipes"],
    kinds: FIGURE_KINDS,
    recipes: recipeNames(),
    cli: "pip install ./python, then graphunslopify describe <file>",
    endpoints: { mcp: "/api/mcp", convert: "/api/convert", health: "/api/health" },
  });
}
