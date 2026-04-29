import { corsHeaders } from "../_shared/cors.ts";
import {
  createAuthedClient,
  createServiceClient,
  fetchFromBunnyStorage,
  json,
} from "../_shared/upload.ts";
import { getActiveStripeEnvironment } from "../_shared/stripe.ts";

const LICENSE_FILE_MAP: Record<string, string[]> = {
  basic: ["MP3"],
  premium: ["MP3", "WAV"],
  exclusive: ["MP3", "WAV", "STEMS"],
};

const FILE_COLUMN_MAP: Record<string, string> = {
  MP3: "file_mp3_url",
  WAV: "file_wav_url",
  STEMS: "stems_zip_url",
};

const FILE_EXTENSION_MAP: Record<string, string> = {
  MP3: "mp3",
  WAV: "wav",
  STEMS: "zip",
};

function slugify(value: string) {
  return String(value || "soundswipe-beat")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "soundswipe-beat";
}

function entitledFilesForPurchase(purchase: Record<string, unknown>) {
  const explicitFiles = Array.isArray(purchase.entitlement_files)
    ? purchase.entitlement_files
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
    : [];

  if (explicitFiles.length) {
    return explicitFiles;
  }

  const tier = String(purchase.license_type || "basic").trim().toLowerCase();
  return LICENSE_FILE_MAP[tier] || LICENSE_FILE_MAP.basic;
}

function purchasesEnvironmentColumnMissing(error: unknown) {
  const message = String((error as { message?: string; details?: string })?.message || (error as { details?: string })?.details || "").toLowerCase();
  return message.includes("environment") && message.includes("purchases");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { user } = await createAuthedClient(request);
    const serviceSupabase = createServiceClient();
    const stripeEnvironment = getActiveStripeEnvironment();
    const payload = await request.json().catch(() => ({}));

    const beatId = String(payload?.beat_id || "").trim();
    const fileType = String(payload?.file_type || "").trim().toUpperCase();

    if (!beatId || !fileType) {
      return json({ error: "Beat and file type are required." }, 400);
    }

    const beatColumn = FILE_COLUMN_MAP[fileType];
    if (!beatColumn) {
      return json({ error: "That licensed file type is not supported." }, 400);
    }

    let { data: purchase, error: purchaseError } = await serviceSupabase
      .from("purchases")
      .select("id, license_type, entitlement_files")
      .eq("user_id", user.id)
      .eq("content_type", "beat")
      .eq("beats_id", beatId)
      .eq("status", "completed")
      .eq("environment", stripeEnvironment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (purchasesEnvironmentColumnMissing(purchaseError)) {
      ({ data: purchase, error: purchaseError } = await serviceSupabase
        .from("purchases")
        .select("id, license_type, entitlement_files")
        .eq("user_id", user.id)
        .eq("content_type", "beat")
        .eq("beats_id", beatId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (purchaseError) {
      throw purchaseError;
    }

    if (!purchase?.id) {
      return json({ error: "You do not have a completed purchase for this beat." }, 403);
    }

    const entitledFiles = entitledFilesForPurchase(purchase as Record<string, unknown>);
    if (!entitledFiles.includes(fileType)) {
      return json({ error: "Your current license tier does not include that download." }, 403);
    }

    const { data: beat, error: beatError } = await serviceSupabase
      .from("beats")
      .select(`id, title, ${beatColumn}`)
      .eq("id", beatId)
      .limit(1)
      .maybeSingle();

    if (beatError) {
      throw beatError;
    }

    const sourceURL = String(beat?.[beatColumn] || "").trim();
    if (!sourceURL) {
      return json({ error: "That licensed file is not available for this beat yet." }, 404);
    }

    const storageResponse = await fetchFromBunnyStorage(sourceURL);
    if (!storageResponse.ok || !storageResponse.body) {
      return json({ error: `Licensed file fetch failed (${storageResponse.status})` }, 502);
    }

    const extension = FILE_EXTENSION_MAP[fileType] || "bin";
    const filename = `${slugify(String(beat?.title || "soundswipe-beat"))}-${fileType.toLowerCase()}.${extension}`;
    const contentType = storageResponse.headers.get("content-type")
      || (fileType === "STEMS" ? "application/zip" : `audio/${extension}`);

    return new Response(storageResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Download request failed" }, 500);
  }
});
