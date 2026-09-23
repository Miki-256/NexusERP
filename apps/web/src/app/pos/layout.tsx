import type { Metadata, Viewport } from "next";
import "@/components/pos/pos.css";
import { posFontVariables } from "@/components/pos/pos-fonts";

export const metadata: Metadata = {
  title: "Nexus POS",
  description: "Point of sale register",
  manifest: "/pos-manifest.json",
  applicationName: "Nexus POS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexus POS",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#1e3a5f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function PosRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={`pos-route ${posFontVariables}`}>{children}</div>;
}
