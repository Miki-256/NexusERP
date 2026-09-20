import type { Metadata } from "next";
import { Noto_Sans_Ethiopic, Open_Sans, Poppins } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AuthHashHandler } from "@/components/auth/auth-hash-handler";
import { getMessages, getRequestLocale } from "@/i18n/request";
import { cn } from "@/lib/utils";

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-open-sans",
  display: "swap",
  adjustFontFallback: true,
});

/** Headings only — defer preload so body/LCP text isn't blocked by extra WOFF2 files. */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-poppins",
  display: "swap",
  preload: false,
  adjustFontFallback: true,
});

const notoEthiopic = Noto_Sans_Ethiopic({
  subsets: ["ethiopic"],
  weight: ["400", "600", "700"],
  variable: "--font-noto-ethiopic",
  display: "swap",
  preload: false,
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  title: "Nexus ERP",
  description: "Enterprise retail ERP and point of sale",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  const messages = await getMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          Theme boot must run before paint. suppressHydrationWarning avoids false
          mismatches when browser extensions inject <style>/<script> into <head>.
        */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nexus-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={cn(
          openSans.variable,
          poppins.variable,
          notoEthiopic.variable,
          "font-sans antialiased"
        )}
        suppressHydrationWarning
      >
        <Providers locale={locale} messages={messages}>
          <AuthHashHandler />
          {children}
        </Providers>
      </body>
    </html>
  );
}
