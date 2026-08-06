/**
 * Golden-set eval runner.
 *
 *     pnpm eval              # against a running site
 *     CHAT_URL=... pnpm eval
 *
 * Asks every case in tests/golden.jsonl through the real /api/chat endpoint and
 * scores the answers. Exits non-zero when the cite rate falls below 90%, which
 * is the gate PLAN.md Phase 2 specifies.
 *
 * It talks to the HTTP endpoint rather than calling the pipeline directly on
 * purpose: the prompt, retrieval, streaming and the disclaimer all have to work
 * together, and a harness that bypasses the route would pass while the site
 * returned nothing.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CITE_RATE_THRESHOLD,
  parseGoldenJsonl,
  scoreCase,
  summarise,
  type CaseScore,
  type GoldenCase,
} from "./score.js";

const chatUrl = process.env.CHAT_URL ?? "http://127.0.0.1:3000/api/chat";

/**
 * Resolved from this file, not from the working directory.
 *
 * `pnpm eval` runs from packages/rag, and the golden set lives at the repository
 * root — so a cwd-relative default crashed before asking a single question, in
 * the exact invocation the docs and CI both use.
 */
const goldenPath =
  process.env.GOLDEN_PATH ??
  fileURLToPath(new URL("../../../../tests/golden.jsonl", import.meta.url));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How many times to wait out a 429 before giving up on a case.
 *
 * The golden set is larger than the chat endpoint's own rate limit allows in one
 * window, so being throttled is the expected path, not an error: thirty
 * questions against twenty-per-five-minutes means the run has to wait partway
 * through. Before this, every case past the limit failed as "request failed"
 * and the gate could never pass — it looked like a broken model rather than a
 * working rate limiter.
 *
 * It waits rather than asking for an exemption. A header that skipped the limit
 * would be a bypass anyone could send, and the eval is meant to exercise the
 * endpoint real users get.
 */
const RATE_LIMIT_RETRIES = 5;

/** Collects the streamed NDJSON answer into one string. */
async function ask(golden: GoldenCase, attempt = 0): Promise<string> {
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: golden.question, lang: golden.lang, session: "eval" }),
  });

  if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
    // Retry-After is what the endpoint itself says to wait; the fallback is one
    // window's worth for a server that omits it.
    const header = Number(response.headers.get("retry-after"));
    const waitSeconds = Number.isFinite(header) && header > 0 ? header : 60;
    console.log(`  rate limited, waiting ${waitSeconds}s (${golden.id})`);
    await response.body?.cancel();
    await sleep(waitSeconds * 1000 + 500);
    return ask(golden, attempt + 1);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  if (response.body === null) throw new Error("empty response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== "") {
        try {
          const event = JSON.parse(line) as { type: string; text?: string; message?: string };
          if (event.type === "token") answer += event.text ?? "";
          if (event.type === "error") throw new Error(event.message ?? "stream error");
        } catch (error) {
          if (error instanceof Error && error.message !== "") throw error;
        }
      }
      newline = buffer.indexOf("\n");
    }
  }

  return answer;
}

const golden = parseGoldenJsonl(await readFile(goldenPath, "utf8"));
console.log(`${golden.length} case(s) from ${goldenPath} → ${chatUrl}\n`);

const scores: CaseScore[] = [];
for (const testCase of golden) {
  let answer: string;
  try {
    answer = await ask(testCase);
  } catch (error) {
    // A transport failure is a failed case, not a crashed run — one bad case
    // must not hide the other twenty-nine.
    scores.push({
      id: testCase.id,
      passed: false,
      cited: false,
      grounded: false,
      disclaimer: false,
      languageOk: false,
      failures: [`request failed: ${error instanceof Error ? error.message : String(error)}`],
    });
    console.log(`✗ ${testCase.id} — request failed`);
    continue;
  }

  const score = scoreCase(testCase, answer);
  scores.push(score);
  console.log(`${score.passed ? "✓" : "✗"} ${score.id}`);
  for (const failure of score.failures) console.log(`    ${failure}`);
}

const summary = summarise(scores);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log("\n" + "─".repeat(60));
console.log(`passed        ${summary.passed}/${summary.total}`);
console.log(`cite rate     ${pct(summary.citeRate)}  (gate: ${pct(CITE_RATE_THRESHOLD)})`);
console.log(`grounded      ${pct(summary.groundedRate)}`);
console.log(`disclaimer    ${pct(summary.disclaimerRate)}`);
console.log(`language      ${pct(summary.languageRate)}`);

if (summary.citeRate < CITE_RATE_THRESHOLD) {
  console.error(
    `\nCite rate ${pct(summary.citeRate)} is below the ${pct(CITE_RATE_THRESHOLD)} gate.`,
  );
  process.exitCode = 1;
}
