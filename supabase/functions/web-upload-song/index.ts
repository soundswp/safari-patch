import { corsHeaders } from "../_shared/cors.ts";
import {
  assertMaxFileSize,
  createAuthedClient,
  json,
  normalizeProducerTags,
  parseBool,
  parseCSVList,
  uploadToBunny,
} from "../_shared/upload.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { supabase, user } = await createAuthedClient(request);

    const form = await request.formData();
    const editId = String(form.get("editId") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const album = String(form.get("album") ?? "").trim();
    const featuredArtists = parseCSVList(form.get("featuredArtists"));
    const tags = parseCSVList(form.get("tags"));
    const lyrics = String(form.get("lyrics") ?? "").trim();
    const isExplicit = parseBool(form.get("isExplicit"));
    const producerTags = normalizeProducerTags(form.get("producerTags"));

    const audioFile = form.get("audioFile");
    const artworkFile = form.get("artworkFile");

    const errors: string[] = [];
    if (!title) errors.push("Title is required");
    if (title.length > 0 && title.length < 3) errors.push("Title must be at least 3 characters");
    let existingSong: Record<string, unknown> | null = null;
    if (editId) {
      const { data, error } = await supabase
        .from("songs")
        .select("id, user_id, export_file_url, album_art")
        .eq("id", editId)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return json({ error: "Song not found or not editable." }, 404);
      }
      existingSong = data as Record<string, unknown>;
    }

    const audioUpload = audioFile instanceof File ? audioFile : null;
    if (!audioUpload && !existingSong?.export_file_url) errors.push("Audio file is required");
    assertMaxFileSize(audioUpload, 100, "Audio file", errors);
    assertMaxFileSize(artworkFile instanceof File ? artworkFile : null, 5, "Artwork", errors);
    if (errors.length) return json({ error: errors.join("\n") }, 400);

    const songId = editId || crypto.randomUUID();
    const userId = user.id;
    const extension = audioUpload instanceof File ? (audioUpload as File).name.split(".").pop()?.toLowerCase() || "m4a" : "m4a";
    const audioURL = audioUpload instanceof File
      ? await uploadToBunny(audioUpload as File, `users/${userId}/exports/${songId}.${extension}`, "audio/mp4")
      : String(existingSong?.export_file_url || "");
    const artworkSuffix = artworkFile instanceof File ? `-${Date.now()}` : "";
    const artworkURL = artworkFile instanceof File
      ? await uploadToBunny(artworkFile, `artwork/songs/${songId}${artworkSuffix}.jpg`, "image/jpeg")
      : existingSong?.album_art ?? null;

    const payload: Record<string, unknown> = {
      title,
      album_art: artworkURL,
      export_file_url: audioURL,
      featured_artists: featuredArtists,
      producer_tags: producerTags,
      album: album || null,
      lyrics: lyrics || null,
      tags,
      is_explicit: isExplicit,
    };

    if (!editId) {
      payload.id = songId;
      payload.user_id = userId;
      payload.duration = null;
      payload.release_date = new Date().toISOString();
      payload.plays = 0;
      payload.likes = 0;
      payload.comments = 0;
      payload.shares = 0;
      payload.genre = null;
      payload.streaming_links = null;
      payload.copyright_status = "pending";
      payload.drm_protected = true;
      payload.protection_level = "standard";
    }

    if (editId) {
      const { error: updateError } = await supabase.from("songs").update(payload).eq("id", songId).eq("user_id", userId);
      if (updateError) return json({ error: updateError.message }, 400);
    } else {
      const { error: insertError } = await supabase.from("songs").insert(payload);
      if (insertError) return json({ error: insertError.message }, 400);

      try {
        await supabase.rpc("increment_user_songs", { user_id: userId });
      } catch {
        // Keep the upload successful even if the profile counter update fails.
      }
    }
    return json({ songId, updated: Boolean(editId) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Upload failed" }, 500);
  }
});
