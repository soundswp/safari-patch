import { corsHeaders } from "../_shared/cors.ts";
import { createAuthedClient, createServiceClient, json } from "../_shared/upload.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { user } = await createAuthedClient(request);
    const service = createServiceClient();
    const body = await request.json().catch(() => ({}));

    const contentId = String(body?.contentId || "").trim();
    const normalizedType = String(body?.contentType || "").trim().toLowerCase();
    const table = normalizedType === "beat" ? "beats" : normalizedType === "song" ? "songs" : "";

    if (!contentId || !table) {
      return json({ error: "A valid content id and content type are required." }, 400);
    }

    const ownerResult = await service
      .from(table)
      .select("id, user_id")
      .eq("id", contentId)
      .limit(1)
      .maybeSingle();

    if (ownerResult.error) {
      console.error("Delete ownership lookup failed", ownerResult.error);
      return json({ error: "We couldn’t verify ownership right now." }, 500);
    }

    if (!ownerResult.data) {
      return json({ error: "Content not found." }, 404);
    }

    if (ownerResult.data.user_id !== user.id) {
      return json({ error: "You can only delete your own content." }, 403);
    }

    if (table === "beats") {
      const purchasesResult = await service
        .from("purchases")
        .select("id", { count: "exact", head: true })
        .eq("beats_id", contentId)
        .eq("content_type", "beat")
        .eq("status", "completed");

      if (purchasesResult.error) {
        console.error("Delete purchase lookup failed", purchasesResult.error);
        return json({ error: "We couldn’t update this beat right now." }, 500);
      }

      if ((purchasesResult.count || 0) > 0) {
        const softDeleteResult = await service
          .from("beats")
          .update({
            public_license_state: "removed_from_profile",
            basic_license_enabled: false,
            premium_license_enabled: false,
            exclusive_license_enabled: false,
          })
          .eq("id", contentId)
          .eq("user_id", user.id);

        if (softDeleteResult.error) {
          console.error("Soft delete beat failed", softDeleteResult.error);
          return json({ error: "We couldn’t remove this beat right now." }, 500);
        }

        return json({ success: true, archived: true });
      }
    }

    await Promise.allSettled([
      service.from("comments").delete().eq("content_id", contentId).eq("content_type", normalizedType),
      service.from("liked_content").delete().eq("content_id", contentId).eq("content_type", normalizedType),
      service.from("reposts").delete().eq("content_id", contentId).eq("content_type", normalizedType),
      service.from("playlist_items").delete().eq("content_id", contentId).eq("content_type", normalizedType),
    ]);

    const deleteResult = await service
      .from(table)
      .delete()
      .eq("id", contentId)
      .eq("user_id", user.id);

    if (deleteResult.error) {
      console.error("Delete content failed", deleteResult.error);
      return json({ error: "We couldn’t delete this content right now." }, 500);
    }

    return json({ success: true });
  } catch (error) {
    console.error("web-delete-content failed", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = /Unauthorized|Missing authorization/i.test(message) ? 401 : 500;
    return json({ error: message }, status);
  }
});
