import { corsHeaders } from "../_shared/cors.ts";
import { createAuthedClient, createServiceClient, json } from "../_shared/upload.ts";
import {
  computePlatformFee,
  getActiveStripeEnvironment,
  stripeRequest,
  stripeStatusForEnvironment,
  tierDetailsForBeat,
  type TierKey,
} from "../_shared/stripe.ts";

function routePath(request: Request) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const functionIndex = segments.indexOf("stripe-commerce");
  if (functionIndex === -1) return "/";
  return `/${segments.slice(functionIndex + 1).join("/")}`.replace(/\/+$/, "") || "/";
}

function purchasesEnvironmentColumnMissing(error: unknown) {
  const message = String((error as { message?: string; details?: string })?.message || (error as { details?: string })?.details || "").toLowerCase();
  return message.includes("environment") && message.includes("purchases");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const route = routePath(request);
    const { user } = await createAuthedClient(request);
    const serviceSupabase = createServiceClient();

    if (route !== "/checkout-session" && route !== "/") {
      return json({ error: "Not found" }, 404);
    }

    const body = await request.json().catch(() => ({}));
    const beatId = String(body.beat_id || "").trim();
    const tierKey = String(body.tier || "").trim().toLowerCase() as TierKey;
    const stripeEnvironment = getActiveStripeEnvironment();

    if (!beatId || !tierKey) {
      return json({ error: "Beat ID and tier are required" }, 400);
    }

    const { data: beat } = await serviceSupabase
      .from("beats")
      .select("id, user_id, title, description, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, exclusive_includes_stems, basic_license_price, premium_license_price, exclusive_license_price, price, public_license_state, file_mp3_url, file_wav_url, stems_zip_url, profiles!beats_user_id_fkey(display_name, username)")
      .eq("id", beatId)
      .maybeSingle();

    if (!beat) {
      return json({ error: "Beat not found" }, 404);
    }

    if (String(beat.user_id) === user.id) {
      return json({ error: "You cannot purchase your own beat" }, 400);
    }

    const offer = tierDetailsForBeat(beat as Record<string, unknown>, tierKey);
    if (!offer) {
      return json({ error: "This license tier is not available for checkout" }, 400);
    }

    let existingPurchaseQuery = serviceSupabase
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("beats_id", beatId)
      .eq("content_type", "beat")
      .eq("status", "completed")
      .eq("environment", stripeEnvironment)
      .limit(1)
      .maybeSingle();

    let { data: existingPurchase, error: existingPurchaseError } = await existingPurchaseQuery;
    if (purchasesEnvironmentColumnMissing(existingPurchaseError)) {
      ({ data: existingPurchase, error: existingPurchaseError } = await serviceSupabase
        .from("purchases")
        .select("id")
        .eq("user_id", user.id)
        .eq("beats_id", beatId)
        .eq("content_type", "beat")
        .eq("status", "completed")
        .limit(1)
        .maybeSingle());
    }
    if (existingPurchaseError) {
      throw existingPurchaseError;
    }

    if (existingPurchase?.id) {
      return json({ error: "You already purchased this beat" }, 400);
    }

    const { data: paymentRow } = await serviceSupabase
      .from("producer_payments")
      .select("*")
      .eq("user_id", beat.user_id)
      .maybeSingle();

    const paymentStatus = stripeStatusForEnvironment(paymentRow as Record<string, unknown> | null, stripeEnvironment);

    if (!paymentStatus.stripe_connect_id || !paymentStatus.payout_enabled || !paymentStatus.onboarding_complete) {
      return json({ error: "Seller payouts are not ready for this beat" }, 400);
    }

    const origin = String(body.origin || new URL(request.url).origin || "https://soundswipe.app");
    const successURL = String(body.success_url || `${origin}/beat.html?id=${encodeURIComponent(beatId)}&checkout=success`);
    const cancelURL = String(body.cancel_url || `${origin}/beat.html?id=${encodeURIComponent(beatId)}&checkout=cancel`);
    const sellerName = beat.profiles?.display_name || beat.profiles?.username || "SoundSwipe Producer";
    const applicationFeeAmount = computePlatformFee(offer.unitAmount);
    const unlockedFiles = offer.entitlements.files
      .filter((file) => file !== "wav" || Boolean(beat.file_wav_url))
      .filter((file) => file !== "stems" || Boolean(beat.stems_zip_url))
      .map((file) => file.toUpperCase());

    const session = await stripeRequest("/checkout/sessions", {
      mode: "payment",
      success_url: successURL,
      cancel_url: cancelURL,
      customer_email: user.email || "",
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": offer.unitAmount,
      "line_items[0][price_data][product_data][name]": `${offer.label} - ${beat.title}`,
      "line_items[0][price_data][product_data][description]": `${offer.description} • ${sellerName}`,
      "metadata[beat_id]": beatId,
      "metadata[stripe_environment]": stripeEnvironment,
      "metadata[tier]": offer.key,
      "metadata[tier_label]": offer.label,
      "metadata[seller_user_id]": String(beat.user_id),
      "metadata[seller_connect_id]": String(paymentStatus.stripe_connect_id),
      "metadata[buyer_user_id]": user.id,
      "metadata[product_type]": "beat_license",
      "metadata[producer_name]": sellerName,
      "metadata[beat_title]": String(beat.title || "Untitled Beat"),
      "metadata[entitlement_files]": unlockedFiles.join(","),
      "payment_intent_data[application_fee_amount]": applicationFeeAmount,
      "payment_intent_data[transfer_data][destination]": String(paymentStatus.stripe_connect_id),
      "payment_intent_data[metadata][beat_id]": beatId,
      "payment_intent_data[metadata][stripe_environment]": stripeEnvironment,
      "payment_intent_data[metadata][tier]": offer.key,
      "payment_intent_data[metadata][buyer_user_id]": user.id,
      "payment_intent_data[metadata][seller_user_id]": String(beat.user_id),
      "payment_intent_data[metadata][seller_connect_id]": String(paymentStatus.stripe_connect_id),
      "payment_intent_data[metadata][entitlement_files]": unlockedFiles.join(","),
      "payment_intent_data[metadata][producer_name]": sellerName,
      "payment_intent_data[metadata][beat_title]": String(beat.title || "Untitled Beat"),
    }, { environment: stripeEnvironment });

    return json({
      checkoutURL: session.url,
      sessionId: session.id,
      tier: offer.key,
      price: offer.price,
      environment: stripeEnvironment,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Checkout session creation failed" }, 500);
  }
});
