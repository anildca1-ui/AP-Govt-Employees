"use client";

import { useState } from "react";
import type { QuizQuestion } from "@/lib/library/tests-hub";
import { classifyFailure, failureMessage } from "@/lib/chat/failure";
import type { Dictionary } from "@/i18n/dictionary";

/**
 * Practice-question generator for one test.
 *
 * Every question shows its source GO. That is not decoration: a practice
 * question an employee cannot trace back to a rule is one they cannot check,
 * and this is material they will sit an exam on.
 */
export function QuizClient({ testId, dict }: { testId: string; dict: Dictionary }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ testId }),
      });
      if (!response.ok) {
        // Not read from the body: the route's message is ours to read, not the
        // reader's ("Generation failed", "GEMINI_API_KEY is not set"). Being
        // rate-limited is worth saying plainly, though — "quiz unavailable"
        // would read as broken when the answer is simply to wait.
        const failure = classifyFailure(response.status, response.headers.get("retry-after"));
        setMessage(
          failure.kind === "rate-limited"
            ? failureMessage(failure, dict)
            : dict.tests.quizUnavailable,
        );
        return;
      }

      const payload = (await response.json()) as {
        questions?: QuizQuestion[];
        reason?: string;
      };

      if (payload.reason === "no-corpus" || (payload.questions ?? []).length === 0) {
        setMessage(dict.tests.noCorpus);
        return;
      }
      setQuestions(payload.questions ?? []);
      setRevealed(new Set());
    } catch {
      setMessage(dict.tests.quizUnavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">{dict.tests.quizIntro}</p>

      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? dict.tests.generating : dict.tests.generateQuiz}
      </button>

      {message !== null && <p className="text-sm text-slate-600">{message}</p>}

      {questions !== null && (
        <ol className="space-y-4">
          {questions.map((question, index) => (
            <li key={index} className="rounded-lg border border-slate-200 p-4">
              <p className="font-medium">
                {index + 1}. {question.question}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {question.options.map((option, optionIndex) => (
                  <li
                    key={optionIndex}
                    className={
                      revealed.has(index) && optionIndex === question.correctIndex
                        ? "rounded bg-green-50 px-2 py-1 text-green-900"
                        : "px-2 py-1"
                    }
                  >
                    {String.fromCharCode(65 + optionIndex)}. {option}
                  </li>
                ))}
              </ul>

              {revealed.has(index) ? (
                <div className="mt-2 space-y-1 text-sm">
                  {question.explanation !== undefined && (
                    <p className="text-slate-600">{question.explanation}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {dict.tests.source}: {question.source}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRevealed((current) => new Set(current).add(index))}
                  className="mt-2 rounded border border-slate-300 px-3 py-1 text-xs"
                >
                  {dict.tests.showAnswer}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
