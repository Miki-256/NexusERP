import { AcceptInviteClient } from "./invite-client";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; confirm?: string }>;
}) {
  const params = await searchParams;
  return (
    <AcceptInviteClient
      inviteId={params.id ?? null}
      awaitingEmailConfirm={params.confirm === "1"}
    />
  );
}
