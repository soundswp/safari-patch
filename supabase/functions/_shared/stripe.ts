export type StripeEnvironment = "test" | "live";

type StripeRequestOptions = {
  method?: "GET" | "POST";
  account?: string | null;
  environment?: StripeEnvironment;
};

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const PLATFORM_FEE_BPS = Number(Deno.env.get("SOUNDSWIPE_PLATFORM_FEE_BPS") ?? "1000");

export const TIER_DEFINITIONS = {
  basic: {
    key: "basic",
    label: "Basic License",
    description: "MP3 license for smaller independent releases.",
    bullets: [
      "MP3",
      "up to 5,000 sales/downloads",
      "up to 100,000 streams",
      "1 music video",
      "non-exclusive",
    ],
    entitlements: {
      files: ["mp3"],
      salesLimit: 5000,
      streamLimit: 100000,
      videoLimit: 1,
      exclusive: false,
    },
  },
  premium: {
    key: "premium",
    label: "Premium License",
    description: "MP3 + WAV license for larger releases and cleaner delivery.",
    bullets: [
      "MP3 + WAV",
      "up to 20,000 sales/downloads",
      "up to 500,000 streams",
      "1 music video",
      "non-exclusive",
    ],
    entitlements: {
      files: ["mp3", "wav"],
      salesLimit: 20000,
      streamLimit: 500000,
      videoLimit: 1,
      exclusive: false,
    },
  },
  exclusive: {
    key: "exclusive",
    label: "Exclusive License",
    description: "Full rights package with stems and exclusive removal from sale.",
    bullets: [
      "MP3 + WAV + stems",
      "unlimited sales/downloads",
      "unlimited streams",
      "unlimited videos",
      "exclusive / beat removed from sale",
    ],
    entitlements: {
      files: ["mp3", "wav", "stems"],
      salesLimit: null,
      streamLimit: null,
      videoLimit: null,
      exclusive: true,
    },
  },
} as const;

export type TierKey = keyof typeof TIER_DEFINITIONS;

function stripeSecretKeyFromEnvironment(environment: StripeEnvironment) {
  if (environment === "live") {
    return Deno.env.get("STRIPE_SECRET_KEY_LIVE") || Deno.env.get("STRIPE_SECRET_KEY") || "";
  }
  return Deno.env.get("STRIPE_SECRET_KEY_TEST") || Deno.env.get("STRIPE_SECRET_KEY") || "";
}

function stripeWebhookSecretFromEnvironment(environment: StripeEnvironment) {
  if (environment === "live") {
    return Deno.env.get("STRIPE_WEBHOOK_SECRET_LIVE") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  }
  return Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
}

function inferStripeEnvironmentFromKey(secretKey: string): StripeEnvironment {
  return secretKey.startsWith("sk_live_") ? "live" : "test";
}

export function getActiveStripeEnvironment(): StripeEnvironment {
  const configured = String(Deno.env.get("STRIPE_ACTIVE_MODE") || "").trim().toLowerCase();
  if (configured === "live" || configured === "test") {
    return configured;
  }

  const explicitLive = Deno.env.get("STRIPE_SECRET_KEY_LIVE") || "";
  const explicitTest = Deno.env.get("STRIPE_SECRET_KEY_TEST") || "";
  if (explicitLive && !explicitTest) return "live";
  if (explicitTest && !explicitLive) return "test";

  const fallback = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (fallback) {
    return inferStripeEnvironmentFromKey(fallback);
  }

  return "test";
}

export function ensureStripeEnv(environment: StripeEnvironment = getActiveStripeEnvironment()) {
  if (!stripeSecretKeyFromEnvironment(environment)) {
    throw new Error(`Stripe ${environment} environment is not configured`);
  }
}

function encodeFormBody(body: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(body).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  return params;
}

export async function stripeRequest(
  path: string,
  body: Record<string, string | number | boolean | null | undefined> = {},
  options: StripeRequestOptions = {},
) {
  const environment = options.environment ?? getActiveStripeEnvironment();
  const secretKey = stripeSecretKeyFromEnvironment(environment);
  ensureStripeEnv(environment);
  const method = options.method ?? "POST";
  const url = `${STRIPE_API_BASE}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(options.account ? { "Stripe-Account": options.account } : {}),
    },
    body: method === "GET" ? undefined : encodeFormBody(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

export function tierDetailsForBeat(beat: Record<string, unknown>, key: string) {
  const normalizedKey = String(key || "").toLowerCase() as TierKey;
  const definition = TIER_DEFINITIONS[normalizedKey];
  if (!definition) return null;

  const isEnabled = normalizedKey === "basic"
    ? beat.basic_license_enabled !== false
    : Boolean(beat[`${normalizedKey}_license_enabled`]);
  const price = Number(beat[`${normalizedKey}_license_price`] ?? (normalizedKey === "basic" ? beat.price : 0));

  if (!isEnabled || !Number.isFinite(price) || price < 0.99) {
    return null;
  }

  const entitlements = {
    ...definition.entitlements,
    files: definition.entitlements.files.filter((file) => file !== "stems" || Boolean(beat.exclusive_includes_stems)),
  };

  return {
    ...definition,
    price,
    unitAmount: Math.round(price * 100),
    entitlements,
  };
}

export function computePlatformFee(unitAmount: number) {
  return Math.max(0, Math.round(unitAmount * (PLATFORM_FEE_BPS / 10000)));
}

type StripeWebhookVerificationResult = {
  event: Record<string, unknown>;
  environment: StripeEnvironment;
};

function buildStripeEnvironmentCandidates(): StripeEnvironment[] {
  const active = getActiveStripeEnvironment();
  const ordered: StripeEnvironment[] = [active, active === "test" ? "live" : "test"];
  return ordered.filter((value, index) => ordered.indexOf(value) === index);
}

async function verifyStripeSignature(rawBody: string, signature: string, webhookSecret: string) {
  const elements = Object.fromEntries(signature.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = elements.t;
  const expected = elements.v1;
  if (!timestamp || !expected) {
    throw new Error("Stripe signature is invalid");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const actual = Array.from(new Uint8Array(signatureBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  if (actual !== expected) {
    throw new Error("Stripe signature verification failed");
  }
}

export async function verifyStripeWebhook(request: Request): Promise<StripeWebhookVerificationResult> {
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  if (!signature) {
    throw new Error("Missing Stripe signature");
  }

  let lastError: Error | null = null;

  for (const environment of buildStripeEnvironmentCandidates()) {
    const webhookSecret = stripeWebhookSecretFromEnvironment(environment);
    if (!webhookSecret) continue;

    try {
      await verifyStripeSignature(rawBody, signature, webhookSecret);
      return {
        event: JSON.parse(rawBody),
        environment,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) throw lastError;
  throw new Error("Stripe webhook secret is not configured");
}

export function stripeEnvironmentColumnSet(environment: StripeEnvironment) {
  return {
    connectId: `stripe_connect_id_${environment}`,
    onboardingComplete: `onboarding_complete_${environment}`,
    payoutEnabled: `payout_enabled_${environment}`,
    chargesEnabled: `charges_enabled_${environment}`,
    detailsSubmitted: `details_submitted_${environment}`,
  } as const;
}

export function stripeStatusForEnvironment(row: Record<string, unknown> | null | undefined, environment: StripeEnvironment) {
  const columns = stripeEnvironmentColumnSet(environment);
  const hasEnvironmentColumns = Boolean(
    row
    && (
      Object.prototype.hasOwnProperty.call(row, columns.connectId)
      || Object.prototype.hasOwnProperty.call(row, columns.onboardingComplete)
      || Object.prototype.hasOwnProperty.call(row, columns.payoutEnabled)
      || Object.prototype.hasOwnProperty.call(row, columns.chargesEnabled)
      || Object.prototype.hasOwnProperty.call(row, columns.detailsSubmitted)
    )
  );
  const allowLegacyFallback = !hasEnvironmentColumns && environment === "test";
  const connectId = String(row?.[columns.connectId] ?? (allowLegacyFallback ? row?.stripe_connect_id : "") ?? "").trim();
  return {
    stripe_connect_id: connectId,
    onboarding_complete: Boolean(row?.[columns.onboardingComplete] ?? (allowLegacyFallback ? row?.onboarding_complete : false)),
    payout_enabled: Boolean(row?.[columns.payoutEnabled] ?? (allowLegacyFallback ? row?.payout_enabled : false)),
    charges_enabled: Boolean(row?.[columns.chargesEnabled] ?? (allowLegacyFallback ? row?.charges_enabled : false)),
    details_submitted: Boolean(row?.[columns.detailsSubmitted] ?? (allowLegacyFallback ? row?.details_submitted : false)),
  };
}

export function stripePaymentUpsertForEnvironment(
  environment: StripeEnvironment,
  values: {
    stripe_connect_id?: string | null;
    onboarding_complete?: boolean;
    payout_enabled?: boolean;
    charges_enabled?: boolean;
    details_submitted?: boolean;
  },
) {
  const columns = stripeEnvironmentColumnSet(environment);
  const payload: Record<string, unknown> = {
    [columns.connectId]: values.stripe_connect_id ?? null,
    [columns.onboardingComplete]: values.onboarding_complete ?? false,
    [columns.payoutEnabled]: values.payout_enabled ?? false,
    [columns.chargesEnabled]: values.charges_enabled ?? false,
    [columns.detailsSubmitted]: values.details_submitted ?? false,
  };

  if (environment === getActiveStripeEnvironment()) {
    payload.stripe_connect_id = values.stripe_connect_id ?? null;
    payload.onboarding_complete = values.onboarding_complete ?? false;
    payload.payout_enabled = values.payout_enabled ?? false;
    payload.charges_enabled = values.charges_enabled ?? false;
    payload.details_submitted = values.details_submitted ?? false;
  }

  return payload;
}
