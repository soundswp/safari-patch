import { corsHeaders } from "../_shared/cors.ts";
import { createAuthedClient, createServiceClient, json } from "../_shared/upload.ts";
import {
  getActiveStripeEnvironment,
  stripePaymentUpsertForEnvironment,
  stripeRequest,
  stripeStatusForEnvironment,
  type StripeEnvironment,
} from "../_shared/stripe.ts";

function routePath(request: Request) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const functionIndex = segments.indexOf("stripe-connect");
  if (functionIndex === -1) return "/";
  return `/${segments.slice(functionIndex + 1).join("/")}`.replace(/\/+$/, "") || "/";
}

function stripeSettingsReturnURL(path: string) {
  return `https://soundswipe.us/${path}`;
}

function purchasesEnvironmentColumnMissing(error: unknown) {
  const message = String((error as { message?: string; details?: string })?.message || (error as { details?: string })?.details || "").toLowerCase();
  return message.includes("environment") && message.includes("purchases");
}

function activeStripeStatusFromRow(row: Record<string, unknown> | null | undefined, environment: StripeEnvironment) {
  return stripeStatusForEnvironment(row, environment);
}

async function fetchOrCreateConnectedAccount(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  environment: StripeEnvironment,
) {
  const { data: paymentRow } = await serviceSupabase
    .from("producer_payments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const existingStatus = activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, environment);
  if (existingStatus.stripe_connect_id) {
    return { paymentRow, accountId: String(existingStatus.stripe_connect_id) };
  }

  const { data: profileRow } = await serviceSupabase
    .from("profiles")
    .select("email, display_name, username")
    .eq("id", userId)
    .maybeSingle();

  const account = await stripeRequest("/accounts", {
    type: "express",
    email: String(profileRow?.email ?? ""),
    "metadata[user_id]": userId,
    "metadata[username]": String(profileRow?.username ?? ""),
    "metadata[stripe_environment]": environment,
    "business_profile[name]": String(profileRow?.display_name || profileRow?.username || "SoundSwipe Producer"),
  }, { environment });

  const now = new Date().toISOString();
  const upsertPayload = {
    user_id: userId,
    ...stripePaymentUpsertForEnvironment(environment, {
      stripe_connect_id: String(account.id || ""),
      onboarding_complete: false,
      payout_enabled: false,
      charges_enabled: false,
      details_submitted: false,
    }),
    updated_at: now,
  };

  await serviceSupabase.from("producer_payments").upsert(upsertPayload, { onConflict: "user_id" });
  return { paymentRow: upsertPayload, accountId: account.id };
}

async function syncStripeAccountStatus(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  accountId: string,
  environment: StripeEnvironment,
) {
  const account = await stripeRequest(`/accounts/${accountId}`, {}, { method: "GET", environment });
  const status = {
    user_id: userId,
    ...stripePaymentUpsertForEnvironment(environment, {
      stripe_connect_id: accountId,
      onboarding_complete: Boolean(account.details_submitted && account.charges_enabled),
      payout_enabled: Boolean(account.payouts_enabled),
      charges_enabled: Boolean(account.charges_enabled),
      details_submitted: Boolean(account.details_submitted),
    }),
    country: account.country || "US",
    currency: account.default_currency || "usd",
    updated_at: new Date().toISOString(),
  };

  await serviceSupabase.from("producer_payments").upsert(status, { onConflict: "user_id" });
  return status;
}

async function fetchRecentSales(serviceSupabase: ReturnType<typeof createServiceClient>, userId: string, environment: StripeEnvironment) {
  const { data: beatRows } = await serviceSupabase
    .from("beats")
    .select("id")
    .eq("user_id", userId)
    .limit(1000);

  const beatIds = (beatRows || []).map((row) => row.id).filter(Boolean);
  if (!beatIds.length) return [];

  let { data: purchases, error } = await serviceSupabase
    .from("purchases")
    .select("id, beats_id, license_type, amount, created_at, status, beat_title, producer_name")
    .in("beats_id", beatIds)
    .eq("environment", environment)
    .order("created_at", { ascending: false })
    .limit(10);

  if (purchasesEnvironmentColumnMissing(error)) {
    ({ data: purchases, error } = await serviceSupabase
      .from("purchases")
      .select("id, beats_id, license_type, amount, created_at, status, beat_title, producer_name")
      .in("beats_id", beatIds)
      .order("created_at", { ascending: false })
      .limit(10));
  }

  if (error) {
    throw error;
  }

  return purchases || [];
}

async function fetchSellerDashboard(serviceSupabase: ReturnType<typeof createServiceClient>, userId: string, environment: StripeEnvironment) {
  let { data: purchases, error } = await serviceSupabase
    .from("purchases")
    .select("id, beats_id, license_type, amount, created_at, status, beat_title, producer_name, user_id, stripe_checkout_session_id, stripe_payment_intent_id, buyer_email")
    .eq("seller_user_id", userId)
    .eq("status", "completed")
    .eq("environment", environment)
    .order("created_at", { ascending: false })
    .limit(500);

  if (purchasesEnvironmentColumnMissing(error)) {
    ({ data: purchases, error } = await serviceSupabase
      .from("purchases")
      .select("id, beats_id, license_type, amount, created_at, status, beat_title, producer_name, user_id, stripe_checkout_session_id, stripe_payment_intent_id, buyer_email")
      .eq("seller_user_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(500));
  }

  if (error) {
    throw error;
  }

  const rows = purchases || [];
  const buyerIds = Array.from(new Set(rows.map((row) => String(row.user_id || "")).filter(Boolean)));
  const { data: buyerProfiles } = buyerIds.length
    ? await serviceSupabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", buyerIds)
    : { data: [] as Array<Record<string, unknown>> };

  const buyerMap = new Map((buyerProfiles || []).map((profile) => [String(profile.id), profile]));
  const now = Date.now();
  const recentWindowMs = 30 * 24 * 60 * 60 * 1000;

  const sales = rows.map((sale) => {
    const buyerProfile = buyerMap.get(String(sale.user_id || ""));
    return {
      id: sale.id,
      date: sale.created_at,
      beatId: sale.beats_id,
      beatTitle: sale.beat_title || "Untitled Beat",
      buyerName: String(buyerProfile?.display_name || buyerProfile?.username || sale.buyer_email || "Unknown buyer"),
      buyerUsername: buyerProfile?.username ? `@${buyerProfile.username}` : "",
      licenseTier: String(sale.license_type || "basic"),
      orderReference: String(sale.stripe_checkout_session_id || sale.stripe_payment_intent_id || sale.id || ""),
      amount: Number(sale.amount) || 0,
    };
  });

  const beatBreakdownMap = new Map<string, { beatId: string; beatTitle: string; salesCount: number; revenue: number }>();
  sales.forEach((sale) => {
    const key = String(sale.beatId || sale.beatTitle || sale.id);
    const existing = beatBreakdownMap.get(key) || {
      beatId: String(sale.beatId || ""),
      beatTitle: sale.beatTitle,
      salesCount: 0,
      revenue: 0,
    };
    existing.salesCount += 1;
    existing.revenue += sale.amount;
    beatBreakdownMap.set(key, existing);
  });

  const beatBreakdown = Array.from(beatBreakdownMap.values())
    .sort((a, b) => (b.revenue - a.revenue) || (b.salesCount - a.salesCount) || a.beatTitle.localeCompare(b.beatTitle));

  const distinctBeatsSold = new Set(sales.map((sale) => String(sale.beatId || sale.beatTitle || sale.id)).filter(Boolean)).size;
  const recentSalesCount = sales.filter((sale) => {
    const timestamp = new Date(String(sale.date || "")).getTime();
    return Number.isFinite(timestamp) && (now - timestamp) <= recentWindowMs;
  }).length;

  return {
    summary: {
      totalSales: sales.length,
      totalRevenue: sales.reduce((sum, sale) => sum + sale.amount, 0),
      totalBeatsSold: distinctBeatsSold,
      recentSalesCount,
    },
    sales,
    beatBreakdown,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user } = await createAuthedClient(request);
    const serviceSupabase = createServiceClient();
    const route = routePath(request);
    const stripeEnvironment = getActiveStripeEnvironment();

    if (route === "/create-account-link") {
      const body = await request.json().catch(() => ({}));
      const { accountId } = await fetchOrCreateConnectedAccount(serviceSupabase, user.id, stripeEnvironment);
      const accountLink = await stripeRequest("/account_links", {
        account: accountId,
        type: "account_onboarding",
        refresh_url: String(body.refresh_url || stripeSettingsReturnURL("settings.html?stripe=refresh")),
        return_url: String(body.return_url || stripeSettingsReturnURL("settings.html?stripe=return")),
      }, { environment: stripeEnvironment });

      const status = await syncStripeAccountStatus(serviceSupabase, user.id, accountId, stripeEnvironment);
      return json({ url: accountLink.url, accountId, status, environment: stripeEnvironment });
    }

    if (route === "/create-login-link") {
      const { data: paymentRow } = await serviceSupabase
        .from("producer_payments")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      const status = activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, stripeEnvironment);

      if (!status.stripe_connect_id) {
        return json({ error: "No Stripe account connected" }, 400);
      }

      try {
        const loginLink = await stripeRequest(`/accounts/${status.stripe_connect_id}/login_links`, {}, { environment: stripeEnvironment });
        return json({ url: loginLink.url, destination: "dashboard", environment: stripeEnvironment });
      } catch (error) {
        console.error("Stripe login link failed", error);
        const accountLink = await stripeRequest("/account_links", {
          account: String(status.stripe_connect_id),
          type: "account_onboarding",
          refresh_url: stripeSettingsReturnURL("seller-dashboard.html?stripe=refresh"),
          return_url: stripeSettingsReturnURL("seller-dashboard.html?stripe=return"),
        }, { environment: stripeEnvironment });

        return json({
          url: accountLink.url,
          destination: "onboarding",
          message: "Stripe still needs a little more setup before the dashboard is available.",
          environment: stripeEnvironment,
        });
      }
    }

    if (route === "/get-balance") {
      const { data: paymentRow } = await serviceSupabase
        .from("producer_payments")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      const status = activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, stripeEnvironment);

      if (!status.stripe_connect_id) {
        return json({ error: "No Stripe account connected" }, 400);
      }

      const balance = await stripeRequest("/balance", {}, {
        method: "GET",
        account: String(status.stripe_connect_id),
        environment: stripeEnvironment,
      });

      return json({ ...balance, environment: stripeEnvironment });
    }

    if (route === "/status" || route === "/") {
      const { data: paymentRow } = await serviceSupabase
        .from("producer_payments")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      let status = activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, stripeEnvironment);
      if (status.stripe_connect_id) {
        status = await syncStripeAccountStatus(serviceSupabase, user.id, String(status.stripe_connect_id), stripeEnvironment);
      }

      const recentSales = await fetchRecentSales(serviceSupabase, user.id, stripeEnvironment);
      return json({
        connected: Boolean(status?.stripe_connect_id),
        payoutReady: Boolean(status?.payout_enabled && status?.onboarding_complete),
        status,
        environment: stripeEnvironment,
        environments: {
          test: activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, "test"),
          live: activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, "live"),
        },
        recentSales,
      });
    }

    if (route === "/seller-dashboard") {
      const { data: paymentRow } = await serviceSupabase
        .from("producer_payments")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      let status = activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, stripeEnvironment);
      if (status.stripe_connect_id) {
        status = await syncStripeAccountStatus(serviceSupabase, user.id, String(status.stripe_connect_id), stripeEnvironment);
      }

      const dashboard = await fetchSellerDashboard(serviceSupabase, user.id, stripeEnvironment);
      return json({
        connected: Boolean(status?.stripe_connect_id),
        payoutReady: Boolean(status?.payout_enabled && status?.onboarding_complete),
        status,
        environment: stripeEnvironment,
        environments: {
          test: activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, "test"),
          live: activeStripeStatusFromRow(paymentRow as Record<string, unknown> | null, "live"),
        },
        ...dashboard,
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Stripe Connect request failed" }, 500);
  }
});
