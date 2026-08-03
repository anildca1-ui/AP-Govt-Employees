"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/i18n/config";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Horizontally scrollable on phones — the audience is overwhelmingly mobile, and
 * a scrolling strip keeps every section one tap away without a menu to open.
 */
export function SiteNav({
  items,
  locale,
  ariaLabel,
}: {
  items: NavItem[];
  locale: Locale;
  ariaLabel: string;
}) {
  const pathname = usePathname();
  const home = `/${locale}`;

  return (
    <nav aria-label={ariaLabel} className="border-t border-slate-200 bg-white">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 py-1.5 text-sm [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const isActive =
            item.href === home ? pathname === home : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={
                  isActive
                    ? "block rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white"
                    : "block rounded-md px-3 py-1.5 text-slate-700 transition hover:bg-slate-100"
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
