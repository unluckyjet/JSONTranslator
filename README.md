# GraphUnslopify

An MCP server and HTTP API that will translate JSON plot specifications into matplotlib code.

**Current state: MVP.** The transport, hosting, and tool registration are real and working. The
translation is not implemented. Sending JSON returns `json successfully passed` plus a description
of what arrived.

## Endpoints

| Path | Method | Purpose |
| --- | --- | --- |
| `/api/mcp` | GET, POST, DELETE | MCP Streamable HTTP endpoint |
| `/api/convert` | POST | Plain HTTP twin of the `pass_json` tool |
| `/api/health` | GET | Liveness and endpoint listing |

## MCP tool

`pass_json` takes one argument, `payload`, which is any JSON value. A JSON-encoded string is
accepted too, because clients disagree about whether to pre-parse tool arguments.

It returns JSON like:

```json
{
  "ok": true,
  "message": "json successfully passed",
  "shape": { "kind": "object", "keys": ["kind", "x", "y"] },
  "bytes": 42,
  "receivedAt": "2026-09-01T12:00:00.000Z"
}
```

## Connecting a client

Claude Code:

```bash
claude mcp add --transport http graph-unslopify https://<your-deployment>.vercel.app/api/mcp
```

Cursor or Windsurf, in `mcp.json`:

```json
{
  "mcpServers": {
    "graph-unslopify": {
      "url": "https://<your-deployment>.vercel.app/api/mcp"
    }
  }
}
```

## Calling it without MCP

```bash
curl -X POST https://<your-deployment>.vercel.app/api/convert \
  -H 'content-type: application/json' \
  -d '{"kind":"line","x":[1,2,3],"y":[4,5,6]}'
```

## Local development

```bash
npm install
npm test                       # unit tests for the core
npm run typecheck
PORT=3999 node scripts/serve.ts   # offline server, no Vercel login needed
node scripts/smoke.ts http://localhost:3999   # real MCP handshake against it
```

`npm run dev` uses `vercel dev` instead, which matches the deployed routing exactly but needs a
Vercel login.

## Layout

`src/core.ts` holds the only logic. `ingest(payload)` is where the matplotlib generator goes; its
signature stays the same when it lands. The three files under `api/` are thin adapters that call it
and do nothing else.
