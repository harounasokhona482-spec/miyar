import type { ModelProvider, ModelRequest, ModelResponse } from "./provider";

type Responder = (request: ModelRequest) => string | Promise<string>;

/**
 * Deterministic provider for tests and local development. It returns whatever
 * the responder gives it and records every request.
 */
export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly calls: ModelRequest[] = [];

  constructor(private readonly respond: Responder) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request);
    return { text: await this.respond(request) };
  }

  /** Answers from a table keyed by the exact user message; unknown messages throw. */
  static fromTable(table: ReadonlyMap<string, string>, extractMessage: (r: ModelRequest) => string): FakeProvider {
    return new FakeProvider((request) => {
      const key = extractMessage(request);
      const text = table.get(key);
      if (text === undefined) throw new Error("FakeProvider: no canned response for this input");
      return text;
    });
  }
}
