/**
 * Employee profile shape and validation (PLAN.md Phase 6).
 *
 * Kept pure so the rules can be tested without a database or a session, and so
 * the same validation runs on the form and on the server action.
 */

export const PENSION_SCHEMES = ["CPS", "OPS", "GPS"] as const;
export type PensionScheme = (typeof PENSION_SCHEMES)[number];

export interface Profile {
  name: string | null;
  basicPay: number | null;
  scale: string | null;
  dept: string | null;
  /** ISO yyyy-mm-dd. */
  joinDate: string | null;
  scheme: PensionScheme | null;
}

/**
 * A stable identifier for each way a profile can be rejected.
 *
 * The reason travels as a code, not as prose. `message` is English and written
 * for a developer reading a test failure; it used to be put straight into a
 * redirect and rendered on the page, so a Telugu-speaking employee mistyping
 * their basic pay was answered in English (rule 5). The page maps the code to
 * the dictionary, the same way the sign-in form already handles "otp".
 */
export type ProfileProblemCode =
  | "basicPayInvalid"
  | "basicPayTypo"
  | "joinDateInvalid"
  | "schemeUnknown";

export interface ProfileProblem {
  field: keyof Profile;
  code: ProfileProblemCode;
  /** Developer-facing. Never render this; use the code. */
  message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a submitted profile.
 *
 * Every field is optional: the dashboard's value is that it prefills the
 * calculators, and demanding a complete profile before showing anything would
 * cost more people than it helps. What is present must be sane, though — a
 * basic pay of zero would silently produce zero arrears.
 */
export function validateProfile(input: {
  name?: string;
  basicPay?: string;
  scale?: string;
  dept?: string;
  joinDate?: string;
  scheme?: string;
}): { profile: Profile; problems: ProfileProblem[] } {
  const problems: ProfileProblem[] = [];

  const text = (value: string | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };

  let basicPay: number | null = null;
  const rawPay = (input.basicPay ?? "").trim();
  if (rawPay !== "") {
    const parsed = Number(rawPay);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      problems.push({ field: "basicPay", code: "basicPayInvalid", message: "Basic pay must be a positive number" });
    } else if (parsed > 10_000_000) {
      // Far above the master scale maximum: almost certainly a typo, and a
      // wrong figure here quietly wrongs every prefilled calculator.
      problems.push({ field: "basicPay", code: "basicPayTypo", message: "That basic pay looks like a typo" });
    } else {
      basicPay = Math.round(parsed);
    }
  }

  let joinDate: string | null = null;
  const rawDate = (input.joinDate ?? "").trim();
  if (rawDate !== "") {
    if (!ISO_DATE.test(rawDate) || Number.isNaN(new Date(`${rawDate}T00:00:00Z`).getTime())) {
      problems.push({ field: "joinDate", code: "joinDateInvalid", message: "Date of joining must be a real date" });
    } else {
      joinDate = rawDate;
    }
  }

  const rawScheme = (input.scheme ?? "").trim();
  let scheme: PensionScheme | null = null;
  if (rawScheme !== "") {
    if ((PENSION_SCHEMES as readonly string[]).includes(rawScheme)) {
      scheme = rawScheme as PensionScheme;
    } else {
      problems.push({ field: "scheme", code: "schemeUnknown", message: "Unknown pension scheme" });
    }
  }

  return {
    profile: {
      name: text(input.name),
      basicPay,
      scale: text(input.scale),
      dept: text(input.dept),
      joinDate,
      scheme,
    },
    problems,
  };
}

/** Maps a profile to the `users` row shape. */
export function profileToRow(id: string, profile: Profile): Record<string, unknown> {
  return {
    id,
    name: profile.name,
    basic_pay: profile.basicPay,
    scale: profile.scale,
    dept: profile.dept,
    join_date: profile.joinDate,
    cps_or_ops: profile.scheme,
  };
}

export function rowToProfile(row: Record<string, unknown> | null): Profile {
  if (row === null) {
    return { name: null, basicPay: null, scale: null, dept: null, joinDate: null, scheme: null };
  }
  const scheme = row.cps_or_ops;
  return {
    name: (row.name as string | null) ?? null,
    basicPay: (row.basic_pay as number | null) ?? null,
    scale: (row.scale as string | null) ?? null,
    dept: (row.dept as string | null) ?? null,
    joinDate: (row.join_date as string | null) ?? null,
    scheme:
      typeof scheme === "string" && (PENSION_SCHEMES as readonly string[]).includes(scheme)
        ? (scheme as PensionScheme)
        : null,
  };
}

/** Consent purposes we record. */
export const CONSENT_PURPOSES = ["profile_storage", "chat_logging"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * The wording shown when consent is taken, stored alongside the event.
 *
 * Versioned because the question a regulator asks is not "did they consent" but
 * "what were they told when they did" — and that answer must survive a later
 * rewrite of the privacy page.
 */
export const CONSENT_POLICY_VERSION = "2026-08-1";
