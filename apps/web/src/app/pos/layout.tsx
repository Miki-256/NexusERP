import type { Metadata, Viewport } from "next";
import "@/components/pos/pos.css";
import { posFontVariables } from "@/components/pos/pos-fonts";

export const metadata: Metadata = {
  title: "Nexus POS",
  description: "Point of sale register",
  manifest: "/pos-manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexus POS",
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
