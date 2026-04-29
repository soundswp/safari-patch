import { sendWelcomeEmail } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, json } from "../_shared/upload.ts";

const HOOK_SECRET = Deno.env.get("WELCOME_EMAIL_HOOK_SECRET") ?? "";
const SITE_URL = (Deno.env.get("SOUNDSWIPE_SITE_URL") ?? "https://soundswipe.us").replace(/\/+$/, "");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const secret = request.headers.get("x-welcome-hook-secret") ?? "";
    if (!HOOK_SECRET || secret !== HOOK_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const profileId = String(body?.profile_id || body?.user_id || "").trim();
    const fallbackEmail = String(body?.email || "").trim();
    const fallbackDisplayName = String(body?.display_name || "").trim();

    if (!profileId && !fallbackEmail) {
      return json({ error: "Missing profile identifier or email" }, 400);
    }

    const serviceSupabase = createServiceClient();

    let profile: Record<string, unknown> | null = null;
    if (profileId) {
      const { data } = await serviceSupabase
        .from("profiles")
        .select("id, email, display_name, username")
        .eq("id", profileId)
        .limit(1)
        .maybeSingle();
      profile = data as Record<string, unknown> | null;
    }

    const recipientEmail = String(profile?.email || fallbackEmail || "").trim();
    if (!recipientEmail) {
      return json({ error: "Profile email is missing" }, 400);
    }

    const displayName = String(profile?.display_name || profile?.username || fallbackDisplayName || "there").trim();
    const result = await sendWelcomeEmail({
      to: recipientEmail,
      displayName,
      openURL: SITE_URL,
    });

    if (!result.sent) {
      return json({ error: String(result.reason || "Welcome email failed") }, 400);
    }

    return json({ sent: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Welcome email failed" }, 500);
  }
});
