/**
 * The one place the JSON payload is interpreted. Both the MCP tool and the REST
 * endpoint call `ingest`; neither contains logic of its own.
 *
 * Today `ingest` only acknowledges the payload. The matplotlib code generator
 * replaces the body of `ingest` and keeps the same signature.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PayloadShape =
  | { kind: "object"; keys: string[] }
  | { kind: "array"; length: number }
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "null" };

export type IngestOk = {
  ok: true;
  message: "json successfully passed";
  shape: PayloadShape;
  bytes: number;
  receivedAt: string;
};

export type IngestError = {
  ok: false;
  message: string;
};

export type IngestResult = IngestOk | IngestError;

export const ACK_MESSAGE = "json successfully passed" as const;

/**
 * Clients disagree on whether a JSON argument arrives parsed or as a string.
 * Accept both so a model that stringifies its arguments is not an error case.
 */
export function coerceJson(input: unknown): IngestError | { ok: true; value: JsonValue } {
  if (typeof input === "string") {
    try {
      return { ok: true, value: JSON.parse(input) as JsonValue };
    } catch {
      return { ok: false, message: "payload is a string but not valid JSON" };
    }
  }
  if (input === undefined) {
    return { ok: false, message: "payload is required" };
  }
  return { ok: true, value: input as JsonValue };
}

function describe(value: JsonValue): PayloadShape {
  if (value === null) return { kind: "null" };
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  switch (typeof value) {
    case "object":
      return { kind: "object", keys: Object.keys(value) };
    case "string":
      return { kind: "string" };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
  }
}

export function ingest(input: unknown, now: Date = new Date()): IngestResult {
  const coerced = coerceJson(input);
  if (!coerced.ok) return coerced;

  let bytes: number;
  try {
    bytes = JSON.stringify(coerced.value)?.length ?? 0;
  } catch {
    return { ok: false, message: "payload is not JSON-serializable" };
  }

  return {
    ok: true,
    message: ACK_MESSAGE,
    shape: describe(coerced.value),
    bytes,
    receivedAt: now.toISOString(),
  };
}
