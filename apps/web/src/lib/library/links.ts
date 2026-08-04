/**
 * The quick-links directory (PLAN.md Phase 5).
 *
 * apgea.org's version of this page is a flat, stale list; the improvement here
 * is categories and honest labelling of what each site is for. Links live in
 * code rather than the database because they change perhaps twice a year and
 * an editable table would be one more thing to secure for no benefit.
 *
 * The plan asks for an uptime ping badge. Not implemented, deliberately:
 * checking a dozen government sites on every page load would make our page as
 * slow as the slowest of them, and doing it from a cron would mean storing and
 * displaying a judgement about third-party availability that is wrong as often
 * as it is right — a site blocking our probe is not a site that is down.
 */

export interface QuickLink {
  label: string;
  url: string;
  /** What an employee actually comes here to do. */
  purpose: string;
}

export interface LinkCategory {
  id: string;
  label: string;
  links: QuickLink[];
}

export const LINK_CATEGORIES: LinkCategory[] = [
  {
    id: "pay",
    label: "Pay & Treasury",
    links: [
      { label: "CFMS", url: "https://cfms.ap.gov.in", purpose: "Pay slips, bills, employee ID" },
      { label: "HRMS", url: "https://hrms.apcfss.in", purpose: "Service register, leave, transfers" },
      { label: "IFMIS", url: "https://ifmis.ap.gov.in", purpose: "Treasury and bill status" },
      { label: "AP Finance", url: "https://apfinance.gov.in", purpose: "Finance department orders" },
    ],
  },
  {
    id: "orders",
    label: "Orders & Gazette",
    links: [
      { label: "GO Issue Register", url: "https://goir.ap.gov.in", purpose: "Every GO since 2008" },
      { label: "AP e-Gazette", url: "https://apegazette.cgg.gov.in", purpose: "Gazette notifications" },
    ],
  },
  {
    id: "benefits",
    label: "Benefits & Insurance",
    links: [
      { label: "APGLI", url: "https://apgli.ap.gov.in", purpose: "Policy status, premium, bonus" },
      { label: "EHS", url: "https://ehs.ap.gov.in", purpose: "Health scheme, empanelled hospitals" },
      { label: "ZPPF / GPF", url: "https://apzppf.ap.gov.in", purpose: "Provident fund balance and slips" },
    ],
  },
  {
    id: "education",
    label: "Education & Training",
    links: [
      { label: "CSE AP", url: "https://cse.ap.gov.in", purpose: "School education department" },
      { label: "SCERT AP", url: "https://scert.ap.gov.in", purpose: "Curriculum and training" },
      { label: "DIKSHA", url: "https://diksha.gov.in", purpose: "Teacher training modules" },
      { label: "AP Revenue Academy", url: "https://revenueacademy.ap.gov.in", purpose: "Departmental test material" },
    ],
  },
  {
    id: "grievance",
    label: "Grievance & Services",
    links: [
      { label: "PGRS / Spandana", url: "https://spandana.ap.gov.in", purpose: "Public grievance redressal" },
      { label: "AP Sachivalayam", url: "https://gramawardsachivalayam.ap.gov.in", purpose: "Village and ward services" },
    ],
  },
];

/** Every link, flattened — used to assert the directory stays sane. */
export function allLinks(): QuickLink[] {
  return LINK_CATEGORIES.flatMap((category) => category.links);
}
