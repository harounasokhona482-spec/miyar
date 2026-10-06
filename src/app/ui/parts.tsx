"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PRODUCT_DISCLAIMER } from "../../domain/messages";
import { arNum, sourceHost, type Answer } from "./presenters";

/** Button looks from the design system: primary, secondary, text. Height ≥ 48px (text ≥ 44px). */
export const btn = {
  primary:
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-display text-[15px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-disabled disabled:text-faint",
  secondary:
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-primary bg-white px-5 py-3 font-display text-[15px] font-semibold text-primary transition-colors hover:bg-selected disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled disabled:text-faint",
  text: "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg px-2 font-display text-sm font-semibold text-primary underline decoration-1 underline-offset-4 hover:text-primary-hover disabled:cursor-not-allowed disabled:text-faint",
};

export function AppHeader({ onHowItWorks }: { onHowItWorks: () => void }) {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex w-full max-w-[72rem] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <p className="font-display text-xl font-bold leading-none">مِعيار</p>
          <p className="rounded-full border border-control px-2.5 text-[11px] font-medium leading-5 text-ink-soft">أداة ذكاء اصطناعي</p>
        </div>
        <button type="button" onClick={onHowItWorks} className={btn.text}>
          كيف يعمل مِعيار؟
        </button>
      </div>
    </header>
  );
}

export function AppFooter({ disclaimer, onHowItWorks }: { disclaimer: string; onHowItWorks: () => void }) {
  return (
    <footer className="mx-auto mt-10 w-full max-w-[72rem] border-t border-line px-4 py-5 text-center text-[12px] leading-6 text-muted sm:px-6">
      <p>{disclaimer}</p>
      <button type="button" onClick={onHowItWorks} className={`${btn.text} text-[12.5px]`}>
        كيف يعمل مِعيار؟
      </button>
    </footer>
  );
}

const STAGES = ["فهم المعاملة", "الاستيضاح", "التحقق", "النتيجة"];

/** The four-segment progress bar under the header; the stage name is announced, not drawn. */
export function StepBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div>
      <div aria-hidden className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-ink" : "bg-line"}`} />
        ))}
      </div>
      <p className="sr-only">
        المرحلة {arNum(step)} من ٤: {STAGES[step - 1]}
      </p>
    </div>
  );
}

export type StatusKind = "grounded" | "disputed" | "missing" | "referral" | "insufficient";

const BADGE_TONE: Record<StatusKind, string> = {
  grounded: "bg-grounded-tint text-grounded-text",
  disputed: "bg-disputed-tint text-disputed-text",
  missing: "bg-missing-tint text-missing-text",
  referral: "bg-referral-tint text-referral-text",
  insufficient: "bg-insufficient-tint text-insufficient-text",
};

/** Each state has its own shape (✓ · ●○ · ? · ↖ · ○), so the meaning never rests on color alone. */
function StatusIcon({ kind }: { kind: StatusKind }) {
  switch (kind) {
    case "grounded":
      return <span className="grid size-4 place-items-center rounded-full bg-grounded text-[9px] font-bold leading-none text-white">✓</span>;
    case "disputed":
      return (
        <span className="inline-flex gap-0.5">
          <span className="size-1.5 rounded-full bg-disputed" />
          <span className="size-1.5 rounded-full border-[1.5px] border-disputed" />
        </span>
      );
    case "missing":
      return <span className="grid size-4 place-items-center rounded-full border-[1.5px] border-missing text-[9px] font-bold leading-none">?</span>;
    case "referral":
      return <span className="text-[12px] font-bold leading-none">↖</span>;
    case "insufficient":
      return <span className="size-3 rounded-full border-[1.5px] border-insufficient" />;
  }
}

export function StatusBadge({ kind, label }: { kind: StatusKind; label: string }) {
  return (
    <p className={`inline-flex items-center gap-2 self-start rounded-full px-3.5 py-1 font-display text-[13.5px] font-semibold ${BADGE_TONE[kind]}`}>
      <span aria-hidden className="inline-flex">
        <StatusIcon kind={kind} />
      </span>
      {label}
    </p>
  );
}

/** Source voice: Naskh type on a copper tint, always labelled «نص المصدر». */
export function SourceQuote({ text, location }: { text: string; location: string }) {
  return (
    <figure className="rounded-lg bg-cite-tint px-3 py-2.5">
      <figcaption className="mb-0.5 font-display text-[11.5px] font-semibold text-cite">نص المصدر</figcaption>
      <blockquote className="font-quote text-[15px] leading-[1.95] text-ink">«{text}»</blockquote>
      <p className="mt-1 text-[12px] leading-6 text-muted">{location}</p>
    </figure>
  );
}

/** A citation number in Mi'yar's text; it opens and highlights its source card. */
export function Cite({ n, onActivate }: { n: number; onActivate: (n: number) => void }) {
  return (
    <a
      href={`#src-${n}`}
      onClick={(e) => {
        e.preventDefault();
        onActivate(n);
      }}
      aria-label={`المصدر ${arNum(n)}`}
      className="mx-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-[5px] bg-cite px-1.5 align-[1px] font-display text-[11.5px] font-semibold leading-none text-white no-underline hover:bg-ink"
    >
      {arNum(n)}
    </a>
  );
}

type Source = Answer["sources"][number];

export function SourceCard({ n, source, showExcerpt, defaultOpen, highlight }: { n: number; source: Source; showExcerpt: boolean; defaultOpen: boolean; highlight: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const host = sourceHost(source.url);

  useEffect(() => {
    if (!highlight) return;
    setOpen(true);
    setFlash(true);
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    ref.current?.querySelector("summary")?.focus({ preventScroll: true });
    const t = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [highlight]);

  return (
    <details
      id={`src-${n}`}
      ref={ref}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={`group scroll-mt-6 rounded-[14px] border border-line bg-white shadow-[0_1px_2px_rgba(30,40,50,.05)] ${flash ? "miyar-flash" : ""}`}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-start gap-2.5 rounded-[14px] p-3.5 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 inline-flex min-w-6 justify-center rounded-[5px] bg-cite px-1.5 font-display text-[11.5px] font-semibold leading-5 text-white">{arNum(n)}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[14px] font-semibold leading-6">{source.title}</span>
          <span className="block text-[12.5px] font-medium leading-6 text-muted">{source.section}</span>
        </span>
        <span aria-hidden className="mt-0.5 text-muted transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5">
        {showExcerpt && source.verified_excerpt && <SourceQuote text={source.verified_excerpt.text} location={source.verified_excerpt.location} />}
        <a href={source.url} target="_blank" rel="noopener noreferrer" className={`${btn.text} self-start px-0`}>
          عرض المصدر <span aria-hidden>↖</span>
          {host && (
            <span dir="ltr" className="font-body text-xs font-normal text-muted no-underline">
              {host}
            </span>
          )}
          <span className="sr-only">(يفتح في نافذة جديدة)</span>
        </a>
      </div>
    </details>
  );
}

/** A titled block of the result page. */
export function Block({ title, children, tone = "plain", aside }: { title: string; children: ReactNode; tone?: "plain" | "surface" | "dashed"; aside?: ReactNode }) {
  const frame = { plain: "", surface: "rounded-xl bg-surface p-4", dashed: "rounded-xl border-[1.5px] border-dashed border-control p-4" }[tone];
  return (
    <section className={`flex flex-col gap-2 ${frame}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[17px] font-bold leading-7">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const HOW = [
  { title: "نفهم", text: "نستخرج من وصفك عناصر المعاملة: الأطراف وطريقة الدفع والأجل والرسوم، ونحدد ما لم يُذكر." },
  { title: "نستوضح", text: "إذا نقصت معلومة قد تغيّر النتيجة، نسألك سؤالًا واحدًا في كل مرة، وثلاثة أسئلة كحد أقصى. و«لا أعرف» إجابة مقبولة." },
  { title: "نبحث", text: "نبحث في المصادر المعتمدة داخل مِعيار فقط، لا في الإنترنت." },
  { title: "نوثّق", text: "لا نعرض إجابة إلا إذا كفى الدليل، ونتحقق من أن كل نص نعرضه موجود في مصدره. وإن لم يكفِ الدليل امتنعنا عن الإجابة." },
];

export function HowItWorksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="how-title"
      className="m-auto max-h-[85dvh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-ink/40"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="how-title" className="font-display text-lg font-bold">
            كيف يعمل مِعيار؟
          </h2>
          <button type="button" onClick={onClose} className={btn.text}>
            إغلاق
          </button>
        </div>
        <ol className="flex flex-col gap-3">
          {HOW.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface font-display text-sm font-semibold">{arNum(i + 1)}</span>
              <div>
                <p className="font-display font-semibold">{s.title}</p>
                <p className="text-sm leading-7 text-ink-soft">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="rounded-xl bg-surface p-3.5 text-sm leading-7">
          <p className="font-display font-semibold">حدود الأداة</p>
          <p>{PRODUCT_DISCLAIMER}</p>
          <p>لا يحكم على عقد بعينه، ولا يرجّح بين الآراء.</p>
        </div>
      </div>
    </dialog>
  );
}
