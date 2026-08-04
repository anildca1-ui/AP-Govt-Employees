import { describe, expect, it } from "vitest";
import { escapeFilterValue, type DocumentRow } from "./queries";
import { filterByTag, NEWS_TAGS, tagsFor } from "./tagging";
import { allLinks, LINK_CATEGORIES } from "./links";
import { DEPARTMENTAL_TESTS, findTest, parseQuiz, QUIZ_SYSTEM_PROMPT } from "./tests-hub";

function doc(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: "d1",
    go_number: "G.O.Ms.No.60",
    go_type: "Ms",
    dept: "Finance",
    issue_date: "2025-10-20",
    subject: "Dearness Allowance enhanced to 37.31 percent",
    subject_te: "కరువు భత్యం పెంపు",
    pdf_url: "https://goir.ap.gov.in/60.pdf",
    source: "goir",
    superseded_by: null,
    supersedes: null,
    created_at: "2025-10-21T00:00:00Z",
    ...overrides,
  };
}

describe("escapeFilterValue", () => {
  it("strips the characters PostgREST treats as filter syntax", () => {
    // A comma in a search box would otherwise be read as another condition in
    // the `or` filter, quietly changing what the query means.
    expect(escapeFilterValue("DA,dept.eq.Finance")).toBe("DA dept.eq.Finance");
    expect(escapeFilterValue('a"b(c)d\\e')).toBe("a b c d e");
  });

  it("leaves ordinary Telugu and English searches alone", () => {
    expect(escapeFilterValue("కరువు భత్యం")).toBe("కరువు భత్యం");
    expect(escapeFilterValue("  dearness allowance  ")).toBe("dearness allowance");
  });
});

describe("tagsFor", () => {
  it("tags a DA order from its English subject", () => {
    expect(tagsFor(doc())).toContain("DA");
  });

  it("tags from the Telugu subject when that is all there is", () => {
    // A Telugu-language GO often has only subject_te filled; an English-only
    // matcher would tag none of them.
    const tags = tagsFor({ subject: null, subject_te: "కరువు భత్యం పెంపు ఉత్తర్వులు" });
    expect(tags).toContain("DA");
  });

  it("gives a document several tags when it genuinely covers several topics", () => {
    // A DA revision usually applies to pensioners too.
    const tags = tagsFor({
      subject: "Dearness Allowance to pensioners — revised pension",
      subject_te: null,
    });

    expect(tags).toContain("DA");
    expect(tags).toContain("Pension");
  });

  it("recognises each topic the plan names", () => {
    const samples: Record<string, string> = {
      DA: "Dearness Allowance sanctioned",
      PRC: "Revised Scales of Pay 2022",
      Transfers: "Transfers and postings of officers",
      EHS: "Employee Health Scheme empanelment",
      Exams: "Departmental Test EOT 141 notification",
      Pension: "Gratuity and commutation of pension",
      Leave: "Surrender leave encashment orders",
    };

    for (const [tag, subject] of Object.entries(samples)) {
      expect(tagsFor({ subject, subject_te: null }), subject).toContain(tag);
    }
  });

  it("returns no tags rather than guessing on an unrelated subject", () => {
    expect(tagsFor({ subject: "Appointment of a committee", subject_te: null })).toEqual([]);
  });

  it("returns no tags for a document with no subject at all", () => {
    expect(tagsFor({ subject: null, subject_te: null })).toEqual([]);
  });

  it("only ever emits tags from the declared list", () => {
    for (const tag of tagsFor(doc())) {
      expect(NEWS_TAGS).toContain(tag);
    }
  });
});

describe("filterByTag", () => {
  const documents = [
    doc({ id: "a", subject: "Dearness Allowance", subject_te: null }),
    doc({ id: "b", subject: "Transfers and postings", subject_te: null }),
    doc({ id: "c", subject: "Committee constituted", subject_te: null }),
  ];

  it("keeps only documents carrying the tag", () => {
    expect(filterByTag(documents, "DA").map((d) => d.id)).toEqual(["a"]);
    expect(filterByTag(documents, "Transfers").map((d) => d.id)).toEqual(["b"]);
  });

  it("returns everything when no tag is selected", () => {
    expect(filterByTag(documents, null)).toHaveLength(3);
  });

  it("returns nothing when no document carries the tag", () => {
    expect(filterByTag(documents, "EHS")).toEqual([]);
  });
});

describe("parseQuiz", () => {
  const valid = {
    question: "What is the DA rate from 01.01.2024?",
    options: ["33.67%", "37.31%", "30.03%", "26.39%"],
    correctIndex: 1,
    source: "G.O.Ms.No.60 dt 20.10.2025",
    explanation: "The order enhances DA to 37.31%.",
  };

  it("accepts a well-formed question", () => {
    expect(parseQuiz(JSON.stringify({ questions: [valid] }))).toEqual([valid]);
  });

  it("tolerates fenced or prose-wrapped JSON", () => {
    const raw = "Here you go:\n```json\n" + JSON.stringify({ questions: [valid] }) + "\n```";
    expect(parseQuiz(raw)).toHaveLength(1);
  });

  it("drops a question with no source", () => {
    // A practice question an employee cannot trace to a rule is one they cannot
    // check — and they will sit an exam on it.
    const { source, ...noSource } = valid;
    expect(parseQuiz(JSON.stringify({ questions: [noSource] }))).toEqual([]);
  });

  it("drops malformed option sets and out-of-range answers", () => {
    const bad = [
      { ...valid, options: ["only", "three", "options"] },
      { ...valid, options: ["a", "b", "c", ""] },
      { ...valid, correctIndex: 7 },
      { ...valid, correctIndex: -1 },
      { ...valid, question: "" },
    ];

    for (const question of bad) {
      expect(parseQuiz(JSON.stringify({ questions: [question] })), JSON.stringify(question)).toEqual(
        [],
      );
    }
  });

  it("keeps the good questions and drops only the bad ones", () => {
    const mixed = { questions: [valid, { ...valid, source: "" }, { ...valid, question: "Second?" }] };
    expect(parseQuiz(JSON.stringify(mixed))).toHaveLength(2);
  });

  it("returns [] for junk rather than throwing", () => {
    for (const junk of ["", "not json", "{}", '{"questions":"nope"}', "[1,2,3]"]) {
      expect(parseQuiz(junk), junk).toEqual([]);
    }
  });
});

describe("QUIZ_SYSTEM_PROMPT", () => {
  it("forbids questions from general knowledge", () => {
    expect(QUIZ_SYSTEM_PROMPT).toMatch(/only source/i);
    expect(QUIZ_SYSTEM_PROMPT).toMatch(/never write a question from general knowledge/i);
  });

  it("requires a source on every question", () => {
    expect(QUIZ_SYSTEM_PROMPT).toMatch(/source/i);
  });

  it("tells the model to return fewer rather than pad", () => {
    expect(QUIZ_SYSTEM_PROMPT).toMatch(/never pad/i);
  });
});

describe("quick links", () => {
  it("has no duplicate URLs across categories", () => {
    const urls = allLinks().map((link) => link.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("uses https everywhere", () => {
    // These are government sites handling employee data; an http link in a
    // directory people trust is a directory teaching a bad habit.
    for (const link of allLinks()) {
      expect(link.url, link.label).toMatch(/^https:\/\//);
    }
  });

  it("says what each site is for, not just its name", () => {
    for (const link of allLinks()) {
      expect(link.purpose.length, link.label).toBeGreaterThan(10);
    }
  });

  it("covers the categories the plan names", () => {
    const labels = LINK_CATEGORIES.map((c) => c.id);
    expect(labels).toContain("pay");
    expect(labels).toContain("orders");
    expect(labels).toContain("benefits");
  });
});

describe("departmental tests", () => {
  it("covers EOT 141 and GOT 88/97 as the plan requires", () => {
    const ids = DEPARTMENTAL_TESTS.map((t) => t.id);
    expect(ids).toContain("eot-141");
    expect(ids).toContain("got-88");
    expect(ids).toContain("got-97");
  });

  it("gives every test at least one paper with topics", () => {
    for (const test of DEPARTMENTAL_TESTS) {
      expect(test.papers.length, test.id).toBeGreaterThan(0);
      for (const paper of test.papers) {
        expect(paper.topics.length, `${test.id}/${paper.code}`).toBeGreaterThan(0);
      }
    }
  });

  it("finds a test by id and returns undefined otherwise", () => {
    expect(findTest("got-88")?.code).toBe("88");
    expect(findTest("nope")).toBeUndefined();
  });
});
