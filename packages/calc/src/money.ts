/**
 * Rupee handling shared by every calculator in PLAN.md Part 4.
 *
 * AP pay bills round each computed element to the nearest rupee, with 50 paise
 * and above rounded up. JavaScript's Math.round already rounds .5 away from zero
 * for positive numbers, but rounds -0.5 towards zero, which would understate a
 * recovery (negative arrear). roundRupees is explicit about both directions so
 * arrear tables and recovery tables use the same rule.
 */

/** A rupee amount. Always a whole number once it has passed through roundRupees. */
export type Rupees = number;

export function roundRupees(amount: number): Rupees {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`roundRupees expects a finite number, received ${amount}`);
  }
  return Math.sign(amount) * Math.round(Math.abs(amount));
}

/**
 * Indian-numbering-system currency string (₹1,23,456) for display and for the
 * WhatsApp-share text on every calculator page.
 */
export function formatINR(amount: number, opts: { paise?: boolean } = {}): string {
  const fractionDigits = opts.paise === true ? 2 : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}
