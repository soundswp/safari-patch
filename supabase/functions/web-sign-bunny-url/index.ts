
import { corsHeaders } from "../_shared/cors.ts";
import {
  generateSignedBunnyURL,
  isAllowedPublicBunnyPath,
  json,
  normalizeBunnyPath,
} from "../_shared/upload.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await request.json().catch(() => ({}));
    const url = String(payload?.url ?? payload?.path ?? "").trim();
    const expiresIn = Number.isFinite(Number(payload?.expiresIn)) ? Number(payload.expiresIn) : 86400;
    const path = normalizeBunnyPath(url);

    if (!path) {
      return json({ error: "Missing Bunny URL or path" }, 400);
    }

    if (!isAllowedPublicBunnyPath(path)) {
      return json({ error: "This Bunny path is not allowed for public signing" }, 403);
    }

    const signedUrl = await generateSignedBunnyURL(path, expiresIn);
    return json({ signedUrl, path });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Signing failed" }, 500);
  }
});
