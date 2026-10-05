import { afterEach, describe, expect, it } from "vitest";
import { REFERRAL_MESSAGE, TECHNICAL_ERROR_MESSAGE } from "../../../domain/messages";
import { ApiResponseSchema } from "../../../domain/schemas/apiResponse";
import { POST } from "./route";

const saved = { key: process.env.MIYAR_LLM_API_KEY, secret: process.env.MIYAR_STATE_SECRET };
afterEach(() => {
  process.env.MIYAR_LLM_API_KEY = saved.key;
  process.env.MIYAR_STATE_SECRET = saved.secret;
  if (saved.key === undefined) delete process.env.MIYAR_LLM_API_KEY;
  if (saved.secret === undefined) delete process.env.MIYAR_STATE_SECRET;
});

const post = (body: string) => POST(new Request("http://localhost/api/miyar", { method: "POST", body, headers: { "content-type": "application/json" } }));

describe("POST /api/miyar", () => {
  it("answers malformed JSON with TECHNICAL_ERROR (HTTP 200, JSON, no-store)", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(ApiResponseSchema.parse(body)).toMatchObject({ state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE });
  });

  it("refers a personal-ruling request even with no model configured", async () => {
    delete process.env.MIYAR_LLM_API_KEY;
    const body = await (await post(JSON.stringify({ message: "هل عقدي حلال أم حرام؟" }))).json();
    expect(body).toMatchObject({ state: "REFERRAL", message: REFERRAL_MESSAGE });
  });

  it("returns TECHNICAL_ERROR, not a crash, when no API key is set", async () => {
    delete process.env.MIYAR_LLM_API_KEY;
    const body = await (await post(JSON.stringify({ message: "اشتريت هاتفًا بالتقسيط، كيف توصف هذه المعاملة؟" }))).json();
    expect(body).toMatchObject({ state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE });
    expect(JSON.stringify(body)).not.toMatch(/provider_not_configured|API|key/i);
  });

  it("rejects an oversized body", async () => {
    const body = await (await post(JSON.stringify({ message: "أ".repeat(90_000) }))).json();
    expect(body.state).toBe("TECHNICAL_ERROR");
  });
});
