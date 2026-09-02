import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { GET as mcpGet, POST as mcpPost, DELETE as mcpDelete } from "../api/mcp.ts";
import { POST as convertPost } from "../api/convert.ts";
import { GET as healthGet } from "../api/health.ts";

/**
 * Mirrors Vercel's file routing so the same handlers can be exercised without
 * a Vercel login. `vercel dev` is the deployed-parity surface; this is the
 * offline one.
 */
type Handler = (request: Request) => Response | Promise<Response>;

const routes: Record<string, Partial<Record<string, Handler>>> = {
  "/api/mcp": { GET: mcpGet, POST: mcpPost, DELETE: mcpDelete },
  "/api/convert": { POST: convertPost },
  "/api/health": { GET: healthGet },
};

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);

  // A repeated header arrives as an array, which Headers takes one value at a time.
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const one of value) headers.append(name, one);
    else if (value !== undefined) headers.set(name, value);
  }

  return new Request(new URL(req.url ?? "/", origin), {
    method: req.method,
    headers,
    body: body.length > 0 ? body : undefined,
  });
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const body = response.body;
  if (!body) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(body).pipe(res).on("finish", resolve).on("error", reject);
  });
}

const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const origin = `http://localhost:${port}`;
  const pathname = new URL(req.url ?? "/", origin).pathname;
  const handler = routes[pathname]?.[req.method ?? "GET"];

  if (!handler) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: `no route for ${req.method} ${pathname}` }));
    return;
  }

  try {
    await send(await handler(await toRequest(req, origin)), res);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: String(error) }));
  }
}).listen(port, () => console.log(`listening on http://localhost:${port}`));
