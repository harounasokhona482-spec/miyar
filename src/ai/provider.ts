/**
 * Model provider adapter. Pipeline stages talk only to this interface, so
 * the concrete provider (and its model and key, taken from server-side
 * environment variables) can change without touching pipeline logic.
 *
 * Only FakeProvider exists today. No real API is wired.
 */

export type ModelTask = "transaction_extraction" | "clarification_extraction" | "grounded_generation";

export type ModelRequest = {
  task: ModelTask;
  /** Instructions. Never contains user text. */
  system: string;
  /** User-supplied content, already wrapped as data. */
  input: string;
  /** JSON Schema the output must follow, for providers with structured output. */
  output_schema: Record<string, unknown>;
};

export type ModelResponse = {
  /** Raw model output; callers parse and validate it. */
  text: string;
};

export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelResponse>;
}
