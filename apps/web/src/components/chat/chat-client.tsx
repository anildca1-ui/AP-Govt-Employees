"use client";

import type { Citation, RetrievalMode } from "@ap-emp-ai/rag";
import { useCallback, useRef, useState } from "react";
import { CitationCard } from "./citation-card";
import { readNdjson } from "@/lib/chat/ndjson";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

interface Turn {
  question: string;
  answer: string;
  citations: Citation[];
  mode: RetrievalMode | null;
  logId: string | null;
  status: "streaming" | "done" | "error";
  errorMessage?: string;
  feedback?: 1 | -1;
}

/**
 * The chat surface.
 *
 * Answers stream token by token because generation takes seconds, and a reader
 * on a phone watching a blank screen concludes the site is broken. Citations
 * arrive before the first token and render immediately, so the GOs an answer
 * rests on are visible while it is still being written.
 */
export function ChatClient({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Groups a visitor's questions without identifying them — no account, no
  // cookie, gone when the tab closes (DPDP: collect nothing we do not need).
  const sessionRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "anon",
  );

  const update = useCallback((index: number, patch: Partial<Turn>) => {
    setTurns((current) =>
      current.map((turn, i) => (i === index ? { ...turn, ...patch } : turn)),
    );
  }, []);

  const ask = useCallback(async () => {
    const asked = question.trim();
    if (asked === "" || busy) return;

    const index = turns.length;
    setTurns((current) => [
      ...current,
      { question: asked, answer: "", citations: [], mode: null, logId: null, status: "streaming" },
    ]);
    setQuestion("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: asked, session: sessionRef.current, lang: locale }),
        signal: controller.signal,
      });

      if (!response.ok || response.body === null) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        update(index, { status: "error", errorMessage: detail?.error ?? dict.chat.error });
        return;
      }

      // Accumulated locally rather than through setState per token: React would
      // otherwise re-render the whole transcript on every few characters.
      let answer = "";
      for await (const event of readNdjson(response.body)) {
        if (event.type === "citations") {
          update(index, { citations: event.citations, mode: event.mode });
        } else if (event.type === "token") {
          answer += event.text;
          update(index, { answer });
        } else if (event.type === "done") {
          update(index, { status: "done", logId: event.logId });
        } else {
          update(index, { status: "error", errorMessage: event.message });
        }
      }
    } catch (error) {
      // An aborted request is the reader pressing Stop, not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        update(index, { status: "error", errorMessage: dict.chat.error });
      } else {
        update(index, { status: "done" });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [question, busy, turns.length, locale, dict.chat.error, update]);

  const sendFeedback = useCallback(
    async (index: number, logId: string, value: 1 | -1) => {
      update(index, { feedback: value });
      // Fire and forget: a failed feedback write must not interrupt reading.
      await fetch("/api/chat/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logId, feedback: value }),
      }).catch(() => undefined);
    },
    [update],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.chat.title}</h1>
        <p className="text-sm text-slate-600">{dict.chat.intro}</p>
      </header>

      <ol className="space-y-6">
        {turns.map((turn, index) => (
          <li key={index} className="space-y-3">
            <div className="rounded-lg bg-slate-100 p-3">
              <p className="text-xs font-medium text-slate-500">{dict.chat.you}</p>
              <p className="mt-1 whitespace-pre-wrap">{turn.question}</p>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">{dict.chat.assistant}</p>

              {turn.status === "error" ? (
                <p className="mt-1 text-sm text-red-700">{turn.errorMessage ?? dict.chat.error}</p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap">
                  {turn.answer}
                  {turn.status === "streaming" && (
                    <span className="ml-0.5 inline-block animate-pulse" aria-hidden>
                      ▌
                    </span>
                  )}
                </p>
              )}

              {turn.status === "streaming" && turn.answer === "" && (
                <p className="mt-1 text-sm text-slate-500">{dict.chat.sending}</p>
              )}
            </div>

            <section className="space-y-2">
              <h2 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {dict.chat.sources}
                {turn.mode === "go-number" && (
                  <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[10px] normal-case">
                    {dict.chat.exactMatch}
                  </span>
                )}
              </h2>
              {turn.citations.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {turn.status === "streaming" ? dict.chat.sourcesPending : dict.chat.noSources}
                </p>
              ) : (
                <ul className="space-y-2">
                  {turn.citations.map((citation) => (
                    <CitationCard key={citation.documentId} citation={citation} dict={dict} />
                  ))}
                </ul>
              )}
            </section>

            {/* Only offered when there is a row to attach it to. */}
            {turn.status === "done" && turn.logId !== null && (
              <div className="flex items-center gap-2 text-sm">
                {turn.feedback === undefined ? (
                  <>
                    <span className="text-slate-600">{dict.chat.helpful}</span>
                    <button
                      type="button"
                      onClick={() => void sendFeedback(index, turn.logId!, 1)}
                      className="rounded border border-slate-300 px-2 py-0.5"
                    >
                      👍 {dict.chat.yes}
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendFeedback(index, turn.logId!, -1)}
                      className="rounded border border-slate-300 px-2 py-0.5"
                    >
                      👎 {dict.chat.no}
                    </button>
                  </>
                ) : (
                  <span className="text-slate-500">{dict.chat.thanks}</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
        className="sticky bottom-0 flex gap-2 bg-white py-3"
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={dict.chat.placeholder}
          aria-label={dict.chat.title}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium"
          >
            {dict.chat.stop}
          </button>
        ) : (
          <button
            type="submit"
            disabled={question.trim() === ""}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {dict.chat.send}
          </button>
        )}
      </form>
    </div>
  );
}
