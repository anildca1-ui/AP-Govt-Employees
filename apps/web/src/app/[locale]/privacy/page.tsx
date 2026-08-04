import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

/**
 * Privacy policy (CLAUDE.md rule 7: /privacy in Telugu + English).
 *
 * Bilingual on one page rather than per-locale content: consent language must
 * be identical in meaning across languages, and two separately-maintained
 * texts drift. The page renders both, always, whichever locale frames it.
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <article className="prose prose-slate max-w-none space-y-8 text-sm leading-relaxed">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.privacyPage.title}</h1>
        <p className="text-xs text-slate-500">{dict.privacyPage.updated}: 2026-08-03 · v2026-08-1</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">గోప్యతా విధానం (తెలుగు)</h2>
        <p>ఈ వెబ్‌సైట్ అధికారిక ఆంధ్రప్రదేశ్ ప్రభుత్వ వెబ్‌సైట్ కాదు.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>మేము సేకరించేది:</strong> మీరు ఖాతా తెరిస్తే — మీ మొబైల్ నంబర్ (ప్రవేశానికి), మీరు ఇచ్చిన వివరాలు (బేసిక్ పే, స్కేల్, శాఖ, నియామక తేదీ, పెన్షన్ పథకం). ఖాతా లేకుండా అన్ని కాలిక్యులేటర్లు, జీవో లైబ్రరీ వాడుకోవచ్చు — అప్పుడు మేము ఏ వ్యక్తిగత వివరమూ సేకరించము.</li>
          <li><strong>ఎందుకు:</strong> కాలిక్యులేటర్లను మీ వివరాలతో ముందే నింపడానికి మాత్రమే. మీ సమ్మతి లేకుండా మీ ప్రశ్నలు మీ ఖాతాతో అనుసంధానించబడవు.</li>
          <li><strong>సమ్మతి:</strong> ప్రతి సమ్మతి — ఏ తేదీన, ఏ పదాలతో అడిగామో సహా — రికార్డు చేయబడుతుంది. మీ సమ్మతి చరిత్రను మీరు చూడవచ్చు.</li>
          <li><strong>తొలగింపు:</strong> "నా డేటా తొలగించండి" ద్వారా మీ ఖాతా, వివరాలు, సమ్మతి రికార్డులు శాశ్వతంగా తొలగించబడతాయి. ఇది వెంటనే జరుగుతుంది; వెనక్కి తీసుకోలేరు.</li>
          <li><strong>మూడవ పక్షాలు:</strong> మీ వివరాలు అమ్మబడవు, ప్రకటనలకు వాడబడవు. డేటా Supabase (డేటాబేస్) లో నిల్వ అవుతుంది; AI సమాధానాల కోసం మీ ప్రశ్న మాత్రమే మోడల్ ప్రొవైడర్‌కు పంపబడుతుంది — మీ పేరు, నంబర్ కాదు.</li>
          <li><strong>లోపాల నివేదిక:</strong> సైట్‌లో ఏదైనా విఫలమైతే, దాన్ని సరిచేయడానికి సాంకేతిక వివరాలు (ఏ పేజీ, ఏ లోపం) ఒక ఎర్రర్-ట్రాకింగ్ సేవకు పంపబడతాయి. మీ ఫోన్ నంబర్, బేసిక్ పే, మీరు అడిగిన ప్రశ్నలు — ఇవేవీ పంపబడవు; పంపే ముందు తొలగించబడతాయి.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Privacy Policy (English)</h2>
        <p>This is not an official Government of Andhra Pradesh website.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>What we collect:</strong> If you open an account — your mobile number (for sign-in) and the details you choose to give (basic pay, scale, department, joining date, pension scheme). Every calculator and the GO library work without an account, in which case we collect no personal information at all.</li>
          <li><strong>Why:</strong> Solely to prefill the calculators with your details. Your questions are not linked to your account unless you consent to that separately.</li>
          <li><strong>Consent:</strong> Every consent is recorded as an event — including the date and the exact wording you were shown. You can review your consent history.</li>
          <li><strong>Deletion:</strong> "Delete my data" permanently removes your account, details and consent records. It takes effect immediately and cannot be undone.</li>
          <li><strong>Third parties:</strong> Your details are never sold or used for advertising. Data is stored in Supabase; for AI answers, only your question text is sent to the model provider — never your name or number.</li>
          <li><strong>Error reports:</strong> When something on the site fails, the technical details needed to fix it — which page, which error — are sent to an error-tracking service. Your phone number, basic pay and the questions you asked are not: they are stripped out before the report leaves our server.</li>
        </ul>
      </section>

      <p className="text-xs text-slate-500">{dict.footer.disclaimer}</p>
    </article>
  );
}
