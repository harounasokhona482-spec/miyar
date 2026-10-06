"use client";

import { useRef, useState, type FormEvent } from "react";
import { DONT_KNOW_OPTION } from "../../domain/messages";
import { StepBar, btn } from "./parts";
import { arNum, preview, type Clarifying } from "./presenters";

export const MAX_LENGTH = 2000;
export const MIN_LENGTH = 15;
const PRIVACY_NOTE = "لا تُدخل أرقام بطاقات أو حسابات أو هويات أو بيانات شخصية حساسة.";

/** Starting points that fill the box with an editable template (never sent as is). */
const EXAMPLES = [
  { label: "اشترِ الآن وادفع لاحقًا", text: "اشتريت [السلعة] عبر تطبيق دفع ثمنها للمتجر، وسأسدد للتطبيق على [عدد] دفعات." },
  { label: "تمويل سيارة من البنك", text: "طلبت من البنك تمويل سيارة، والبنك سيشتريها من المعرض ثم يبيعها لي بثمن معلوم على أقساط." },
  { label: "شراء بالتقسيط", text: "اشتريت [السلعة] بالتقسيط على [عدد] أشهر بسعر أعلى من سعرها نقدًا، والسعر متفق عليه من البداية." },
  { label: "شرط التأخر في السداد", text: "في عقد التقسيط شرط ينص على أنه إذا تأخرت عن قسط واحد [اكتب ما يحدث عند التأخر]." },
];

const titleClass = "font-display font-bold leading-[1.45] text-ink";

// ---------------------------------------------------------------------------
// 1 · Ask
// ---------------------------------------------------------------------------

export function AskScreen({ value, onChange, onSubmit, busy }: { value: string; onChange: (v: string) => void; onSubmit: (text: string) => void; busy: boolean }) {
  const [hint, setHint] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (text.length < MIN_LENGTH) {
      setHint(true);
      box.current?.focus();
      return;
    }
    setHint(false);
    onSubmit(text);
  }

  function pickExample(text: string) {
    onChange(text);
    setHint(false);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      const at = text.indexOf("[");
      if (at >= 0) el.setSelectionRange(at, text.indexOf("]", at) + 1);
    });
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="ask-title">
      <div className="flex flex-col gap-2">
        <p className="font-display text-[13.5px] font-semibold text-primary">مساعد معرفي لفهم المعاملات المالية المعاصرة</p>
        <h1 id="ask-title" data-screen-title tabIndex={-1} className={`${titleClass} text-[1.6rem]`}>
          صِف معاملتك كما تفهمها
        </h1>
        <p className="text-[15px] leading-[1.8] text-ink-soft">لا تحتاج إلى معرفة المصطلحات. اكتب ما حدث بكلماتك: من دفع، ولمن، وكيف ستسدد.</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="rounded-2xl border-[1.5px] border-control bg-white transition-shadow focus-within:border-primary focus-within:shadow-[0_0_0_4px_var(--color-focus)]">
          <label htmlFor="q" className="sr-only">
            وصف المعاملة
          </label>
          <textarea
            id="q"
            ref={box}
            value={value}
            onChange={(e) => {
              onChange(e.target.value.slice(0, MAX_LENGTH));
              if (hint) setHint(false);
            }}
            rows={6}
            maxLength={MAX_LENGTH}
            disabled={busy}
            aria-describedby="q-privacy q-count"
            placeholder="مثال: اشتريت جوالًا عبر تطبيق دفع قيمته للمتجر، وسأسدد للتطبيق على أربع دفعات…"
            className="block w-full resize-y rounded-2xl bg-transparent px-4 pt-3.5 pb-1 text-base leading-8 text-ink outline-none placeholder:text-faint focus-visible:outline-none"
          />
          <div className="flex items-end justify-between gap-3 px-4 pb-3 text-[12px] leading-5 text-muted">
            <span id="q-privacy">{PRIVACY_NOTE}</span>
            <span id="q-count" dir="ltr" className="shrink-0 font-mono">
              {value.length} / {MAX_LENGTH}
            </span>
          </div>
        </div>

        <div aria-live="polite">
          {hint && (
            <p className="rounded-xl border-[1.5px] border-dashed border-control p-3.5 text-[14px] leading-7 text-ink-soft">
              اكتب جملة أو اثنتين على الأقل: ماذا اشتريت أو اقترضت، ومن دفع، وكيف تسدد.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p id="examples-title" className="text-[12.5px] font-medium text-muted">
            أو ابدأ من مثال وعدّله:
          </p>
          <ul aria-labelledby="examples-title" className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <li key={ex.label}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pickExample(ex.text)}
                  className="min-h-11 rounded-full border border-control bg-white px-4 text-[13.5px] text-ink transition-colors hover:border-primary hover:bg-selected disabled:cursor-not-allowed disabled:text-faint"
                >
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2.5 pt-1">
          <button type="submit" disabled={busy} className={btn.primary}>
            ابدأ الفهم
          </button>
          <p className="flex justify-center gap-1.5 text-[12px] font-medium text-muted">
            <span>نفهم</span>
            <span aria-hidden>·</span>
            <span>نستوضح</span>
            <span aria-hidden>·</span>
            <span>نبحث</span>
            <span aria-hidden>·</span>
            <span>نوثّق</span>
          </p>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2 · Understanding (before the first clarification question)
// ---------------------------------------------------------------------------

export function UnderstandingScreen({ r, original, onConfirm, onEdit }: { r: Clarifying; original: string; onConfirm: () => void; onEdit: () => void }) {
  const inferred = r.inferred ?? [];
  const unclear = r.unclear ?? [];
  const empty = inferred.length === 0 && r.understanding.length === 0;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="understand-title">
      <StepBar step={1} />
      <h1 id="understand-title" data-screen-title tabIndex={-1} className={`${titleClass} text-[1.35rem]`}>
        هذا ما فهمناه من وصفك
      </h1>

      {original && preview(original, 70) === original.trim() && <p className="rounded-xl bg-surface px-4 py-2.5 text-[13.5px] leading-7 text-ink-soft">«{original.trim()}»</p>}
      {original && preview(original, 70) !== original.trim() && (
        <details className="rounded-xl bg-surface px-4 py-2.5 text-[13.5px] leading-7 text-ink-soft">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 [&::-webkit-details-marker]:hidden">
            <span>«{preview(original, 70)}»</span>
            <span className="font-display text-[12.5px] font-semibold text-primary underline underline-offset-4">وصفك كاملًا</span>
          </summary>
          <p className="pb-1">«{original}»</p>
        </details>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(30,40,50,.05)]">
        {inferred.map((f) => (
          <div key={f.label} className="border-b border-line px-4 py-3">
            <p className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-muted">
              {f.label}
              <span className="rounded-full border border-dashed border-control px-2 text-[11px] leading-5 text-ink-soft">استنتاج من مِعيار</span>
            </p>
            <p className="font-display text-[15px] font-semibold leading-7">{f.value}</p>
          </div>
        ))}
        {r.understanding.length > 0 && (
          <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] text-[14px] leading-6">
            {r.understanding.map((u, i) => (
              <div key={u.label} className="contents">
                <dt className={`px-4 py-2.5 text-muted ${i > 0 ? "border-t border-line" : ""}`}>{u.label}</dt>
                <dd className={`px-4 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>{u.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {empty && <p className="px-4 py-3 text-[14px] text-ink-soft">لم نستخرج من وصفك تفاصيل كافية بعد، وسنسألك عمّا نحتاجه.</p>}
      </div>
      {inferred.length > 0 && r.understanding.length > 0 && (
        <p className="-mt-2 text-[12.5px] leading-6 text-muted">ما عُلّم «استنتاج من مِعيار» تحليل منّا، والباقي مما ذكرته أنت في وصفك.</p>
      )}

      {unclear.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border-[1.5px] border-dashed border-control px-4 py-3">
          <p className="flex items-center gap-2 font-display text-[13.5px] font-semibold">
            <span aria-hidden className="grid size-[18px] place-items-center rounded-full border-[1.5px] border-ink text-[11px] font-bold leading-none">
              ?
            </span>
            لم يتضح لنا بعد
          </p>
          <ul className="list-disc pr-5 text-[13.5px] leading-7 text-ink-soft">
            {unclear.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2.5 pt-1">
        <button type="button" onClick={onConfirm} className={btn.primary}>
          نعم، هذا صحيح
        </button>
        <button type="button" onClick={onEdit} className={btn.secondary}>
          تعديل الوصف
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3 · Clarification: one question per screen
// ---------------------------------------------------------------------------

export function ClarifyScreen({ r, busy, onAnswer, onBack }: { r: Clarifying; busy: boolean; onAnswer: (text: string) => void; onBack?: () => void }) {
  const c = r.clarification;
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const answer = text.trim() || choice;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (answer && !busy) onAnswer(answer);
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="clarify-title">
      <StepBar step={2} />
      <p className="text-[12.5px] font-medium text-muted">
        سؤال {arNum(c.round)} · نسأل فقط عمّا قد يغيّر النتيجة، و{arNum(c.max_rounds)} أسئلة كحد أقصى
      </p>
      <h1 id="clarify-title" data-screen-title tabIndex={-1} className={`${titleClass} text-[1.25rem] leading-[1.7]`}>
        {c.question}
      </h1>

      {c.why && (
        <details className="group -mt-2 text-[13.5px] leading-7 text-ink-soft">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-display font-semibold text-primary [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="transition-transform group-open:rotate-180">
              ⌄
            </span>
            <span className="underline underline-offset-4">لماذا نسأل؟</span>
          </summary>
          <div className="rounded-xl bg-surface px-4 py-3">
            <p>{c.why}</p>
            <p>وما تفيده المصادر قد يختلف بحسب هذه المعلومة، لذلك نسألك عنها.</p>
          </div>
        </details>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2.5" disabled={busy}>
          <legend className="sr-only">{c.question}</legend>
          {c.options.map((o) => (
            <label
              key={o}
              className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-control bg-white px-4 py-3 transition-colors hover:border-primary has-[:checked]:border-primary has-[:checked]:bg-selected has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
            >
              <input
                type="radio"
                name="choice"
                value={o}
                checked={choice === o && !text.trim()}
                onChange={() => {
                  setChoice(o);
                  setText("");
                }}
                className="peer sr-only"
              />
              <span aria-hidden className="size-5 shrink-0 rounded-full border-[1.5px] border-control bg-white transition-all peer-checked:border-[6px] peer-checked:border-primary" />
              <span className={`text-[15px] font-medium leading-7 ${o === DONT_KNOW_OPTION ? "text-ink-soft" : "text-ink"}`}>{o}</span>
            </label>
          ))}
        </fieldset>

        {c.allow_free_text && (
          <div>
            <label htmlFor="free" className="sr-only">
              أو اكتب إجابتك بكلماتك
            </label>
            <input
              id="free"
              value={text}
              disabled={busy}
              maxLength={MAX_LENGTH}
              onChange={(e) => {
                setText(e.target.value.slice(0, MAX_LENGTH));
                if (e.target.value.trim()) setChoice(null);
              }}
              placeholder="أو اكتب بكلماتك…"
              className="w-full border-b-[1.5px] border-control bg-transparent py-3 text-base text-ink outline-none placeholder:text-faint focus:border-primary"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5 pt-1">
          <button type="submit" disabled={!answer || busy} className={btn.primary}>
            متابعة
          </button>
          {onBack && (
            <button type="button" onClick={onBack} disabled={busy} className={`${btn.text} self-center`}>
              <span aria-hidden>→</span> رجوع إلى ملخص المعاملة
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4 · Verification: the steps the request goes through
// ---------------------------------------------------------------------------

const VERIFY_STEPS = ["فهم المعاملة", "البحث في المصادر المعتمدة", "التحقق من كفاية الدليل", "إعداد الإجابة الموثقة"];

/** `done` steps are complete, the next one is current. While the request is in flight only the first step is current. */
export function VerifyScreen({ done, slow, settling, onCancel }: { done: number; slow: boolean; settling: boolean; onCancel: () => void }) {
  const current = done < VERIFY_STEPS.length ? done : -1;
  return (
    <section className="flex flex-col gap-6" aria-labelledby="verify-title">
      <StepBar step={3} />
      <div className="flex flex-col gap-1.5">
        <h1 id="verify-title" data-screen-title tabIndex={-1} className={`${titleClass} text-[1.35rem]`}>
          نتحقق قبل أن نجيب
        </h1>
        <p className="text-[14.5px] leading-7 text-ink-soft">لن نكتب إجابة إلا إذا وجدنا في المصادر ما يكفي لدعمها.</p>
      </div>

      <ol aria-label="مراحل التحقق" className="flex flex-col">
        {VERIFY_STEPS.map((s, i) => {
          const state = i < done ? "done" : i === current ? "current" : "pending";
          return (
            <li key={s} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                {state === "done" && <span className="grid size-6 place-items-center rounded-full bg-primary text-[12px] font-bold leading-none text-white">✓</span>}
                {state === "current" && (
                  <span className="grid size-6 place-items-center rounded-full border-2 border-primary">
                    <span className="miyar-pulse size-2.5 rounded-full bg-primary" />
                  </span>
                )}
                {state === "pending" && <span className="size-6 rounded-full border-2 border-line" />}
                {i < VERIFY_STEPS.length - 1 && <span className={`min-h-6 w-0.5 flex-1 ${i < done ? "bg-primary" : "bg-line"}`} />}
              </div>
              <div className="pb-5">
                <p className={`font-display text-[15px] font-semibold leading-6 ${state === "pending" ? "text-faint" : "text-ink"}`}>{s}</p>
                <p className="sr-only">{state === "done" ? "مكتملة" : state === "current" ? "جارية الآن" : "لم تبدأ بعد"}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p role="status" aria-live="polite" className="-mt-3 text-[13px] leading-6 text-muted">
        {settling ? "اكتمل التحقق." : slow ? "ما زلنا نتحقق… قد يستغرق ذلك وقتًا أطول قليلًا." : "قد يستغرق ذلك بضع ثوانٍ."}
      </p>

      <button type="button" onClick={onCancel} disabled={settling} className={`${btn.text} self-center`}>
        إلغاء
      </button>
    </section>
  );
}
