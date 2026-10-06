"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCT_DISCLAIMER } from "../domain/messages";
import { callApi, localTechnicalError, type Payload } from "./ui/api";
import { AppFooter, AppHeader, HowItWorksDialog } from "./ui/parts";
import type { Clarifying, Settled } from "./ui/presenters";
import { ResultScreen } from "./ui/result";
import { AskScreen, ClarifyScreen, UnderstandingScreen, VerifyScreen } from "./ui/screens";

/**
 * Mi'yar: one page whose screens follow each other (describe → understanding →
 * clarification → verification → result). Talks only to POST /api/miyar. The
 * state token lives in memory only and is never shown. Every failure ends on
 * the fixed TECHNICAL_ERROR screen with a retry, never on a blank screen or an
 * endless wait.
 */

type View =
  | { kind: "ask" }
  | { kind: "verify" }
  | { kind: "understand"; r: Clarifying }
  | { kind: "clarify"; r: Clarifying }
  | { kind: "result"; r: Settled };

const HASH: Record<View["kind"], string> = { ask: "", verify: "", understand: "#understand", clarify: "#clarify", result: "#result" };
const SLOW_AFTER_MS = 15_000;
const STEP_MS = 170;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export default function MiyarApp() {
  const [view, setView] = useState<View>({ kind: "ask" });
  const [question, setQuestion] = useState(""); // kept for edits, retries and the referral summary
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [slow, setSlow] = useState(false);
  const [settling, setSettling] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const inFlight = useRef(false);
  const cancel = useRef<AbortController | null>(null);
  const cancelledByUser = useRef(false);
  const lastRequest = useRef<{ payload: Payload; from: View } | null>(null);
  const snapshots = useRef(new Map<number, View>());
  const seq = useRef(0);
  const firstRender = useRef(true);

  // Every screen except verification gets a history entry, so the browser's back button steps back one screen.
  const go = useCallback((v: View) => {
    setView(v);
    if (v.kind === "verify") return;
    const id = ++seq.current;
    snapshots.current.set(id, v);
    window.history.pushState({ miyar: id }, "", window.location.pathname + window.location.search + HASH[v.kind]);
  }, []);

  useEffect(() => {
    snapshots.current.set(0, { kind: "ask" });
    window.history.replaceState({ miyar: 0 }, "", window.location.pathname + window.location.search);
    const onPop = (e: PopStateEvent) => {
      cancel.current?.abort(); // leaving verification by "back" cancels the request
      const id = (e.state as { miyar?: number } | null)?.miyar;
      setView((id !== undefined && snapshots.current.get(id)) || { kind: "ask" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Each new screen starts at the top, with focus on its heading (announced by screen readers).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>("[data-screen-title]")?.focus({ preventScroll: true });
  }, [view]);

  /** After the response arrived: mark the stages it went through, briefly (instantly with reduced motion). */
  async function complete(stages: number) {
    if (reducedMotion()) {
      setDone(stages);
      await sleep(250);
      return;
    }
    for (let i = 1; i <= stages; i++) {
      setDone(i);
      await sleep(STEP_MS);
    }
    await sleep(200);
  }

  async function send(payload: Payload, from: View) {
    if (inFlight.current) return; // no double submit
    inFlight.current = true;
    const ac = new AbortController();
    cancel.current = ac;
    cancelledByUser.current = false;
    lastRequest.current = { payload, from };
    setBusy(true);
    setDone(0);
    setSlow(false);
    setSettling(false);
    go({ kind: "verify" });
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    try {
      const out = await callApi(payload, ac.signal);
      if (out.kind === "cancelled") {
        if (cancelledByUser.current) setView(from); // "back" already chose its own screen
        return;
      }
      const r = out.response;
      setSettling(true);
      if (r.state === "NEEDS_CLARIFICATION") {
        await complete(3); // understood, searched, found that one fact is missing
        if (ac.signal.aborted) return;
        go(r.clarification.round === 1 ? { kind: "understand", r } : { kind: "clarify", r });
      } else {
        if (r.state === "GROUNDED" || r.state === "DISPUTED") await complete(4);
        if (ac.signal.aborted) return;
        go({ kind: "result", r });
      }
    } catch {
      go({ kind: "result", r: localTechnicalError() as Settled });
    } finally {
      clearTimeout(slowTimer);
      cancel.current = null;
      inFlight.current = false;
      setBusy(false);
      setSettling(false);
    }
  }

  function reset() {
    if (inFlight.current) return;
    setQuestion("");
    go({ kind: "ask" });
  }

  const wide = view.kind === "result" && view.r.state === "GROUNDED";
  const openHow = () => setHowOpen(true);

  return (
    <>
      <AppHeader onHowItWorks={openHow} />
      <main className={`mx-auto w-full px-4 pt-6 pb-2 sm:px-6 sm:pt-10 ${wide ? "max-w-[72rem]" : "max-w-[40rem]"}`}>
        {view.kind === "ask" && <AskScreen value={question} onChange={setQuestion} busy={busy} onSubmit={(text) => void send({ message: text }, view)} />}
        {view.kind === "verify" && (
          <VerifyScreen
            done={done}
            slow={slow}
            settling={settling}
            onCancel={() => {
              cancelledByUser.current = true;
              cancel.current?.abort();
            }}
          />
        )}
        {view.kind === "understand" && (
          <UnderstandingScreen r={view.r} original={question} onConfirm={() => go({ kind: "clarify", r: view.r })} onEdit={() => go({ kind: "ask" })} />
        )}
        {view.kind === "clarify" && (
          <ClarifyScreen
            key={view.r.state_token}
            r={view.r}
            busy={busy}
            onAnswer={(text) => void send({ message: text, state_token: view.r.state_token }, view)}
            onBack={() => go({ kind: "understand", r: view.r })}
          />
        )}
        {view.kind === "result" && (
          <ResultScreen
            r={view.r}
            original={question}
            busy={busy}
            onNew={reset}
            onEdit={() => go({ kind: "ask" })}
            onRetry={() => lastRequest.current && void send(lastRequest.current.payload, lastRequest.current.from)}
          />
        )}
      </main>
      <AppFooter disclaimer={PRODUCT_DISCLAIMER} onHowItWorks={openHow} />
      <HowItWorksDialog open={howOpen} onClose={() => setHowOpen(false)} />
    </>
  );
}
