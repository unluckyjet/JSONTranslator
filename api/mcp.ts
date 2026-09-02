import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { ingest } from "../src/core.ts";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "pass_json",
      {
        title: "Pass JSON",
        description:
          "Send a JSON plot specification to GraphUnslopify. Returns an acknowledgement " +
          "describing what was received. Matplotlib code generation is not implemented yet.",
        inputSchema: z.object({
          payload: z
            .unknown()
            .describe("Any JSON value. A JSON-encoded string is also accepted."),
        }),
      },
      async ({ payload }) => {
        const result = ingest(payload);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.ok,
        };
      },
    );
  },
  {
    serverInfo: { name: "graph-unslopify", version: "0.1.0" },
    verboseLogs: process.env.VERCEL_ENV !== "production",
  },
);

export { handler as GET, handler as POST, handler as DELETE };
