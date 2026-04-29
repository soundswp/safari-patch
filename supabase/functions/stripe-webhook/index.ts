import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, json } from "../_shared/upload.ts";
import { sendProducerSaleNotificationEmail, sendPurchaseConfirmationEmail } from "../_shared/email.ts";
import {
  stripePaymentUpsertForEnvironment,
  type StripeEnvironment,
  verifyStripeWebhook,
} from "../_shared/stripe.ts";

function purchasesEnvironmentColumnMissing(error: unknown) {
  const message = String((error as { message?: string; details?: string })?.message || (error as { details?: string })?.details || "").toLowerCase();
  return message.includes("environment") && message.includes("purchases");
}

async function syncConnectedAccount(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  account: Record<string, unknown>,
  environment: StripeEnvironment,
) {
  const metadata = (account.metadata || {}) as Record<string, string>;
  const userId = String(metadata.user_id || "").trim();
  if (!userId) return;

  await serviceSupabase.from("producer_payments").upsert({
    user_id: userId,
    ...stripePaymentUpsertForEnvironment(environment, {
      stripe_connect_id: String(account.id || ""),
      onboarding_complete: Boolean(account.details_submitted && account.charges_enabled),
      payout_enabled: Boolean(account.payouts_enabled),
      charges_enabled: Boolean(account.charges_enabled),
      details_submitted: Boolean(account.details_submitted),
    }),
    country: String(account.country || "US"),
    currency: String(account.default_currency || "usd"),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
}

async function finalizeBeatPurchase(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  session: Record<string, unknown>,
  environment: StripeEnvironment,
) {
  if (String(session.payment_status || "") !== "paid") {
    return;
  }

  const metadata = (session.metadata || {}) as Record<string, string>;
  const customerDetails = (session.customer_details || {}) as Record<string, unknown>;
  const beatId = String(metadata.beat_id || "").trim();
  const buyerUserId = String(metadata.buyer_user_id || "").trim();
  const tier = String(metadata.tier || "").trim().toLowerCase();
  const sessionId = String(session.id || "").trim();
  const purchaseEnvironment = String(metadata.stripe_environment || environment).trim().toLowerCase() === "live" ? "live" : "test";

  if (!beatId || !buyerUserId || !tier || !sessionId) {
    throw new Error("Stripe checkout metadata is incomplete");
  }

  let { data: existingPurchase, error: existingPurchaseError } = await serviceSupabase
    .from("purchases")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .eq("environment", purchaseEnvironment)
    .limit(1)
    .maybeSingle();

  if (purchasesEnvironmentColumnMissing(existingPurchaseError)) {
    ({ data: existingPurchase, error: existingPurchaseError } = await serviceSupabase
      .from("purchases")
      .select("id")
      .eq("stripe_checkout_session_id", sessionId)
      .limit(1)
      .maybeSingle());
  }
  if (existingPurchaseError) {
    throw existingPurchaseError;
  }

  if (existingPurchase?.id) {
    return;
  }

  const { data: beat } = await serviceSupabase
    .from("beats")
    .select("id, title, user_id, file_mp3_url, file_wav_url, stems_zip_url, profiles!beats_user_id_fkey(email, display_name, username)")
    .eq("id", beatId)
    .maybeSingle();

  if (!beat) {
    throw new Error("Purchased beat no longer exists");
  }

  const { data: buyerProfile } = await serviceSupabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", buyerUserId)
    .maybeSingle();

  const entitlementFiles = String(metadata.entitlement_files || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const producerName = beat.profiles?.display_name || beat.profiles?.username || String(metadata.producer_name || "SoundSwipe Producer");
  const producerEmail = String(beat.profiles?.email || "").trim();
  const beatTitle = beat.title || String(metadata.beat_title || "Untitled Beat");
  const buyerEmail = String(customerDetails.email || session.customer_email || "").trim();
  const amount = Number(session.amount_total || 0) / 100;
  const saleDate = new Date().toISOString();

  const purchasePayload = {
    id: crypto.randomUUID(),
    user_id: buyerUserId,
    beats_id: beatId,
    content_type: "beat",
    license_type: tier,
    amount,
    status: "completed",
    seller_user_id: String(beat.user_id),
    seller_stripe_account_id: String(metadata.seller_connect_id || ""),
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: String(session.payment_intent || ""),
    environment: purchaseEnvironment,
    is_test: purchaseEnvironment === "test",
    product_type: "beat_license",
    entitlement_files: entitlementFiles,
    entitlement_payload: {
      files: entitlementFiles,
      tier,
      beat_title: beatTitle,
    },
    buyer_email: buyerEmail,
    beat_title: beatTitle,
    producer_name: producerName,
    completed_at: saleDate,
    created_at: saleDate,
  };

  let { error: insertError } = await serviceSupabase.from("purchases").insert(purchasePayload);
  if (purchasesEnvironmentColumnMissing(insertError)) {
    const legacyPayload = { ...purchasePayload };
    delete legacyPayload.environment;
    delete legacyPayload.is_test;
    ({ error: insertError } = await serviceSupabase.from("purchases").insert(legacyPayload));
  }
  if (insertError) {
    throw insertError;
  }

  if (tier === "exclusive" && purchaseEnvironment === "live") {
    await serviceSupabase
      .from("beats")
      .update({
        basic_license_enabled: false,
        premium_license_enabled: false,
        exclusive_license_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", beatId);
  }

  const emailResult = await sendPurchaseConfirmationEmail({
    to: buyerEmail,
    beatTitle,
    tierLabel: String(metadata.tier_label || tier),
    producerName,
    buyerName: String(buyerProfile?.display_name || buyerProfile?.username || "there"),
    orderReference: sessionId,
    unlockedFiles: entitlementFiles,
    purchasedBeatsURL: "https://soundswipe.us/purchased-beats.html",
  });

  const producerEmailResult = producerEmail
    ? await sendProducerSaleNotificationEmail({
      to: producerEmail,
      producerName,
      buyerName: String(buyerProfile?.display_name || buyerProfile?.username || buyerEmail || "A buyer"),
      beatTitle,
      orderReference: sessionId,
      tierLabel: String(metadata.tier_label || tier),
      saleDate,
      saleAmount: amount,
    })
    : { sent: false, reason: "Producer email missing" };

  await serviceSupabase
    .from("purchases")
    .update({
      email_sent_at: emailResult.sent ? new Date().toISOString() : null,
      email_error: [emailResult.sent ? "" : String(emailResult.reason || ""), producerEmailResult.sent ? "" : String(producerEmailResult.reason || "")]
        .filter(Boolean)
        .join(" | ") || null,
    })
    .eq("stripe_checkout_session_id", sessionId);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { event, environment } = await verifyStripeWebhook(request);
    const serviceSupabase = createServiceClient();

    switch (event.type) {
      case "account.updated":
        await syncConnectedAccount(serviceSupabase, event.data?.object || {}, environment);
        break;
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await finalizeBeatPurchase(serviceSupabase, event.data?.object || {}, environment);
        break;
      default:
        break;
    }

    return json({ received: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Stripe webhook failed" }, 400);
  }
});
