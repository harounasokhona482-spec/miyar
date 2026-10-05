import { NextResponse } from "next/server";
import { providerFromEnv } from "../../../ai/providerConfig";
import { handleMiyarRequest } from "../../../pipeline/orchestrator";

/**
 * POST /api/miyar — the only entry point. First turn: { message }.
 * Clarification turn: { message, state_token }. Always answers with one of
 * the approved response states; malformed requests become TECHNICAL_ERROR.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Worst case: extraction and generation, each with one provider retry. */
export const maxDuration = 120;

const MAX_BODY_BYTES = 80_000;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown = null;
  try {
    const raw = await request.text();
    body = raw.length > MAX_BODY_BYTES ? null : JSON.parse(raw);
  } catch {
    body = null; // rejected as invalid_request by the orchestrator
  }
  const { response } = await handleMiyarRequest(body, {
    provider: () => providerFromEnv(process.env),
    stateSecret: process.env.MIYAR_STATE_SECRET,
  });
  return NextResponse.json(response, { status: 200, headers: { "Cache-Control": "no-store" } });
}
