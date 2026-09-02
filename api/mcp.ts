import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { FigureSpec } from "../src/schema.ts";
import { translate } from "../src/translate.ts";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "figure_to_matplotlib",
      {
        title: "Figure spec to matplotlib",
        description:
          "Turn a semantic figure specification into a runnable matplotlib script, plus a list of " +
          "problems found in the spec. Describe what the figure means, not how to draw it: there is " +
          "no colour, line width, or font size to set, because the generator owns those so that " +
          "every figure in one paper agrees. No data is sent; the script reads data.path locally.",
        inputSchema: z.object({ spec: FigureSpec }),
      },
      async ({ spec }) => {
        const result = translate(spec);

        if (result.status === "invalid_spec") {
          const lines = result.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
          return {
            content: [{ type: "text", text: `Spec rejected.\n${lines}` }],
            isError: true,
          };
        }

        const report = result.findings.length
          ? result.findings.map((f) => `${f.severity.toUpperCase()} [${f.code}] ${f.message}`).join("\n")
          : "No problems found.";

        return {
          content: [
            { type: "text", text: `${report}\n\n# ${result.filename}\n${result.code}` },
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
  },
  {
    serverInfo: { name: "graph-unslopify", version: "0.2.0" },
    verboseLogs: process.env.VERCEL_ENV !== "production",
  },
);

export { handler as GET, handler as POST, handler as DELETE };
