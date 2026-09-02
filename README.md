# GraphUnslopify

An MCP server that will turn JSON plot specifications into matplotlib code.

It does not do that yet. Right now it accepts JSON and answers `json successfully passed` with a
description of what arrived. That sounds trivial, and the acknowledgement is, but the part worth
having is underneath it. The MCP transport, the tool registration, and the input handling all work,
so the generator drops into a slot that is already wired.

## Endpoints

| Path | Method | Purpose |
| --- | --- | --- |
| `/api/mcp` | GET, POST, DELETE | MCP Streamable HTTP |
| `/api/convert` | POST | Same behaviour without MCP, for curl |
| `/api/health` | GET | Liveness, and a list of these endpoints |

## The pass_json tool

One argument, `payload`, holding any JSON value. A JSON-encoded string works too, because clients
disagree about whether to parse tool arguments before sending them and I would rather accept both
than make you guess.

The reply:

```json
{
  "ok": true,
  "message": "json successfully passed",
  "shape": { "kind": "object", "keys": ["kind", "x", "y"] },
  "bytes": 42,
  "receivedAt": "2026-09-01T12:00:00.000Z"
}
```

`shape` exists so you can tell at a glance whether the payload survived the trip intact. Once the
generator lands, that field is where the parsed plot spec will report itself.

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

## Running it locally

```bash
npm install
npm test          # 7 unit tests over src/core.ts
npm run typecheck
```

Unit tests do not prove the MCP wiring works, so there is a second layer. Start the offline server
and drive a real handshake at it:

```bash
PORT=3999 node scripts/serve.ts
node scripts/smoke.ts http://localhost:3999
```

`scripts/serve.ts` copies Vercel's file routing onto a plain Node server, which means you can
exercise the handlers with no Vercel login. `scripts/smoke.ts` sends `initialize`, `tools/list`,
and `tools/call` over the wire and checks all five responses. Point it at a deployed URL to check
a release the same way.

`npm run dev` runs `vercel dev` instead. That matches deployed routing exactly, at the cost of
needing a Vercel login.

## Deploying

Import the repo at [vercel.com/new](https://vercel.com/new). Framework preset is Other, and leave
the build command empty. Everything runs on the Hobby tier, so it costs nothing. Vercel redeploys
on every push to `main` once the project is linked.

After a deploy, run `node scripts/smoke.ts https://<your-deployment>.vercel.app`. If it prints five
passes, a real MCP client can connect.

## Layout

`src/core.ts` holds all the logic in one function, `ingest`. The three files under `api/` call it
and contain no logic of their own, 65 lines between them. Replacing the body of
`ingest` is the whole job when the generator arrives, and its signature will not change, so the MCP
tool and the HTTP endpoint both pick up the new behaviour with no edits.

## A note on mcp-handler

Vercel's published docs still show the v1 API, with a three-argument `createMcpHandler` and a
`basePath` option. Version 2 dropped both. It also peers on `@modelcontextprotocol/server`, not
`@modelcontextprotocol/sdk`, which is an easy hour to lose. If you extend the server, read
`node_modules/mcp-handler/dist/index.d.mts` rather than the docs.
