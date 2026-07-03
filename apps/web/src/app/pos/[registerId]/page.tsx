import { PosKiosk } from "@/components/pos/pos-kiosk";

export default async function PosRegisterPage({
  params,
}: {
  params: Promise<{ registerId: string }>;
}) {
  const { registerId } = await params;
  return <PosKiosk registerId={registerId} />;
}
