import { notFound } from "next/navigation";
import { ChatClient } from "@/components/chat/chat-client";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

export default async function ChatPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  // The dictionary is resolved on the server and passed down, so the client
  // bundle carries only the strings this page uses rather than both locales.
  return <ChatClient locale={locale} dict={dict} />;
}
