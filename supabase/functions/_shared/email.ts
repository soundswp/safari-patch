const SMTP2GO_API_KEY = Deno.env.get("SMTP2GO_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("SOUNDSWIPE_EMAIL_FROM") ?? "";
const SUPPORT_EMAIL = Deno.env.get("SOUNDSWIPE_SUPPORT_EMAIL") ?? "support@soundswipe.us";
const SITE_URL = trimTrailingSlash(Deno.env.get("SOUNDSWIPE_SITE_URL") ?? "https://soundswipe.us");
const LOGO_URL = Deno.env.get("SOUNDSWIPE_LOGO_URL") ?? `${SITE_URL}/soundswipe_logo3.png`;

type PurchaseEmailPayload = {
  to: string;
  beatTitle: string;
  tierLabel: string;
  producerName: string;
  buyerName: string;
  orderReference: string;
  unlockedFiles: string[];
  purchasedBeatsURL: string;
};

type WelcomeEmailPayload = {
  to: string;
  displayName?: string;
  openURL?: string;
};

type ProducerSaleEmailPayload = {
  to: string;
  producerName: string;
  buyerName: string;
  beatTitle: string;
  orderReference: string;
  tierLabel: string;
  saleDate: string;
  saleAmount?: number;
};

type SMTPEmailPayload = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
};

export async function sendPurchaseConfirmationEmail(payload: PurchaseEmailPayload) {
  if (!SMTP2GO_API_KEY || !EMAIL_FROM || !payload.to) {
    return { sent: false, reason: "Email environment is not configured" };
  }

  const unlockedFiles = payload.unlockedFiles.join(", ") || "Included in your purchased tier";
  const purchasedBeatsURL = payload.purchasedBeatsURL || `${SITE_URL}/purchased-beats.html`;
  const lines = [
    `Hi ${payload.buyerName || "there"},`,
    "",
    "Your SoundSwipe beat purchase is confirmed.",
    "",
    `Beat: ${payload.beatTitle}`,
    `Tier: ${payload.tierLabel}`,
    `Producer: ${payload.producerName}`,
    `Order reference: ${payload.orderReference}`,
    `Unlocked files: ${unlockedFiles}`,
    "",
    `Open your Purchased Beats library: ${purchasedBeatsURL}`,
    "",
    `Need help? Contact ${SUPPORT_EMAIL}.`,
    "",
    "Thank you for using SoundSwipe.",
  ];

  const html = renderBrandedEmail({
    eyebrow: "Purchase confirmed",
    title: "Your beat license is ready.",
    previewText: `Your ${payload.tierLabel} license for ${payload.beatTitle} is confirmed.`,
    intro: `Hi ${escapeHtml(payload.buyerName || "there")}, your SoundSwipe purchase is complete. Your licensed files are now available in your Purchased Beats library.`,
    badge: payload.tierLabel,
    rows: [
      ["Beat", payload.beatTitle],
      ["Producer", payload.producerName],
      ["License", payload.tierLabel],
      ["Unlocked files", unlockedFiles],
      ["Order reference", payload.orderReference],
    ],
    ctaLabel: "Open Purchased Beats",
    ctaURL: purchasedBeatsURL,
    secondaryText: "Keep this email for your records. Your license details and available downloads are also stored in your SoundSwipe account.",
  });

  return sendSMTPEmail({
    to: payload.to,
    subject: `SoundSwipe purchase confirmed: ${payload.beatTitle}`,
    textBody: lines.join("\n"),
    htmlBody: html,
  });
}

export async function sendWelcomeEmail(payload: WelcomeEmailPayload) {
  if (!SMTP2GO_API_KEY || !EMAIL_FROM || !payload.to) {
    return { sent: false, reason: "Email environment is not configured" };
  }

  const openURL = payload.openURL || SITE_URL;
  const greetingName = payload.displayName || "there";
  const lines = [
    `Hi ${greetingName},`,
    "",
    "Welcome to SoundSwipe.",
    "",
    "Your account is live and you’re ready to get started.",
    "",
    "Discover beats, songs, and creators, upload your own music, and explore everything SoundSwipe has to offer.",
    "",
    `Open SoundSwipe: ${openURL}`,
    "",
    `Questions? Contact us at ${SUPPORT_EMAIL}`,
  ];

  const html = renderBrandedEmail({
    eyebrow: "Welcome",
    title: "Welcome to SoundSwipe",
    previewText: "Your SoundSwipe account is live and ready to go.",
    intro: `Hi ${escapeHtml(greetingName)}, your account is live and you’re ready to get started.<br><br>Discover beats, songs, and creators, upload your own music, and explore everything SoundSwipe has to offer.`,
    ctaLabel: "Open SoundSwipe",
    ctaURL: openURL,
    secondaryText: `Questions? Contact us at ${SUPPORT_EMAIL}`,
  });

  return sendSMTPEmail({
    to: payload.to,
    subject: "Welcome to SoundSwipe",
    textBody: lines.join("\n"),
    htmlBody: html,
  });
}

export async function sendProducerSaleNotificationEmail(payload: ProducerSaleEmailPayload) {
  if (!SMTP2GO_API_KEY || !EMAIL_FROM || !payload.to) {
    return { sent: false, reason: "Email environment is not configured" };
  }

  const saleDateLabel = formatEmailDate(payload.saleDate);
  const saleAmountLabel = Number.isFinite(Number(payload.saleAmount))
    ? new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(Number(payload.saleAmount))
    : "";

  const lines = [
    `Hi ${payload.producerName || "there"},`,
    "",
    "A beat sale just came through on SoundSwipe.",
    "",
    `Buyer: ${payload.buyerName}`,
    `Beat: ${payload.beatTitle}`,
    `Order reference: ${payload.orderReference}`,
    `License: ${payload.tierLabel}`,
    `Sale date: ${saleDateLabel}`,
    saleAmountLabel ? `Sale amount: ${saleAmountLabel}` : "",
    "",
    `Questions? Contact us at ${SUPPORT_EMAIL}`,
  ].filter(Boolean);

  const html = renderBrandedEmail({
    eyebrow: "New sale",
    title: "A beat purchase just landed.",
    previewText: `${payload.buyerName} purchased ${payload.beatTitle} on SoundSwipe.`,
    intro: `Hi ${escapeHtml(payload.producerName || "there")}, a beat sale just came through on SoundSwipe.`,
    badge: payload.tierLabel,
    rows: [
      ["Buyer", payload.buyerName],
      ["Beat", payload.beatTitle],
      ["Order reference", payload.orderReference],
      ["License", payload.tierLabel],
      ["Sale date", saleDateLabel],
      ["Sale amount", saleAmountLabel],
    ],
    ctaLabel: "Open SoundSwipe",
    ctaURL: SITE_URL,
    secondaryText: `Questions? Contact us at ${SUPPORT_EMAIL}`,
  });

  return sendSMTPEmail({
    to: payload.to,
    subject: `SoundSwipe sale: ${payload.beatTitle}`,
    textBody: lines.join("\n"),
    htmlBody: html,
  });
}

async function sendSMTPEmail(payload: SMTPEmailPayload) {
  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": SMTP2GO_API_KEY,
    },
    body: JSON.stringify({
      sender: EMAIL_FROM,
      to: [payload.to],
      subject: payload.subject,
      text_body: payload.textBody,
      html_body: payload.htmlBody,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      sent: false,
      reason: result?.data?.error || `Email send failed (${response.status})`,
    };
  }

  return { sent: true, providerResponse: result };
}

type BrandedEmailPayload = {
  eyebrow: string;
  title: string;
  previewText: string;
  intro: string;
  badge?: string;
  rows?: [string, string][];
  ctaLabel?: string;
  ctaURL?: string;
  secondaryText?: string;
};

function renderBrandedEmail(payload: BrandedEmailPayload) {
  const safeRows = (payload.rows || [])
    .filter(([, value]) => Boolean(String(value || "").trim()))
    .map(([label, value]) => detailRow(label, value))
    .join("");
  const cta = payload.ctaLabel && payload.ctaURL
    ? `
      <tr>
        <td style="padding: 24px 0 4px;">
          <a href="${escapeHtml(payload.ctaURL)}" style="display: inline-block; padding: 15px 22px; border-radius: 999px; background: linear-gradient(135deg, #8867ff 0%, #61a4ff 100%); color: #ffffff; font-size: 15px; font-weight: 800; text-decoration: none; box-shadow: 0 18px 34px rgba(97, 164, 255, 0.24);">${escapeHtml(payload.ctaLabel)}</a>
        </td>
      </tr>
    `
    : "";
  const badge = payload.badge
    ? `<span style="display: inline-block; margin-left: 8px; padding: 6px 10px; border-radius: 999px; background: rgba(82, 218, 163, 0.14); color: #9ff3cf; font-size: 12px; font-weight: 800; letter-spacing: 0.02em;">${escapeHtml(payload.badge)}</span>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <title>${escapeHtml(payload.title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #05070c;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${escapeHtml(payload.previewText)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width: 100%; background: radial-gradient(circle at top left, rgba(136, 103, 255, 0.28), transparent 30%), radial-gradient(circle at 86% 8%, rgba(97, 164, 255, 0.18), transparent 26%), #05070c;">
      <tr>
        <td align="center" style="padding: 34px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 640px;">
            <tr>
              <td align="center" style="padding: 0 0 18px;">
                <a href="${escapeHtml(SITE_URL)}" style="display: inline-block; text-decoration: none;">
                  <img src="${escapeHtml(LOGO_URL)}" width="210" alt="SoundSwipe" style="display: block; width: 210px; max-width: 72%; height: auto; border: 0;">
                </a>
              </td>
            </tr>
            <tr>
              <td style="border: 1px solid rgba(255, 255, 255, 0.10); border-radius: 28px; background: #10141d; overflow: hidden; box-shadow: 0 28px 70px rgba(0, 0, 0, 0.35);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding: 30px 30px 24px; background: linear-gradient(135deg, rgba(136, 103, 255, 0.18), rgba(97, 164, 255, 0.08));">
                      <div style="font-family: Arial, Helvetica, sans-serif; color: #bca8ff; font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;">${escapeHtml(payload.eyebrow)}${badge}</div>
                      <h1 style="margin: 12px 0 0; font-family: Arial, Helvetica, sans-serif; color: #f5f7fb; font-size: 30px; line-height: 1.12; letter-spacing: -0.03em;">${escapeHtml(payload.title)}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 28px 30px 30px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="font-family: Arial, Helvetica, sans-serif; color: #c4cadd; font-size: 16px; line-height: 1.65;">${payload.intro}</td>
                        </tr>
                        ${safeRows ? `
                          <tr>
                            <td style="padding-top: 22px;">
                              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: separate; border-spacing: 0 10px;">
                                ${safeRows}
                              </table>
                            </td>
                          </tr>
                        ` : ""}
                        ${cta}
                        ${payload.secondaryText ? `
                          <tr>
                            <td style="padding-top: 22px; font-family: Arial, Helvetica, sans-serif; color: #9ea8ba; font-size: 14px; line-height: 1.6;">${escapeHtml(payload.secondaryText)}</td>
                          </tr>
                        ` : ""}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 20px 18px 0; font-family: Arial, Helvetica, sans-serif; color: #7d8799; font-size: 12px; line-height: 1.6;">
                Need help? Contact <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color: #bca8ff; text-decoration: none;">${escapeHtml(SUPPORT_EMAIL)}</a>.<br>
                © ${new Date().getFullYear()} SoundSwipe. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding: 14px 16px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; background: rgba(255, 255, 255, 0.045);">
        <div style="font-family: Arial, Helvetica, sans-serif; color: #9ea8ba; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;">${escapeHtml(label)}</div>
        <div style="margin-top: 4px; font-family: Arial, Helvetica, sans-serif; color: #f5f7fb; font-size: 15px; line-height: 1.45; font-weight: 700;">${escapeHtml(value)}</div>
      </td>
    </tr>
  `;
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function trimTrailingSlash(value: string) {
  return String(value || "").replace(/\/+$/, "");
}

function formatEmailDate(value: string) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
