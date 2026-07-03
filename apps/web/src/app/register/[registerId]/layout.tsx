import "@/components/pos/pos.css";
import { posFontVariables } from "@/components/pos/pos-fonts";

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={`pos-route ${posFontVariables}`}>{children}</div>;
}
