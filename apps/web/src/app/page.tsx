import { formatINR } from "@ap-emp-ai/calc";
import { findGoReference } from "@ap-emp-ai/rag";

// Placeholder home page. Its only job in Phase 0 task 1 is to prove the
// workspace wiring: the web app resolves and renders values from the calc and
// rag packages. Phase 0 task 4 replaces this with the real layout.
export default function Home() {
  const example = findGoReference("G.O.Ms.No.51 లో ఏమి ఉంది?");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">ఆంధ్రప్రదేశ్ ప్రభుత్వ ఉద్యోగుల పోర్టల్</h1>
        <p className="mt-1 text-sm text-slate-600">
          AP Government Employees Portal — scaffold. Phase 0, task 1.
        </p>
      </div>

      <dl className="rounded-lg border border-slate-200 p-4 text-sm">
        <dt className="font-medium">@ap-emp-ai/calc</dt>
        <dd className="mb-3 text-slate-600">{formatINR(123456)}</dd>
        <dt className="font-medium">@ap-emp-ai/rag</dt>
        <dd className="text-slate-600">{example?.canonical ?? "—"}</dd>
      </dl>

      <footer className="text-xs text-slate-500">
        ఇది అధికారిక ఆంధ్రప్రదేశ్ ప్రభుత్వ వెబ్‌సైట్ కాదు. / This is not an official Government of
        Andhra Pradesh website.
      </footer>
    </main>
  );
}
