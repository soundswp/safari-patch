# SoundSwipe Email Templates

Use these HTML templates in Supabase Auth email settings so account emails match the branded backend purchase emails.

Recommended Supabase Auth subjects:

- Confirmation: `Confirm your SoundSwipe email`
- Recovery: `Reset your SoundSwipe password`

The templates use `https://soundswipe.us/soundswipe_logo3.png`, matching the website logo asset. If the production domain or logo path changes, update the image URL in these templates and set `SOUNDSWIPE_LOGO_URL` for Edge Function emails.
