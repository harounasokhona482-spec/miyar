import { PRODUCT_DISCLAIMER, TECHNICAL_ERROR_MESSAGE } from "../../domain/messages";
import type { ApiResponse } from "../../domain/schemas/apiResponse";

/**
 * The only way the screens talk to the server: POST /api/miyar. Any network or
 * server failure, non-JSON body, unknown state or timeout becomes the fixed
 * TECHNICAL_ERROR response — never a thrown error, a blank screen or an
 * endless wait. A user cancellation is reported as such, not as an error.
 */

export type Payload = { message: string; state_token?: string };
export type CallOutcome = { kind: "response"; response: ApiResponse } | { kind: "cancelled" };

export const CLIENT_TIMEOUT_MS = 150_000;
const KNOWN_STATES = new Set(["GROUNDED", "DISPUTED", "NEEDS_CLARIFICATION", "REFERRAL", "INSUFFICIENT_EVIDENCE", "TECHNICAL_ERROR"]);

export const localTechnicalError = (): ApiResponse => ({
  state: "TECHNICAL_ERROR",
  request_id: "local",
  message: TECHNICAL_ERROR_MESSAGE,
  disclaimer: PRODUCT_DISCLAIMER,
});

export async function callApi(payload: Payload, cancel: AbortSignal): Promise<CallOutcome> {
  const controller = new AbortController();
  const onCancel = () => controller.abort();
  cancel.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch("/api/miyar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return { kind: "response", response: localTechnicalError() };
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== "object" || !KNOWN_STATES.has((data as { state?: string }).state ?? "")) {
      return { kind: "response", response: localTechnicalError() };
    }
    return { kind: "response", response: data as ApiResponse };
  } catch {
    return cancel.aborted ? { kind: "cancelled" } : { kind: "response", response: localTechnicalError() };
  } finally {
    clearTimeout(timer);
    cancel.removeEventListener("abort", onCancel);
  }
}
