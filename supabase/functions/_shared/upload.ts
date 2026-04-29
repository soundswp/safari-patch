import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";
import { getActiveStripeEnvironment, stripeStatusForEnvironment } from "./stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUNNY_KEY = Deno.env.get("BUNNY_NET_ACCESS_KEY") ?? "";
const BUNNY_ZONE = Deno.env.get("BUNNY_NET_STORAGE_ZONE") ?? "";
const RAW_BUNNY_PULL_ZONE = Deno.env.get("BUNNY_NET_PULL_ZONE") ?? "https://soundswipe.b-cdn.net/";
const BUNNY_PULL_ZONE = RAW_BUNNY_PULL_ZONE.endsWith("/") ? RAW_BUNNY_PULL_ZONE : `${RAW_BUNNY_PULL_ZONE}/`;
const BUNNY_TOKEN_KEY = Deno.env.get("BUNNY_NET_TOKEN_KEY") ?? "";

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function parseBool(value: FormDataEntryValue | null) {
  return String(value ?? "false") === "true";
}

export function parseOptionalBool(value: FormDataEntryValue | null) {
  if (value === null) return null;
  return parseBool(value);
}

export function parseOptionalFloat(value: FormDataEntryValue | null) {
  const numeric = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseOptionalInt(value: FormDataEntryValue | null) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseCSVList(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ensureEnv() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase environment is not configured");
  }

  if (!BUNNY_KEY || !BUNNY_ZONE || !BUNNY_PULL_ZONE) {
    throw new Error("BunnyNet environment is not configured");
  }
}

export function ensureServiceRoleEnv() {
  ensureEnv();
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service role environment is not configured");
  }
}

export async function createAuthedClient(request: Request): Promise<{ supabase: SupabaseClient; user: User }> {
  ensureEnv();
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Missing authorization header");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Unauthorized");
  }

  return { supabase, user: data.user };
}

export function createServiceClient() {
  ensureServiceRoleEnv();
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}


export function normalizeBunnyPath(urlOrPath: string) {
  const value = String(urlOrPath || "").trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    return parsed.pathname || "";
  } catch {
    return value.startsWith("/") ? value : `/${value}`;
  }
}

export function isAllowedPublicBunnyPath(path: string) {
  const publicPatterns = [
    "/profiles/avatars/",
    "/profiles/banners/",
    "/artwork/",
    "/beats/mp3/",
    "/users/",
    "/playlists/covers/",
    "/community/covers/",
  ];

  return publicPatterns.some((pattern) => path.includes(pattern));
}

export async function generateSignedBunnyURL(urlOrPath: string, expiresIn = 86400) {
  ensureEnv();
  if (!BUNNY_TOKEN_KEY) {
    throw new Error("BunnyNet token key is not configured");
  }

  const urlPath = normalizeBunnyPath(urlOrPath);
  if (!urlPath) {
    throw new Error("Bunny path is invalid");
  }

  const expirationTime = Math.floor(Date.now() / 1000) + Math.floor(expiresIn);
  const hashableBase = `${BUNNY_TOKEN_KEY}${urlPath}${expirationTime}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashableBase));
  let token = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
  token = token.replace(/\n/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const baseURL = BUNNY_PULL_ZONE.endsWith("/") ? BUNNY_PULL_ZONE.slice(0, -1) : BUNNY_PULL_ZONE;
  return `${baseURL}${urlPath}?token=${token}&expires=${expirationTime}`;
}

export async function uploadToBunny(file: File, path: string, fallbackContentType: string) {
  ensureEnv();
  const endpoint = `https://ny.storage.bunnycdn.com/${BUNNY_ZONE}/${path}`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      AccessKey: BUNNY_KEY,
      "Content-Type": file.type || fallbackContentType,
    },
    body: file.stream(),
  });

  if (!response.ok) {
    throw new Error(`Bunny upload failed (${response.status})`);
  }

  return `${BUNNY_PULL_ZONE}${path}`;
}

export async function fetchFromBunnyStorage(urlOrPath: string) {
  ensureEnv();
  const normalizedPath = normalizeBunnyPath(urlOrPath).replace(/^\/+/, "");
  if (!normalizedPath) {
    throw new Error("Bunny path is invalid");
  }

  const endpoint = `https://ny.storage.bunnycdn.com/${BUNNY_ZONE}/${normalizedPath}`;
  return fetch(endpoint, {
    method: "GET",
    headers: {
      AccessKey: BUNNY_KEY,
    },
  });
}

export function assertFilePresent(file: FormDataEntryValue | null, label: string, errors: string[]) {
  if (!(file instanceof File)) {
    errors.push(`${label} is required`);
    return null;
  }
  return file;
}

export function assertMaxFileSize(file: File | null, maxSizeMB: number, label: string, errors: string[]) {
  if (!file) return;
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    errors.push(`${label} must be ${maxSizeMB}MB or smaller`);
  }
}

export function validPrice(value: number | null) {
  return value !== null && value >= 0.99 && value <= 9999.99;
}

export async function fetchStripeConnectStatus(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("producer_payments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { connected: false };
  }

  const status = stripeStatusForEnvironment(data as Record<string, unknown>, getActiveStripeEnvironment());
  return {
    connected: Boolean(status.stripe_connect_id && status.payout_enabled && status.onboarding_complete),
  };
}

export type SongProducerTagPayload = {
  user_id: string | null;
  display_name: string;
  username: string | null;
};

export function normalizeProducerTags(value: FormDataEntryValue | null) {
  let parsed: unknown = [];

  try {
    parsed = JSON.parse(String(value ?? "[]"));
  } catch {
    throw new Error("Producer tags are not valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Producer tags must be an array");
  }

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const displayName = String(candidate.display_name ?? candidate.displayName ?? "").trim();
      const username = String(candidate.username ?? "").trim();
      const userId = String(candidate.user_id ?? candidate.userId ?? "").trim();

      if (!displayName && !username) {
        return null;
      }

      return {
        user_id: userId || null,
        display_name: displayName || username,
        username: username || null,
      } satisfies SongProducerTagPayload;
    })
    .filter((entry): entry is SongProducerTagPayload => Boolean(entry));
}
