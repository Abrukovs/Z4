import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "Ставка Дня — прогнозы на спорт с аналитикой",
  description:
    "Ежедневная «Ставка дня», бесплатные прогнозы на футбол, теннис, хоккей и баскетбол, история результатов и честная статистика: winrate, ROI, график прибыли.",
  keywords: [
    "прогнозы на спорт",
    "ставка дня",
    "футбол",
    "теннис",
    "хоккей",
    "баскетбол",
    "статистика ставок",
  ],
  icons: {
    icon: "/icon.svg",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Ставка Дня",
    statusBarStyle: "black-translucent",
  },
  // og:image и twitter:image генерируются динамически файловой конвенцией
  // src/app/opengraph-image.tsx (ставка дня, коэффициент, статистика)
  openGraph: {
    title: "Ставка Дня — прогнозы на спорт",
    description:
      "Ежедневная ставка дня, прогнозы на сегодня, история результатов и статистика",
    type: "website",
    siteName: "Ставка Дня",
    locale: "ru_RU",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ставка Дня — прогнозы на спорт",
    description:
      "Ежедневная ставка дня на реальные матчи: ≈ коэффициенты, live-счёты, честная статистика",
  },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased bg-zinc-50 text-zinc-900`}>
        {children}
        <Toaster theme="light" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
