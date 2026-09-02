import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { RECIPES, findRecipe, recipeNames } from "../src/recipes.ts";
import { FIGURE_KINDS, FigureSpec } from "../src/schema.ts";
import { translate } from "../src/translate.ts";
import { verify } from "../src/verify.ts";

function issueList(issues: { path: string; message: string }[]): string {
  return issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
}

function findingList(findings: { severity: string; code: string; message: string }[]): string {
  if (!findings.length) return "No problems found.";
  return findings.map((f) => `${f.severity.toUpperCase()} [${f.code}] ${f.message}`).join("\n");
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "figure_to_matplotlib",
      {
        title: "Figure spec to matplotlib",
        description:
          "Turn a semantic figure specification into a runnable matplotlib script, plus a list of " +
          "problems found in the spec. Describe what the figure means, not how to draw it: there " +
          "is no colour, line width, or font size to set, because the generator owns those so " +
          "every figure in one paper agrees. No data is sent; the script reads data.path locally. " +
          `Kinds: ${FIGURE_KINDS.join(", ")}. Run "graphunslopify describe <file>" first to see ` +
          "what columns exist, and call list_recipes for a known-good starting spec.",
        inputSchema: z.object({ spec: FigureSpec }),
      },
      async ({ spec }) => {
        const result = translate(spec);

        if (result.status === "invalid_spec") {
          return {
            content: [{ type: "text", text: `Spec rejected.\n${issueList(result.issues)}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `${findingList(result.findings)}\n\n# ${result.filename}\n${result.code}`,
            },
          ],
          structuredContent: {
            ok: result.ok,
            filename: result.filename,
            findings: result.findings,
            code: result.code,
          },
          isError: !result.ok,
        };
      },
    );

    server.registerTool(
      "validate_spec",
      {
        title: "Check a spec without generating code",
        description:
          "Parse a figure specification and report every problem, without emitting a script. " +
          "Cheaper than figure_to_matplotlib when iterating on a spec, and the findings are the " +
          "same ones the generator would report.",
        inputSchema: z.object({ spec: FigureSpec }),
      },
      async ({ spec }) => {
        const parsed = FigureSpec.safeParse(spec);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => ({
            path: i.path.length ? i.path.join(".") : "(root)",
            message: i.message,
          }));
          return {
            content: [{ type: "text", text: `Spec rejected.\n${issueList(issues)}` }],
            structuredContent: { ok: false, issues },
            isError: true,
          };
        }
        const findings = verify(parsed.data);
        const ok = !findings.some((f) => f.severity === "error");
        return {
          content: [{ type: "text", text: findingList(findings) }],
          structuredContent: { ok, findings, resolved: parsed.data },
          isError: !ok,
        };
      },
    );

    server.registerTool(
      "list_recipes",
      {
        title: "Known-good starting specs",
        description:
          "The figures that keep recurring in papers, as specs that already pass validation. " +
          "Fetch one, change the field names to match your data, and send it to " +
          "figure_to_matplotlib. Faster and far less error-prone than assembling a spec by hand.",
        inputSchema: z.object({
          name: z
            .string()
            .optional()
            .describe(`Return one recipe in full. One of: ${recipeNames().join(", ")}`),
        }),
      },
      async ({ name }) => {
        if (!name) {
          const summary = RECIPES.map((r) => `${r.name}: ${r.purpose}`).join("\n");
          return {
            content: [{ type: "text", text: summary }],
            structuredContent: { recipes: RECIPES.map((r) => ({ name: r.name, purpose: r.purpose })) },
          };
        }
        const recipe = findRecipe(name);
        if (!recipe) {
          return {
            content: [
              { type: "text", text: `No recipe called "${name}". Try one of: ${recipeNames().join(", ")}` },
            ],
            isError: true,
          };
        }
        return {
          content: [
            { type: "text", text: `${recipe.purpose}\n\n${JSON.stringify(recipe.spec, null, 2)}` },
          ],
          structuredContent: recipe,
        };
      },
    );
  },
  {
    serverInfo: { name: "graph-unslopify", version: "0.4.0" },
    verboseLogs: process.env.VERCEL_ENV !== "production",
  },
);

export { handler as GET, handler as POST, handler as DELETE };
