import { OpenAIProvider } from "./openaiProvider";
import type { ModelProvider } from "./provider";

/**
 * Builds the model provider from server-side environment variables:
 * MIYAR_LLM_PROVIDER (only "openai"), MIYAR_LLM_MODEL (default gpt-5.6),
 * MIYAR_LLM_API_KEY. Never reads or exposes the key anywhere else.
 */

export const DEFAULT_MODEL = "gpt-5.6";

export type ProviderConfigResult = { ok: true; provider: ModelProvider } | { ok: false; code: "provider_not_configured" | "provider_unsupported" };

export function providerFromEnv(env: Record<string, string | undefined> = process.env): ProviderConfigResult {
  const kind = (env.MIYAR_LLM_PROVIDER ?? "openai").trim().toLowerCase();
  if (kind !== "openai") return { ok: false, code: "provider_unsupported" };
  const apiKey = env.MIYAR_LLM_API_KEY?.trim();
  if (!apiKey) return { ok: false, code: "provider_not_configured" };
  const model = env.MIYAR_LLM_MODEL?.trim() || DEFAULT_MODEL;
  return { ok: true, provider: new OpenAIProvider({ apiKey, model }) };
}
