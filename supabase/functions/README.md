# Web Upload Functions

These Supabase Edge Functions let the website upload pages use the same real SoundSwipe content tables and core upload flow without exposing BunnyNet credentials in browser JavaScript.

Functions:

- `web-upload-beat`
- `web-upload-song`
- `web-update-profile`
- `web-sign-bunny-url`
- `web-welcome-email`
- `web-download-purchased-beat`
- `stripe-connect`
- `stripe-commerce`
- `stripe-webhook`

Required Supabase function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BUNNY_NET_ACCESS_KEY`
- `BUNNY_NET_STORAGE_ZONE`
- `BUNNY_NET_PULL_ZONE`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_ACTIVE_MODE` (`test` or `live`, optional; defaults from configured keys)
- `STRIPE_SECRET_KEY_TEST`
- `STRIPE_SECRET_KEY_LIVE`
- `STRIPE_WEBHOOK_SECRET_TEST`
- `STRIPE_WEBHOOK_SECRET_LIVE`
- `SMTP2GO_API_KEY`
- `SOUNDSWIPE_EMAIL_FROM`
- `SOUNDSWIPE_SUPPORT_EMAIL`
- `WELCOME_EMAIL_HOOK_SECRET`
- `SOUNDSWIPE_SITE_URL` (optional, defaults to `https://soundswipe.us`)
- `SOUNDSWIPE_LOGO_URL` (optional, defaults to `https://soundswipe.us/soundswipe_logo3.png`)

Deploy example:

```bash
supabase functions deploy web-upload-beat
supabase functions deploy web-upload-song
supabase functions deploy web-update-profile
supabase functions deploy web-welcome-email
supabase functions deploy web-download-purchased-beat
supabase functions deploy stripe-connect
supabase functions deploy stripe-commerce
supabase functions deploy stripe-webhook
```

Set secrets example:

```bash
supabase secrets set \
  SUPABASE_URL=... \
  SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  BUNNY_NET_ACCESS_KEY=... \
  BUNNY_NET_STORAGE_ZONE=... \
  BUNNY_NET_PULL_ZONE=... \
  STRIPE_ACTIVE_MODE=test \
  STRIPE_SECRET_KEY_TEST=... \
  STRIPE_WEBHOOK_SECRET_TEST=... \
  STRIPE_SECRET_KEY_LIVE=... \
  STRIPE_WEBHOOK_SECRET_LIVE=... \
  STRIPE_SECRET_KEY=... \
  STRIPE_WEBHOOK_SECRET=... \
  SMTP2GO_API_KEY=... \
  SOUNDSWIPE_EMAIL_FROM=... \
  SOUNDSWIPE_SUPPORT_EMAIL=... \
  WELCOME_EMAIL_HOOK_SECRET=... \
  SOUNDSWIPE_SITE_URL=https://soundswipe.us \
  SOUNDSWIPE_LOGO_URL=https://soundswipe.us/soundswipe_logo3.png
```

Current scope:

- Uses the same SoundSwipe `beats` and `songs` tables
- Uses the shared `profiles` table for website profile/settings updates
- Uses the same core metadata fields and license fields from the app upload flow
- Checks `producer_payments` so paid beat-license uploads follow the same Stripe-connected rule as the app
- Uses BunnyNet server-side so the website does not expose upload credentials
- Uses `producer_payments` as the seller Stripe Connect status store
- Separates seller Stripe Connect linkage and purchase history by `test` vs `live` environment without touching beat cards or pricing records
- Builds Stripe Checkout sessions from the backend beat tier configuration instead of trusting the client
- Finalizes purchases from Stripe webhook confirmation and sends confirmation email from the backend
- Sends welcome emails from the backend for new profile creation when paired with the SQL trigger
- Sends branded HTML purchase emails with SoundSwipe logo, product styling, and plain-text fallbacks

Current known gap versus iOS app:

- The iOS app currently applies additional DRM/watermark handling in native code for some protected file paths.
- These web functions keep the same real backend insert flow and file destinations, but they do not yet port the native DRM watermark step.
- The iOS app does native artwork cropping and audio-duration inspection before upload. The web flow keeps the same backend entry model but currently uses preview-only artwork handling and stores duration as `null`.


Additional secret required for signed Bunny CDN delivery:
- `BUNNY_NET_TOKEN_KEY`

SQL setup:

- Run `supabase/sql/stripe-commerce.sql` against the live project before enabling the new commerce functions.
- For existing projects already using Stripe test mode, also run `supabase/sql/stripe-live-cutover.sql` to backfill test purchases and seller connections into the new environment-aware columns.

Auth email templates:

- Paste the HTML in `supabase/email-templates/confirmation.html` into Supabase Auth confirmation emails.
- Paste the HTML in `supabase/email-templates/recovery.html` into Supabase Auth recovery emails.
