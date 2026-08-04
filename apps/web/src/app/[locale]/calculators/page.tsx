import { notFound } from "next/navigation";
import { CalculatorIndex } from "@/components/calculators/calculator-index";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

export default async function CalculatorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return <CalculatorIndex locale={locale} dict={dict} />;
}
