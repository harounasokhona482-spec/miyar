"use client";

import { useState } from "react";
import { Block, Cite, SourceCard, SourceQuote, StatusBadge, StepBar, btn } from "./parts";
import {
  CONDITIONS_INTRO,
  SUMMARY_DISPUTED,
  arNum,
  excerptShownOnCard,
  insufficientKind,
  scopeView,
  sourceNumbers,
  sourcesCount,
  splitLimitations,
  type Grounded,
  type Settled,
} from "./presenters";

type Actions = { onNew: () => void; onEdit: () => void; onRetry: () => void; busy: boolean };

const titleClass = "font-display font-bold leading-[1.6] text-ink";

/** Screen 5: one template, a status first, then the content of that state, then the next step. */
export function ResultScreen({ r, original, ...actions }: { r: Settled; original: string } & Actions) {
  switch (r.state) {
    case "GROUNDED":
      return <GroundedResult r={r} {...actions} />;
    case "DISPUTED":
      return <DisputedResult r={r} {...actions} />;
    case "REFERRAL":
      return <ReferralResult message={r.message} original={original} {...actions} />;
    case "INSUFFICIENT_EVIDENCE":
      return <InsufficientResult message={r.message} {...actions} />;
    case "TECHNICAL_ERROR":
      return <ErrorResult message={r.message} {...actions} />;
  }
}

// ---------------------------------------------------------------------------
// GROUNDED
// ---------------------------------------------------------------------------

function GroundedResult({ r, onNew, onEdit }: { r: Grounded } & Actions) {
  const a = r.answer;
  const scope = scopeView(a);
  const numbers = sourceNumbers(a);
  const { conditions, other } = splitLimitations(a.limitations);
  // A citation click opens and highlights its card; the counter re-triggers repeated clicks.
  const [highlight, setHighlight] = useState<{ n: number; nonce: number }>({ n: 0, nonce: 0 });
  const activate = (n: number) => setHighlight((h) => ({ n, nonce: h.nonce + 1 }));

  return (
    <div className="flex flex-col gap-6">
      <StepBar step={4} />
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10">
        {/* A · B · C · D */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-col gap-2.5">
            <StatusBadge kind="grounded" label={scope.badge} />
            <p className="text-[13px] text-muted">
              مبنية على {sourcesCount(a.sources.length)} · ليست فتوى لحالتك
            </p>
            <h1 data-screen-title tabIndex={-1} className={`${titleClass} text-[1.2rem]`}>
              {scope.summary}
            </h1>
          </div>

          <Block
            title="فهمنا للمعاملة"
            tone="surface"
            aside={
              <button type="button" onClick={onEdit} className={btn.text}>
                تعديل
              </button>
            }
          >
            <p className="text-[14.5px] leading-[1.85] text-ink-soft">{a.understanding}</p>
          </Block>

          <Block title={scope.heading}>
            {scope.structural && <p className="text-[13.5px] leading-7 text-muted">وصفٌ لما تذكره المصادر عن أطراف هذا النوع من المعاملات وتسلسله، وليس حكمًا على صحتها.</p>}
            <p className="text-[12.5px] leading-6 text-muted">بصياغة مِعيار، وتحت كل جملة نص المصدر الذي تستند إليه.</p>
            <ol className="flex flex-col gap-4">
              {a.claims.map((c) => {
                const n = numbers.get(c.source_id);
                return (
                  <li key={c.claim_ref} className="flex flex-col gap-2">
                    <p className="max-w-[65ch] text-[15.5px] leading-[1.95] text-ink">
                      {c.text}
                      {n && <Cite n={n} onActivate={activate} />}
                    </p>
                    <SourceQuote text={c.quote.text} location={c.quote.location} />
                  </li>
                );
              })}
            </ol>
          </Block>
        </div>

        {/* E · sources: a sticky side column on desktop, after the content on phones */}
        <section aria-labelledby="sources-title" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start lg:border-r lg:border-line lg:pr-7">
          <h2 id="sources-title" className="font-display text-[17px] font-bold">
            المصادر ({arNum(a.sources.length)})
          </h2>
          {a.sources.map((s, i) => {
            const n = i + 1;
            return (
              <SourceCard
                key={s.source_id}
                n={n}
                source={s}
                showExcerpt={!!s.verified_excerpt && excerptShownOnCard(s.verified_excerpt.text, a)}
                defaultOpen={i === 0}
                highlight={highlight.n === n ? highlight.nonce : 0}
              />
            );
          })}
        </section>

        {/* F · G */}
        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-2">
          {conditions.length > 0 && (
            <Block title="ما الذي يعتمد عليه انطباق هذه المعلومة؟" tone="dashed">
              <p className="text-[14px] leading-7 text-ink-soft">{CONDITIONS_INTRO}</p>
              <ul className="list-disc pr-5 text-[14px] leading-7">
                {conditions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Block>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {other.length > 0 && (
              <Block title="حدود هذه الإجابة" tone="surface">
                <ul className="list-disc pr-5 text-[13.5px] leading-7 text-ink-soft">
                  {other.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </Block>
            )}
            <section className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
              <h2 className="font-display text-[17px] font-bold">الخطوة التالية</h2>
              <p className="text-[14px] leading-7 text-ink-soft">{a.next_step}</p>
              <button type="button" onClick={onNew} className={`${btn.primary} mt-auto`}>
                اسأل عن معاملة أخرى
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DISPUTED: positions side by side, with their sources, and no preference
// ---------------------------------------------------------------------------

function DisputedResult({ r, onNew }: { r: Extract<Settled, { state: "DISPUTED" }> } & Actions) {
  const numbers = new Map<string, number>();
  for (const p of r.positions) if (!numbers.has(p.source_id)) numbers.set(p.source_id, numbers.size + 1);
  return (
    <div className="flex flex-col gap-5">
      <StepBar step={4} />
      <StatusBadge kind="disputed" label="فيها أكثر من رأي معتبر" />
      <h1 data-screen-title tabIndex={-1} className={`${titleClass} text-[1.15rem]`}>
        {SUMMARY_DISPUTED}
      </h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {r.positions.map((p, i) => (
          <li key={p.position_id} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4">
            <p className="font-display text-[14px] font-semibold">الرأي {arNum(i + 1)}</p>
            <p className="text-[14px] leading-7 text-ink-soft">{p.position_summary}</p>
            <p className="text-[12px] text-muted">
              يستند إلى المصدر <span className="rounded-[5px] bg-cite px-1.5 font-display font-semibold text-white">{arNum(numbers.get(p.source_id)!)}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="text-[13px] leading-6 text-muted">ترتيب العرض لا يعني أفضلية لأي رأي. ولمعرفة الأنسب لحالتك، يُنصح بسؤال مختص.</p>
      <button type="button" onClick={onNew} className={btn.secondary}>
        اسأل عن معاملة أخرى
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// REFERRAL: a deliberate protection, with something useful to take along
// ---------------------------------------------------------------------------

function ReferralResult({ message, original, onNew }: { message: string; original: string } & Actions) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(original);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <StepBar step={4} />
      <StatusBadge kind="referral" label="تحتاج إلى مراجعة مختص" />
      <h1 data-screen-title tabIndex={-1} className={`${titleClass} text-[1.15rem]`}>
        {message}
      </h1>
      {original && (
        <div className="flex flex-col gap-2 rounded-xl bg-referral-tint p-4">
          <p className="font-display text-[14px] font-semibold text-referral-text">وصفك جاهز لتعرضه على المختص</p>
          <p className="text-[14px] leading-7 text-ink-soft">«{original}»</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void copy()} className={`${btn.text} px-0`}>
              نسخ الوصف
            </button>
            <span role="status" aria-live="polite" className="text-[12.5px] text-muted">
              {copied === "done" ? "تم نسخ الوصف." : copied === "failed" ? "تعذّر النسخ، يمكنك تحديد النص ونسخه يدويًا." : ""}
            </span>
          </div>
        </div>
      )}
      <button type="button" onClick={onNew} className={btn.secondary}>
        اسأل عن معاملة أخرى
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// INSUFFICIENT_EVIDENCE: a conscious abstention, not a failure
// ---------------------------------------------------------------------------

const INSUFFICIENT_BADGE = {
  evidence: "لا توجد مرجعية كافية",
  scope: "خارج نطاق مِعيار الحالي",
  language: "العربية فقط في هذه النسخة",
} as const;

function InsufficientResult({ message, onNew, onEdit }: { message: string } & Actions) {
  const kind = insufficientKind(message);
  return (
    <div className="flex flex-col gap-5">
      <StepBar step={4} />
      <StatusBadge kind="insufficient" label={INSUFFICIENT_BADGE[kind]} />
      <h1 data-screen-title tabIndex={-1} className={`${titleClass} text-[1.15rem]`}>
        {message}
      </h1>
      <div className="flex flex-col gap-2.5">
        <button type="button" onClick={onEdit} className={btn.primary}>
          أعد صياغة الوصف
        </button>
        <button type="button" onClick={onNew} className={btn.secondary}>
          اسأل عن معاملة أخرى
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TECHNICAL_ERROR: a system notice (diamond, neutral surface), never red
// ---------------------------------------------------------------------------

function ErrorResult({ message, onRetry, onEdit, busy }: { message: string } & Actions) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-xl bg-surface p-4">
        <span aria-hidden className="mt-2 size-4 shrink-0 rotate-45 border-[1.5px] border-ink" />
        <div className="flex flex-col gap-1">
          <h1 data-screen-title tabIndex={-1} className={`${titleClass} text-[1.1rem]`}>
            تعذّر إكمال التحقق
          </h1>
          <p className="text-[14px] leading-7 text-ink-soft">{message}</p>
          <p className="text-[13px] leading-6 text-muted">وصفك وإجاباتك محفوظة، ولن تحتاج إلى كتابتها من جديد.</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button type="button" onClick={onRetry} disabled={busy} className={btn.primary}>
          حاول مرة أخرى
        </button>
        <button type="button" onClick={onEdit} disabled={busy} className={`${btn.text} self-center`}>
          عدّل الوصف
        </button>
      </div>
    </div>
  );
}
