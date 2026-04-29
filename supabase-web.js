(function () {
    const SUPABASE_URL = "https://sdvktobunikpihpchwur.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdmt0b2J1bmlrcGlocGNod3VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NTQ0NDYsImV4cCI6MjA2MDIzMDQ0Nn0.T7sZl52NmKfDc-P-AUyviqyF2-C2IyDUZoTdAjBJzlI";

    function resolveRedirect(pathname) {
        return new URL(pathname, window.location.href).toString();
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.error("Supabase client library is not available on this page.");
        return;
    }

    window.SoundSwipeSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: "pkce"
        }
    });

    window.SoundSwipeSupabaseConfig = {
        url: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        callbackURL: resolveRedirect("auth-callback.html")
    };

    window.SoundSwipeStripeConfig = {
        environment: "live"
    };
})();
