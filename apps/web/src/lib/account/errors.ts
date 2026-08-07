/**
 * Turns an ?error= code from the account actions into something a reader can
 * understand, in their language.
 *
 * The account page used to render the query parameter directly, and the actions
 * put raw prose in it — a validation message written for a developer, or
 * whatever Postgres said ("new row violates row-level security policy for table
 * users"). Both reached a Telugu-speaking employee in English (rule 5), and the
 * database one described our schema to anyone who could provoke a failure.
 *
 * So codes travel and this maps them. An unrecognised code falls back to the
 * generic message rather than being shown, which is what makes it impossible
 * for prose to reach the page by adding a redirect and forgetting this file.
 */
import type { Dictionary } from "@/i18n/dictionary";

export const ACCOUNT_ERROR_CODES = [
  "unconfigured",
  "otp",
  "verify",
  "basicPayInvalid",
  "basicPayTypo",
  "joinDateInvalid",
  "schemeUnknown",
  "saveFailed",
  "confirm",
  "delete",
] as const;

export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

export function accountErrorMessage(code: string | undefined, dict: Dictionary): string | null {
  if (code === undefined) return null;

  const messages: Record<AccountErrorCode, string> = {
    unconfigured: dict.account.notConfigured,
    otp: dict.account.otpFailed,
    verify: dict.account.verifyFailed,
    basicPayInvalid: dict.account.errBasicPayInvalid,
    basicPayTypo: dict.account.errBasicPayTypo,
    joinDateInvalid: dict.account.errJoinDateInvalid,
    schemeUnknown: dict.account.errSchemeUnknown,
    saveFailed: dict.account.errSaveFailed,
    confirm: dict.account.errConfirm,
    delete: dict.account.deleteFailed,
  };

  return messages[code as AccountErrorCode] ?? dict.account.errGeneric;
}
