import { corsHeaders } from "../_shared/cors.ts";
import {
  assertMaxFileSize,
  createAuthedClient,
  fetchStripeConnectStatus,
  json,
  parseBool,
  parseCSVList,
  parseOptionalFloat,
  parseOptionalInt,
  uploadToBunny,
  validPrice,
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
    const description = String(form.get("description") ?? "").trim();
    const bpm = parseOptionalInt(form.get("bpm"));
    const key = String(form.get("key") ?? "").trim();
    const tags = parseCSVList(form.get("tags"));
    let producerCredits: Array<Record<string, unknown>> = [];
    try {
      const rawProducerCredits = String(form.get("producerCredits") ?? "[]");
      const parsed = JSON.parse(rawProducerCredits);
      if (Array.isArray(parsed)) {
        producerCredits = parsed
          .map((entry) => {
            const displayName = String((entry as Record<string, unknown>)?.display_name ?? (entry as Record<string, unknown>)?.displayName ?? "").trim();
            const username = String((entry as Record<string, unknown>)?.username ?? "").trim().replace(/^@+/, "");
            const userId = String((entry as Record<string, unknown>)?.user_id ?? (entry as Record<string, unknown>)?.userId ?? "").trim();
            const profileImageURL = String((entry as Record<string, unknown>)?.profile_image_url ?? (entry as Record<string, unknown>)?.profileImageUrl ?? "").trim();
            if (!displayName && !username) return null;
            return {
              user_id: userId || null,
              username: username || null,
              display_name: displayName || username,
              profile_image_url: profileImageURL || null,
            };
          })
          .filter(Boolean) as Array<Record<string, unknown>>;
      }
    } catch {
      producerCredits = [];
    }

    const mp3File = form.get("mp3File");
    const wavFile = form.get("wavFile");
    const stemsFile = form.get("stemsFile");
    const artworkFile = form.get("artworkFile");

    const publicLicenseState = String(form.get("publicLicenseState") ?? "free_for_non_profit");
    const basicLicenseEnabled = parseBool(form.get("basicLicenseEnabled"));
    const premiumLicenseEnabled = parseBool(form.get("premiumLicenseEnabled"));
    const exclusiveLicenseEnabled = parseBool(form.get("exclusiveLicenseEnabled"));
    const exclusiveIncludesStems = parseBool(form.get("exclusiveIncludesStems"));
    const basicLicensePrice = parseOptionalFloat(form.get("basicLicensePrice"));
    const premiumLicensePrice = parseOptionalFloat(form.get("premiumLicensePrice"));
    const exclusiveLicensePrice = parseOptionalFloat(form.get("exclusiveLicensePrice"));

    const errors: string[] = [];
    if (!title) errors.push("Title is required");
    if (title.length > 0 && title.length < 3) errors.push("Title must be at least 3 characters");
    if (!description) errors.push("Description is required");
    if (description.length > 0 && description.length < 10) errors.push("Description must be at least 10 characters");
    if (bpm === null) errors.push("BPM is required");
    if (!key) errors.push("Key is required");
    let existingBeat: Record<string, unknown> | null = null;
    if (editId) {
      const { data, error } = await supabase
        .schema("public")
        .from("beats")
        .select("id, user_id, file_mp3_url, file_wav_url, stems_zip_url, album_url")
        .eq("id", editId)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return json({ error: "Beat not found or not editable." }, 404);
      }
      existingBeat = data as Record<string, unknown>;
    }

    const mp3Upload = mp3File instanceof File ? mp3File : null;
    if (!mp3Upload && !existingBeat?.file_mp3_url) errors.push("MP3 file is required");

    assertMaxFileSize(mp3Upload, 20, "MP3", errors);
    assertMaxFileSize(wavFile instanceof File ? wavFile : null, 100, "WAV", errors);
    assertMaxFileSize(stemsFile instanceof File ? stemsFile : null, 250, "Stems archive", errors);
    assertMaxFileSize(artworkFile instanceof File ? artworkFile : null, 5, "Artwork", errors);

    if (publicLicenseState === "license_required" && !basicLicenseEnabled && !premiumLicenseEnabled && !exclusiveLicenseEnabled) {
      errors.push("Enable at least one paid license tier for License Required beats");
    }
    if (basicLicenseEnabled && !validPrice(basicLicensePrice)) {
      errors.push("Basic License price must be between $0.99 and $9,999.99");
    }
    if (premiumLicenseEnabled && !validPrice(premiumLicensePrice)) {
      errors.push("Premium License price must be between $0.99 and $9,999.99");
    }
    if (exclusiveLicenseEnabled && !validPrice(exclusiveLicensePrice)) {
      errors.push("Exclusive License price must be between $0.99 and $9,999.99");
    }
    if ((premiumLicenseEnabled || exclusiveLicenseEnabled) && !(wavFile instanceof File) && !existingBeat?.file_wav_url) {
      errors.push("WAV file required for Premium or Exclusive tiers");
    }
    if (exclusiveLicenseEnabled && exclusiveIncludesStems && !(stemsFile instanceof File) && !existingBeat?.stems_zip_url) {
      errors.push("Stems ZIP required when Exclusive includes stems");
    }
    const stripeStatus = await fetchStripeConnectStatus(supabase, user.id);
    const requiresPaidLicenses = basicLicenseEnabled || premiumLicenseEnabled || exclusiveLicenseEnabled;
    if (requiresPaidLicenses && !stripeStatus.connected) {
      errors.push("Connect Stripe to sell paid licenses");
    }
    if (errors.length) return json({ error: errors.join("\n") }, 400);

    const beatId = editId || crypto.randomUUID();
    const userId = user.id;

    const mp3URL = mp3Upload instanceof File
      ? await uploadToBunny(mp3Upload as File, `beats/mp3/${beatId}.mp3`, "audio/mpeg")
      : String(existingBeat?.file_mp3_url || "");
    const wavURL = wavFile instanceof File
      ? await uploadToBunny(wavFile, `beats/wav/${beatId}.wav`, "audio/wav")
      : existingBeat?.file_wav_url ?? null;
    const stemsURL = stemsFile instanceof File
      ? await uploadToBunny(stemsFile, `beats/stems/${beatId}_stems.zip`, "application/zip")
      : existingBeat?.stems_zip_url ?? null;
    const artworkSuffix = artworkFile instanceof File ? `-${Date.now()}` : "";
    const artworkURL = artworkFile instanceof File
      ? await uploadToBunny(artworkFile, `artwork/beats/${beatId}${artworkSuffix}.jpg`, "image/jpeg")
      : existingBeat?.album_url ?? null;

    const payload: Record<string, unknown> = {
      title,
      file_mp3_url: mp3URL,
      is_exclusive: exclusiveLicenseEnabled,
      is_premium: premiumLicenseEnabled,
      description,
      public_license_state: publicLicenseState,
      basic_license_enabled: basicLicenseEnabled,
      premium_license_enabled: premiumLicenseEnabled,
      exclusive_license_enabled: exclusiveLicenseEnabled,
      exclusive_includes_stems: exclusiveIncludesStems,
    };

    if (!editId) {
      payload.id = beatId;
      payload.user_id = userId;
      payload.likes = 0;
      payload.comments = 0;
      payload.shares = 0;
      payload.upload_date = new Date().toISOString();
      payload.copyright_status = "pending";
      payload.copyright_checked = false;
      payload.drm_protected = true;
      payload.protection_level = "basic";
    }

    if (artworkURL) payload.album_url = artworkURL;
    if (bpm !== null) payload.bpm = bpm;
    if (key) payload.key = key;
    if (tags.length) payload.tags = tags;
    if (basicLicenseEnabled && basicLicensePrice !== null) payload.price = basicLicensePrice;
    if (wavURL) payload.file_wav_url = wavURL;
    if (stemsURL) payload.stems_zip_url = stemsURL;
    if (basicLicensePrice !== null) payload.basic_license_price = basicLicensePrice;
    if (premiumLicensePrice !== null) payload.premium_license_price = premiumLicensePrice;
    if (exclusiveLicensePrice !== null) payload.exclusive_license_price = exclusiveLicensePrice;
    payload.additional_producers = producerCredits;

    const withoutProducerCredits = () => {
      const clone = { ...payload };
      delete clone.additional_producers;
      return clone;
    };

    const shouldRetryWithoutProducerCredits = (message: string) =>
      message.toLowerCase().includes("additional_producers");

    if (editId) {
      let { error: updateError } = await supabase.schema("public").from("beats").update(payload).eq("id", beatId).eq("user_id", userId);
      if (updateError && shouldRetryWithoutProducerCredits(updateError.message || "")) {
        ({ error: updateError } = await supabase.schema("public").from("beats").update(withoutProducerCredits()).eq("id", beatId).eq("user_id", userId));
      }
      if (updateError) return json({ error: updateError.message }, 400);
    } else {
      let { error: insertError } = await supabase.schema("public").from("beats").insert(payload);
      if (insertError && shouldRetryWithoutProducerCredits(insertError.message || "")) {
        ({ error: insertError } = await supabase.schema("public").from("beats").insert(withoutProducerCredits()));
      }
      if (insertError) return json({ error: insertError.message }, 400);

      try {
        await supabase.rpc("increment_user_beats", { user_id: userId });
      } catch {
        // Keep the upload successful even if the profile counter update fails.
      }
    }
    return json({ beatId, updated: Boolean(editId) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Upload failed" }, 500);
  }
});
