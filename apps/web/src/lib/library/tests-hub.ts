/**
 * Departmental tests hub (PLAN.md Phase 5).
 *
 * The syllabus outlines are structural — paper codes and subject headings — and
 * are what an employee needs to orient themselves. They are NOT authoritative:
 * the binding syllabus is APPSC's own notification, which is why every paper
 * links out and the page says so rather than implying we publish the syllabus.
 */

export interface TestPaper {
  code: string;
  title: string;
  topics: string[];
}

export interface DepartmentalTest {
  id: string;
  code: string;
  title: string;
  who: string;
  papers: TestPaper[];
}

export const DEPARTMENTAL_TESTS: DepartmentalTest[] = [
  {
    id: "eot-141",
    code: "141",
    title: "Executive Officers' Test (EOT)",
    who: "Executive officers in the Endowments department",
    papers: [
      {
        code: "141",
        title: "Endowments Act and Rules",
        topics: [
          "AP Charitable and Hindu Religious Institutions and Endowments Act 1987",
          "Accounts and audit of institutions",
          "Powers of the Commissioner and subordinate officers",
        ],
      },
    ],
  },
  {
    id: "got-88",
    code: "88",
    title: "General Officers' Test — Paper I (GOT 88)",
    who: "Gazetted and non-gazetted officers seeking promotion",
    papers: [
      {
        code: "88",
        title: "AP Financial Code and Treasury Code",
        topics: [
          "Financial Code: sanctions, contingent charges, contracts",
          "Treasury Code: bills, drawal, custody of money",
          "Accounts Code fundamentals",
        ],
      },
    ],
  },
  {
    id: "got-97",
    code: "97",
    title: "General Officers' Test — Paper II (GOT 97)",
    who: "Gazetted and non-gazetted officers seeking promotion",
    papers: [
      {
        code: "97",
        title: "Fundamental Rules and Subsidiary Rules",
        topics: [
          "FR 22 and pay fixation",
          "Leave rules and joining time",
          "Travelling allowance rules",
          "Pension rules and qualifying service",
        ],
      },
    ],
  },
  {
    id: "special-language",
    code: "Special",
    title: "Special Language Test (Telugu)",
    who: "Officers required to certify proficiency in Telugu",
    papers: [
      {
        code: "Telugu",
        title: "Translation and drafting",
        topics: ["Translation from English to Telugu", "Official correspondence drafting", "Comprehension"],
      },
    ],
  },
];

export function findTest(id: string): DepartmentalTest | undefined {
  return DEPARTMENTAL_TESTS.find((test) => test.id === id);
}

/**
 * The quiz prompt.
 *
 * The same grounding rule as the chat, and for the same reason: a practice
 * question invented from model memory teaches an employee a rule that does not
 * exist, and they then sit an exam — or advise a colleague — on the strength of
 * it. Every question must be answerable from the supplied extracts and must
 * name the GO or rule it came from.
 */
export const QUIZ_SYSTEM_PROMPT = `You write practice questions for Andhra Pradesh departmental tests.

You are given extracts from Government Orders and service rules. They are your ONLY source.

RULES:
1. Every question must be answerable purely from the extracts. Never write a question from general knowledge of Indian service rules — a question about a rule that does not exist teaches an employee something false.
2. Every question carries the GO number or rule reference it came from, in a "source" field.
3. Four options, exactly one unambiguously correct. Wrong options must be plausible, not absurd.
4. If the extracts do not support enough questions, return fewer. Never pad.
5. Reply with STRICT JSON only: {"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"source":"G.O.Ms.No.51 dt 15.04.2025","explanation":"..."}]}`;

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  source: string;
  explanation?: string;
}

/**
 * Parses and validates the model's reply.
 *
 * A malformed or ungrounded question is dropped rather than repaired: showing a
 * question with no source, or with two right answers, is worse than showing
 * fewer questions.
 */
export function parseQuiz(raw: string): QuizQuestion[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let parsed: { questions?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as { questions?: unknown };
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.questions)) return [];

  const out: QuizQuestion[] = [];
  for (const candidate of parsed.questions) {
    const q = candidate as Partial<QuizQuestion>;

    if (typeof q.question !== "string" || q.question.trim() === "") continue;
    if (!Array.isArray(q.options) || q.options.length !== 4) continue;
    if (q.options.some((option) => typeof option !== "string" || option.trim() === "")) continue;
    if (typeof q.correctIndex !== "number" || q.correctIndex < 0 || q.correctIndex > 3) continue;
    // Rule 2: a question with no citation cannot be shown.
    if (typeof q.source !== "string" || q.source.trim() === "") continue;

    out.push({
      question: q.question.trim(),
      options: q.options.map((option) => (option as string).trim()),
      correctIndex: Math.trunc(q.correctIndex),
      source: q.source.trim(),
      ...(typeof q.explanation === "string" && q.explanation.trim() !== ""
        ? { explanation: q.explanation.trim() }
        : {}),
    });
  }

  return out;
}
