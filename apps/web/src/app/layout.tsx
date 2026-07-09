import type { Metadata } from "next";
import { Open_Sans, Poppins } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AuthHashHandler } from "@/components/auth/auth-hash-handler";

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

/** Inlined so PageHeader description paints before the main CSS bundle. */
const CRITICAL_LCP_CSS = `
.page-header-desc{max-width:42rem;font-size:.875rem;line-height:1.625;color:hsl(215 16% 42%)}
.dark .page-header-desc{color:hsl(215 16% 58%)}
`;

export const metadata: Metadata = {
  title: "Nexus ERP",
  description: "Enterprise retail ERP and point of sale",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_LCP_CSS }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nexus-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${openSans.variable} ${poppins.variable} font-sans antialiased`}>
        <Providers>
          <AuthHashHandler />
          {children}
        </Providers>
      </body>
    </html>
  );
}
