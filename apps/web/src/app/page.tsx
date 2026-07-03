import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  redirect(POST_AUTH_BOOTSTRAP_PATH);
}
