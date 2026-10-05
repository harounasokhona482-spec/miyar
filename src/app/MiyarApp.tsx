"use client";

import { useEffect, useRef, useState } from "react";
import { DONT_KNOW_OPTION, PRODUCT_DISCLAIMER, TECHNICAL_ERROR_MESSAGE } from "../domain/messages";
import type { ApiResponse } from "../domain/schemas/apiResponse";

/**
 * Mi'yar MVP screen. Talks only to POST /api/miyar; the state token stays in
 * memory and is never shown. Any network or server failure becomes the fixed
 * TECHNICAL_ERROR message with a retry button — never a blank screen or an
 * endless spinner.
 */

const PRIVACY_NOTE = "لا تُدخل أرقام بطاقات أو حسابات أو هويات أو بيانات شخصية حساسة.";
const MAX_LENGTH = 2000;
const CLIENT_TIMEOUT_MS = 150_000;
const STAGES = ["فهم المعاملة", "البحث في المصادر المعتمدة", "التحقق من كفاية الدليل", "إعداد النتيجة"];
const KNOWN_STATES = new Set(["GROUNDED", "DISPUTED", "NEEDS_CLARIFICATION", "REFERRAL", "INSUFFICIENT_EVIDENCE", "TECHNICAL_ERROR"]);

type Payload = { message: string; state_token?: string };

const localError = (): ApiResponse => ({ state: "TECHNICAL_ERROR", request_id: "local", message: TECHNICAL_ERROR_MESSAGE, disclaimer: PRODUCT_DISCLAIMER });

async function callApi(payload: Payload): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch("/api/miyar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return localError();
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== "object" || !KNOWN_STATES.has((data as { state?: string }).state ?? "")) return localError();
    return data as ApiResponse;
  } catch {
    return localError();
  } finally {
    clearTimeout(timer);
  }
}

function Loading() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % STAGES.length), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-stone-300 p-5">
      <p className="mb-3 font-semibold">جارٍ تحليل المعاملة…</p>
      <ul className="space-y-1 text-sm">
        {STAGES.map((s, k) => (
          <li key={s} className={k === i ? "font-semibold" : "opacity-50"}>
            <span aria-hidden className={`ml-2 inline-block h-2 w-2 rounded-full ${k === i ? "animate-pulse bg-emerald-600" : "bg-stone-400"}`} />
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({ text, tone }: { text: string; tone: "info" | "warn" | "error" }) {
  const colors = { info: "border-sky-300 bg-sky-50", warn: "border-amber-300 bg-amber-50", error: "border-red-300 bg-red-50" }[tone];
  return <p className={`rounded-xl border p-4 leading-8 text-stone-900 ${colors}`}>{text}</p>;
}

function Grounded({ r }: { r: Extract<ApiResponse, { state: "GROUNDED" }> }) {
  const a = r.answer;
  const scope =
    a.answer_scope === "structural_general_information"
      ? "معلومات عن بنية المعاملة فقط"
      : a.answer_scope === "conditional_general_information"
        ? "معلومة عامة مشروطة"
        : "معلومة عامة من المصادر المعتمدة";
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-1 text-lg font-bold">فهمنا للمعاملة</h2>
        <p className="leading-8">{a.understanding}</p>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">الخلاصة من المصادر المعتمدة</h2>
        <p className="mb-2 inline-block rounded-full bg-stone-200 px-3 py-0.5 text-xs text-stone-800">{scope}</p>
        <ul className="space-y-3">
          {a.claims.map((c) => (
            <li key={c.claim_ref} className="rounded-xl border border-stone-300 p-3">
              <p className="leading-8">{c.text}</p>
              <blockquote className="mt-2 border-r-4 border-emerald-600 pr-3 text-sm leading-7 text-stone-700">
                «{c.quote.text}»
                <footer className="mt-1 text-xs text-stone-500">{c.quote.location}</footer>
              </blockquote>
            </li>
          ))}
        </ul>
      </section>

      {a.limitations.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-bold">حدود هذه الإجابة</h2>
          <ul className="list-disc space-y-1 pr-5 text-sm leading-7">
            {a.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-bold">المصادر</h2>
        <ul className="space-y-3 text-sm">
          {a.sources.map((s) => (
            <li key={s.source_id} className="rounded-xl border border-stone-300 p-3">
              <p className="font-semibold">{s.title}</p>
              <p>{s.section}</p>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-emerald-700 underline">
                {s.url}
              </a>
              {s.verified_excerpt && (
                <blockquote className="mt-2 border-r-4 border-stone-400 pr-3 leading-7 text-stone-700">
                  «{s.verified_excerpt.text}»<footer className="mt-1 text-xs text-stone-500">{s.verified_excerpt.location}</footer>
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">الخطوة التالية</h2>
        <p className="leading-8">{a.next_step}</p>
      </section>
    </div>
  );
}

export default function MiyarApp() {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const lastPayload = useRef<Payload | null>(null);
  const inFlight = useRef(false);

  async function send(payload: Payload) {
    if (inFlight.current) return; // no double submit
    inFlight.current = true;
    setBusy(true);
    lastPayload.current = payload;
    try {
      const r = await callApi(payload);
      setResult(r);
      setReply("");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function reset() {
    if (inFlight.current) return;
    setQuestion("");
    setReply("");
    setResult(null);
    lastPayload.current = null;
  }

  const clarifying = result?.state === "NEEDS_CLARIFICATION" ? result : null;
  const answer = (text: string) => clarifying && text.trim() && send({ message: text.trim(), state_token: clarifying.state_token });

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">مِعيار</h1>
        <p className="text-sm leading-7 opacity-80">{PRODUCT_DISCLAIMER}</p>
      </header>

      {!result && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) void send({ message: question.trim() });
          }}
        >
          <label htmlFor="q" className="block font-semibold">
            صف المعاملة المالية بلغتك
          </label>
          <textarea
            id="q"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, MAX_LENGTH))}
            rows={6}
            disabled={busy}
            placeholder="مثال: اشتريت هاتفًا بالتقسيط على 10 أشهر بسعر أعلى من سعره نقدًا، والسعر متفق عليه من البداية. كيف تُفهم هذه المعاملة؟"
            className="w-full rounded-xl border border-stone-300 bg-white p-3 leading-8 text-stone-900"
          />
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>{PRIVACY_NOTE}</span>
            <span dir="ltr">
              {question.length}/{MAX_LENGTH}
            </span>
          </div>
          <button type="submit" disabled={busy || !question.trim()} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-50 sm:w-auto">
            حلّل المعاملة
          </button>
        </form>
      )}

      {busy && <Loading />}

      {!busy && clarifying && (
        <section className="space-y-4">
          {clarifying.understanding.length > 0 && (
            <div className="rounded-xl border border-stone-300 p-4">
              <h2 className="mb-2 font-bold">فهمنا من سؤالك</h2>
              <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
                {clarifying.understanding.map((u) => (
                  <div key={u.label} className="contents">
                    <dt className="font-semibold">{u.label}</dt>
                    <dd>{u.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="space-y-3 rounded-xl border border-emerald-300 p-4">
            <p className="text-xs opacity-70">
              سؤال {clarifying.clarification.round} من {clarifying.clarification.max_rounds}
            </p>
            <p className="font-semibold leading-8">{clarifying.clarification.question}</p>
            <div className="flex flex-wrap gap-2">
              {clarifying.clarification.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={busy}
                  onClick={() => void answer(o)}
                  className={`rounded-xl border px-4 py-2 ${o === DONT_KNOW_OPTION ? "border-stone-400" : "border-emerald-600"} disabled:opacity-50`}
                >
                  {o}
                </button>
              ))}
            </div>
            {clarifying.clarification.allow_free_text && (
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void answer(reply);
                }}
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value.slice(0, MAX_LENGTH))}
                  disabled={busy}
                  placeholder="أو اكتب إجابتك"
                  className="flex-1 rounded-xl border border-stone-300 bg-white p-2 text-stone-900"
                />
                <button type="submit" disabled={busy || !reply.trim()} className="rounded-xl bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">
                  إرسال
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {!busy && result && result.state === "GROUNDED" && <Grounded r={result} />}

      {!busy && result && result.state === "DISPUTED" && (
        <section className="space-y-3">
          <Notice text={result.message} tone="info" />
          <ul className="space-y-2">
            {result.positions.map((p) => (
              <li key={p.position_id} className="rounded-xl border border-stone-300 p-3 text-sm leading-7">
                {p.position_summary}
                <span className="mr-2 text-xs opacity-60">({p.source_id})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!busy && result && result.state === "REFERRAL" && <Notice text={result.message} tone="info" />}
      {!busy && result && result.state === "INSUFFICIENT_EVIDENCE" && <Notice text={result.message} tone="warn" />}
      {!busy && result && result.state === "TECHNICAL_ERROR" && (
        <div className="space-y-3">
          <Notice text={result.message} tone="error" />
          <button
            type="button"
            onClick={() => lastPayload.current && void send(lastPayload.current)}
            disabled={busy || !lastPayload.current}
            className="rounded-xl border border-stone-400 px-4 py-2 disabled:opacity-50"
          >
            حاول مرة أخرى
          </button>
        </div>
      )}

      {result && (
        <button type="button" onClick={reset} disabled={busy} className="rounded-xl border border-stone-400 px-4 py-2 disabled:opacity-50">
          سؤال جديد
        </button>
      )}

      <footer className="border-t border-stone-300 pt-3 text-xs leading-6 opacity-70">
        {PRODUCT_DISCLAIMER} {PRIVACY_NOTE}
      </footer>
    </main>
  );
}
