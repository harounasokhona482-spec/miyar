import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MAX_CLARIFICATION_ROUNDS } from "../domain/schemas/pipelineResult";
import { TransactionSchema } from "../domain/schemas/transaction";
import { FACT_IDS } from "../pipeline/missingInfo";

/**
 * Server-signed clarification state (HMAC-SHA256, no database, no encryption).
 * Carries only what the next turn needs: the structured transaction, the
 * clarification progress and the pending question, plus compact retrieval
 * terms — never the knowledge base or the user's raw text. Any tampering,
 * expiry or malformed payload is rejected; the caller returns TECHNICAL_ERROR.
 */

export const STATE_TOKEN_TTL_MS = 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

const FactIdSchema = z.enum(FACT_IDS);

export const TokenPayloadSchema = z.strictObject({
  v: z.literal(1),
  issued_at: z.number().int().positive(),
  transaction: TransactionSchema,
  clarification: z.strictObject({
    rounds_used: z.number().int().min(0).max(MAX_CLARIFICATION_ROUNDS),
    attempts: z.record(z.string(), z.number().int().min(0).max(MAX_CLARIFICATION_ROUNDS)),
    unknown_by_user: z.array(FactIdSchema),
    pending: z.strictObject({
      fact_id: FactIdSchema,
      round: z.number().int().min(1).max(MAX_CLARIFICATION_ROUNDS),
      attempt: z.number().int().min(1),
      question: z.string().min(1),
      options: z.array(z.string().min(1)).min(1),
    }),
  }),
  query_terms: z.array(z.string().min(1).max(40)).max(200),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export type TokenError = "state_secret_missing" | "state_token_malformed" | "state_token_bad_signature" | "state_token_expired" | "state_token_invalid_payload";

function secretOk(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signState(payload: Omit<TokenPayload, "v" | "issued_at">, secret: string | undefined, now = Date.now()): { ok: true; token: string } | { ok: false; error: TokenError } {
  if (!secretOk(secret)) return { ok: false, error: "state_secret_missing" };
  const full: TokenPayload = { v: 1, issued_at: now, ...payload };
  const body = Buffer.from(JSON.stringify(TokenPayloadSchema.parse(full)), "utf8").toString("base64url");
  return { ok: true, token: `${body}.${sign(body, secret)}` };
}

export function verifyState(token: unknown, secret: string | undefined, now = Date.now()): { ok: true; payload: TokenPayload } | { ok: false; error: TokenError } {
  if (!secretOk(secret)) return { ok: false, error: "state_secret_missing" };
  if (typeof token !== "string" || token.length > 64_000) return { ok: false, error: "state_token_malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "state_token_malformed" };
  const [body, mac] = parts as [string, string];

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, error: "state_token_bad_signature" };

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "state_token_malformed" };
  }
  const parsed = TokenPayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "state_token_invalid_payload" };
  if (now - parsed.data.issued_at > STATE_TOKEN_TTL_MS || parsed.data.issued_at > now + 60_000) return { ok: false, error: "state_token_expired" };
  return { ok: true, payload: parsed.data };
}
