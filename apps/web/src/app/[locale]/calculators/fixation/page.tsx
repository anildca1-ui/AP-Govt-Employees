import { notFound } from "next/navigation";
import { Calculator } from "@/components/calculators/calculators";
import { CALCULATORS, labelsFor } from "@/lib/calculators/registry";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

const META = CALCULATORS.find((c) => c.slug === "fixation")!;

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const { title, description } = labelsFor(META, dict);

  return <Calculator id={META.id} title={title} description={description} dict={dict} />;
}
