import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { buildClarificationRequest, buildExtractionRequest } from "../pipeline/extraction";
import { OpenAIProvider, ProviderError, type ResponsesClient } from "./openaiProvider";
import type { ModelRequest } from "./provider";
import { DEFAULT_MODEL, providerFromEnv } from "./providerConfig";
import { stripOptionalNulls, toStrictJsonSchema } from "./strictSchema";

type Call = { body: Record<string, unknown>; options?: Record<string, unknown> };

/** Fake Responses client: each call consumes the next scripted outcome. */
function scriptedClient(outcomes: (() => unknown)[]) {
  const calls: Call[] = [];
  const client: ResponsesClient = {
    responses: {
      create: async (body, options) => {
        calls.push({ body, ...(options ? { options: options as Record<string, unknown> } : {}) });
        const next = outcomes[calls.length - 1];
        if (!next) throw new Error("unexpected extra call");
        return next();
      },
    },
  };
  return { client, calls };
}

const ok = (text: string) => () => ({ status: "completed", output_text: text, output: [{ type: "message", content: [{ type: "output_text" }] }] });
const throwing = (err: unknown) => () => {
  throw err;
};
const request = (): ModelRequest => buildExtractionRequest("اشتريت هاتفًا بالتقسيط");
const provider = (client: ResponsesClient) => new OpenAIProvider({ apiKey: "test-key", model: "gpt-5.6", client, timeoutMs: 1000 });

describe("request body", () => {
  it("uses the Responses API with strict structured output, low reasoning, no tools, nothing stored", async () => {
    const { client, calls } = scriptedClient([ok("{}")]);
    await provider(client).complete(request());
    const body = calls[0]!.body;
    expect(body).toMatchObject({ model: "gpt-5.6", reasoning: { effort: "low" }, store: false, text: { format: { type: "json_schema", strict: true, name: "transaction_extraction" } } });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(calls[0]!.options).toMatchObject({ timeout: 1000, maxRetries: 0 });
  });
});

describe("retry policy: exactly one retry, transient failures only", () => {
  it.each([
    ["HTTP 429", OpenAI.APIError.generate(429, {}, "rate limited", new Headers())],
    ["HTTP 500", OpenAI.APIError.generate(500, {}, "server", new Headers())],
    ["HTTP 503", OpenAI.APIError.generate(503, {}, "unavailable", new Headers())],
    ["network error", new OpenAI.APIConnectionError({ message: "socket hang up" })],
    ["timeout", new OpenAI.APIConnectionTimeoutError({ message: "timed out" })],
  ])("retries once after %s", async (_label, err) => {
    const { client, calls } = scriptedClient([throwing(err), ok('{"a":1}')]);
    expect((await provider(client).complete(request())).text).toBe('{"a":1}');
    expect(calls).toHaveLength(2);
  });

  it("gives up after the single retry also fails", async () => {
    const err = OpenAI.APIError.generate(503, {}, "unavailable", new Headers());
    const { client, calls } = scriptedClient([throwing(err), throwing(err)]);
    await expect(provider(client).complete(request())).rejects.toMatchObject({ code: "provider_server_error" });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["HTTP 400", throwing(OpenAI.APIError.generate(400, {}, "bad request", new Headers())), "provider_http_error"],
    ["HTTP 401", throwing(OpenAI.APIError.generate(401, {}, "unauthorized", new Headers())), "provider_http_error"],
    ["a refusal", () => ({ status: "completed", output_text: "", output: [{ type: "message", content: [{ type: "refusal" }] }] }), "provider_refusal"],
    ["an incomplete response", () => ({ status: "incomplete", output_text: "{", output: [] }), "provider_incomplete"],
    ["an empty response", () => ({ status: "completed", output_text: "", output: [] }), "provider_empty"],
  ])("does not retry %s", async (_label, outcome, code) => {
    const { client, calls } = scriptedClient([outcome]);
    const error = await provider(client).complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code });
    expect(calls).toHaveLength(1);
  });

  it("returns malformed JSON unchanged so the pipeline rejects it (no retry)", async () => {
    const { client, calls } = scriptedClient([ok("{not json")]);
    expect((await provider(client).complete(request())).text).toBe("{not json");
    expect(calls).toHaveLength(1);
  });
});

describe("strict schema adaptation", () => {
  const schemas = {
    extraction: buildExtractionRequest("x").output_schema,
    clarification: buildClarificationRequest("س", "ج", ["ownership_transfer", "fees.type"]).output_schema,
  };

  function walk(node: unknown, visit: (o: Record<string, unknown>) => void) {
    if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
    else if (node && typeof node === "object") {
      visit(node as Record<string, unknown>);
      Object.values(node).forEach((v) => walk(v, visit));
    }
  }

  it.each(Object.entries(schemas))("%s: every object requires all its properties and forbids extras; no unsupported keywords", (_name, schema) => {
    const strict = toStrictJsonSchema(schema);
    walk(strict, (o) => {
      if (o.type === "object") {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
      }
      for (const k of ["minLength", "maxLength", "$schema", "default"]) expect(o).not.toHaveProperty(k);
    });
    expect(JSON.stringify(strict)).not.toContain("evidence_origin");
  });

  it("maps strict-mode nulls back to absent optional fields, keeping required nulls", () => {
    const schema = schemas.extraction;
    const field = { value: null, provenance: "unknown", evidence_span: null };
    expect(stripOptionalNulls({ product_or_service: field, parties: [{ role: "app", description: field }] }, schema)).toEqual({
      product_or_service: { value: null, provenance: "unknown" },
      parties: [{ role: "app", description: { value: null, provenance: "unknown" } }],
    });
  });
});

describe("configuration from environment", () => {
  it("requires an API key", () => {
    expect(providerFromEnv({ MIYAR_LLM_PROVIDER: "openai" })).toEqual({ ok: false, code: "provider_not_configured" });
    expect(providerFromEnv({ MIYAR_LLM_PROVIDER: "openai", MIYAR_LLM_API_KEY: "   " })).toEqual({ ok: false, code: "provider_not_configured" });
  });

  it("supports only the openai provider and defaults the model to gpt-5.6", () => {
    expect(providerFromEnv({ MIYAR_LLM_PROVIDER: "other", MIYAR_LLM_API_KEY: "k" })).toEqual({ ok: false, code: "provider_unsupported" });
    const r = providerFromEnv({ MIYAR_LLM_API_KEY: "k" });
    expect(r.ok).toBe(true);
    expect(DEFAULT_MODEL).toBe("gpt-5.6");
  });
});
