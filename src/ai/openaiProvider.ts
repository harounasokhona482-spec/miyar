import OpenAI from "openai";
import type { ModelProvider, ModelRequest, ModelResponse } from "./provider";
import { stripOptionalNulls, toStrictJsonSchema } from "./strictSchema";

/**
 * OpenAI Responses API provider. Structured Outputs (strict JSON Schema),
 * low reasoning effort, no tools of any kind, nothing stored server-side.
 *
 * Reliability: one attempt timeout; exactly one retry, and only for transient
 * failures (network error, timeout, HTTP 429, HTTP 5xx). Refusals, schema or
 * application validation failures are never retried. Errors carry an internal
 * code only; callers turn them into TECHNICAL_ERROR.
 */

export class ProviderError extends Error {
  constructor(
    readonly code: "provider_timeout" | "provider_network" | "provider_rate_limited" | "provider_server_error" | "provider_http_error" | "provider_refusal" | "provider_incomplete" | "provider_empty",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "ProviderError";
  }
}

/** The slice of the OpenAI client this provider uses (injectable for tests). */
export type ResponsesClient = {
  responses: { create(body: Record<string, unknown>, options?: { timeout?: number; maxRetries?: number; signal?: AbortSignal }): Promise<unknown> };
};

type ResponseShape = {
  status?: string;
  output_text?: string;
  output?: { type?: string; content?: { type?: string }[] }[];
};

export type OpenAIProviderOptions = {
  apiKey: string;
  model: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  client?: ResponsesClient;
};

/** Per attempt; the pipeline's outer stage timeouts (45 s) leave room for the one retry. */
export const OPENAI_ATTEMPT_TIMEOUT_MS = 20_000;

function classify(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError("provider_timeout", true);
  if (err instanceof OpenAI.APIUserAbortError) return new ProviderError("provider_timeout", true);
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError("provider_network", true);
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0;
    if (status === 429) return new ProviderError("provider_rate_limited", true);
    if (status >= 500) return new ProviderError("provider_server_error", true);
    return new ProviderError("provider_http_error", false);
  }
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") return new ProviderError("provider_timeout", true);
  return new ProviderError("provider_network", true);
}

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private readonly client: ResponsesClient;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.client = options.client ?? (new OpenAI({ apiKey: options.apiKey, maxRetries: 0 }) as unknown as ResponsesClient);
    this.timeoutMs = options.timeoutMs ?? OPENAI_ATTEMPT_TIMEOUT_MS;
  }

  private body(request: ModelRequest): Record<string, unknown> {
    return {
      model: this.options.model,
      instructions: request.system,
      input: request.input,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: request.task, schema: toStrictJsonSchema(request.output_schema), strict: true } },
      store: false,
    };
  }

  private async attempt(request: ModelRequest, signal?: AbortSignal): Promise<string> {
    let response: ResponseShape;
    try {
      response = (await this.client.responses.create(this.body(request), { timeout: this.timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) })) as ResponseShape;
    } catch (err) {
      throw classify(err);
    }
    const refused = response.output?.some((item) => item.content?.some((c) => c.type === "refusal"));
    if (refused) throw new ProviderError("provider_refusal", false);
    if (response.status && response.status !== "completed") throw new ProviderError("provider_incomplete", false);
    const text = response.output_text ?? "";
    if (!text.trim()) throw new ProviderError("provider_empty", false);
    return text;
  }

  async complete(request: ModelRequest, options: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    let text: string;
    try {
      text = await this.attempt(request, options.signal);
    } catch (err) {
      const e = classify(err);
      if (!e.retryable || options.signal?.aborted) throw e;
      text = await this.attempt(request, options.signal); // the one retry; its failure propagates
    }
    // Map strict-mode nulls back to absent optional fields; malformed JSON is left for the caller to reject.
    try {
      return { text: JSON.stringify(stripOptionalNulls(JSON.parse(text), request.output_schema)) };
    } catch {
      return { text };
    }
  }
}
