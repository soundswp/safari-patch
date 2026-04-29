import { corsHeaders } from "../_shared/cors.ts";
import {
  createAuthedClient,
  json,
  parseOptionalBool,
  uploadToBunny,
} from "../_shared/upload.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { supabase, user } = await createAuthedClient(request);
    const form = await request.formData();

    const displayName = String(form.get("display_name") ?? "").trim();
    const username = String(form.get("username") ?? "").trim().replace(/^@/, "").toLowerCase();
    const bio = String(form.get("bio") ?? "").trim();
    const dateOfBirth = String(form.get("date_of_birth") ?? "").trim();
    const userType = normalizeUserType(String(form.get("user_type") ?? "").trim());
    const profileImage = form.get("profile_image");

    const isPrivate = parseOptionalBool(form.get("is_private"));
    const showInDiscovery = parseOptionalBool(form.get("show_in_discovery"));
    const allowDirectMessages = parseOptionalBool(form.get("allow_direct_messages"));
    const showOnlineStatus = parseOptionalBool(form.get("show_online_status"));
    const allowReadReceipts = parseOptionalBool(form.get("allow_read_receipts"));
    const preferencesCompleted = parseOptionalBool(form.get("preferences_completed"));

    const updates: Record<string, unknown> = {};
    const errors: string[] = [];

    if (form.has("display_name")) {
      if (!displayName) errors.push("Display name is required");
      else if (displayName.length > 100) errors.push("Display name must be 100 characters or fewer");
      else updates.display_name = displayName;
    }

    if (form.has("username")) {
      if (!username) errors.push("Username is required");
      else if (!/^[a-z0-9_]{3,24}$/.test(username)) errors.push("Username must be 3 to 24 characters and use only letters, numbers, or underscores");
      else {
        const { data: existing, error } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", username)
          .neq("id", user.id)
          .limit(1)
          .maybeSingle();

        if (error && error.code !== "PGRST116") {
          throw error;
        }

        if (existing?.id) {
          errors.push("That username is already taken");
        } else {
          updates.username = username;
        }
      }
    }

    if (form.has("bio")) {
      if (bio.length > 500) errors.push("Bio must be 500 characters or fewer");
      else updates.bio = bio || null;
    }

    if (form.has("date_of_birth")) {
      updates.date_of_birth = dateOfBirth || null;
    }

    if (form.has("user_type")) {
      updates.user_type = userType || null;
    }

    if (isPrivate !== null) updates.is_private = isPrivate;
    if (showInDiscovery !== null) updates.show_in_discovery = showInDiscovery;
    if (allowDirectMessages !== null) updates.allow_direct_messages = allowDirectMessages;
    if (showOnlineStatus !== null) updates.show_online_status = showOnlineStatus;
    if (allowReadReceipts !== null) updates.allow_read_receipts = allowReadReceipts;
    if (preferencesCompleted !== null) updates.preferences_completed = preferencesCompleted;

    if (profileImage instanceof File) {
      if (profileImage.size > 2 * 1024 * 1024) {
        errors.push("Profile image must be 2MB or smaller");
      } else {
        const imageURL = await uploadToBunny(profileImage, `profiles/avatars/${user.id}-${Date.now()}.jpg`, "image/jpeg");
        updates.profile_image_url = imageURL;
        updates.profile_image_updated_at = new Date().toISOString();
      }
    }

    if (errors.length) {
      return json({ error: errors.join("\n") }, 400);
    }

    if (!Object.keys(updates).length) {
      return json({ error: "No profile changes were provided" }, 400);
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("*")
      .single();

    if (error) {
      return json({ error: error.message }, 400);
    }

    return json({ profile: data });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Profile update failed" }, 500);
  }
});

function normalizeUserType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";

  const includesArtist = ["artist", "vocalist", "singer", "rapper"].some((token) => normalized.includes(token));
  const includesProducer = ["producer", "beat producer", "song producer", "full stack producer", "audio engineer", "dj"].some((token) => normalized.includes(token));

  if (includesArtist && includesProducer) return "Artist / Producer";
  if (includesProducer) return "Producer";
  if (includesArtist) return "Artist";
  return "";
}
