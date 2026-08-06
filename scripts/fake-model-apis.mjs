/**
 * Stand-ins for the embedding and answer APIs, so the chat can be exercised
 * without spending money or holding real keys.
 *
 *     node scripts/fake-model-apis.mjs
 *     OPENAI_BASE_URL=http://localhost:54330/v1 \
 *     GEMINI_BASE_URL=http://localhost:54330/v1beta/models \
 *     pnpm --filter @ap-emp-ai/web start
 *
 * It answers in the shape the real services do — OpenAI's embeddings payload,
 * Gemini's server-sent-event stream — because the parts worth checking are the
 * ones between: does retrieval reach the route, does the answer arrive as a
 * stream rather than in one lump, do citations render, does the disclaimer
 * survive to the screen.
 *
 * It is not a model. The text it returns is fixed and says so.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_MODEL_PORT ?? 54330);
const DIMENSIONS = 1024;

/** A deterministic unit-ish vector, so retrieval has something well-formed. */
function vectorFor(text) {
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + ch.codePointAt(0)) % 100000;
  return Array.from({ length: DIMENSIONS }, (_, i) => ((seed + i) % 97) / 970);
}

/**
 * What a grounded answer looks like: it names the GO, gives the figure, and
 * carries the bilingual disclaimer (CLAUDE.md rule 4). Fixed text — the point
 * is to prove the plumbing, not to imitate a model.
 */
const ANSWER = [
  "G.O.Ms.No.60 ప్రకారం, 01-01-2024 నుండి కరువు భత్యం 33.67% నుండి ",
  "37.31% కు పెంచబడింది. ",
  "(ఇది స్టాండ్-ఇన్ సమాధానం — నిజమైన మోడల్ కాదు.)\n\n",
  "ఇది AI సమాచారం మాత్రమే — అధికారిక GO తో సరిచూసుకోండి / ",
  "AI-generated information only — verify with the original GO before acting.",
];

function sse(res, chunks) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let i = 0;
  const tick = setInterval(() => {
    if (i >= chunks.length) {
      clearInterval(tick);
      res.end();
      return;
    }
    const frame = { candidates: [{ content: { parts: [{ text: chunks[i] }] } }] };
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
    i += 1;
  }, 120); // Spaced out on purpose, so streaming is visibly streaming.
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.endsWith("/embeddings")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // One item per input, each carrying its index — the real API's contract,
      // and one the ingest embedder checks. Returning a single unindexed vector
      // for a batch of forty chunks is the sort of stand-in that passes while
      // the real thing would fail.
      let inputs = [""];
      try {
        const raw = JSON.parse(body).input;
        inputs = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
      } catch {
        /* an unparseable body still gets a well-formed response */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: inputs.map((text, index) => ({ index, embedding: vectorFor(text) })),
        }),
      );
    });
    return;
  }

  if (url.pathname.includes("streamGenerateContent")) {
    req.resume();
    sse(res, ANSWER);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: `no stand-in for ${url.pathname}` }));
}).listen(PORT, () => console.log(`stand-in model APIs on :${PORT}`));
