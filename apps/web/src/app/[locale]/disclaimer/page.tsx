import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

/**
 * Disclaimer (PLAN.md Part 5 checkpoint 4). Bilingual on one page, like the
 * privacy policy and for the same reason: the two texts must not drift.
 */
export default async function DisclaimerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <article className="max-w-none space-y-8 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">{dict.footer.disclaimerLink}</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">నిరాకరణ (తెలుగు)</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>ఇది అధికారిక ఆంధ్రప్రదేశ్ ప్రభుత్వ వెబ్‌సైట్ కాదు. ఏ ప్రభుత్వ శాఖతోనూ దీనికి సంబంధం లేదు.</li>
          <li>ఇక్కడి AI సమాధానాలు, లెక్కలు సమాచారం కోసమే — అధికారిక నిర్ణయాలకు ఆధారం కావు. ప్రతి విషయాన్ని అసలు జీవోతో సరిచూసుకోండి; అసలు జీవోయే చట్టబద్ధమైనది.</li>
          <li>జీతం, పెన్షన్, సెలవు వంటి విషయాల్లో తుది నిర్ణయం మీ DDO / శాఖ / ప్రభుత్వానిదే.</li>
          <li>రేట్లు (డీఏ శాతం, స్కేళ్లు, పన్ను శ్లాబులు) జీవోలతో సరిచూసే వరకు "ధృవీకరించలేదు" అనే హెచ్చరికతో చూపబడతాయి.</li>
          <li>ఈ సైట్ ఉచితం; ప్రకటనలు లేవు; మీ డేటా అమ్మబడదు.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Disclaimer (English)</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>This is not an official Government of Andhra Pradesh website and is not affiliated with any government department.</li>
          <li>AI answers and calculator results here are informational only and are no basis for official decisions. Verify everything against the original GO — the original GO alone is authoritative.</li>
          <li>Final decisions on pay, pension and leave rest with your DDO, department and the Government.</li>
          <li>Rates (DA percentages, scales, tax slabs) are shown with an "unverified" warning until each has been checked against its GO.</li>
          <li>This site is free, carries no advertising, and your data is never sold.</li>
        </ul>
      </section>

      <p className="text-xs text-slate-500">{dict.footer.disclaimer}</p>
    </article>
  );
}
