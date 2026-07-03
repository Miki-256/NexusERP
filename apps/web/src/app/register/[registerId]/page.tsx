import { PosKiosk } from "@/components/pos/pos-kiosk";

/** Short public alias: /register/{id} — same as /pos/{id} for cashier terminals. */
export default async function RegisterKioskPage({
  params,
}: {
  params: Promise<{ registerId: string }>;
}) {
  const { registerId } = await params;
  return <PosKiosk registerId={registerId} />;
}
