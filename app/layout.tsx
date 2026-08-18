import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "keycalendar.local";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const description = "Единый кабинет для управления объектами, бронированиями и финансами.";

  return {
    title: { default: "KeyCalendar", template: "%s · KeyCalendar" },
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "KeyCalendar",
      description,
      type: "website",
      locale: "ru_RU",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "KeyCalendar — бронирования, объекты и финансы" }],
    },
    twitter: { card: "summary_large_image", title: "KeyCalendar", description, images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
