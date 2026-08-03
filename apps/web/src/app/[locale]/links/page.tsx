import { ComingSoon } from "@/components/coming-soon";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { notFound } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return <ComingSoon title={dict.nav.links} dict={dict} />;
}
