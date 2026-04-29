(function () {
    const LAST_SEARCH_KEY = "soundswipe-web-search";
    const POST_AUTH_REDIRECT_KEY = "soundswipe-post-auth-redirect";
    const PENDING_VERIFICATION_KEY = "soundswipe-pending-verification";
    const POST_UPLOAD_SHARE_PROMPT_KEY = "soundswipe-post-upload-share-prompt";
    const appPreviewHref = "app.html";
    const protectedPages = new Set(["upload", "purchased", "settings", "edit-profile"]);
    const ARTWORK_CARD_RATIO = 133 / 200;
    const ARTWORK_EXPORT_WIDTH = 1200;
    const uploadState = {
        songProducerSearchToken: 0,
        beatStripeConnected: false,
        beatStripeChecked: false,
        edit: {
            beatId: "",
            songId: ""
        },
        artwork: {
            beat: {
                sourceFile: null,
                croppedFile: null,
                crop: null
            },
            song: {
                sourceFile: null,
                croppedFile: null,
                crop: null
            }
        },
        cropper: null
    };

    const state = {
        session: null,
        authUser: null,
        profile: null,
        route: null
    };
    const producerProfileCache = new Map();

    const PUBLIC_ROUTE_RESERVED_SEGMENTS = new Set([
        "",
        "index",
        "index.html",
        "login",
        "login.html",
        "signup",
        "signup.html",
        "app",
        "app.html",
        "about",
        "about.html",
        "faq",
        "faq.html",
        "privacy",
        "privacy.html",
        "terms",
        "terms.html",
        "contact",
        "contact.html",
        "settings",
        "settings.html",
        "upload",
        "upload.html",
        "purchased-beats",
        "purchased-beats.html",
        "seller-dashboard",
        "seller-dashboard.html",
        "edit-profile",
        "edit-profile.html",
        "auth-callback",
        "auth-callback.html",
        "beat",
        "beat.html",
        "song",
        "song.html",
        "profile",
        "profile.html",
        "b",
        "b.html",
        "s",
        "s.html",
        "404",
        "404.html"
    ]);

    const signedMediaURLCache = new Map();

    const profilePageState = {
        data: null,
        activeTab: "beats",
        likesFilter: "beats",
        visibleCounts: {
            beats: 9,
            songs: 9,
            likes_beats: 9,
            likes_songs: 9
        },
        feedback: "",
        isFollowPending: false,
        relationshipModal: {
            open: false,
            mode: "followers",
            title: "",
            profileId: "",
            loading: false,
            error: "",
            items: []
        }
    };

    const editProfileState = {
        feedback: "",
        feedbackType: "info",
        selectedImageFile: null,
        sourceImageFile: null,
        crop: null,
        previewURL: ""
    };

    const searchPageState = {
        type: "beats",
        query: "",
        visibleCount: 15,
        beatFilters: {
            bpmMin: "",
            bpmMax: "",
            key: "",
            recency: "any",
            licenseTier: "any"
        },
        songFilters: {
            recency: "any"
        }
    };

    const purchasedBeatsPageState = {
        filter: "all",
        bpmMin: "",
        bpmMax: "",
        key: "",
        visibleCount: 15
    };

    const BEAT_KEY_OPTIONS = ["C Minor","C Major","C# Minor","C# Major","D Minor","D Major","D# Minor","D# Major","E Minor","E Major","F Minor","F Major","F# Minor","F# Major","G Minor","G Major","G# Minor","G# Major","A Minor","A Major","A# Minor","A# Major","B Minor","B Major"];

    const discoverPlayback = {
        activeAudio: null,
        activeCardId: null,
        waveformCache: new Map(),
        audioContext: null,
        animationFrame: null
    };

    const discoverAutoplay = {
        states: new WeakMap(),
        visibilityBound: false,
        configs: {
            beats: {
                intervalMs: 4125,
                initialDelayMs: 1600,
                interactionPauseMs: 8500,
                resumePollMs: 900
            },
            songs: {
                intervalMs: 4560,
                initialDelayMs: 2450,
                interactionPauseMs: 5200,
                resumePollMs: 900
            },
            profiles: {
                intervalMs: 4980,
                initialDelayMs: 3280,
                interactionPauseMs: 5200,
                resumePollMs: 900
            }
        }
    };

    const homepageAmbientState = {
        activeDriverKind: "",
        activeImageURL: "",
        holdUntil: 0,
        holdMs: 5200,
        initialized: false,
        rafId: null,
        scrollBound: false
    };

    const runtimeBrowser = {
        safari: (() => {
            const ua = navigator.userAgent || "";
            return /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|Firefox|FxiOS|Android/i.test(ua);
        })()
    };

    function isSafariBrowser() {
        return runtimeBrowser.safari;
    }

    if (runtimeBrowser.safari) {
        document.documentElement.classList.add("is-safari");
        discoverAutoplay.configs.beats.intervalMs = 6200;
        discoverAutoplay.configs.songs.intervalMs = 6900;
        discoverAutoplay.configs.profiles.intervalMs = 7600;
        discoverAutoplay.configs.beats.initialDelayMs = 2200;
        discoverAutoplay.configs.songs.initialDelayMs = 2800;
        discoverAutoplay.configs.profiles.initialDelayMs = 3400;
        homepageAmbientState.holdMs = 9000;
    }

    const BEAT_PRODUCER_SCHEMA_FIELDS = ["producer_display_name", "additional_producers"];

    function getSupabase() {
        return window.SoundSwipeSupabase;
    }

    function hasSupabase() {
        return Boolean(getSupabase());
    }

    function missingBeatProducerSchemaFields(error) {
        const message = String(error?.message || error?.details || "").toLowerCase();
        if (!error) return [];
        return BEAT_PRODUCER_SCHEMA_FIELDS.filter((field) => message.includes(field));
    }

    function beatCreditSchemaMissing(error) {
        return missingBeatProducerSchemaFields(error).length > 0;
    }

    function stripBeatProducerFields(selectClause, fields = BEAT_PRODUCER_SCHEMA_FIELDS) {
        let next = String(selectClause || "");
        (Array.isArray(fields) ? fields : [fields]).forEach((field) => {
            next = next
                .replace(new RegExp(`${field},\\s*`, "g"), "")
                .replace(new RegExp(`,\\s*${field}`, "g"), "")
                .replace(new RegExp(`\\b${field}\\b`, "g"), "");
        });
        return next.replace(/,\s*,/g, ",").replace(/\(\s*,/g, "(").replace(/,\s*\)/g, ")").replace(/\s{2,}/g, " ").trim();
    }

    async function executeBeatSelectWithFallback(buildQuery, selectClause) {
        let result = await buildQuery(selectClause);
        const missingFields = missingBeatProducerSchemaFields(result?.error);
        if (missingFields.length) {
            result = await buildQuery(stripBeatProducerFields(selectClause, missingFields));
        }
        return result;
    }

    function isLoggedIn() {
        return Boolean(state.session?.user);
    }

    function currentUserName() {
        return state.profile?.display_name || state.authUser?.user_metadata?.display_name || "SoundSwipe User";
    }

    function currentUsername() {
        return state.profile?.username ? `@${state.profile.username}` : "@soundswipe";
    }

    function initialsForName(name) {
        return String(name)
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() || "")
            .join("") || "SS";
    }


    function isBunnyCDNURL(url) {
        return /https?:\/\/[^\s]*b-cdn\.net\//i.test(String(url || ""));
    }

    async function resolveSignedBunnyURL(url) {
        if (!url || !isBunnyCDNURL(url) || !window.SoundSwipeSupabaseConfig?.url) {
            return url;
        }

        if (signedMediaURLCache.has(url)) {
            return signedMediaURLCache.get(url);
        }

        try {
            const session = state.session || (hasSupabase() ? (await getSupabase().auth.getSession()).data.session : null);
            const headers = {
                "Content-Type": "application/json"
            };
            if (session?.access_token) {
                headers.Authorization = `Bearer ${session.access_token}`;
            }

            const response = await fetch(`${window.SoundSwipeSupabaseConfig.url}/functions/v1/web-sign-bunny-url`, {
                method: "POST",
                headers,
                body: JSON.stringify({ url })
            });

            const payload = await response.json().catch(() => ({}));
            const signedURL = response.ok && payload?.signedUrl ? payload.signedUrl : url;
            signedMediaURLCache.set(url, signedURL);
            return signedURL;
        } catch (error) {
            console.error("Bunny URL signing failed", error);
            signedMediaURLCache.set(url, url);
            return url;
        }
    }

    async function hydrateProfileMedia(profile) {
        if (!profile) return profile;
        if (profile.profile_image_url) {
            profile.profile_image_url = await resolveSignedBunnyURL(profile.profile_image_url);
        }
        return profile;
    }

    async function hydrateProfilesMedia(profiles) {
        return Promise.all((profiles || []).map(async (profile) => hydrateProfileMedia(profile)));
    }

    async function hydrateBeatCardMedia(beat) {
        if (!beat) return beat;
        if (beat.image) {
            beat.image = await resolveSignedBunnyURL(beat.image);
        }
        if (beat.audioFile) {
            beat.audioFile = await resolveSignedBunnyURL(beat.audioFile);
        }
        if (beat.creatorAvatar) {
            beat.creatorAvatar = await resolveSignedBunnyURL(beat.creatorAvatar);
        }
        if (Array.isArray(beat.linkedProducerCredits) && beat.linkedProducerCredits.length) {
            beat.linkedProducerCredits = await Promise.all(beat.linkedProducerCredits.map(async (credit) => ({
                ...credit,
                profileImage: credit?.profileImage ? await resolveSignedBunnyURL(credit.profileImage) : ""
            })));
        }
        if (Array.isArray(beat.producerCredits) && beat.producerCredits.length) {
            const linkedMap = new Map((beat.linkedProducerCredits || []).map((credit) => [credit.key, credit.profileImage]));
            beat.producerCredits = beat.producerCredits.map((credit) => ({
                ...credit,
                profileImage: linkedMap.get(credit.key) || credit.profileImage || ""
            }));
        }
        return beat;
    }

    async function hydrateSongCardMedia(song) {
        if (!song) return song;
        if (song.image) {
            song.image = await resolveSignedBunnyURL(song.image);
        }
        if (song.audioFile) {
            song.audioFile = await resolveSignedBunnyURL(song.audioFile);
        }
        if (song.creatorAvatar) {
            song.creatorAvatar = await resolveSignedBunnyURL(song.creatorAvatar);
        }
        return song;
    }

    function avatarMarkup() {
        const profileImage = state.profile?.profile_image_url;
        if (profileImage) {
            return `
                <span class="user-avatar user-avatar--image">
                    <img src="${escapeHtml(cacheBustedImageURL(profileImage, state.profile?.profile_image_updated_at || ""))}" alt="${escapeHtml(currentUserName())}" />
                </span>
            `;
        }

        return `<span class="user-avatar">${escapeHtml(initialsForName(currentUserName()))}</span>`;
    }

    function navSearchValue() {
        const params = new URLSearchParams(window.location.search);
        return params.get("q") || "";
    }

    function filterVisibleBeats(query) {
        return query.not("public_license_state", "eq", "removed_from_profile");
    }

    function normalizedSearchTokens(value) {
        return String(value || "")
            .toLowerCase()
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean);
    }

    function searchValueIncludesAllTokens(values, query) {
        const tokens = normalizedSearchTokens(query);
        if (!tokens.length) return true;
        const haystack = values
            .flatMap((value) => Array.isArray(value) ? value : [value])
            .map((value) => String(value || "").toLowerCase())
            .filter(Boolean)
            .join(" ");

        return tokens.every((token) => haystack.includes(token));
    }

    function navSearchType() {
        const params = new URLSearchParams(window.location.search);
        return params.get("type") || "beats";
    }

    function currentRedirectURL() {
        return `${window.location.pathname}${window.location.search}`;
    }

    function normalizeUsernameValue(value) {
        return String(value || "").trim().replace(/^@+/, "");
    }

    function slugifyPublicSegment(value, fallback = "item") {
        const normalized = String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return normalized || fallback;
    }

    function uuidToShortToken(uuid) {
        const compact = String(uuid || "").trim().toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(compact)) {
            return "";
        }
        const hex = compact.replace(/-/g, "");
        let binary = "";
        for (let index = 0; index < hex.length; index += 2) {
            binary += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
        }
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    function shortTokenToUUID(token) {
        const compact = String(token || "").trim().replace(/-/g, "+").replace(/_/g, "/");
        if (!compact) return "";
        const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
        try {
            const binary = atob(padded);
            if (binary.length !== 16) return "";
            const hex = Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        } catch {
            return "";
        }
    }

    function isLocalDevelopmentHost() {
        const host = window.location.hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
    }

    function currentRoutePathForParsing() {
        const params = new URLSearchParams(window.location.search);
        const routedPath = params.get("route");
        if (routedPath && (window.location.pathname.endsWith("/404.html") || window.location.pathname === "/404.html")) {
            return routedPath.startsWith("/") ? routedPath : `/${routedPath}`;
        }
        return window.location.pathname;
    }

    function localRouterWrappedPath(path) {
        const normalizedPath = String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`;
        return `/404.html?route=${encodeURIComponent(normalizedPath)}`;
    }

    function getParsedPublicRoute() {
        if (state.route) return state.route;
        const segments = currentRoutePathForParsing()
            .split("/")
            .map((segment) => segment.trim())
            .filter(Boolean)
            .map((segment) => decodeURIComponent(segment));

        if (!segments.length) {
            state.route = { kind: "none" };
            return state.route;
        }

        const first = segments[0].toLowerCase();
        const second = segments[1] || "";
        if (["beat", "beats", "b"].includes(first) && second) {
            const token = second.includes("~") ? second.split("~").pop() : second;
            const id = shortTokenToUUID(token);
            state.route = id ? { kind: "beat", id, token, slug: second } : { kind: "none" };
            return state.route;
        }

        if (["song", "songs", "s"].includes(first) && second) {
            const token = second.includes("~") ? second.split("~").pop() : second;
            const id = shortTokenToUUID(token);
            state.route = id ? { kind: "song", id, token, slug: second } : { kind: "none" };
            return state.route;
        }

        if (segments.length === 1 && !segments[0].includes(".") && !PUBLIC_ROUTE_RESERVED_SEGMENTS.has(first)) {
            state.route = { kind: "profile", username: segments[0] };
            return state.route;
        }

        state.route = { kind: "none" };
        return state.route;
    }

    function appendURLParams(path, params = {}) {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value === null || value === undefined || value === "") return;
            query.set(key, value);
        });
        const queryString = query.toString();
        return queryString ? `${path}?${queryString}` : path;
    }

    function buildPublicProfileURL(profileLike, options = {}) {
        const absolute = options.absolute !== false;
        const tab = options.tab || "";
        const relationship = options.relationship || "";
        const username = normalizeUsernameValue(typeof profileLike === "string"
            ? profileLike
            : (profileLike?.usernameRaw || profileLike?.username || profileLike?.creatorUsername || ""));
        const id = typeof profileLike === "object" ? (profileLike?.id || profileLike?.userId || "") : "";

        let path = username
            ? `/${encodeURIComponent(username)}`
            : (id ? `/profile.html?id=${encodeURIComponent(id)}` : "/profile.html");

        if (isLocalDevelopmentHost() && path.startsWith("/") && !path.endsWith(".html")) {
            path = localRouterWrappedPath(path);
        }

        if (path.startsWith("/")) {
            path = appendURLParams(path, {
                tab: tab && tab !== "beats" ? tab : "",
                relationship
            });
            return absolute ? `${window.location.origin}${path}` : path;
        }

        return absolute
            ? `${window.location.origin}/${appendURLParams(path, {
                tab: tab && tab !== "beats" ? tab : "",
                relationship
            })}`
            : appendURLParams(path, {
                tab: tab && tab !== "beats" ? tab : "",
                relationship
            });
    }

    function buildPublicContentShareURL(contentType, contentLike, fallbackTitle = "", options = {}) {
        const absolute = options.absolute !== false;
        const type = String(contentType || "").toLowerCase() === "beat" ? "beat" : "song";
        const contentId = typeof contentLike === "object" ? (contentLike?.id || "") : String(contentLike || "");
        const contentTitle = typeof contentLike === "object"
            ? (contentLike?.title || contentLike?.name || fallbackTitle)
            : fallbackTitle;
        const token = uuidToShortToken(contentId);
        if (!token) {
            const fallback = `/${type}.html?id=${encodeURIComponent(contentId)}`;
            return absolute ? `${window.location.origin}${fallback}` : fallback;
        }

        const slug = slugifyPublicSegment(contentTitle, type);
        let path = `/${type}/${encodeURIComponent(slug)}~${token}`;
        if (isLocalDevelopmentHost()) {
            path = localRouterWrappedPath(path);
        }
        return absolute ? `${window.location.origin}${path}` : path;
    }

    function applyCanonicalPublicURL(path) {
        if (!path) return;
        const nextPath = String(path);
        const currentPath = `${window.location.pathname}${window.location.search}`;
        if (currentPath === nextPath) return;
        window.history.replaceState({}, "", nextPath);
        state.route = null;
    }

    function requestedBeatId() {
        const params = new URLSearchParams(window.location.search);
        const queryId = params.get("id");
        if (queryId) return queryId;
        const route = getParsedPublicRoute();
        return route.kind === "beat" ? route.id : "";
    }

    function requestedSongId() {
        const params = new URLSearchParams(window.location.search);
        const queryId = params.get("id");
        if (queryId) return queryId;
        const route = getParsedPublicRoute();
        return route.kind === "song" ? route.id : "";
    }

    function requestedProfileRoute() {
        const params = new URLSearchParams(window.location.search);
        const queryId = params.get("id");
        if (queryId) {
            return { id: queryId, username: "" };
        }
        const route = getParsedPublicRoute();
        return route.kind === "profile"
            ? { id: "", username: route.username }
            : { id: "", username: "" };
    }

    function preparePrettyRouteShell() {
        getParsedPublicRoute();
        const mount = document.querySelector("[data-route-shell]");
        if (!mount) return;

        const route = state.route || { kind: "none" };
        let markup = `
            <section class="page-hero">
                <div class="content-panel" style="max-width:760px; margin:0 auto;">
                    <span class="eyebrow">SoundSwipe</span>
                    <h1>Page not found</h1>
                    <p class="lede">That link doesn’t match a live SoundSwipe profile, beat, or song.</p>
                </div>
            </section>
        `;

        if (route.kind === "beat") {
            document.body.dataset.page = "beat";
            document.title = "Beat • SoundSwipe";
            markup = `<section class="page-hero" data-beat-detail></section>`;
        } else if (route.kind === "song") {
            document.body.dataset.page = "song";
            document.title = "Song • SoundSwipe";
            markup = `<section class="page-hero" data-song-detail></section>`;
        } else if (route.kind === "profile") {
            document.body.dataset.page = "profile";
            document.title = "Profile • SoundSwipe";
            markup = `<section class="page-hero" data-profile-detail></section>`;
        }

        mount.outerHTML = markup;
    }

    function closeReplicaMenus() {
        document.querySelectorAll("[data-card-menu].open").forEach((menu) => {
            menu.classList.remove("open");
            menu.hidden = true;
        });
        document.querySelectorAll("[data-card-menu-toggle][aria-expanded=\"true\"]").forEach((button) => {
            button.setAttribute("aria-expanded", "false");
        });
    }

    function showSiteToast(message, tone = "info") {
        const existing = document.querySelector(".site-toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.className = `site-toast site-toast--${tone}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add("is-visible"));

        window.setTimeout(() => {
            toast.classList.remove("is-visible");
            window.setTimeout(() => toast.remove(), 220);
        }, 2200);
    }

    function isEmailVerified(user = state.authUser) {
        return Boolean(user?.email_confirmed_at || user?.confirmed_at);
    }

    function storePostAuthRedirect(value) {
        localStorage.setItem(POST_AUTH_REDIRECT_KEY, value);
    }

    function consumePostAuthRedirect() {
        const value = localStorage.getItem(POST_AUTH_REDIRECT_KEY);
        if (value) {
            localStorage.removeItem(POST_AUTH_REDIRECT_KEY);
        }
        return value;
    }

    function storePendingVerification(email) {
        localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify({
            email: String(email || "").trim(),
            createdAt: Date.now()
        }));
    }

    function getPendingVerification() {
        try {
            const raw = localStorage.getItem(PENDING_VERIFICATION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed?.email) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function clearPendingVerification() {
        localStorage.removeItem(PENDING_VERIFICATION_KEY);
    }

    function storePostUploadSharePrompt(entity) {
        if (!entity?.id || !entity?.entityType) return;
        try {
            sessionStorage.setItem(POST_UPLOAD_SHARE_PROMPT_KEY, JSON.stringify({
                id: entity.id,
                entityType: entity.entityType,
                title: entity.title || "",
                createdAt: Date.now()
            }));
        } catch {}
    }

    function consumePostUploadSharePrompt(entity) {
        if (!entity?.id || !entity?.entityType) return null;
        try {
            const raw = sessionStorage.getItem(POST_UPLOAD_SHARE_PROMPT_KEY);
            if (!raw) return null;
            sessionStorage.removeItem(POST_UPLOAD_SHARE_PROMPT_KEY);
            const parsed = JSON.parse(raw);
            if (parsed?.id === entity.id && parsed?.entityType === entity.entityType) {
                return parsed;
            }
            return null;
        } catch {
            sessionStorage.removeItem(POST_UPLOAD_SHARE_PROMPT_KEY);
            return null;
        }
    }

    let logoutInFlight = false;

    async function performWebsiteLogout() {
        if (logoutInFlight || !hasSupabase()) return;
        logoutInFlight = true;
        closeReplicaMenus();

        try {
            await getSupabase().auth.signOut({ scope: "local" });
        } catch (error) {
            console.error("Local logout failed", error);
        }

        state.session = null;
        state.authUser = null;
        state.profile = null;
        clearPendingVerification();
        signedMediaURLCache.clear();
        buildNav();
        await fillProfilePage();
        await fillEditProfilePage();
        await fillSettingsPage();
        await fillSellerDashboardPage();
        await fillPurchasedBeats();

        try {
            await getSupabase().auth.signOut({ scope: "global" });
        } catch (error) {
            console.error("Global logout failed", error);
        }

        logoutInFlight = false;
        window.location.href = "index.html";
    }

    function buildNav() {
        const navMount = document.querySelector("[data-nav]");
        if (!navMount) return;
        const pendingVerification = getPendingVerification();
        const showVerifyNotice = isLoggedIn() && !isEmailVerified();
        document.body.classList.toggle("has-nav-notice", showVerifyNotice);
        const verifyEmailLabel = state.authUser?.email || pendingVerification?.email || "";

        navMount.innerHTML = `
            <header class="top-nav">
                <div class="container top-nav-inner">
                    <a class="nav-brand" href="index.html" aria-label="SoundSwipe home">
                        <img src="soundswipe_logo3.png" alt="SoundSwipe" />
                    </a>

                    <form class="nav-search" id="global-search-form">
                        <select id="global-search-type" aria-label="Search filter">
                            <option value="beats">Beats</option>
                            <option value="songs">Songs</option>
                            <option value="profiles">Profiles</option>
                        </select>
                        <input id="global-search-input" type="search" placeholder="Search beats, songs, or profiles" value="${escapeHtml(navSearchValue())}" />
                        <button type="submit" aria-label="Search">⌕</button>
                    </form>

                    <div class="nav-actions">
                        <button class="nav-link" id="nav-upload-button" type="button">Upload</button>
                        <a class="nav-secondary" href="${appPreviewHref}">App</a>
                        ${isLoggedIn() ? `
                            <div class="nav-user">
                                <button class="dropdown-trigger" id="user-menu-trigger" type="button">
                                    ${avatarMarkup()}
                                    <span>${escapeHtml(currentUserName())}</span>
                                </button>
                                <div class="dropdown-menu" id="user-menu">
                                    <a href="${escapeHtml(buildPublicProfileURL(state.profile || state.authUser?.user_metadata || {}, { absolute: false }))}">My Profile</a>
                                    <a href="seller-dashboard.html">Seller Dashboard</a>
                                    <a href="purchased-beats.html">Purchased Beats</a>
                                    <a href="settings.html">Settings</a>
                                    <button id="logout-button" type="button">Log Out</button>
                                </div>
                            </div>
                        ` : `
                            <a class="nav-link" href="login.html">Login</a>
                            <a class="nav-primary" href="signup.html">Sign Up</a>
                        `}
                    </div>
                </div>
                ${showVerifyNotice ? `
                    <div class="container nav-notice-wrap">
                        <div class="nav-notice nav-notice--info">
                            <strong>Verify your email</strong>
                            <span>${verifyEmailLabel ? `Check ${escapeHtml(verifyEmailLabel)} for your SoundSwipe verification link.` : "Please confirm your email address to finish setting up your SoundSwipe account."}</span>
                        </div>
                    </div>
                ` : ""}
            </header>
        `;

        const searchType = navMount.querySelector("#global-search-type");
        const searchInput = navMount.querySelector("#global-search-input");
        searchType.value = navSearchType();

        navMount.querySelector("#global-search-form").addEventListener("submit", (event) => {
            event.preventDefault();
            const type = searchType.value;
            const q = searchInput.value.trim();
            localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({ type, q }));
            const url = new URL("search.html", window.location.href);
            url.searchParams.set("type", type);
            if (q) url.searchParams.set("q", q);
            window.location.href = url.toString();
        });

        navMount.querySelector("#nav-upload-button")?.addEventListener("click", () => {
            if (!isLoggedIn()) {
                storePostAuthRedirect("upload.html");
                const url = new URL("login.html", window.location.href);
                url.searchParams.set("intent", "upload");
                window.location.href = url.toString();
                return;
            }
            openUploadChooser();
        });

        document.querySelector("#hero-upload-button")?.addEventListener("click", () => {
            if (!isLoggedIn()) {
                storePostAuthRedirect("upload.html");
                const url = new URL("login.html", window.location.href);
                url.searchParams.set("intent", "upload");
                window.location.href = url.toString();
                return;
            }
            openUploadChooser();
        });

        const trigger = navMount.querySelector("#user-menu-trigger");
        const menu = navMount.querySelector("#user-menu");
        if (trigger && menu) {
            trigger.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                menu.classList.toggle("open");
            });
            menu.addEventListener("click", (event) => {
                event.stopPropagation();
            });
            document.addEventListener("click", (event) => {
                if (!trigger.parentElement.contains(event.target)) {
                    menu.classList.remove("open");
                }
            });
        }

        navMount.querySelector("#logout-button")?.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await performWebsiteLogout();
        });
    }

    function buildModals() {
        const modalMount = document.querySelector("[data-modals]");
        if (!modalMount) return;

        modalMount.innerHTML = `
            <div class="modal-backdrop" id="upload-modal" aria-hidden="true">
                <div class="modal-card">
                    <div class="modal-header">
                        <div>
                            <h2>Start an Upload</h2>
                            <p class="muted">Choose what you want to share to SoundSwipe.</p>
                        </div>
                        <button class="icon-button" id="upload-modal-close" type="button" aria-label="Close">×</button>
                    </div>
                    <div class="upload-choice-grid">
                        <a class="choice-card" href="upload.html?type=beat">
                            <span class="eyebrow">Upload Beat</span>
                            <h3>Beat Release</h3>
                            <p>Artwork, audio, licensing, and beat details.</p>
                            <span class="button-secondary">Continue with Beat</span>
                        </a>
                        <a class="choice-card" href="upload.html?type=song">
                            <span class="eyebrow">Upload Song</span>
                            <h3>Song Release</h3>
                            <p>Artwork, audio, credits, and release details.</p>
                            <span class="button-secondary">Continue with Song</span>
                        </a>
                    </div>
                </div>
            </div>
        `;

        const modal = modalMount.querySelector("#upload-modal");
        modalMount.querySelector("#upload-modal-close")?.addEventListener("click", closeUploadChooser);
        modal?.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeUploadChooser();
            }
        });
    }

    function buildFooter() {
        const shell = document.querySelector(".shell");
        const modalMount = document.querySelector("[data-modals]");
        if (!shell || !modalMount) return;

        shell.querySelector("[data-site-footer]")?.remove();

        const footer = document.createElement("footer");
        footer.className = "site-footer";
        footer.setAttribute("data-site-footer", "");
        footer.innerHTML = `
            <div class="container">
                <div class="site-footer-panel">
                    <div class="site-footer-brand">
                        <a class="site-footer-logo" href="index.html" aria-label="SoundSwipe home">
                            <img src="soundswipe_logo3.png" alt="SoundSwipe" />
                        </a>
                        <p>Discover beats, upload releases, and buy licensed beats with confidence. The mobile app is launching soon.</p>
                    </div>

                    <nav class="site-footer-links" aria-label="Footer">
                        <div class="site-footer-group">
                            <h2>Company</h2>
                            <a href="about.html">About Us</a>
                            <a href="faq.html">FAQ</a>
                            <a href="contact.html">Contact Us</a>
                        </div>
                        <div class="site-footer-group">
                            <h2>Legal</h2>
                            <a href="copyright-dmca.html">Copyright / DMCA</a>
                            <a href="privacy.html">Privacy Policy</a>
                            <a href="terms.html">Terms of Service</a>
                        </div>
                        <div class="site-footer-group">
                            <h2>Social</h2>
                            <a class="site-footer-social" href="https://www.instagram.com/soundswipe.us" target="_blank" rel="noreferrer" aria-label="SoundSwipe Instagram">
                                <span aria-hidden="true">◎</span>
                                Instagram
                            </a>
                        </div>
                    </nav>
                </div>

                <div class="site-footer-bottom">
                    <span>© ${new Date().getFullYear()} SoundSwipe. All rights reserved.</span>
                    <span>Built for artists, producers, and listeners.</span>
                </div>
            </div>
        `;

        shell.insertBefore(footer, modalMount);
    }

    function openUploadChooser() {
        document.querySelector("#upload-modal")?.classList.add("open");
    }

    function closeUploadChooser() {
        document.querySelector("#upload-modal")?.classList.remove("open");
    }

    function showFeedback(selector, message, type = "info") {
        const node = document.querySelector(selector);
        if (!node) return;
        node.textContent = message;
        node.className = node.className.replace(/\b(show|error|success|info)\b/g, "").trim();
        node.classList.add("show", type);
    }

    function clearFeedback(selector) {
        const node = document.querySelector(selector);
        if (!node) return;
        node.textContent = "";
        node.className = node.className.replace(/\b(show|error|success|info)\b/g, "").trim();
    }

    async function ensureProfileForUser(authUser, profileSeed = {}) {
        if (!authUser?.id) return null;

        const supabase = getSupabase();
        const { data: existingProfile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", authUser.id)
            .limit(1)
            .maybeSingle();

        if (existingProfile) {
            const profileUpdates = {};
            const seedDisplayName = profileSeed.displayName || authUser.user_metadata?.display_name || "";
            const seedUsername = (profileSeed.username || authUser.user_metadata?.username || "").replace(/^@/, "").toLowerCase();
            const seedDateOfBirth = profileSeed.dateOfBirth || "";
            const seedUserType = profileSeed.userType || "";

            if (!existingProfile.display_name && seedDisplayName) profileUpdates.display_name = seedDisplayName;
            if (!existingProfile.username && seedUsername) profileUpdates.username = seedUsername;
            if (!existingProfile.date_of_birth && seedDateOfBirth) profileUpdates.date_of_birth = seedDateOfBirth;
            if (!existingProfile.user_type && seedUserType) profileUpdates.user_type = seedUserType;

            let resolvedProfile = existingProfile;
            if (Object.keys(profileUpdates).length) {
                const { data: updatedProfile, error: updateError } = await supabase
                    .from("profiles")
                    .update(profileUpdates)
                    .eq("id", authUser.id)
                    .select("*")
                    .single();

                if (updateError) {
                    console.error("Profile backfill failed", updateError);
                } else if (updatedProfile) {
                    resolvedProfile = updatedProfile;
                }
            }

            const hydratedProfile = await hydrateProfileMedia(resolvedProfile);
            state.profile = hydratedProfile;
            return hydratedProfile;
        }

        if (profileError && profileError.code !== "PGRST116") {
            console.error("Profile fetch failed", profileError);
            return null;
        }

        const email = authUser.email || profileSeed.email || "";
        const displayName = profileSeed.displayName || authUser.user_metadata?.display_name || email.split("@")[0] || "SoundSwipe User";
        const rawUsername = profileSeed.username || authUser.user_metadata?.username || displayName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24);
        const username = rawUsername.replace(/^_+|_+$/g, "") || `user_${authUser.id.slice(0, 8)}`;
        const dateOfBirth = profileSeed.dateOfBirth || null;

        const insertPayload = {
            id: authUser.id,
            email,
            display_name: displayName,
            username,
            date_of_birth: dateOfBirth,
            bio: null,
            profile_image_url: null,
            banner_image_url: null,
            followers: 0,
            following: 0,
            is_verified: false,
            uploaded_beats: 0,
            uploaded_songs: 0,
            liked_content: 0,
            user_type: profileSeed.userType || null,
            preferences_completed: false
        };

        const { data: createdProfile, error: insertError } = await supabase
            .from("profiles")
            .insert(insertPayload)
            .select("*")
            .single();

        if (insertError) {
            console.error("Profile creation failed", insertError);
            return null;
        }

        const hydratedProfile = await hydrateProfileMedia(createdProfile);
        state.profile = hydratedProfile;
        return hydratedProfile;
    }

    async function syncSessionState() {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.getSession();
        if (error) {
            console.error("Session restore failed", error);
        }

        state.session = data?.session || null;
        state.authUser = data?.session?.user || null;
        state.profile = null;

        if (state.authUser) {
            if (isEmailVerified(state.authUser)) {
                clearPendingVerification();
            }
            await ensureProfileForUser(state.authUser);
        }
    }

    async function handleProtectedPage() {
        const page = document.body.dataset.page;
        if (page === "profile" && !isLoggedIn()) {
            const params = new URLSearchParams(window.location.search);
            if (!params.get("id")) {
                storePostAuthRedirect(currentRedirectURL());
                const url = new URL("login.html", window.location.href);
                url.searchParams.set("redirect", currentRedirectURL());
                window.location.href = url.toString();
            }
            return;
        }

        if (!protectedPages.has(page) || isLoggedIn()) return;

        storePostAuthRedirect(currentRedirectURL());
        const url = new URL("login.html", window.location.href);
        url.searchParams.set("redirect", currentRedirectURL());
        window.location.href = url.toString();
    }

    async function wireAuthForms() {
        const loginForm = document.querySelector("[data-login-form]");
        const signupForm = document.querySelector("[data-signup-form]");
        const pendingVerification = getPendingVerification();

        if ((loginForm || signupForm) && pendingVerification) {
            showFeedback(
                "[data-auth-status]",
                `Email not verified yet. Check ${pendingVerification.email} for your SoundSwipe verification link, then sign in here.`,
                "info"
            );
        }

        loginForm?.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFeedback("[data-auth-feedback]");

            const email = loginForm.querySelector('[name="email"]').value.trim();
            const password = loginForm.querySelector('[name="password"]').value;

            try {
                const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
                if (error) throw error;

                state.session = data.session;
                state.authUser = data.user;
                if (isEmailVerified(data.user)) {
                    clearPendingVerification();
                }
                await ensureProfileForUser(data.user, { email });
                buildNav();
                routeAfterAuth();
            } catch (error) {
                showFeedback("[data-auth-feedback]", normalizeAuthError(error, "Login failed."), "error");
            }
        });

        signupForm?.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFeedback("[data-auth-feedback]");
            clearFeedback("[data-auth-status]");

            const email = signupForm.querySelector('[name="email"]').value.trim();
            const password = signupForm.querySelector('[name="password"]').value;
            const displayName = signupForm.querySelector('[name="display_name"]').value.trim();
            const firstName = signupForm.querySelector('[name="first_name"]').value.trim();
            const lastName = signupForm.querySelector('[name="last_name"]').value.trim();
            const username = signupForm.querySelector('[name="username"]').value.trim().replace(/^@/, "");
            const dateOfBirth = signupForm.querySelector('[name="date_of_birth"]').value || null;
            const userType = buildUserTypeValue({
                artist: Boolean(signupForm.querySelector('[name="user_type_artist"]')?.checked),
                producer: Boolean(signupForm.querySelector('[name="user_type_producer"]')?.checked)
            }) || null;

            try {
                const { data, error } = await getSupabase().auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: window.SoundSwipeSupabaseConfig.callbackURL,
                        data: {
                            display_name: displayName,
                            username,
                            first_name: firstName,
                            last_name: lastName,
                            full_name: [firstName, lastName].filter(Boolean).join(" ").trim()
                        }
                    }
                });

                if (error) throw error;

                if (data.session && data.user) {
                    state.session = data.session;
                    state.authUser = data.user;
                    storePendingVerification(email);
                    await ensureProfileForUser(data.user, { email, displayName, username, dateOfBirth, userType, firstName, lastName });
                    buildNav();
                    routeAfterAuth();
                    return;
                }
                try {
                    const loginAttempt = await getSupabase().auth.signInWithPassword({ email, password });
                    if (!loginAttempt.error && loginAttempt.data?.session && loginAttempt.data?.user) {
                        state.session = loginAttempt.data.session;
                        state.authUser = loginAttempt.data.user;
                        storePendingVerification(email);
                        await ensureProfileForUser(loginAttempt.data.user, { email, displayName, username, dateOfBirth, userType, firstName, lastName });
                        buildNav();
                        routeAfterAuth();
                        return;
                    }
                } catch {}

                storePendingVerification(email);
                buildNav();
                showFeedback(
                    "[data-auth-status]",
                    `Account created. Email not verified yet. Check ${email} for your SoundSwipe verification link, then finish sign-in here.`,
                    "info"
                );
            } catch (error) {
                showFeedback("[data-auth-feedback]", normalizeAuthError(error, "Sign up failed."), "error");
            }
        });

        document.querySelectorAll("[data-social-login]").forEach((button) => {
            button.addEventListener("click", async () => {
                clearFeedback("[data-auth-feedback]");
                const provider = button.dataset.socialProvider;
                if (!provider) return;

                try {
                    storePostAuthRedirect(resolveRequestedRedirect());
                    const { error } = await getSupabase().auth.signInWithOAuth({
                        provider,
                        options: {
                            redirectTo: window.SoundSwipeSupabaseConfig.callbackURL
                        }
                    });
                    if (error) throw error;
                } catch (error) {
                    showFeedback("[data-auth-feedback]", normalizeAuthError(error, `${capitalize(provider)} sign-in failed.`), "error");
                }
            });
        });
    }

    function resolveRequestedRedirect() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("redirect")) {
            return params.get("redirect");
        }
        if (params.get("intent") === "upload") {
            return "upload.html";
        }
        return "profile.html";
    }

    function routeAfterAuth() {
        const params = new URLSearchParams(window.location.search);
        const explicitRedirect = consumePostAuthRedirect() || params.get("redirect") || (params.get("intent") === "upload" ? "upload.html" : "");
        const shouldCompleteProfile = state.profile && state.profile.preferences_completed === false;
        const redirect = explicitRedirect || (shouldCompleteProfile
            ? "edit-profile.html?setup=1"
            : buildPublicProfileURL(state.profile || state.authUser?.user_metadata || {}, { absolute: false }));
        window.location.href = redirect;
    }

    async function handleAuthCallbackPage() {
        if (document.body.dataset.page !== "auth-callback") return;

        const statusNode = document.querySelector("[data-callback-status]");
        const setStatus = (message, type = "info") => {
            if (!statusNode) return;
            statusNode.textContent = message;
            statusNode.className = "auth-status show " + type;
        };

        try {
            await syncSessionState();
            if (state.authUser) {
                await ensureProfileForUser(state.authUser);
                setStatus("Signed in successfully. Redirecting to your SoundSwipe web workspace…", "success");
                setTimeout(routeAfterAuth, 500);
                return;
            }

            setStatus("We couldn’t finish the login handoff. Please try signing in again.", "error");
        } catch (error) {
            console.error("Auth callback failed", error);
            setStatus(normalizeAuthError(error, "Authentication callback failed."), "error");
        }
    }

    function normalizeAuthError(error, fallback) {
        const message = error?.message || error?.error_description || String(error || fallback);
        const lower = message.toLowerCase();

        if (lower.includes("email not confirmed")) {
            return "Please verify your email address before logging in.";
        }
        if (lower.includes("invalid login credentials")) {
            return "Invalid email or password. Please check your credentials and try again.";
        }
        if (lower.includes("user already registered")) {
            return "An account with this email already exists. Try logging in instead.";
        }
        if (lower.includes("password should be at least")) {
            return "Password must be at least 6 characters.";
        }

        return message || fallback;
    }

    function capitalize(value) {
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    function currentStripeEnvironment() {
        return window.SoundSwipeStripeConfig?.environment === "live" ? "live" : "test";
    }

    function purchaseEnvironmentColumnMissing(error) {
        const message = String(error?.message || error?.details || "").toLowerCase();
        return message.includes("environment") && message.includes("purchases");
    }

    function renderLoadMoreButton(visibleCount, totalCount, context) {
        if (totalCount <= visibleCount) return "";
        return `
            <div class="load-more-wrap">
                <button class="button-secondary load-more-button" type="button" data-load-more="${escapeHtml(context)}">
                    Load More
                </button>
            </div>
        `;
    }

    function profileVisibleCountKey() {
        return profilePageState.activeTab === "likes"
            ? `likes_${profilePageState.likesFilter}`
            : profilePageState.activeTab;
    }

    function renderBeatKeyOptionList(selectedValue = "") {
        return BEAT_KEY_OPTIONS.map((value) => `<option value="${escapeHtml(value)}" ${selectedValue === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
    }

    async function fillSearchPage() {
        const resultsMount = document.querySelector("[data-search-results]");
        const filtersMount = document.querySelector("[data-search-filters]");
        if (!resultsMount || !filtersMount) return;

        const params = new URLSearchParams(window.location.search);
        const rawType = params.get("type") || "beats";
        const map = { beat: "beats", song: "songs", profile: "profiles" };
        const type = map[rawType] || rawType;
        const query = (params.get("q") || "").trim().toLowerCase();
        searchPageState.type = type;
        searchPageState.query = query;
        searchPageState.visibleCount = 15;

        const [liveBeatPool, liveSongPool, liveProfilePool] = hasSupabase()
            ? await Promise.all([
                fetchSearchBeatPool(query),
                fetchSearchSongPool(query),
                fetchSearchProfilePool(query)
            ])
            : [[], [], []];
        const beatPool = liveBeatPool;
        const songPool = liveSongPool;
        const profilePool = liveProfilePool;

        const meta = document.querySelector("[data-search-meta]");

        const renderSearchPage = () => {
            filtersMount.innerHTML = renderSearchFilters(type);
            bindSearchFilters(type, renderSearchPage);

            let filtered = [];
            if (type === "beats") {
                filtered = applyBeatSearchFilters(beatPool, query);
                const visibleItems = filtered.slice(0, searchPageState.visibleCount);
                resultsMount.innerHTML = filtered.length
                    ? `<div class="search-card-grid">${visibleItems.map((item) => renderSearchBeatCard(item)).join("")}</div>${renderLoadMoreButton(searchPageState.visibleCount, filtered.length, "search")}`
                    : `<div class="empty-state">No beats matched this search yet. Try another keyword or adjust the filters.</div>`;
            } else if (type === "songs") {
                filtered = applySongSearchFilters(songPool, query);
                const visibleItems = filtered.slice(0, searchPageState.visibleCount);
                resultsMount.innerHTML = filtered.length
                    ? `<div class="search-card-grid">${visibleItems.map((item) => renderSearchSongCard(item)).join("")}</div>${renderLoadMoreButton(searchPageState.visibleCount, filtered.length, "search")}`
                    : `<div class="empty-state">No songs matched this search yet. Try another keyword or adjust the filters.</div>`;
            } else {
                filtered = applyProfileSearchFilters(profilePool, query);
                resultsMount.innerHTML = filtered.length
                    ? `<div class="search-profile-list">${filtered.map(renderSearchProfileRow).join("")}</div>`
                    : `<div class="empty-state">No profiles matched this search yet. Try another name or username.</div>`;
            }

            if (meta) {
                meta.textContent = query
                    ? `${filtered.length} ${type} results for “${query}”`
                    : `Showing ${type} discovery results`;
            }

            resultsMount.querySelector('[data-load-more="search"]')?.addEventListener("click", () => {
                searchPageState.visibleCount += 15;
                renderSearchPage();
            });

            initializeDiscoverPlayback();
        };

        renderSearchPage();
    }

    async function fetchSearchBeatPool(query) {
        if (!hasSupabase()) return [];
        const beatSelect = "id, user_id, title, album_url, bpm, key, tags, description, producer_display_name, additional_producers, file_mp3_url, upload_date, public_license_state, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, profiles!beats_user_id_fkey(display_name, username, profile_image_url)";
        const { data, error } = await executeBeatSelectWithFallback((selectClause) => {
            return filterVisibleBeats(getSupabase()
                .from("beats")
                .select(selectClause)
                .order("upload_date", { ascending: false })
                .limit(120));
        }, beatSelect);
        if (error) {
            console.error("Search beat pool query failed", error);
            return [];
        }
        const filtered = (data || []).filter((beat) => {
            if (!query) return true;
            const profile = beat.profiles || {};
            return searchValueIncludesAllTokens([
                beat.title,
                beat.description,
                beat.key,
                beat.bpm,
                beat.tags,
                profile.display_name,
                profile.username
            ], query);
        }).slice(0, 60);

        return Promise.all(filtered.map(async (beat, index) => {
            const profile = beat.profiles || {};
            const producerCreditState = await enrichBeatProducerCreditState(normalizeBeatProducerCredits({
                user_id: beat.user_id,
                username: profile.username,
                display_name: profile.display_name || profile.username,
                profile_image_url: profile.profile_image_url || ""
            }, beat.additional_producers));
            const creatorName = producerCreditState.names[0] || profile.display_name || profile.username || "Unknown Producer";
            return hydrateBeatCardMedia(normalizeSeedBeatCard({
                id: beat.id,
                userId: beat.user_id,
                title: beat.title || "Untitled Beat",
                image: beat.album_url || "",
                audioFile: beat.file_mp3_url || "",
                creatorName,
                creatorUsername: profile.username || "",
                creatorAvatar: profile.profile_image_url || "",
                producers: producerCreditState.names.length ? producerCreditState.names : [creatorName].filter(Boolean),
                producerCredits: producerCreditState.all,
                linkedProducerCredits: producerCreditState.linked,
                manualProducerCredits: producerCreditState.manual,
                bpm: beat.bpm || null,
                key: beat.key || null,
                tags: Array.isArray(beat.tags) ? beat.tags : [],
                description: beat.description || "",
                publicLicenseState: beat.public_license_state === "free_for_non_profit" ? "Free for Non-Profit" : "License Required",
                basicLicenseEnabled: beat.basic_license_enabled !== false,
                premiumLicenseEnabled: Boolean(beat.premium_license_enabled),
                exclusiveLicenseEnabled: Boolean(beat.exclusive_license_enabled),
                uploadDate: beat.upload_date || null,
                waveformSeed: beat.id || `beat-${index}`,
                durationLabel: "0:57",
                href: buildPublicContentShareURL("beat", beat, beat.title, { absolute: false })
            }));
        }));
    }

    async function fetchSearchSongPool(query) {
        if (!hasSupabase()) return [];
        const request = getSupabase()
            .from("songs")
            .select("id, user_id, title, album_art, export_file_url, release_date, genre, tags, producer_tags")
            .order("release_date", { ascending: false })
            .limit(120);
        const { data, error } = await request;
        if (error) {
            console.error("Search song pool query failed", error);
            return [];
        }
        const filtered = (data || []).filter((song) => {
            if (!query) return true;
            const producerNames = Array.isArray(song.producer_tags)
                ? song.producer_tags.map((tag) => tag?.displayName || tag?.display_name || tag?.username).filter(Boolean)
                : [];
            return searchValueIncludesAllTokens([
                song.title,
                song.genre,
                song.tags,
                producerNames
            ], query);
        }).slice(0, 60);

        return Promise.all(filtered.map(async (song, index) => {
            const producerNames = Array.isArray(song.producer_tags)
                ? song.producer_tags.map((tag) => tag?.displayName || tag?.display_name || tag?.username).filter(Boolean)
                : [];
            return hydrateSongCardMedia(normalizeSeedSongCard({
                id: song.id,
                userId: song.user_id,
                title: song.title || "Untitled Song",
                image: song.album_art || "",
                audioFile: song.export_file_url || "",
                creatorName: producerNames[0] || "SoundSwipe Artist",
                producers: producerNames,
                tags: Array.isArray(song.tags) ? song.tags : [song.genre].filter(Boolean),
                description: "",
                releaseDate: song.release_date || null,
                waveformSeed: song.id || `song-${index}`,
                durationLabel: "1:08",
                href: buildPublicContentShareURL("song", song, song.title, { absolute: false })
            }));
        }));
    }

    async function fetchSearchProfilePool(query) {
        if (!hasSupabase()) return [];
        let request = getSupabase()
            .from("profiles")
            .select("id, display_name, username, user_type, profile_image_url, followers, uploaded_beats, uploaded_songs")
            .order("followers", { ascending: false })
            .limit(60);
        if (query) {
            request = request.or(`display_name.ilike.%${query}%,username.ilike.%${query}%`);
        }
        const { data, error } = await request;
        if (error) {
            console.error("Search profile pool query failed", error);
            return [];
        }
        const hydratedProfiles = await hydrateProfilesMedia(data || []);
        return hydratedProfiles.map((item) => ({
            id: item.id,
            name: item.display_name || item.username || "SoundSwipe Creator",
            username: item.username ? `@${item.username}` : "@soundswipe",
            usernameRaw: item.username || "",
            role: prettifyUserType(item.user_type),
            image: item.profile_image_url || "",
            followers: compactCount(item.followers || 0),
            uploads: (Number(item.uploaded_beats) || 0) + (Number(item.uploaded_songs) || 0),
            href: buildPublicProfileURL({ id: item.id, usernameRaw: item.username }, { absolute: false })
        }));
    }

    function renderSearchFilters(type) {
        if (type === "profiles") {
            return `
                <div class="search-filter-panel">
                    <div>
                        <span class="eyebrow">Filters</span>
                        <h2>Profiles</h2>
                        <p class="muted">Browse profiles.</p>
                    </div>
                </div>
            `;
        }

        if (type === "songs") {
            return `
                <div class="search-filter-panel">
                    <div>
                        <span class="eyebrow">Filters</span>
                        <h2>Songs</h2>
                        <p class="muted">Filter song results.</p>
                    </div>
                    <div class="field">
                        <label for="search-song-recency">Recency</label>
                        <select id="search-song-recency" data-search-filter="song-recency">
                            <option value="any" ${searchPageState.songFilters.recency === "any" ? "selected" : ""}>Any time</option>
                            <option value="7" ${searchPageState.songFilters.recency === "7" ? "selected" : ""}>Last 7 days</option>
                            <option value="30" ${searchPageState.songFilters.recency === "30" ? "selected" : ""}>Last 30 days</option>
                            <option value="90" ${searchPageState.songFilters.recency === "90" ? "selected" : ""}>Last 90 days</option>
                        </select>
                    </div>
                </div>
            `;
        }

        return `
            <div class="search-filter-panel">
                <div>
                    <span class="eyebrow">Filters</span>
                    <h2>Beats</h2>
                    <p class="muted">Filter beat results.</p>
                </div>
                <div class="search-filter-group">
                    <label>BPM</label>
                    ${renderBpmDualSlider(searchPageState.beatFilters.bpmMin, searchPageState.beatFilters.bpmMax, "search")}
                </div>
                <div class="field">
                    <label for="search-beat-key">Key</label>
                    <select id="search-beat-key" data-search-filter="beat-key">
                        <option value="">Any key</option>
                        ${renderBeatKeyOptionList(searchPageState.beatFilters.key)}
                    </select>
                </div>
                <div class="field">
                    <label for="search-beat-recency">Recency</label>
                    <select id="search-beat-recency" data-search-filter="beat-recency">
                        <option value="any" ${searchPageState.beatFilters.recency === "any" ? "selected" : ""}>Any time</option>
                        <option value="7" ${searchPageState.beatFilters.recency === "7" ? "selected" : ""}>Last 7 days</option>
                        <option value="30" ${searchPageState.beatFilters.recency === "30" ? "selected" : ""}>Last 30 days</option>
                        <option value="90" ${searchPageState.beatFilters.recency === "90" ? "selected" : ""}>Last 90 days</option>
                    </select>
                </div>
                <div class="field">
                    <label for="search-beat-license">Paid License Tier</label>
                    <select id="search-beat-license" data-search-filter="beat-license">
                        <option value="any" ${searchPageState.beatFilters.licenseTier === "any" ? "selected" : ""}>Any tier</option>
                        <option value="basic" ${searchPageState.beatFilters.licenseTier === "basic" ? "selected" : ""}>Basic</option>
                        <option value="premium" ${searchPageState.beatFilters.licenseTier === "premium" ? "selected" : ""}>Premium</option>
                        <option value="exclusive" ${searchPageState.beatFilters.licenseTier === "exclusive" ? "selected" : ""}>Exclusive</option>
                    </select>
                </div>
            </div>
        `;
    }

    function bindSearchFilters(type, rerender) {
        document.querySelectorAll("[data-search-filter]").forEach((node) => {
            const key = node.dataset.searchFilter;
            const applyState = () => {
                searchPageState.visibleCount = 15;
                if (type === "beats") {
                    if (key === "bpm-min") {
                        const nextMin = Math.min(Number(node.value || 0), Number(searchPageState.beatFilters.bpmMax || 240));
                        searchPageState.beatFilters.bpmMin = String(nextMin);
        syncDualSliderUI("search", searchPageState.beatFilters.bpmMin, searchPageState.beatFilters.bpmMax);
        bindDualSliderInteractions("search", {
            getMin: () => searchPageState.beatFilters.bpmMin || "0",
            getMax: () => searchPageState.beatFilters.bpmMax || "240",
            update: (which, value) => {
                if (which === "min") {
                    const nextMin = Math.min(value, Number(searchPageState.beatFilters.bpmMax || 240));
                    searchPageState.beatFilters.bpmMin = String(nextMin);
                } else {
                    const nextMax = Math.max(value, Number(searchPageState.beatFilters.bpmMin || 0));
                    searchPageState.beatFilters.bpmMax = String(nextMax);
                }
                searchPageState.visibleCount = 15;
                syncDualSliderUI("search", searchPageState.beatFilters.bpmMin, searchPageState.beatFilters.bpmMax);
            },
            commit: () => rerender()
        });
    }
                    if (key === "bpm-max") {
                        const nextMax = Math.max(Number(node.value || 240), Number(searchPageState.beatFilters.bpmMin || 0));
                        searchPageState.beatFilters.bpmMax = String(nextMax);
                        syncDualSliderUI("search", searchPageState.beatFilters.bpmMin, searchPageState.beatFilters.bpmMax);
                    }
                    if (key === "beat-key") searchPageState.beatFilters.key = node.value;
                    if (key === "beat-recency") searchPageState.beatFilters.recency = node.value;
                    if (key === "beat-license") searchPageState.beatFilters.licenseTier = node.value;
                } else if (type === "songs" && key === "song-recency") {
                    searchPageState.songFilters.recency = node.value;
                }
            };

            if (node.type === "range") {
                node.addEventListener("input", applyState);
                node.addEventListener("change", () => {
                    applyState();
                    rerender();
                });
                node.addEventListener("pointerup", () => {
                    rerender();
                });
                return;
            }

            const eventName = node.tagName === "SELECT" ? "change" : "input";
            node.addEventListener(eventName, () => {
                applyState();
                rerender();
            });
        });

        if (type === "beats") {
            syncDualSliderUI("search", searchPageState.beatFilters.bpmMin, searchPageState.beatFilters.bpmMax);
        }
    }

    function applyBeatSearchFilters(items, query) {
        const { bpmMin, bpmMax, key, recency, licenseTier } = searchPageState.beatFilters;
        return items.filter((item) => {
            if (query) {
                const haystack = JSON.stringify([item.title, item.creatorName, item.producers, item.tags, item.key, item.description]).toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            if (bpmMin && Number(item.bpm) < Number(bpmMin)) return false;
            if (bpmMax && Number(item.bpm) > Number(bpmMax)) return false;
            if (key && item.key !== key) return false;
            if (licenseTier !== "any") {
                if (licenseTier === "basic" && !item.basicLicenseEnabled) return false;
                if (licenseTier === "premium" && !item.premiumLicenseEnabled) return false;
                if (licenseTier === "exclusive" && !item.exclusiveLicenseEnabled) return false;
            }
            if (!passesRecencyFilter(item.uploadDate, recency)) return false;
            return true;
        });
    }

    function applySongSearchFilters(items, query) {
        const { recency } = searchPageState.songFilters;
        return items.filter((item) => {
            if (query) {
                const haystack = JSON.stringify([item.title, item.creatorName, item.producers, item.tags, item.description, item.album]).toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            if (!passesRecencyFilter(item.releaseDate, recency)) return false;
            return true;
        });
    }

    function applyProfileSearchFilters(items, query) {
        return items.filter((item) => {
            if (!query) return true;
            return JSON.stringify([item.name, item.username, item.role]).toLowerCase().includes(query);
        });
    }

    function passesRecencyFilter(dateValue, filterValue) {
        if (!filterValue || filterValue === "any" || !dateValue) return true;
        const timestamp = new Date(dateValue).getTime();
        if (Number.isNaN(timestamp)) return true;
        const maxDays = Number(filterValue);
        const daysOld = (Date.now() - timestamp) / 86400000;
        return daysOld <= maxDays;
    }

    function renderSearchBeatCard(item) {
        return renderBeatDiscoverReplicaCard(item, 0);
    }

    function renderSearchSongCard(item) {
        return renderSongDiscoverReplicaCard(item, 0);
    }

    function renderSearchProfileRow(item) {
        return `
            <a class="search-result-row search-profile-row" href="${item.href}">
                ${renderProfileIdentityAvatar({
                    image: item.image,
                    name: item.name,
                    username: item.username,
                    className: "search-profile-avatar"
                })}
                <div>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${escapeHtml(item.username)}</p>
                    <div class="chip-row" style="margin-top:8px;">
                        <span class="chip">${escapeHtml(item.role)}</span>
                        <span class="chip">${escapeHtml(String(item.uploads))} uploads</span>
                    </div>
                </div>
                <div class="content-side">
                    <strong>${escapeHtml(item.followers)}</strong>
                    <div>Followers</div>
                </div>
            </a>
        `;
    }

    function initializeHeroCarousel() {
        const carousels = Array.from(document.querySelectorAll("[data-hero-carousel]"));
        if (!carousels.length) return;

        carousels.forEach((carousel) => {
            const slides = Array.from(carousel.querySelectorAll(".phone-slide"));
            if (slides.length <= 1) return;

            let currentIndex = 0;

            window.setInterval(() => {
                slides[currentIndex].classList.remove("is-active");
                currentIndex = (currentIndex + 1) % slides.length;
                slides[currentIndex].classList.add("is-active");
            }, 2800);
        });
    }

    function uniqueContentItems(liveItems, minimumCount = 7) {
        const items = [];
        const seen = new Set();

        (liveItems || []).forEach((item) => {
            if (!item?.id || seen.has(item.id)) return;
            seen.add(item.id);
            items.push(item);
        });

        if (items.length <= minimumCount) return items;
        return items.slice(0, Math.max(minimumCount, 9));
    }

    function formatDurationLabel(totalSeconds) {
        const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds % 60;
        return `${minutes}:${String(remainder).padStart(2, "0")}`;
    }

    async function fillDiscoverPage() {
        const beatsMount = document.querySelector("[data-trending-beats]");
        const songsMount = document.querySelector("[data-trending-songs]");
        const profilesMount = document.querySelector("[data-trending-profiles]");
        if (!beatsMount && !songsMount && !profilesMount) return;

        let beats = [];
        let songs = [];
        let profiles = [];

        if (hasSupabase()) {
            const [beatsResult, songsResult, profilesResult] = await Promise.allSettled([
                fetchTrendingBeats(),
                fetchTrendingSongs(),
                fetchTrendingProfiles()
            ]);

            if (beatsResult.status === "fulfilled" && beatsResult.value.length) {
                beats = beatsResult.value;
            }
            if (songsResult.status === "fulfilled" && songsResult.value.length) {
                songs = songsResult.value;
            }
            if (profilesResult.status === "fulfilled" && profilesResult.value.length) {
                profiles = profilesResult.value;
            }
        }

        const liveBeats = uniqueContentItems(beats);
        const liveSongs = uniqueContentItems(songs);

        if (beatsMount) {
            beatsMount.innerHTML = liveBeats.length
                ? renderDiscoverCoverflow("beats", liveBeats, renderBeatDiscoverReplicaCard)
                : renderDiscoverEmpty("No trending beats yet", "Real beat uploads will appear here once creators start posting.");
        }

        if (songsMount) {
            songsMount.innerHTML = liveSongs.length
                ? renderDiscoverCoverflow("songs", liveSongs, renderSongDiscoverReplicaCard)
                : renderDiscoverEmpty("No trending songs yet", "Real song uploads will appear here once artists start posting.");
        }

        if (profilesMount) {
            profilesMount.innerHTML = profiles.length
                ? renderDiscoverCoverflow("profiles", profiles, renderProfileDiscoverCard)
                : renderDiscoverEmpty("No trending profiles yet", "Creator activity, follows, and uploads will surface profiles here as the community grows.");
        }

        initializeDiscoverCarousels();
    }

    async function fetchTrendingBeats() {
        const beatSelect = "id, user_id, title, album_url, bpm, key, tags, likes, comments, shares, upload_date, genre, mood, producer_display_name, additional_producers, file_mp3_url, public_license_state, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, basic_license_price, premium_license_price, exclusive_license_price, profiles!beats_user_id_fkey(display_name, username, profile_image_url)";
        const { data, error } = await executeBeatSelectWithFallback((selectClause) => {
            return filterVisibleBeats(getSupabase()
                .from("beats")
                .select(selectClause)
                .order("likes", { ascending: false })
                .order("comments", { ascending: false })
                .order("shares", { ascending: false })
                .order("upload_date", { ascending: false })
                .limit(18));
        }, beatSelect);

        if (error) {
            console.error("Trending beats query failed", error);
            return [];
        }

        const hydrated = await Promise.all((data || []).map(async (beat) => {
            const profile = beat.profiles || {};
            const producerCreditState = await enrichBeatProducerCreditState(normalizeBeatProducerCredits({
                user_id: beat.user_id,
                username: profile.username,
                display_name: profile.display_name || profile.username,
                profile_image_url: profile.profile_image_url || ""
            }, beat.additional_producers));
            const creatorName = producerCreditState.names[0] || profile.display_name || profile.username || "Unknown Producer";
            const producerNames = producerCreditState.names.length ? producerCreditState.names : [creatorName].filter(Boolean);
            const license = beat.public_license_state === "free_for_non_profit" ? "Free for Non-Profit" : "License Required";
            const price = firstPriceLabel(beat);
            return hydrateBeatCardMedia(normalizeSeedBeatCard({
                id: beat.id,
                userId: beat.user_id,
                title: beat.title || "Untitled Beat",
                image: beat.album_url || "",
                audioFile: beat.file_mp3_url || "",
                producers: producerNames.length ? producerNames : ["Unknown Producer"],
                creatorName,
                creatorUsername: profile.username || "",
                creatorHandle: profile.username ? `@${profile.username}` : `@${String((creatorName || "producer").toLowerCase().replace(/[^a-z0-9]+/g, ""))}`,
                creatorAvatar: profile.profile_image_url || "",
                producerCredits: producerCreditState.all,
                linkedProducerCredits: producerCreditState.linked,
                manualProducerCredits: producerCreditState.manual,
                bpm: beat.bpm || null,
                key: beat.key || null,
                tags: Array.isArray(beat.tags) ? beat.tags : [],
                likes: Number(beat.likes) || 0,
                comments: Number(beat.comments) || 0,
                shares: Number(beat.shares) || 0,
                genre: beat.genre || "Beat",
                mood: beat.mood || null,
                license,
                price,
                basicLicenseEnabled: beat.basic_license_enabled !== false,
                premiumLicenseEnabled: Boolean(beat.premium_license_enabled),
                exclusiveLicenseEnabled: Boolean(beat.exclusive_license_enabled),
                href: buildPublicContentShareURL("beat", beat, beat.title, { absolute: false }),
                uploadDate: beat.upload_date || null,
                waveformSeed: beat.id,
                currentTimeLabel: "0:00",
                durationLabel: "0:00"
            }));
        }));

        return stableSort(hydrated, (beat) => {
            const recency = recencyBoost(beat.uploadDate);
            return beat.likes * 5 + beat.comments * 3 + beat.shares * 4 + recency;
        }).slice(0, 12);
    }

    async function fetchTrendingSongs() {
        const { data, error } = await getSupabase()
            .from("songs")
            .select("id, user_id, title, album_art, export_file_url, plays, likes, comments, shares, release_date, genre, tags, description, producer_tags")
            .order("plays", { ascending: false })
            .order("likes", { ascending: false })
            .order("comments", { ascending: false })
            .order("release_date", { ascending: false })
            .limit(18);

        if (error) {
            console.error("Trending songs query failed", error);
            return [];
        }

        const hydrated = await Promise.all((data || []).map(async (song) => {
            const producerTags = Array.isArray(song.producer_tags) ? song.producer_tags : [];
            const producerNames = producerTags.map((tag) => tag?.displayName || tag?.display_name || tag?.username).filter(Boolean);
            return hydrateSongCardMedia(normalizeSeedSongCard({
                id: song.id,
                userId: song.user_id,
                title: song.title || "Untitled Song",
                image: song.album_art || "",
                audioFile: song.export_file_url || "",
                creatorName: producerNames[0] || "SoundSwipe Artist",
                creatorUsername: "",
                creatorHandle: `@${String((producerNames[0] || song.title || "artist").toLowerCase().replace(/[^a-z0-9]+/g, ""))}`,
                creatorAvatar: "",
                plays: Number(song.plays) || 0,
                likes: Number(song.likes) || 0,
                comments: Number(song.comments) || 0,
                shares: Number(song.shares) || 0,
                genre: song.genre || "Song",
                tags: Array.isArray(song.tags) ? song.tags : [],
                description: song.description || "",
                producers: producerNames,
                href: buildPublicContentShareURL("song", song, song.title, { absolute: false }),
                releaseDate: song.release_date || null,
                waveformSeed: song.id,
                currentTimeLabel: "0:00",
                durationLabel: "0:00"
            }));
        }));

        return stableSort(hydrated, (song) => {
            const recency = recencyBoost(song.releaseDate);
            return song.plays + song.likes * 6 + song.comments * 4 + song.shares * 5 + recency;
        }).slice(0, 12);
    }

    function normalizeSeedBeatCard(beat) {
        const linkedProducerCredits = Array.isArray(beat.linkedProducerCredits) ? beat.linkedProducerCredits : [];
        const manualProducerCredits = Array.isArray(beat.manualProducerCredits) ? beat.manualProducerCredits : [];
        const producerCredits = Array.isArray(beat.producerCredits) ? beat.producerCredits : [];
        return {
            ...beat,
            image: beat.image || beat.albumArt || "",
            producers: beat.producers?.length ? beat.producers : [beat.creatorName].filter(Boolean),
            creatorName: beat.creatorName || beat.producers?.[0] || "SoundSwipe Producer",
            creatorUsername: normalizeUsernameValue(beat.creatorUsername || beat.creatorHandle || ""),
            creatorHandle: beat.creatorHandle || "@soundswipe",
            creatorAvatar: beat.creatorAvatar || "",
            tags: Array.isArray(beat.tags) && beat.tags.length ? beat.tags.slice(0, 2) : [beat.genre, beat.mood].filter(Boolean).slice(0, 2),
            waveformSeed: beat.waveformSeed || beat.id || beat.title,
            currentTimeLabel: "0:00",
            durationLabel: beat.durationLabel || "0:00",
            audioFile: beat.audioFile || "",
            userId: beat.userId || beat.user_id || "",
            producerCredits,
            linkedProducerCredits,
            manualProducerCredits,
            isOwnedByCurrentUser: Boolean(beat.isOwnedByCurrentUser || ((beat.userId || beat.user_id) && (beat.userId || beat.user_id) === state.authUser?.id)),
            href: beat.href || buildPublicContentShareURL("beat", beat, beat.title, { absolute: false })
        };
    }

    function normalizeSeedSongCard(song) {
        return {
            ...song,
            image: song.image || song.albumArt || "",
            creatorName: song.creatorName || song.creator || "SoundSwipe Artist",
            creatorUsername: normalizeUsernameValue(song.creatorUsername || song.creatorHandle || ""),
            creatorHandle: song.creatorHandle || "@soundswipe",
            creatorAvatar: song.creatorAvatar || "",
            producers: song.producers || [],
            tags: Array.isArray(song.tags) && song.tags.length ? song.tags.slice(0, 2) : [song.genre, "Song"].filter(Boolean).slice(0, 2),
            waveformSeed: song.waveformSeed || song.id || song.title,
            currentTimeLabel: "0:00",
            durationLabel: song.durationLabel || "0:00",
            audioFile: song.audioFile || "",
            userId: song.userId || song.user_id || "",
            isOwnedByCurrentUser: Boolean(song.isOwnedByCurrentUser || ((song.userId || song.user_id) && (song.userId || song.user_id) === state.authUser?.id)),
            href: song.href || buildPublicContentShareURL("song", song, song.title, { absolute: false })
        };
    }

    function renderReplicaCardMenu(card, contentType) {
        const shareUrl = buildPublicContentShareURL(contentType, card, card.title);
        return `
            <div class="discover-replica-menu-wrap">
                <button class="discover-replica-menu-button" type="button" data-card-control data-card-menu-toggle aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${escapeHtml(card.title)}">
                    •••
                </button>
                <div class="discover-replica-menu-popover" data-card-menu role="menu" hidden>
                    <button type="button" data-card-menu-share role="menuitem" data-content-id="${escapeHtml(card.id)}" data-content-type="${escapeHtml(contentType)}" data-share-url="${escapeHtml(shareUrl)}">Share Link</button>
                    ${card.isOwnedByCurrentUser ? `<button type="button" data-card-menu-edit role="menuitem" data-content-id="${escapeHtml(card.id)}" data-content-type="${escapeHtml(contentType)}">Edit</button>` : ""}
                    ${card.isOwnedByCurrentUser ? `<button type="button" data-card-menu-delete role="menuitem" data-content-id="${escapeHtml(card.id)}" data-content-type="${escapeHtml(contentType)}">Delete</button>` : ""}
                </div>
            </div>
        `;
    }

    async function fetchTrendingProfiles() {
        const { data, error } = await getSupabase()
            .from("profiles")
            .select("id, display_name, username, profile_image_url, followers, following, uploaded_beats, uploaded_songs, user_type, created_at, show_in_discovery, is_private")
            .eq("show_in_discovery", true)
            .eq("is_private", false)
            .order("followers", { ascending: false })
            .order("uploaded_beats", { ascending: false })
            .order("uploaded_songs", { ascending: false })
            .limit(18);

        if (error) {
            console.error("Trending profiles query failed", error);
            return [];
        }

        const hydratedProfiles = await hydrateProfilesMedia(data || []);
        const normalizedProfiles = await Promise.all(hydratedProfiles.map(async (profile) => {
            const contentCounts = await fetchProfileContentCounts(profile.id, {
                beats: Number(profile.uploaded_beats) || 0,
                songs: Number(profile.uploaded_songs) || 0
            });

            return {
                id: profile.id,
                name: profile.display_name || profile.username || "SoundSwipe Creator",
                username: profile.username ? `@${profile.username}` : "@soundswipe",
                image: profile.profile_image_url || "",
                songs: contentCounts.songs,
                beats: contentCounts.beats,
                followers: Number(profile.followers) || 0,
                following: Number(profile.following) || 0,
                role: prettifyUserType(profile.user_type || "Creator"),
                createdAt: profile.created_at || null,
                href: buildPublicProfileURL({ id: profile.id, usernameRaw: profile.username }, { absolute: false })
            };
        }));

        const activeCreators = normalizedProfiles.filter((profile) => (profile.beats + profile.songs) > 0);

        return stableSort(activeCreators, (profile) => {
            const recency = recencyBoost(profile.createdAt);
            return profile.followers * 8 + profile.beats * 16 + profile.songs * 16 + profile.following + recency;
        }).slice(0, 12);
    }

    function renderDiscoverCoverflow(kind, items, renderer) {
        return `
            <div class="discover-coverflow" data-discover-coverflow="${escapeHtml(kind)}">
                <div class="discover-coverflow-ambient" data-carousel-ambient aria-hidden="true">
                    <div class="discover-coverflow-ambient-layer is-primary" data-carousel-ambient-primary></div>
                    <div class="discover-coverflow-ambient-layer is-secondary" data-carousel-ambient-secondary></div>
                    <div class="discover-coverflow-ambient-overlay"></div>
                </div>
                <button class="discover-arrow discover-arrow--prev" type="button" data-carousel-prev aria-label="Previous ${escapeHtml(kind)}">‹</button>
                <div class="discover-coverflow-viewport" data-carousel-viewport>
                    <div class="discover-coverflow-track" data-carousel-track>
                        ${items.map((item, index) => renderer(item, index)).join("")}
                    </div>
                </div>
                <button class="discover-arrow discover-arrow--next" type="button" data-carousel-next aria-label="Next ${escapeHtml(kind)}">›</button>
            </div>
        `;
    }

    function renderBeatDiscoverReplicaCard(beat, index) {
        return `
            <article class="discover-replica-card beat-card" data-carousel-card data-carousel-image="${escapeHtml(beat.image || "")}" data-card-index="${escapeHtml(String(index))}" data-card-id="${escapeHtml(beat.id)}">
                <a class="discover-replica-link" href="${beat.href}" aria-label="${escapeHtml(beat.title)}"></a>
                <div class="discover-replica-shell">
                    <div class="discover-replica-media">
                        ${renderCardArtwork(beat.image, beat.title)}
                    </div>
                    <div class="discover-replica-overlay"></div>
                    <div class="discover-replica-top">
                        ${renderBeatProducerCluster(beat)}
                        ${renderReplicaCardMenu(beat, "beat")}
                    </div>
                    <div class="discover-replica-meta">
                        ${beat.bpm ? `<span class="discover-replica-pill">${escapeHtml(String(beat.bpm))} BPM</span>` : ""}
                        ${beat.key ? `<span class="discover-replica-pill">${escapeHtml(beat.key)}</span>` : ""}
                        ${beat.license ? `<span class="discover-replica-pill discover-replica-pill--${beat.license === "Free for Non-Profit" ? "good" : "warn"}">${escapeHtml(beat.license)}</span>` : ""}
                    </div>
                    <div class="discover-replica-wavebar">
                        <button class="discover-replica-play" type="button" data-card-control data-play-toggle aria-label="Play ${escapeHtml(beat.title)}" ${beat.audioFile ? "" : "disabled"}>
                            <span data-play-icon>▶</span>
                        </button>
                        <button class="discover-replica-waveform" type="button" data-card-control data-waveform data-waveform-source="${escapeHtml(beat.audioFile || beat.waveformSeed || beat.id || beat.title)}" aria-label="Seek ${escapeHtml(beat.title)}" ${beat.audioFile ? "" : "disabled"}>
                            <canvas class="discover-replica-waveform-canvas" data-waveform-canvas aria-hidden="true"></canvas>
                            <span class="discover-replica-waveform-scrubber" data-waveform-scrubber style="left:0%"></span>
                        </button>
                        <span class="discover-replica-time"><span data-current-time>${escapeHtml(beat.currentTimeLabel)}</span> / <span data-duration>${escapeHtml(beat.durationLabel)}</span></span>
                    </div>
                </div>
                <audio preload="metadata" src="${escapeHtml(beat.audioFile || "")}" data-card-audio></audio>
            </article>
        `;
    }

    function renderSongDiscoverReplicaCard(song, index) {
        return `
            <article class="discover-replica-card song-card" data-carousel-card data-carousel-image="${escapeHtml(song.image || "")}" data-card-index="${escapeHtml(String(index))}" data-card-id="${escapeHtml(song.id)}">
                <a class="discover-replica-link" href="${song.href}" aria-label="${escapeHtml(song.title)}"></a>
                <div class="discover-replica-shell">
                    <div class="discover-replica-media">
                        ${renderCardArtwork(song.image, song.title)}
                    </div>
                    <div class="discover-replica-overlay"></div>
                    <div class="discover-replica-top">
                        <div class="discover-replica-profile">
                            ${renderReplicaAvatar(song.creatorAvatar, song.creatorName)}
                            <div class="discover-replica-copy">
                                <strong>${escapeHtml(song.creatorName)}</strong>
                                <h3>${escapeHtml(song.title)}</h3>
                                <div class="discover-replica-tags">
                                    ${song.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
                                </div>
                            </div>
                        </div>
                        ${renderReplicaCardMenu(song, "song")}
                    </div>
                    <div class="discover-replica-meta">
                        ${song.producers.slice(0, 1).map((producer) => `<span class="discover-replica-pill">${escapeHtml(producer)}</span>`).join("")}
                        ${song.isExplicit ? `<span class="discover-replica-pill">Explicit</span>` : ""}
                    </div>
                    <div class="discover-replica-wavebar">
                        <button class="discover-replica-play" type="button" data-card-control data-play-toggle aria-label="Play ${escapeHtml(song.title)}" ${song.audioFile ? "" : "disabled"}>
                            <span data-play-icon>▶</span>
                        </button>
                        <button class="discover-replica-waveform" type="button" data-card-control data-waveform data-waveform-source="${escapeHtml(song.audioFile || song.waveformSeed || song.id || song.title)}" aria-label="Seek ${escapeHtml(song.title)}" ${song.audioFile ? "" : "disabled"}>
                            <canvas class="discover-replica-waveform-canvas" data-waveform-canvas aria-hidden="true"></canvas>
                            <span class="discover-replica-waveform-scrubber" data-waveform-scrubber style="left:0%"></span>
                        </button>
                        <span class="discover-replica-time"><span data-current-time>${escapeHtml(song.currentTimeLabel)}</span> / <span data-duration>${escapeHtml(song.durationLabel)}</span></span>
                    </div>
                </div>
                <audio preload="metadata" src="${escapeHtml(song.audioFile || "")}" data-card-audio></audio>
            </article>
        `;
    }

    function renderReplicaAvatar(image, name) {
        if (image) {
            return `
                <span class="discover-replica-avatar">
                    <img src="${escapeHtml(cacheBustedImageURL(image))}" alt="${escapeHtml(name)}" />
                </span>
            `;
        }

        return `
            <span class="discover-replica-avatar discover-replica-avatar--fallback" aria-hidden="true">
                ${escapeHtml(initialsForName(name))}
            </span>
        `;
    }

    function parseProducerCreditEntries(rawValue) {
        if (Array.isArray(rawValue)) return rawValue;
        if (typeof rawValue === "string") {
            try {
                const parsed = JSON.parse(rawValue);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
        return [];
    }

    function producerCreditDisplayName(entry = {}, fallback = {}) {
        return String(
            entry?.display_name
            || entry?.displayName
            || entry?.name
            || fallback?.display_name
            || fallback?.displayName
            || fallback?.name
            || entry?.username
            || fallback?.username
            || ""
        ).trim().replace(/^@+/, "");
    }

    function producerProfileCacheKey({ userId = "", username = "" } = {}) {
        return userId ? `id:${userId}` : (username ? `username:${normalizeUsernameValue(username)}` : "");
    }

    function normalizeBeatProducerCredits(ownerProfile = {}, additional = []) {
        const credits = [];
        const pushCredit = (entry, fallback = {}) => {
            const displayName = producerCreditDisplayName(entry, fallback);
            const username = normalizeUsernameValue(entry?.username || fallback.username || "");
            const userId = String(entry?.user_id || entry?.userId || entry?.profile_id || entry?.profileId || entry?.id || fallback.user_id || fallback.userId || fallback.profile_id || fallback.profileId || fallback.id || "").trim();
            const profileImage = String(entry?.profile_image_url || entry?.profileImageUrl || entry?.image || fallback.profile_image_url || fallback.profileImageUrl || fallback.image || "").trim();
            const name = displayName || username;
            if (!name && !userId) return;
            const key = userId || `${username || name}`.toLowerCase();
            if (credits.some((credit) => credit.key === key)) return;
            credits.push({
                key,
                userId: userId || "",
                username,
                displayName: name,
                profileImage,
                isLinked: Boolean(userId || username)
            });
        };

        pushCredit({}, ownerProfile);
        parseProducerCreditEntries(additional).forEach((entry) => pushCredit(entry));

        const linked = credits.filter((credit) => credit.isLinked);
        const manual = credits.filter((credit) => !credit.isLinked);
        return {
            all: credits,
            linked,
            manual,
            names: credits.map((credit) => credit.displayName).filter(Boolean)
        };
    }

    async function fetchProducerProfilesForCredits(credits = []) {
        if (!hasSupabase()) return [];
        const linkedCredits = (Array.isArray(credits) ? credits : []).filter((credit) => credit?.isLinked);
        if (!linkedCredits.length) return [];

        const idsToFetch = Array.from(new Set(linkedCredits
            .map((credit) => String(credit.userId || "").trim())
            .filter(Boolean)
            .filter((userId) => !producerProfileCache.has(producerProfileCacheKey({ userId })))));

        const usernamesToFetch = Array.from(new Set(linkedCredits
            .map((credit) => normalizeUsernameValue(credit.username || ""))
            .filter(Boolean)
            .filter((username) => !producerProfileCache.has(producerProfileCacheKey({ username })))));

        const fetchedProfiles = [];

        if (idsToFetch.length) {
            const { data, error } = await getSupabase()
                .from("profiles")
                .select("id, display_name, username, profile_image_url")
                .in("id", idsToFetch);
            if (!error && Array.isArray(data)) {
                fetchedProfiles.push(...data);
            }
        }

        if (usernamesToFetch.length) {
            const usernameFilter = usernamesToFetch.map((username) => `username.ilike.${username}`).join(",");
            const { data, error } = await getSupabase()
                .from("profiles")
                .select("id, display_name, username, profile_image_url")
                .or(usernameFilter)
                .limit(Math.max(usernamesToFetch.length, 1) * 2);
            if (!error && Array.isArray(data)) {
                fetchedProfiles.push(...data);
            }
        }

        fetchedProfiles.forEach((profile) => {
            const normalized = {
                id: profile.id || "",
                display_name: profile.display_name || "",
                username: profile.username || "",
                profile_image_url: profile.profile_image_url || ""
            };
            const idKey = producerProfileCacheKey({ userId: normalized.id });
            const usernameKey = producerProfileCacheKey({ username: normalized.username });
            if (idKey) producerProfileCache.set(idKey, normalized);
            if (usernameKey) producerProfileCache.set(usernameKey, normalized);
        });

        return fetchedProfiles;
    }

    async function enrichBeatProducerCreditState(creditState) {
        if (!creditState || !Array.isArray(creditState.all) || !creditState.all.length) return creditState;
        await fetchProducerProfilesForCredits(creditState.all);

        const enrichedAll = creditState.all.map((credit) => {
            const cached = producerProfileCache.get(producerProfileCacheKey({ userId: credit.userId }))
                || producerProfileCache.get(producerProfileCacheKey({ username: credit.username }))
                || null;
            if (!cached) return credit;
            return {
                ...credit,
                userId: credit.userId || cached.id || "",
                username: normalizeUsernameValue(credit.username || cached.username || ""),
                displayName: producerCreditDisplayName(credit, cached),
                profileImage: credit.profileImage || cached.profile_image_url || "",
                isLinked: true
            };
        });

        return {
            all: enrichedAll,
            linked: enrichedAll.filter((credit) => credit.isLinked),
            manual: enrichedAll.filter((credit) => !credit.isLinked),
            names: enrichedAll.map((credit) => credit.displayName).filter(Boolean)
        };
    }

    function renderBeatProducerCluster(beat) {
        const linkedCredits = Array.isArray(beat.linkedProducerCredits) && beat.linkedProducerCredits.length
            ? beat.linkedProducerCredits
            : [{
                userId: beat.userId || "",
                username: normalizeUsernameValue(beat.creatorUsername || beat.creatorHandle || ""),
                displayName: beat.creatorName || "SoundSwipe Producer",
                profileImage: beat.creatorAvatar || "",
                isLinked: true
            }];
        const names = linkedCredits.map((credit) => credit.displayName || credit.username).filter(Boolean);
        const label = names.join(", ");
        return `
            <div class="discover-replica-profile discover-replica-profile--collab">
                <div class="discover-replica-avatar-stack">
                    ${linkedCredits.slice(0, 3).map((credit) => renderReplicaAvatar(credit.profileImage, credit.displayName || credit.username || "Producer")).join("")}
                </div>
                <div class="discover-replica-copy">
                    <strong>${escapeHtml(label || beat.creatorName || "SoundSwipe Producer")}</strong>
                    <h3>${escapeHtml(beat.title)}</h3>
                    <div class="discover-replica-tags">
                        ${beat.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
                    </div>
                </div>
            </div>
        `;
    }

    function renderCardArtwork(image, title) {
        if (image) {
            return `<img src="${escapeHtml(cacheBustedImageURL(image))}" alt="${escapeHtml(title)}" />`;
        }

        return `
            <div class="discover-replica-artwork-fallback" aria-label="${escapeHtml(title)}">
                <span>${escapeHtml(initialsForName(title || "SoundSwipe"))}</span>
            </div>
        `;
    }

    function renderProfileDiscoverAvatar(profile) {
        return renderProfileIdentityAvatar({
            image: profile.image,
            name: profile.name,
            username: profile.username,
            className: "discover-profile-portrait"
        });
    }

    function avatarFallbackLetter(username, name) {
        const usernameSeed = String(username || "").replace(/^@+/, "").trim();
        const nameSeed = String(name || "").trim();
        const seed = usernameSeed || nameSeed || "S";
        return seed.charAt(0).toUpperCase();
    }

    function renderProfileIdentityAvatar({ image, name, username, className }) {
        const classes = [className];
        if (!image) {
            classes.push(`${className}--fallback`);
        }

        return `
            <span class="${classes.join(" ")}"${image ? "" : ` aria-label="${escapeHtml(name || username || "Profile")}"`}>
                ${image
                    ? `<img src="${escapeHtml(cacheBustedImageURL(image))}" alt="${escapeHtml(name || username || "Profile")}" />`
                    : `${escapeHtml(avatarFallbackLetter(username, name))}`}
            </span>
        `;
    }

    function profileSectionHref(profileId, options = {}) {
        const params = new URLSearchParams();
        if (profileId) {
            params.set("id", profileId);
        }
        if (options.tab) {
            params.set("tab", options.tab);
        }
        if (options.relationship) {
            params.set("relationship", options.relationship);
        }
        const query = params.toString();
        return `profile.html${query ? `?${query}` : ""}`;
    }

    function renderProfileDiscoverCard(profile, index) {
        return `
            <article class="discover-profile-card" data-carousel-card data-carousel-image="${escapeHtml(profile.image || "")}" data-card-index="${escapeHtml(String(index))}" data-card-id="${escapeHtml(profile.id)}">
                <a class="discover-profile-link" data-card-nav href="${escapeHtml(profileSectionHref(profile.id))}" aria-label="${escapeHtml(profile.name)}"></a>
                <div class="discover-profile-shell">
                    ${renderProfileDiscoverAvatar(profile)}
                    <div class="discover-profile-body">
                        <div class="discover-profile-copy">
                            <strong>${escapeHtml(profile.name)}</strong>
                            <span>${escapeHtml(profile.username)}</span>
                            <em>${escapeHtml(profile.role)}</em>
                        </div>
                        <div class="discover-profile-stats">
                            <a class="discover-profile-stat" data-card-nav href="${escapeHtml(profileSectionHref(profile.id, { tab: "songs" }))}">
                                <strong>${escapeHtml(compactCount(profile.songs))}</strong>
                                <span>Songs</span>
                            </a>
                            <a class="discover-profile-stat" data-card-nav href="${escapeHtml(profileSectionHref(profile.id, { tab: "beats" }))}">
                                <strong>${escapeHtml(compactCount(profile.beats))}</strong>
                                <span>Beats</span>
                            </a>
                            <a class="discover-profile-stat" data-card-nav href="${escapeHtml(profileSectionHref(profile.id, { relationship: "followers" }))}">
                                <strong>${escapeHtml(compactCount(profile.followers))}</strong>
                                <span>Followers</span>
                            </a>
                            <a class="discover-profile-stat" data-card-nav href="${escapeHtml(profileSectionHref(profile.id, { relationship: "following" }))}">
                                <strong>${escapeHtml(compactCount(profile.following))}</strong>
                                <span>Following</span>
                            </a>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    function initializeDiscoverCarousels() {
        document.querySelectorAll("[data-discover-coverflow]").forEach((carousel) => {
            if (carousel.dataset.bound === "true") {
                updateDiscoverCarousel(carousel, Number(carousel.dataset.activeIndex || 0));
                return;
            }

            carousel.dataset.bound = "true";
            const cards = Array.from(carousel.querySelectorAll("[data-carousel-card]"));
            const initialIndex = Math.min(Math.max(1, Math.floor(cards.length / 2)), Math.max(cards.length - 1, 0));
            carousel.dataset.activeIndex = String(initialIndex);

            carousel.querySelector("[data-carousel-prev]")?.addEventListener("click", () => {
                markDiscoverCarouselInteraction(carousel);
                updateDiscoverCarousel(carousel, Number(carousel.dataset.activeIndex || 0) - 1);
            });

            carousel.querySelector("[data-carousel-next]")?.addEventListener("click", () => {
                markDiscoverCarouselInteraction(carousel);
                updateDiscoverCarousel(carousel, Number(carousel.dataset.activeIndex || 0) + 1);
            });

            cards.forEach((card, index) => {
                card.addEventListener("click", (event) => {
                    if (event.target.closest("[data-card-nav]")) {
                        return;
                    }
                    if (event.target.closest("[data-card-control]")) {
                        return;
                    }
                    if (card.classList.contains("discover-profile-card")) {
                        const profileLink = card.querySelector(".discover-profile-link");
                        if (profileLink) {
                            window.location.href = profileLink.getAttribute("href") || "profile.html";
                        }
                        return;
                    }
                    const activeIndex = Number(carousel.dataset.activeIndex || 0);
                    if (index !== activeIndex) {
                        event.preventDefault();
                        markDiscoverCarouselInteraction(carousel);
                        updateDiscoverCarousel(carousel, index);
                    }
                });
            });

            updateDiscoverCarousel(carousel, initialIndex);
        });

        if (!window.__soundswipeDiscoverResizeBound) {
            window.__soundswipeDiscoverResizeBound = true;
            window.addEventListener("resize", () => {
                document.querySelectorAll("[data-discover-coverflow]").forEach((carousel) => {
                    updateDiscoverCarousel(carousel, Number(carousel.dataset.activeIndex || 0));
                });
            });
        }

        initializeDiscoverPlayback();
        initializeDiscoverAutoplay();
        initializeHomepageAmbientPriority();
    }

    function updateDiscoverCarousel(carousel, requestedIndex) {
        const cards = Array.from(carousel.querySelectorAll("[data-carousel-card]"));
        const track = carousel.querySelector("[data-carousel-track]");
        const viewport = carousel.querySelector("[data-carousel-viewport]");
        if (!cards.length || !track || !viewport) return;

        const totalCards = cards.length;
        const activeIndex = totalCards > 0
            ? ((requestedIndex % totalCards) + totalCards) % totalCards
            : 0;
        carousel.dataset.activeIndex = String(activeIndex);

        const cardWidth = cards[0].offsetWidth || 320;
        const gap = parseFloat(getComputedStyle(track).gap || "22") || 22;
        const viewportWidth = viewport.clientWidth || 0;
        const translateX = ((viewportWidth - cardWidth) / 2) - (activeIndex * (cardWidth + gap));

        track.style.transform = isSafariBrowser()
            ? `translate3d(${translateX}px, 0, 0)`
            : `translateX(${translateX}px)`;

        cards.forEach((card, index) => {
            const distance = Math.max(-3, Math.min(3, index - activeIndex));
            card.dataset.distance = String(distance);
            card.classList.toggle("is-active", index === activeIndex);
        });

        const prev = carousel.querySelector("[data-carousel-prev]");
        const next = carousel.querySelector("[data-carousel-next]");
        if (prev) prev.disabled = totalCards <= 1;
        if (next) next.disabled = totalCards <= 1;

        updateDiscoverCarouselAmbient(carousel, cards[activeIndex]);
    }

    function initializeDiscoverAutoplay() {
        if (document.body?.dataset.page !== "home") return;

        document.querySelectorAll("[data-discover-coverflow]").forEach((carousel) => {
            if (carousel.dataset.autoplayBound === "true") return;
            carousel.dataset.autoplayBound = "true";

            const kind = String(carousel.dataset.discoverCoverflow || "").trim();
            const config = discoverAutoplay.configs[kind];
            if (!config) return;

            discoverAutoplay.states.set(carousel, {
                kind,
                timerId: null,
                pausedUntil: 0
            });

            queueDiscoverCarouselAutoplay(carousel, config.initialDelayMs);
        });

        if (!discoverAutoplay.visibilityBound) {
            discoverAutoplay.visibilityBound = true;
            document.addEventListener("visibilitychange", () => {
                if (document.hidden) return;
                document.querySelectorAll("[data-discover-coverflow]").forEach((carousel) => {
                    const state = discoverAutoplay.states.get(carousel);
                    if (!state) return;
                    queueDiscoverCarouselAutoplay(carousel, 1400);
                });
            });
        }
    }

    function queueDiscoverCarouselAutoplay(carousel, delayMs) {
        const autoplayState = discoverAutoplay.states.get(carousel);
        if (!autoplayState) return;
        if (autoplayState.timerId) {
            window.clearTimeout(autoplayState.timerId);
            autoplayState.timerId = null;
        }

        const config = discoverAutoplay.configs[autoplayState.kind];
        if (!config) return;

        autoplayState.timerId = window.setTimeout(() => {
            autoplayState.timerId = null;
            advanceDiscoverCarouselAutoplay(carousel);
        }, Math.max(250, Number(delayMs) || config.intervalMs));
    }

    function advanceDiscoverCarouselAutoplay(carousel) {
        const autoplayState = discoverAutoplay.states.get(carousel);
        if (!autoplayState) return;
        const config = discoverAutoplay.configs[autoplayState.kind];
        if (!config) return;

        const cards = carousel.querySelectorAll("[data-carousel-card]");
        if (cards.length <= 1) return;

        const now = Date.now();
        if (document.hidden || shouldPauseDiscoverCarouselAutoplay(carousel, now)) {
            const remaining = Math.max(config.resumePollMs, autoplayState.pausedUntil - now);
            queueDiscoverCarouselAutoplay(carousel, remaining);
            return;
        }

        updateDiscoverCarousel(carousel, Number(carousel.dataset.activeIndex || 0) + 1);
        queueDiscoverCarouselAutoplay(carousel, config.intervalMs);
    }

    function shouldPauseDiscoverCarouselAutoplay(carousel, now = Date.now()) {
        const autoplayState = discoverAutoplay.states.get(carousel);
        if (!autoplayState) return true;
        if (now < autoplayState.pausedUntil) return true;

        if (autoplayState.kind === "beats" && discoverPlayback.activeAudio && !discoverPlayback.activeAudio.paused) {
            const activeCard = discoverPlayback.activeCardId
                ? document.querySelector(`[data-card-id="${CSS.escape(discoverPlayback.activeCardId)}"]`)
                : null;
            const activeCarousel = activeCard?.closest?.("[data-discover-coverflow]");
            if (activeCarousel === carousel) {
                return true;
            }
        }

        return false;
    }

    function markDiscoverCarouselInteraction(carousel, pauseMs) {
        const autoplayState = discoverAutoplay.states.get(carousel);
        if (!autoplayState) return;
        const config = discoverAutoplay.configs[autoplayState.kind];
        if (!config) return;
        autoplayState.pausedUntil = Date.now() + Math.max(250, Number.isFinite(pauseMs) ? pauseMs : config.interactionPauseMs);
        queueDiscoverCarouselAutoplay(carousel, config.resumePollMs);
    }

    function updateDiscoverCarouselAmbient(carousel, activeCard) {
        const ambient = carousel.querySelector("[data-carousel-ambient]");
        const primaryLayer = carousel.querySelector("[data-carousel-ambient-primary]");
        const secondaryLayer = carousel.querySelector("[data-carousel-ambient-secondary]");
        if (!ambient || !primaryLayer || !secondaryLayer || !activeCard) return;

        const nextImage = String(activeCard.dataset.carouselImage || "").trim();
        if (!nextImage) {
            ambient.classList.remove("is-active");
            return;
        }

        ambient.classList.add("is-active");
        const currentImage = ambient.dataset.activeImage || "";
        if (currentImage === nextImage) return;

        if (ambient._transitionTimer) {
            window.clearTimeout(ambient._transitionTimer);
            ambient._transitionTimer = null;
        }

        secondaryLayer.style.backgroundImage = `url("${nextImage}")`;
        secondaryLayer.classList.add("is-visible");
        ambient.dataset.activeImage = nextImage;

        syncHomepageAmbientFromCarousel(carousel, nextImage);

        const commitAmbientImage = () => {
            primaryLayer.style.backgroundImage = `url("${nextImage}")`;
            secondaryLayer.classList.remove("is-visible");
        };

        if (isSafariBrowser()) {
            requestAnimationFrame(() => {
                requestAnimationFrame(commitAmbientImage);
            });
            return;
        }

        ambient._transitionTimer = window.setTimeout(() => {
            ambient._transitionTimer = null;
            commitAmbientImage();
        }, 520);
    }

    function syncHomepageAmbientFromCarousel(carousel, imageURL) {
        const kind = String(carousel.dataset.discoverCoverflow || "").trim();
        if (!kind || !imageURL) return;

        const section = carousel.closest("[data-home-ambient-section]");
        if (section) {
            section.style.setProperty("--section-ambient-image", `url("${imageURL}")`);
            section.classList.add("has-ambient-image");
        }

        if (kind === "beats") {
            document.querySelectorAll('[data-home-ambient-source="beats"]').forEach((node) => {
                node.style.setProperty("--section-ambient-image", `url("${imageURL}")`);
                node.classList.add("has-ambient-image");
            });
        }

        updateHomepageGlobalAmbient(kind, imageURL);
    }

    function initializeHomepageAmbientPriority() {
        if (document.body?.dataset.page !== "home") return;
        if (!homepageAmbientState.scrollBound) {
            homepageAmbientState.scrollBound = true;
            const refreshDriver = () => {
                if (homepageAmbientState.rafId) return;
                homepageAmbientState.rafId = requestAnimationFrame(() => {
                    homepageAmbientState.rafId = null;
                    const focus = getHomepageAmbientFocus();
                    if (focus?.kind) {
                        const nextImage = resolveActiveCarouselImage(focus.carousel);
                        if (nextImage) {
                            updateHomepageGlobalAmbient(focus.kind, nextImage, { force: true, reason: "focus" });
                        }
                    }
                });
            };

            window.addEventListener("scroll", refreshDriver, { passive: true });
            window.addEventListener("resize", refreshDriver);
        }

        if (!homepageAmbientState.initialized) {
            homepageAmbientState.initialized = true;
            const focus = getHomepageAmbientFocus();
            if (focus?.kind) {
                const nextImage = resolveActiveCarouselImage(focus.carousel);
                if (nextImage) {
                    updateHomepageGlobalAmbient(focus.kind, nextImage, { force: true, reason: "init" });
                }
            }
        }
    }

    function getHomepageAmbientFocus() {
        const sections = Array.from(document.querySelectorAll("[data-home-ambient-section]"))
            .filter((section) => section.dataset.homeAmbientSection !== "hero");
        if (!sections.length) return null;

        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const viewportCenter = viewportHeight * 0.46;
        let best = null;

        sections.forEach((section) => {
            const rect = section.getBoundingClientRect();
            const visibleTop = Math.max(rect.top, 0);
            const visibleBottom = Math.min(rect.bottom, viewportHeight);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            if (visibleHeight <= 0) return;

            const sectionCenter = rect.top + rect.height / 2;
            const distance = Math.abs(sectionCenter - viewportCenter);
            const visibilityRatio = rect.height > 0 ? visibleHeight / rect.height : 0;
            const score = visibilityRatio * 1000 - distance;

            if (!best || score > best.score) {
                best = {
                    section,
                    score,
                    kind: section.dataset.homeAmbientSection || "",
                    carousel: section.querySelector("[data-discover-coverflow]")
                };
            }
        });

        return best;
    }

    function resolveActiveCarouselImage(carousel) {
        if (!carousel) return "";
        const activeIndex = Number(carousel.dataset.activeIndex || 0);
        const activeCard = carousel.querySelector(`[data-card-index="${CSS.escape(String(activeIndex))}"]`)
            || carousel.querySelector("[data-carousel-card].is-active");
        return String(activeCard?.dataset?.carouselImage || "").trim();
    }

    function updateHomepageGlobalAmbient(kind, imageURL, options = {}) {
        if (document.body?.dataset.page !== "home" || !kind || !imageURL) return;

        const focus = getHomepageAmbientFocus();
        const focusKind = focus?.kind || "";
        const now = Date.now();
        const force = Boolean(options.force);
        const activeDriverKind = homepageAmbientState.activeDriverKind;
        const holdActive = now < homepageAmbientState.holdUntil;

        if (!force) {
            if (focusKind && kind !== focusKind) {
                return;
            }
            if (holdActive && activeDriverKind && kind !== activeDriverKind) {
                return;
            }
        }

        const globalLayer = document.querySelector(`[data-home-global-ambient="${CSS.escape(kind)}"]`);
        if (!globalLayer) return;

        if (homepageAmbientState.activeDriverKind === kind && homepageAmbientState.activeImageURL === imageURL && !force) {
            return;
        }

        globalLayer.style.backgroundImage = `url("${imageURL}")`;
        document.querySelectorAll("[data-home-global-ambient]").forEach((layer) => {
            layer.classList.toggle("is-active", layer === globalLayer);
        });

        homepageAmbientState.activeDriverKind = kind;
        homepageAmbientState.activeImageURL = imageURL;
        homepageAmbientState.holdUntil = now + homepageAmbientState.holdMs;
    }

    function initializeDiscoverPlayback() {
        if (!discoverPlayback.resizeBound) {
            discoverPlayback.resizeBound = true;
            window.addEventListener("resize", () => {
                document.querySelectorAll("[data-carousel-card]").forEach((card) => {
                    renderDiscoverWaveform(card, getDiscoverCardProgress(card));
                });
            });
        }

        document.querySelectorAll("[data-carousel-card]").forEach((card) => {
            if (card.dataset.playbackBound === "true") return;
            card.dataset.playbackBound = "true";

            const audio = card.querySelector("[data-card-audio]");
            const playButton = card.querySelector("[data-play-toggle]");
            const waveform = card.querySelector("[data-waveform]");
            const menuToggle = card.querySelector("[data-card-menu-toggle]");
            const menu = card.querySelector("[data-card-menu]");
            const shareAction = card.querySelector("[data-card-menu-share]");
            const editAction = card.querySelector("[data-card-menu-edit]");
            const deleteAction = card.querySelector("[data-card-menu-delete]");

            if (menuToggle && menu) {
                menuToggle.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const isOpen = menu.classList.contains("open");
                    closeReplicaMenus();
                    if (!isOpen) {
                        menu.classList.add("open");
                        menu.hidden = false;
                        menuToggle.setAttribute("aria-expanded", "true");
                    }
                });
            }

            shareAction?.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                closeReplicaMenus();
                await handleCardShareAction(shareAction);
            });

            editAction?.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                closeReplicaMenus();
                handleCardEditAction(editAction);
            });

            deleteAction?.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                closeReplicaMenus();
                await handleCardDeleteAction(deleteAction);
            });

            if (!audio || !playButton || !waveform || !audio.getAttribute("src")) return;

            let safariTouchPlaybackHandledAt = 0;

            const markImmediateInteraction = () => {
                markDiscoverCarouselInteraction(card.closest("[data-discover-coverflow]"), isSafariBrowser() ? 14000 : undefined);
            };

            playButton.addEventListener("pointerdown", markImmediateInteraction, { passive: true });
            playButton.addEventListener("touchstart", markImmediateInteraction, { passive: true });
            playButton.addEventListener("pointerup", () => {
                playButton.focus({ preventScroll: true });
            }, { passive: true });

            if (isSafariBrowser()) {
                playButton.addEventListener("touchend", async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    safariTouchPlaybackHandledAt = Date.now();
                    markImmediateInteraction();
                    await toggleDiscoverCardPlayback(card);
                });
            }

            playButton.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isSafariBrowser() && Date.now() - safariTouchPlaybackHandledAt < 450) {
                    return;
                }
                markImmediateInteraction();
                await toggleDiscoverCardPlayback(card);
            });

            const scrubClientX = (event) => {
                if (typeof event.clientX === "number") return event.clientX;
                const touch = event.touches?.[0] || event.changedTouches?.[0] || null;
                return touch ? touch.clientX : 0;
            };

            const applyScrubPosition = (event) => {
                const rect = waveform.getBoundingClientRect();
                if (!rect.width) return;
                const duration = Number.isFinite(audio.duration) && audio.duration > 0
                    ? audio.duration
                    : Number(card.dataset.waveformDuration || 0);
                if (!duration) return;
                const ratio = Math.max(0, Math.min(1, (scrubClientX(event) - rect.left) / rect.width));
                seekDiscoverAudio(audio, ratio * duration);
                syncDiscoverCardPlaybackUI(card);
                scheduleDiscoverPlaybackFrame();
            };

            const startScrub = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (waveform.disabled) return;
                markImmediateInteraction();
                card.dataset.scrubbing = "true";
                if (typeof event.pointerId === "number" && waveform.setPointerCapture) {
                    try { waveform.setPointerCapture(event.pointerId); } catch {}
                }
                applyScrubPosition(event);
            };

            waveform.addEventListener("pointerdown", startScrub);

            waveform.addEventListener("pointermove", (event) => {
                if (card.dataset.scrubbing !== "true") return;
                if (typeof event.pointerId === "number" && waveform.hasPointerCapture && !waveform.hasPointerCapture(event.pointerId) && !isSafariBrowser()) return;
                event.preventDefault();
                applyScrubPosition(event);
            });

            if (isSafariBrowser()) {
                waveform.addEventListener("touchstart", startScrub, { passive: false });
                waveform.addEventListener("touchmove", (event) => {
                    if (card.dataset.scrubbing !== "true") return;
                    event.preventDefault();
                    applyScrubPosition(event);
                }, { passive: false });
            }

            const endScrub = (event) => {
                if (typeof event?.pointerId === "number" && waveform.hasPointerCapture?.(event.pointerId)) {
                    try { waveform.releasePointerCapture(event.pointerId); } catch {}
                }
                delete card.dataset.scrubbing;
                syncDiscoverCardPlaybackUI(card);
            };

            waveform.addEventListener("pointerup", endScrub);
            waveform.addEventListener("pointercancel", endScrub);
            waveform.addEventListener("touchend", endScrub, { passive: true });
            waveform.addEventListener("touchcancel", endScrub, { passive: true });
            waveform.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
            });

            waveform.addEventListener("keydown", (event) => {
                const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
                if (!duration) return;
                const step = Math.max(2, duration * 0.02);
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    markDiscoverCarouselInteraction(card.closest("[data-discover-coverflow]"));
                    seekDiscoverAudio(audio, Math.max(0, audio.currentTime - step));
                    syncDiscoverCardPlaybackUI(card);
                    scheduleDiscoverPlaybackFrame();
                } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    markDiscoverCarouselInteraction(card.closest("[data-discover-coverflow]"));
                    seekDiscoverAudio(audio, Math.min(duration, audio.currentTime + step));
                    syncDiscoverCardPlaybackUI(card);
                    scheduleDiscoverPlaybackFrame();
                }
            });

            audio.addEventListener("loadedmetadata", () => {
                card.dataset.waveformDuration = String(audio.duration || 0);
                syncDiscoverCardPlaybackUI(card);
                hydrateDiscoverWaveform(card).catch((error) => {
                    console.error("Waveform hydrate failed", error);
                });
            });

            audio.addEventListener("durationchange", () => {
                card.dataset.waveformDuration = String(audio.duration || 0);
                syncDiscoverCardPlaybackUI(card);
            });

            audio.addEventListener("timeupdate", () => {
                if (card.dataset.scrubbing === "true") return;
                if (discoverPlayback.activeAudio === audio || audio.paused) {
                    syncDiscoverCardPlaybackUI(card);
                }
            });

            audio.addEventListener("seeked", () => {
                syncDiscoverCardPlaybackUI(card);
                scheduleDiscoverPlaybackFrame();
            });

            audio.addEventListener("play", () => {
                if (discoverPlayback.activeAudio && discoverPlayback.activeAudio !== audio) {
                    discoverPlayback.activeAudio.pause();
                }
                discoverPlayback.activeAudio = audio;
                discoverPlayback.activeCardId = card.dataset.cardId || null;
                markDiscoverCarouselInteraction(card.closest("[data-discover-coverflow]"));
                syncDiscoverCardPlaybackUI(card);
                scheduleDiscoverPlaybackFrame();
            });

            audio.addEventListener("pause", () => {
                if (discoverPlayback.activeAudio === audio && !audio.ended) {
                    discoverPlayback.activeAudio = null;
                }
                markDiscoverCarouselInteraction(card.closest("[data-discover-coverflow]"));
                syncDiscoverCardPlaybackUI(card);
                scheduleDiscoverPlaybackFrame();
            });

            audio.addEventListener("ended", () => {
                audio.currentTime = 0;
                if (discoverPlayback.activeAudio === audio) {
                    discoverPlayback.activeAudio = null;
                    discoverPlayback.activeCardId = null;
                }
                markDiscoverCarouselInteraction(card.closest("[data-discover-coverflow]"));
                syncDiscoverCardPlaybackUI(card);
                scheduleDiscoverPlaybackFrame();
            });

            hydrateDiscoverWaveform(card).catch(() => {});
            syncDiscoverCardPlaybackUI(card);
        });

        if (!window.__soundswipeReplicaMenuBound) {
            window.__soundswipeReplicaMenuBound = true;
            document.addEventListener("click", (event) => {
                if (!event.target.closest("[data-card-menu-toggle]") && !event.target.closest("[data-card-menu]")) {
                    closeReplicaMenus();
                }
            });
            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    closeReplicaMenus();
                }
            });
        }
    }

    async function handleCardShareAction(button) {
        const shareUrl = button?.dataset?.shareUrl;
        const contentType = button?.dataset?.contentType || "song";
        if (!shareUrl) return;

        const sharePayload = {
            title: contentType === "beat" ? "SoundSwipe Beat" : "SoundSwipe Song",
            text: `Check this ${contentType} on SoundSwipe`,
            url: shareUrl
        };

        try {
            if (navigator.share) {
                await navigator.share(sharePayload);
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
                showSiteToast("Link copied.", "success");
                return;
            }
            showSiteToast("Share link ready.", "success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            console.error("Card share failed", error);
            showSiteToast("Couldn’t share right now.", "error");
        }
    }

    async function handleCardDeleteAction(button) {
        const contentId = button?.dataset?.contentId;
        const contentType = button?.dataset?.contentType;
        if (!contentId || !contentType) return;

        const confirmed = window.confirm(`Delete this ${contentType}? This cannot be undone.`);
        if (!confirmed) return;

        try {
            const result = await deleteWebsiteContent(contentId, contentType);
            const wasArchived = Boolean(result?.archived);
            showSiteToast(
                wasArchived && contentType === "beat"
                    ? "Beat removed from your profile and taken off sale."
                    : `${contentType === "beat" ? "Beat" : "Song"} deleted.`,
                "success"
            );
            window.setTimeout(() => window.location.reload(), 250);
        } catch (error) {
            console.error("Delete content failed", error);
            showSiteToast(error?.message || "Couldn’t delete this content right now.", "error");
        }
    }

    function handleCardEditAction(button) {
        const contentId = button?.dataset?.contentId;
        const contentType = button?.dataset?.contentType;
        if (!contentId || !contentType) return;
        const targetType = contentType === "beat" ? "beat" : "song";
        window.location.href = `upload.html?type=${encodeURIComponent(targetType)}&edit=${encodeURIComponent(contentId)}`;
    }

    async function deleteWebsiteContent(contentId, contentType) {
        if (!state.session?.access_token || !window.SoundSwipeSupabaseConfig?.url) {
            throw new Error("You must be logged in to delete content.");
        }

        const response = await fetch(`${window.SoundSwipeSupabaseConfig.url}/functions/v1/web-delete-content`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${state.session.access_token}`
            },
            body: JSON.stringify({ contentId, contentType })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || "Couldn’t delete this content right now.");
        }

        return payload;
    }

    async function toggleDiscoverCardPlayback(card) {
        const audio = card.querySelector("[data-card-audio]");
        if (!audio) return;

        if (discoverPlayback.activeAudio && discoverPlayback.activeAudio !== audio) {
            discoverPlayback.activeAudio.pause();
        }

        if (audio.paused) {
            try {
                await audio.play();
            } catch (error) {
                console.error("Discover playback failed", error);
            }
        } else {
            audio.pause();
        }
    }

    function syncDiscoverCardPlaybackUI(card) {
        const audio = card.querySelector("[data-card-audio]");
        if (!audio) return;

        const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        const progress = duration > 0 ? currentTime / duration : 0;

        const icon = card.querySelector("[data-play-icon]");
        const current = card.querySelector("[data-current-time]");
        const total = card.querySelector("[data-duration]");
        const scrubber = card.querySelector("[data-waveform-scrubber]");

        if (icon) icon.textContent = audio.paused ? "▶" : "❚❚";
        if (current) current.textContent = formatPlaybackTime(currentTime);
        if (total) total.textContent = formatPlaybackTime(duration);
        if (scrubber) scrubber.style.left = `${Math.max(0, Math.min(100, progress * 100))}%`;
        renderDiscoverWaveform(card, progress);
    }

    function formatPlaybackTime(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
        const whole = Math.floor(seconds);
        const minutes = Math.floor(whole / 60);
        const remainder = whole % 60;
        return `${minutes}:${String(remainder).padStart(2, "0")}`;
    }

    async function hydrateDiscoverWaveform(card) {
        const audio = card.querySelector("[data-card-audio]");
        const audioSrc = audio?.getAttribute("src") || card.querySelector("[data-waveform]")?.dataset.waveformSource || "";
        if (!audioSrc) return;

        let samples = discoverPlayback.waveformCache.get(audioSrc);
        if (!samples) {
            samples = await generateDiscoverWaveformSamples(audioSrc);
            discoverPlayback.waveformCache.set(audioSrc, samples);
        }

        card._waveformSamples = samples?.length ? samples : seededFallbackWaveform(audioSrc, 180);
        renderDiscoverWaveform(card, getDiscoverCardProgress(card));
    }

    async function generateDiscoverWaveformSamples(src) {
        try {
            const response = await fetch(src);
            const buffer = await response.arrayBuffer();
            const context = discoverPlayback.audioContext || new (window.AudioContext || window.webkitAudioContext)();
            discoverPlayback.audioContext = context;
            const audioBuffer = await context.decodeAudioData(buffer.slice(0));
            return downsampleDiscoverWaveform(audioBuffer, 180);
        } catch (error) {
            console.error("Waveform analysis failed", error);
            return seededFallbackWaveform(src, 180);
        }
    }

    function downsampleDiscoverWaveform(audioBuffer, targetCount = 180) {
        const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
        const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));
        const totalSamples = channels[0]?.length || 0;
        if (!totalSamples) return [];

        const bucketSize = totalSamples / targetCount;
        const reduced = [];
        for (let bucketIndex = 0; bucketIndex < targetCount; bucketIndex += 1) {
            const start = Math.floor(bucketIndex * bucketSize);
            const end = Math.min(totalSamples, Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize)));
            let peak = 0;
            for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
                let mixed = 0;
                for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
                    mixed += Math.abs(channels[channelIndex][sampleIndex] || 0);
                }
                peak = Math.max(peak, mixed / channelCount);
            }
            reduced.push(Math.max(0.08, Math.min(1, Math.pow(peak, 0.72))));
        }
        return reduced;
    }

    function seededFallbackWaveform(sourceKey, targetCount = 180) {
        const source = String(sourceKey || "");
        if (!source) return [];
        const bytes = Array.from(source).map((char) => char.charCodeAt(0));
        if (!bytes.length) return [];

        return Array.from({ length: targetCount }, (_, index) => {
            const primary = bytes[index % bytes.length] / 255;
            const secondary = bytes[(index * 7 + 3) % bytes.length] / 255;
            const tertiary = bytes[(index * 11 + 5) % bytes.length] / 255;
            const phase = index / Math.max(targetCount - 1, 1);
            const oscillation = (Math.sin(phase * Math.PI * 4 + primary * Math.PI) + 1) * 0.18;
            const contour = (Math.cos(phase * Math.PI * 2.7 + secondary * Math.PI * 0.7) + 1) * 0.12;
            const floor = 0.12 + tertiary * 0.12;
            return Math.min(0.92, Math.max(0.08, floor + oscillation + contour));
        });
    }

    function getDiscoverCardProgress(card) {
        const audio = card.querySelector("[data-card-audio]");
        if (!audio) return 0;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        return duration > 0 ? Math.max(0, Math.min(1, audio.currentTime / duration)) : 0;
    }

    function renderDiscoverWaveform(card, progress = 0) {
        const canvas = card.querySelector("[data-waveform-canvas]");
        const waveform = card.querySelector("[data-waveform]");
        if (!canvas || !waveform) return;

        const width = Math.max(1, Math.floor(waveform.clientWidth - 20));
        const height = Math.max(1, Math.floor(waveform.clientHeight));
        const dpr = Math.max(1, window.devicePixelRatio || 1);

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);

        const fallbackKey = waveform.dataset.waveformSource || card.dataset.cardId || "soundswipe";
        const values = card._waveformSamples?.length ? card._waveformSamples : seededFallbackWaveform(fallbackKey, 180);
        if (!values.length) return;

        const columnCount = Math.max(1, Math.min(values.length, Math.ceil(width / 2.6)));
        const columnWidth = width / columnCount;
        const samplesPerColumn = values.length / columnCount;
        const centerY = height / 2;
        const halfHeight = height * 0.43;
        const progressX = width * Math.max(0, Math.min(1, progress));

        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const start = Math.floor(columnIndex * samplesPerColumn);
            const end = Math.min(values.length, Math.max(start + 1, Math.ceil((columnIndex + 1) * samplesPerColumn)));
            let peak = 0;
            for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
                peak = Math.max(peak, Math.abs(values[sampleIndex]));
            }

            const normalized = Math.max(0.06, Math.min(1, Math.pow(peak, 0.72)));
            const barHalfHeight = Math.max(1.5, normalized * halfHeight);
            const x = columnIndex * columnWidth;
            const barWidth = Math.max(1.2, columnWidth - 0.5);
            const y = centerY - barHalfHeight;

            context.fillStyle = x + barWidth <= progressX
                ? "rgba(255, 255, 255, 0.96)"
                : "rgba(255, 255, 255, 0.28)";
            drawRoundedRect(context, x, y, barWidth, barHalfHeight * 2, Math.min(1.2, barWidth * 0.22));
            context.fill();
        }
    }

    function drawRoundedRect(context, x, y, width, height, radius) {
        const corner = Math.max(0, Math.min(radius, width / 2, height / 2));
        context.beginPath();
        context.moveTo(x + corner, y);
        context.arcTo(x + width, y, x + width, y + height, corner);
        context.arcTo(x + width, y + height, x, y + height, corner);
        context.arcTo(x, y + height, x, y, corner);
        context.arcTo(x, y, x + width, y, corner);
        context.closePath();
    }

    function seekDiscoverAudio(audio, time) {
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        if (!duration) return;
        const nextTime = Math.max(0, Math.min(duration, time));
        if (!isSafariBrowser() && typeof audio.fastSeek === "function") {
            try {
                audio.fastSeek(nextTime);
                return;
            } catch {}
        }
        audio.currentTime = nextTime;
    }

    function scheduleDiscoverPlaybackFrame() {
        if (discoverPlayback.animationFrame) {
            cancelAnimationFrame(discoverPlayback.animationFrame);
            discoverPlayback.animationFrame = null;
        }

        const step = () => {
            const activeCard = discoverPlayback.activeCardId
                ? document.querySelector(`[data-card-id="${CSS.escape(discoverPlayback.activeCardId)}"]`)
                : null;
            const scrubbingCards = Array.from(document.querySelectorAll('[data-carousel-card][data-scrubbing="true"]'));

            if (discoverPlayback.activeAudio && activeCard) {
                syncDiscoverCardPlaybackUI(activeCard);
            }
            scrubbingCards.forEach((card) => syncDiscoverCardPlaybackUI(card));

            if ((discoverPlayback.activeAudio && !discoverPlayback.activeAudio.paused) || scrubbingCards.length) {
                discoverPlayback.animationFrame = requestAnimationFrame(step);
            } else {
                discoverPlayback.animationFrame = null;
            }
        };

        if (discoverPlayback.activeAudio || document.querySelector('[data-carousel-card][data-scrubbing="true"]')) {
            discoverPlayback.animationFrame = requestAnimationFrame(step);
        }
    }

    function renderDiscoverEmpty(title, description) {
        return `
            <div class="discover-empty">
                <div>
                    <strong style="display:block; margin-bottom:8px;">${escapeHtml(title)}</strong>
                    <span>${escapeHtml(description)}</span>
                </div>
            </div>
        `;
    }

    function compactCount(value) {
        return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
    }

    function parseCompactNumber(value) {
        if (typeof value === "number") return value;
        if (typeof value !== "string") return 0;
        const normalized = value.trim().toUpperCase();
        const multiplier = normalized.endsWith("K") ? 1_000 : normalized.endsWith("M") ? 1_000_000 : 1;
        return Number.parseFloat(normalized) * multiplier || 0;
    }

    function recencyBoost(dateValue) {
        if (!dateValue) return 0;
        const timestamp = new Date(dateValue).getTime();
        if (Number.isNaN(timestamp)) return 0;
        const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
        return Math.max(0, 45 - days);
    }

    function stableSort(items, scorer) {
        return items
            .map((item, index) => ({ item, index, score: scorer(item) }))
            .sort((a, b) => (b.score - a.score) || (a.index - b.index))
            .map((entry) => entry.item);
    }

    function firstPriceLabel(beat) {
        const prices = [
            beat.basic_license_price,
            beat.premium_license_price,
            beat.exclusive_license_price
        ].filter((value) => typeof value === "number");
        if (!prices.length) return "View Tiers";
        return `$${Number(prices[0]).toFixed(0)}+`;
    }

    const BEAT_LICENSE_TIER_DEFINITIONS = {
        basic: {
            key: "basic",
            label: "Basic License",
            bullets: [
                "MP3",
                "up to 5,000 sales/downloads",
                "up to 100,000 streams",
                "1 music video",
                "non-exclusive"
            ]
        },
        premium: {
            key: "premium",
            label: "Premium License",
            bullets: [
                "MP3 + WAV",
                "up to 20,000 sales/downloads",
                "up to 500,000 streams",
                "1 music video",
                "non-exclusive"
            ]
        },
        exclusive: {
            key: "exclusive",
            label: "Exclusive License",
            bullets: [
                "MP3 + WAV + stems",
                "unlimited sales/downloads",
                "unlimited streams",
                "unlimited videos",
                "exclusive / beat removed from sale"
            ]
        }
    };

    function formatUSD(value) {
        if (!Number.isFinite(Number(value))) return "";
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2
        }).format(Number(value));
    }

    function beatLicenseOffers(beat) {
        const offers = [];
        if (beat.basicLicenseEnabled && Number.isFinite(Number(beat.basicLicensePrice))) {
            offers.push({
                ...BEAT_LICENSE_TIER_DEFINITIONS.basic,
                price: Number(beat.basicLicensePrice)
            });
        }
        if (beat.premiumLicenseEnabled && Number.isFinite(Number(beat.premiumLicensePrice))) {
            offers.push({
                ...BEAT_LICENSE_TIER_DEFINITIONS.premium,
                price: Number(beat.premiumLicensePrice)
            });
        }
        if (beat.exclusiveLicenseEnabled && Number.isFinite(Number(beat.exclusiveLicensePrice))) {
            offers.push({
                ...BEAT_LICENSE_TIER_DEFINITIONS.exclusive,
                price: Number(beat.exclusiveLicensePrice)
            });
        }
        return offers;
    }

    function licenseTierSummary(offers) {
        if (!offers.length) return "Not currently for sale";
        return offers.map((offer) => offer.label.replace(" License", "")).join(" / ");
    }

    async function fetchBeatPurchaseState(beatId) {
        if (!state.authUser?.id || !beatId || !hasSupabase()) return null;

        let query = getSupabase()
            .from("purchases")
            .select("id, license_type, amount, created_at, entitlement_files")
            .eq("user_id", state.authUser.id)
            .eq("content_type", "beat")
            .eq("beats_id", beatId)
            .eq("status", "completed")
            .eq("environment", currentStripeEnvironment())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        let { data, error } = await query;
        if (purchaseEnvironmentColumnMissing(error)) {
            ({ data, error } = await getSupabase()
                .from("purchases")
                .select("id, license_type, amount, created_at, entitlement_files")
                .eq("user_id", state.authUser.id)
                .eq("content_type", "beat")
                .eq("beats_id", beatId)
                .eq("status", "completed")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle());
        }

        if (error) {
            console.error("Beat purchase state query failed", error);
            return null;
        }

        if (!data) return null;
        const licenseType = String(data.license_type || "basic").toLowerCase();
        return {
            id: data.id,
            tierKey: licenseType,
            tierLabel: purchasedTierLabel(licenseType),
            files: Array.isArray(data.entitlement_files) && data.entitlement_files.length
                ? data.entitlement_files.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
                : purchasedFilesForTier(licenseType),
            amount: Number(data.amount) || 0,
            purchaseDate: data.created_at || ""
        };
    }

    function trimText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return `${text.slice(0, maxLength - 1).trimEnd()}…`;
    }

    async function fillDynamicDetail() {
        const beatMount = document.querySelector("[data-beat-detail]");
        const songMount = document.querySelector("[data-song-detail]");

        if (beatMount) {
            const beatId = requestedBeatId();
            let beat = null;

            if (beatId && hasSupabase()) {
                const beatSelect = "id, user_id, title, album_url, bpm, key, tags, description, genre, mood, likes, comments, comments_disabled, producer_display_name, additional_producers, public_license_state, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, basic_license_price, premium_license_price, exclusive_license_price, exclusive_includes_stems, file_mp3_url, profiles!beats_user_id_fkey(display_name, username, profile_image_url)";
                const { data, error } = await executeBeatSelectWithFallback((selectClause) => {
                    return getSupabase()
                        .from("beats")
                        .select(selectClause)
                        .eq("id", beatId)
                        .limit(1)
                        .maybeSingle();
                }, beatSelect);

                if (!error && data) {
                    const purchaseState = await fetchBeatPurchaseState(data.id);
                    const producerCreditState = await enrichBeatProducerCreditState(normalizeBeatProducerCredits({
                        user_id: data.user_id,
                        username: data.profiles?.username || "",
                        display_name: data.profiles?.display_name || data.profiles?.username || "",
                        profile_image_url: data.profiles?.profile_image_url || ""
                    }, data.additional_producers));
                    beat = await hydrateBeatCardMedia(normalizeSeedBeatCard({
                        id: data.id,
                        userId: data.user_id,
                        title: data.title || "Untitled Beat",
                        image: data.album_url || "",
                        creatorName: producerCreditState.names[0] || data.profiles?.display_name || data.profiles?.username || "Unknown Producer",
                        creatorUsername: data.profiles?.username || "",
                        creatorHandle: data.profiles?.username ? `@${data.profiles.username}` : "@soundswipe",
                        creatorAvatar: data.profiles?.profile_image_url || "",
                        producers: producerCreditState.names.length ? producerCreditState.names : [data.profiles?.display_name || data.profiles?.username].filter(Boolean),
                        producerCredits: producerCreditState.all,
                        linkedProducerCredits: producerCreditState.linked,
                        manualProducerCredits: producerCreditState.manual,
                        bpm: data.bpm || null,
                        key: data.key || null,
                        tags: Array.isArray(data.tags) ? data.tags : [],
                        description: data.description || "",
                        genre: data.genre || "",
                        mood: data.mood || "",
                        publicLicenseState: data.public_license_state === "free_for_non_profit" ? "Free for Non-Profit" : "License Required",
                        basicLicenseEnabled: data.basic_license_enabled !== false,
                        premiumLicenseEnabled: Boolean(data.premium_license_enabled),
                        exclusiveLicenseEnabled: Boolean(data.exclusive_license_enabled),
                        basicLicensePrice: data.basic_license_price,
                        premiumLicensePrice: data.premium_license_price,
                        exclusiveLicensePrice: data.exclusive_license_price,
                        exclusiveIncludesStems: data.exclusive_includes_stems !== false,
                        isOwnedByCurrentUser: data.user_id === state.authUser?.id,
                        purchaseState,
                        likesCount: Number(data.likes) || 0,
                        isLikedByCurrentUser: false,
                        commentsCount: Number(data.comments) || 0,
                        commentsDisabled: Boolean(data.comments_disabled),
                        entityType: "beat",
                        audioFile: data.file_mp3_url || "",
                        href: buildPublicContentShareURL("beat", data, data.title, { absolute: false })
                    }));
                }
            }

            if (!beat) {
                beatMount.innerHTML = renderDiscoverEmpty("Beat not found", "This beat may have been removed, made private, or the link may be incorrect.");
                return;
            }

            beat.entityType = beat.entityType || "beat";
            beat.commentsCount = Number(beat.commentsCount ?? beat.comments) || 0;
            beat.commentsDisabled = Boolean(beat.commentsDisabled);
            beat.licenseOffers = beatLicenseOffers(beat);
            beat.tierSummary = licenseTierSummary(beat.licenseOffers);
            beat.startingPriceLabel = beat.licenseOffers.length ? formatUSD(beat.licenseOffers[0].price) : (beat.price || firstPriceLabel(beat));
            beat.isOwnedByCurrentUser = Boolean(beat.isOwnedByCurrentUser || (beat.userId && beat.userId === state.authUser?.id));
            applyCanonicalPublicURL(buildPublicContentShareURL("beat", beat, beat.title, { absolute: false }));
            const postUploadPrompt = consumePostUploadSharePrompt(beat);

            document.title = `${beat.title} • SoundSwipe`;
            beatMount.innerHTML = `${postUploadPrompt ? renderPostUploadShareBanner(beat) : ""}${beatDetailMarkup(beat)}`;
            initializeDiscoverPlayback();
            await wireDetailLikeBar(beatMount, beat);
            wireDetailDeleteAction(beatMount, beat);
            wireBeatPurchaseSection(beatMount, beat);
            await wireDetailComments(beatMount, beat);
            if (postUploadPrompt) wirePostUploadShareBanner(beatMount, beat);
        }

        if (songMount) {
            const songId = requestedSongId();
            let song = null;

            if (songId && hasSupabase()) {
                const { data, error } = await getSupabase()
                    .from("songs")
                    .select("id, user_id, title, album_art, export_file_url, release_date, genre, tags, producer_tags, likes, comments, comments_disabled")
                    .eq("id", songId)
                    .limit(1)
                    .maybeSingle();

                if (!error && data) {
                    const profile = await fetchLiveProfileRecord(data.user_id);
                    const producerNames = Array.isArray(data.producer_tags)
                        ? data.producer_tags.map((tag) => tag?.displayName || tag?.display_name || tag?.username).filter(Boolean)
                        : [];
                    song = await hydrateSongCardMedia(normalizeSeedSongCard({
                        id: data.id,
                        userId: data.user_id,
                        title: data.title || "Untitled Song",
                        image: data.album_art || "",
                        audioFile: data.export_file_url || "",
                        creatorName: profile?.display_name || profile?.username || producerNames[0] || "SoundSwipe Artist",
                        creatorUsername: profile?.username || "",
                        creatorHandle: profile?.username ? `@${profile.username}` : "@soundswipe",
                        creatorAvatar: profile?.profile_image_url || "",
                        producers: producerNames,
                        tags: Array.isArray(data.tags) ? data.tags : [data.genre].filter(Boolean),
                        description: "",
                        genre: data.genre || "",
                        releaseDate: data.release_date || null,
                        isOwnedByCurrentUser: data.user_id === state.authUser?.id,
                        likesCount: Number(data.likes) || 0,
                        isLikedByCurrentUser: false,
                        commentsCount: Number(data.comments) || 0,
                        commentsDisabled: Boolean(data.comments_disabled),
                        entityType: "song",
                        href: buildPublicContentShareURL("song", data, data.title, { absolute: false })
                    }));
                }
            }

            if (!song) {
                songMount.innerHTML = renderDiscoverEmpty("Song not found", "This song may have been removed, made private, or the link may be incorrect.");
                return;
            }

            song.entityType = song.entityType || "song";
            song.commentsCount = Number(song.commentsCount ?? song.comments) || 0;
            song.isOwnedByCurrentUser = Boolean(song.isOwnedByCurrentUser || (song.userId && song.userId === state.authUser?.id));
            song.commentsDisabled = Boolean(song.commentsDisabled);
            applyCanonicalPublicURL(buildPublicContentShareURL("song", song, song.title, { absolute: false }));
            const postUploadPrompt = consumePostUploadSharePrompt(song);
            document.title = `${song.title} • SoundSwipe`;
            songMount.innerHTML = `${postUploadPrompt ? renderPostUploadShareBanner(song) : ""}${songDetailMarkup(song)}`;
            initializeDiscoverPlayback();
            await wireDetailLikeBar(songMount, song);
            wireDetailDeleteAction(songMount, song);
            await wireDetailComments(songMount, song);
            if (postUploadPrompt) wirePostUploadShareBanner(songMount, song);
        }
    }

    async function fillProfilePage() {
        const mount = document.querySelector("[data-profile-detail]");
        if (!mount) return;

        const params = new URLSearchParams(window.location.search);
        const requestedProfile = requestedProfileRoute();
        const requestedId = requestedProfile.id;
        const requestedUsername = requestedProfile.username;
        const requestedTab = params.get("tab");
        const requestedRelationship = params.get("relationship");
        const isOwnProfile = (!requestedId && !requestedUsername) || requestedId === state.authUser?.id || requestedUsername === state.profile?.username;

        if (!hasSupabase()) {
            profilePageState.data = buildFallbackProfilePageData(requestedId, isOwnProfile);
            if (requestedTab === "songs" || requestedTab === "beats" || requestedTab === "playlists") {
                profilePageState.activeTab = requestedTab;
            }
            renderProfilePage(mount);
            return;
        }

        let targetProfileId = requestedId || "";
        if (!targetProfileId && requestedUsername) {
            const profileByUsername = await fetchLiveProfileRecordByUsername(requestedUsername);
            targetProfileId = profileByUsername?.id || "";
        }
        if (!targetProfileId && !requestedId && !requestedUsername) {
            targetProfileId = state.authUser?.id || "";
        }
        if (!targetProfileId) {
            if (requestedId || requestedUsername) {
                mount.innerHTML = renderProfileCompactEmpty("Profile not found.", "This profile may have been removed or the link may be incorrect.");
                return;
            }
            mount.innerHTML = renderProfileCompactEmpty("Sign in to view your profile.", "Your SoundSwipe profile, likes, and playlists will appear here once you’re signed in.");
            return;
        }

        mount.innerHTML = `
            <div class="profile-loading-shell">
                <div class="content-panel profile-loading-card">
                    <span class="eyebrow">Profile</span>
                    <h1>Loading profile…</h1>
                    <p class="lede">Pulling in profile info, uploads, playlists, and saved content.</p>
                </div>
            </div>
        `;

        const liveData = await loadLiveProfilePageData(targetProfileId, isOwnProfile);
        profilePageState.data = liveData || buildFallbackProfilePageData(requestedId, isOwnProfile);
        syncOwnProfileRelationshipSnapshot(profilePageState.data);

        if (requestedTab === "songs" || requestedTab === "beats" || requestedTab === "playlists") {
            profilePageState.activeTab = requestedTab;
        }

        if (profilePageState.activeTab === "likes" && !profilePageState.data?.isOwnProfile) {
            profilePageState.activeTab = "beats";
        }

        renderProfilePage(mount);
        applyCanonicalPublicURL(buildPublicProfileURL(profilePageState.data, {
            absolute: false,
            tab: profilePageState.activeTab,
            relationship: profilePageState.relationshipModal.open ? profilePageState.relationshipModal.mode : requestedRelationship
        }));

        if ((requestedRelationship === "followers" || requestedRelationship === "following") && hasSupabase() && profilePageState.data?.id) {
            await openProfileRelationshipModal(requestedRelationship);
        }
    }

    async function fillEditProfilePage() {
        const mount = document.querySelector("[data-edit-profile]");
        if (!mount) return;

        if (!isLoggedIn()) {
            mount.innerHTML = renderProfileCompactEmpty("Sign in to edit your profile.", "Your SoundSwipe profile settings will appear here once you’re signed in.");
            return;
        }

        mount.innerHTML = `
            <div class="profile-loading-shell">
                <div class="content-panel profile-loading-card">
                    <span class="eyebrow">Edit Profile</span>
                    <h1>Loading your profile…</h1>
                    <p class="lede">Getting your profile details ready.</p>
                </div>
            </div>
        `;

        const profile = await fetchEditableProfileRecord();
        if (!profile) {
            mount.innerHTML = renderProfileCompactEmpty("We couldn’t load your profile.", "Please try again in a moment.");
            return;
        }

        state.profile = {
            ...(state.profile || {}),
            ...profile
        };

        renderEditProfilePage(mount, profile);
        wireEditProfileForm(mount, profile);
    }

    async function fetchEditableProfileRecord() {
        if (!state.authUser?.id || !hasSupabase()) return null;

        const { data, error } = await getSupabase()
            .from("profiles")
            .select("id, display_name, username, bio, date_of_birth, user_type, profile_image_url, profile_image_updated_at, preferences_completed")
            .eq("id", state.authUser.id)
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("Editable profile query failed", error);
            return null;
        }

        return await hydrateProfileMedia(data || null);
    }

    async function fillSettingsPage() {
        const mount = document.querySelector("[data-settings-page]");
        if (!mount) return;

        if (!isLoggedIn()) {
            mount.innerHTML = renderProfileCompactEmpty("Sign in to manage settings.", "Your SoundSwipe settings will appear here once you’re signed in.");
            return;
        }

        mount.innerHTML = `
            <div class="profile-loading-shell">
                <div class="content-panel profile-loading-card">
                    <span class="eyebrow">Settings</span>
                    <h1>Loading your settings…</h1>
                    <p class="lede">Getting your account preferences ready.</p>
                </div>
            </div>
        `;

        const [profile, stripeCommerce] = await Promise.all([
            fetchSettingsProfileRecord(),
            fetchSettingsStripeStatus()
        ]);
        if (!profile) {
            mount.innerHTML = renderProfileCompactEmpty("We couldn’t load your settings.", "Please try again in a moment.");
            return;
        }

        state.profile = {
            ...(state.profile || {}),
            ...profile
        };

        renderSettingsPage(mount, profile, stripeCommerce);
        wireSettingsForm(mount);

        const params = new URLSearchParams(window.location.search);
        const stripeResult = params.get("stripe");
        if (stripeResult === "return") {
            const feedbackNode = mount.querySelector("[data-settings-feedback]");
            if (feedbackNode) {
                setFeedbackNode(feedbackNode, "Stripe returned to SoundSwipe. Seller status has been refreshed.", "success");
            }
        } else if (stripeResult === "refresh") {
            const feedbackNode = mount.querySelector("[data-settings-feedback]");
            if (feedbackNode) {
                setFeedbackNode(feedbackNode, "Stripe asked to refresh onboarding. You can continue connecting your account.", "info");
            }
        }
    }

    async function fillSellerDashboardPage() {
        const mount = document.querySelector("[data-seller-dashboard-page]");
        if (!mount) return;

        if (!isLoggedIn()) {
            mount.innerHTML = renderProfileCompactEmpty("Sign in to view seller dashboard.", "Your sales, commerce analytics, and Stripe shortcuts will appear here once you’re signed in.");
            return;
        }

        mount.innerHTML = `
            <div class="profile-loading-shell">
                <div class="content-panel profile-loading-card">
                    <span class="eyebrow">Seller Dashboard</span>
                    <h1>Loading seller analytics…</h1>
                    <p class="lede">Pulling in your sales history, beat performance, and Stripe-connected status.</p>
                </div>
            </div>
        `;

        let dashboard = null;
        try {
            dashboard = await invokeAuthedJSONFunction("stripe-connect", {}, "/seller-dashboard");
        } catch (error) {
            console.error("Seller dashboard query failed", error);
        }

        document.title = "Seller Dashboard • SoundSwipe";
        mount.innerHTML = renderSellerDashboardPage(dashboard);
        wireSellerDashboardPage(mount);
    }

    function renderSellerDashboardPage(dashboard) {
        const connected = Boolean(dashboard?.connected);
        const summary = dashboard?.summary || {
            totalSales: 0,
            totalRevenue: 0,
            totalBeatsSold: 0,
            recentSalesCount: 0
        };
        const sales = Array.isArray(dashboard?.sales) ? dashboard.sales : [];
        const breakdown = Array.isArray(dashboard?.beatBreakdown) ? dashboard.beatBreakdown : [];

        if (!connected) {
            return `
                <div class="seller-dashboard-page">
                    <div class="content-panel seller-dashboard-hero">
                        <div class="seller-dashboard-heading">
                            <span class="eyebrow">Seller Dashboard</span>
                            <h1>Connect Stripe to start selling.</h1>
                            <p class="lede">Once your Stripe account is connected, you’ll be able to track sales, license revenue, and beat performance from one place.</p>
                        </div>
                        <div class="seller-dashboard-actions">
                            <button class="button" type="button" data-seller-connect-stripe>Connect to Stripe</button>
                            <a class="button-secondary" href="settings.html">Open Settings</a>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="seller-dashboard-page">
                <div class="content-panel seller-dashboard-hero">
                    <div class="seller-dashboard-heading">
                        <span class="eyebrow">Seller Dashboard</span>
                        <h1>Track sales, licenses, and beat performance.</h1>
                        <p class="lede">Review revenue, recent purchases, and which beats are converting best across your SoundSwipe storefront.</p>
                    </div>
                    <div class="seller-dashboard-actions">
                        <button class="button-secondary" type="button" data-seller-open-stripe>View on Stripe</button>
                        <a class="button-secondary" href="settings.html">Commerce Settings</a>
                    </div>
                </div>

                <div class="seller-dashboard-metrics">
                    ${renderSellerDashboardMetric("Total Sales", compactCount(summary.totalSales), `${summary.totalSales || 0} completed purchase${Number(summary.totalSales) === 1 ? "" : "s"}`)}
                    ${renderSellerDashboardMetric("Total Revenue", formatUSD(summary.totalRevenue || 0), "Gross license revenue")}
                    ${renderSellerDashboardMetric("Beats Sold", compactCount(summary.totalBeatsSold), "Unique beats with purchases")}
                    ${renderSellerDashboardMetric("Recent Sales", compactCount(summary.recentSalesCount), "Last 30 days")}
                </div>

                <div class="seller-dashboard-grid">
                    <section class="content-panel seller-dashboard-panel">
                        <div class="seller-dashboard-panel-head">
                            <div>
                                <span class="eyebrow">Sales History</span>
                                <h2>Recent Sales</h2>
                            </div>
                            <span class="muted">${sales.length ? `${sales.length} sale${sales.length === 1 ? "" : "s"} shown` : "No sales yet"}</span>
                        </div>
                        ${sales.length ? `
                            <div class="seller-sales-table-wrap">
                                <table class="seller-sales-table">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Beat</th>
                                            <th>Buyer</th>
                                            <th>License</th>
                                            <th>Order</th>
                                            <th>Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${sales.map((sale) => `
                                            <tr>
                                                <td>${escapeHtml(formatCommentTimestamp(sale.date || ""))}</td>
                                                <td>${escapeHtml(sale.beatTitle || "Untitled Beat")}</td>
                                                <td>
                                                    <div class="seller-buyer-cell">
                                                        <strong>${escapeHtml(sale.buyerName || "Unknown buyer")}</strong>
                                                        ${sale.buyerUsername ? `<span>${escapeHtml(sale.buyerUsername)}</span>` : ""}
                                                    </div>
                                                </td>
                                                <td>${escapeHtml(purchasedTierLabel(sale.licenseTier || "basic").replace(" Purchased", ""))}</td>
                                                <td class="seller-order-cell">${escapeHtml(trimText(String(sale.orderReference || ""), 18) || "—")}</td>
                                                <td>${escapeHtml(formatUSD(sale.amount || 0))}</td>
                                            </tr>
                                        `).join("")}
                                    </tbody>
                                </table>
                            </div>
                        ` : renderProfileCompactEmpty("No sales yet.", "Sales will appear here as soon as buyers start licensing your beats.")}
                    </section>

                    <section class="content-panel seller-dashboard-panel">
                        <div class="seller-dashboard-panel-head">
                            <div>
                                <span class="eyebrow">Beat Breakdown</span>
                                <h2>Top Performing Beats</h2>
                            </div>
                            <span class="muted">${breakdown.length ? `${breakdown.length} beat${breakdown.length === 1 ? "" : "s"}` : "No purchases yet"}</span>
                        </div>
                        ${breakdown.length ? `
                            <div class="seller-breakdown-list">
                                ${breakdown.map((item) => `
                                    <div class="seller-breakdown-row">
                                        <div>
                                            <strong>${escapeHtml(item.beatTitle || "Untitled Beat")}</strong>
                                            <span>${escapeHtml(compactCount(item.salesCount || 0))} sale${Number(item.salesCount) === 1 ? "" : "s"}</span>
                                        </div>
                                        <strong>${escapeHtml(formatUSD(item.revenue || 0))}</strong>
                                    </div>
                                `).join("")}
                            </div>
                        ` : renderProfileCompactEmpty("No purchased beats yet.", "Once buyers start licensing your beats, the per-beat revenue breakdown will show up here.")}
                    </section>
                </div>
            </div>
        `;
    }

    function renderSellerDashboardMetric(label, value, detail) {
        return `
            <article class="content-panel seller-metric-card">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(String(value || ""))}</strong>
                <small>${escapeHtml(detail || "")}</small>
            </article>
        `;
    }

    function wireSellerDashboardPage(mount) {
        mount.querySelector("[data-seller-connect-stripe]")?.addEventListener("click", async () => {
            await startStripeConnectOnboarding(null, {
                returnURL: new URL("seller-dashboard.html?stripe=return", window.location.href).toString(),
                refreshURL: new URL("seller-dashboard.html?stripe=refresh", window.location.href).toString()
            });
        });

        mount.querySelector("[data-seller-open-stripe]")?.addEventListener("click", async () => {
            try {
                const payload = await invokeAuthedJSONFunction("stripe-connect", {}, "/create-login-link");
                if (payload?.url) {
                    window.location.href = payload.url;
                }
            } catch (error) {
                console.error("Stripe dashboard open failed", error);
                showSiteToast("We couldn’t open Stripe right now.", "error");
            }
        });

        const params = new URLSearchParams(window.location.search);
        if (params.get("stripe") === "return") {
            showSiteToast("Stripe returned to SoundSwipe. Seller status has been refreshed.", "success");
        } else if (params.get("stripe") === "refresh") {
            showSiteToast("Stripe requested a refresh. You can continue connecting your account.", "info");
        }
    }

    async function fetchSettingsProfileRecord() {
        if (!state.authUser?.id || !hasSupabase()) return null;

        const { data, error } = await getSupabase()
            .from("profiles")
            .select("id, email, username, user_type, is_private, show_in_discovery, allow_direct_messages, show_online_status, allow_read_receipts, profile_image_url, profile_image_updated_at")
            .eq("id", state.authUser.id)
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("Settings profile query failed", error);
            return null;
        }

        return await hydrateProfileMedia(data || null);
    }

    async function fetchSettingsStripeStatus() {
        if (!state.authUser?.id || !hasSupabase()) return null;

        try {
            return await invokeAuthedJSONFunction("stripe-connect", {}, "/status");
        } catch (error) {
            console.error("Stripe status query failed", error);
            return null;
        }
    }

    async function loadLiveProfilePageData(profileId, isOwnProfile) {
        try {
            const profile = await fetchLiveProfileRecord(profileId);
            if (!profile) return null;

            const [isFollowing, relationshipCounts, contentCounts] = await Promise.all([
                !isOwnProfile && isLoggedIn()
                    ? fetchIsFollowingProfile(profileId)
                    : Promise.resolve(false),
                fetchProfileRelationshipCounts(profileId, {
                    followers: Number(profile.followers) || 0,
                    following: Number(profile.following) || 0
                }),
                fetchProfileContentCounts(profileId, {
                    beats: Number(profile.uploaded_beats) || 0,
                    songs: Number(profile.uploaded_songs) || 0
                })
            ]);

            const isPrivateLocked = Boolean(profile.is_private) && !isOwnProfile && !isFollowing;

            const [beats, songs, playlists, likes] = await Promise.all([
                isPrivateLocked ? [] : fetchProfileBeats(profileId, isOwnProfile),
                isPrivateLocked ? [] : fetchProfileSongs(profileId, profile),
                isPrivateLocked ? [] : fetchProfilePlaylists(profileId, isOwnProfile),
                isOwnProfile ? fetchProfileLikes(profileId) : Promise.resolve({ beats: [], songs: [] })
            ]);

            return {
                id: profile.id,
                isOwnProfile,
                isFollowing,
                isPrivateLocked,
                displayName: profile.display_name || profile.username || "SoundSwipe User",
                username: profile.username ? `@${profile.username}` : "@soundswipe",
                usernameRaw: profile.username || "",
                image: profile.profile_image_url || "",
                imageVersion: profile.profile_image_updated_at || "",
                bio: profile.bio || "",
                isVerified: Boolean(profile.is_verified),
                role: prettifyUserType(profile.user_type),
                followers: relationshipCounts.followers,
                following: relationshipCounts.following,
                beatsCount: contentCounts.beats,
                songsCount: contentCounts.songs,
                playlistsCount: playlists.length,
                allowDirectMessages: profile.allow_direct_messages !== false,
                email: profile.email || "",
                beats,
                songs,
                playlists,
                likedBeats: likes.beats,
                likedSongs: likes.songs
            };
        } catch (error) {
            console.error("Profile page load failed", error);
            return null;
        }
    }

    async function fetchProfileRelationshipCounts(profileId, fallback = {}) {
        const followConfig = resolveFollowTableConfig();
        if (!followConfig || !profileId) {
            return {
                followers: Number(fallback.followers) || 0,
                following: Number(fallback.following) || 0
            };
        }

        const supabase = getSupabase();
        const [followersResult, followingResult] = await Promise.all([
            supabase
                .from(followConfig.table)
                .select("id", { count: "exact", head: true })
                .eq(followConfig.targetColumn, profileId),
            supabase
                .from(followConfig.table)
                .select("id", { count: "exact", head: true })
                .eq("follower_id", profileId)
        ]);

        if (followersResult.error) {
            console.error("Followers count query failed", followersResult.error);
        }
        if (followingResult.error) {
            console.error("Following count query failed", followingResult.error);
        }

        return {
            followers: followersResult.error ? (Number(fallback.followers) || 0) : (Number(followersResult.count) || 0),
            following: followingResult.error ? (Number(fallback.following) || 0) : (Number(followingResult.count) || 0)
        };
    }

    async function fetchProfileContentCounts(profileId, fallback = {}) {
        if (!hasSupabase() || !profileId) {
            return {
                beats: Number(fallback.beats) || 0,
                songs: Number(fallback.songs) || 0
            };
        }

        const supabase = getSupabase();
        const [beatsResult, songsResult] = await Promise.all([
            filterVisibleBeats(
                supabase
                    .from("beats")
                    .select("id", { count: "exact", head: true })
                    .eq("user_id", profileId)
            ),
            supabase
                .from("songs")
                .select("id", { count: "exact", head: true })
                .eq("user_id", profileId)
        ]);

        if (beatsResult.error) {
            console.error("Profile beat count query failed", beatsResult.error);
        }
        if (songsResult.error) {
            console.error("Profile song count query failed", songsResult.error);
        }

        return {
            beats: beatsResult.error ? (Number(fallback.beats) || 0) : (Number(beatsResult.count) || 0),
            songs: songsResult.error ? (Number(fallback.songs) || 0) : (Number(songsResult.count) || 0)
        };
    }

    async function fetchLiveProfileRecord(profileId) {
        const { data, error } = await getSupabase()
            .from("profiles")
            .select("id, email, display_name, username, profile_image_url, profile_image_updated_at, bio, followers, following, is_verified, uploaded_beats, uploaded_songs, user_type, is_private, allow_direct_messages")
            .eq("id", profileId)
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("Profile record query failed", error);
            return null;
        }

        return await hydrateProfileMedia(data || null);
    }

    async function fetchLiveProfileRecordByUsername(username) {
        const normalizedUsername = normalizeUsernameValue(username);
        if (!normalizedUsername) return null;

        const { data, error } = await getSupabase()
            .from("profiles")
            .select("id, email, display_name, username, profile_image_url, profile_image_updated_at, bio, followers, following, is_verified, uploaded_beats, uploaded_songs, user_type, is_private, allow_direct_messages")
            .ilike("username", normalizedUsername)
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("Profile username query failed", error);
            return null;
        }

        return await hydrateProfileMedia(data || null);
    }

    async function fetchProfileBeats(profileId, isOwnProfile) {
        const beatSelect = "id, user_id, title, album_url, bpm, key, tags, description, genre, mood, comments, producer_display_name, additional_producers, public_license_state, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, basic_license_price, premium_license_price, exclusive_license_price, file_mp3_url, upload_date, profiles!beats_user_id_fkey(display_name, username, profile_image_url)";
        const { data, error } = await executeBeatSelectWithFallback((selectClause) => {
            return filterVisibleBeats(getSupabase()
                .from("beats")
                .select(selectClause)
                .eq("user_id", profileId)
                .order("upload_date", { ascending: false })
                .limit(60));
        }, beatSelect);

        if (error) {
            console.error("Profile beats query failed", error);
            return [];
        }

        return Promise.all((data || []).map((beat) => mapBeatRowToProfileCard(beat, { ownBeat: isOwnProfile })));
    }

    async function fetchProfileSongs(profileId, profileRecord = null) {
        const { data, error } = await getSupabase()
            .from("songs")
            .select("id, user_id, title, album_art, export_file_url, producer_tags, release_date, genre, tags")
            .eq("user_id", profileId)
            .order("release_date", { ascending: false })
            .limit(60);

        if (error) {
            console.error("Profile songs query failed", error);
            return [];
        }

        return Promise.all((data || []).map((song) => mapSongRowToProfileCard(song, profileRecord)));
    }

    async function fetchProfilePlaylists(profileId, isOwnProfile) {
        let query = getSupabase()
            .from("playlists")
            .select("id, name, cover_image_url, creator_id, is_public, updated_at, (SELECT count(*) FROM playlist_items WHERE playlist_id = playlists.id) as item_count")
            .eq("creator_id", profileId)
            .order("updated_at", { ascending: false })
            .limit(40);

        if (!isOwnProfile) {
            query = query.eq("is_public", true);
        }

        const { data, error } = await query;
        if (error) {
            console.error("Profile playlists query failed", error);
            return [];
        }

        return (data || []).map((playlist) => ({
            id: playlist.id,
            title: playlist.name || "Untitled Playlist",
            image: playlist.cover_image_url || "",
            itemCount: Number(playlist.item_count) || 0,
            isPublic: playlist.is_public !== false
        }));
    }

    async function fetchProfileLikes(profileId) {
        const { data, error } = await getSupabase()
            .from("liked_content")
            .select("content_id, content_type, created_at")
            .eq("user_id", profileId)
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) {
            console.error("Profile likes query failed", error);
            return { beats: [], songs: [] };
        }

        const likeRows = Array.isArray(data) ? data : [];
        const beatIds = [];
        const songIds = [];
        const rank = new Map();

        likeRows.forEach((row, index) => {
            const type = String(row.content_type || "").toLowerCase();
            rank.set(row.content_id, index);
            if (type.includes("beat")) beatIds.push(row.content_id);
            if (type.includes("song")) songIds.push(row.content_id);
        });

        const [beats, songs] = await Promise.all([
            fetchLikedBeatCards(beatIds, rank),
            fetchLikedSongCards(songIds, rank)
        ]);

        return { beats, songs };
    }

    async function fetchLikedBeatCards(ids, rank) {
        if (!ids.length) return [];
        const beatSelect = "id, user_id, title, album_url, bpm, key, tags, description, genre, mood, public_license_state, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, producer_display_name, additional_producers, basic_license_price, premium_license_price, exclusive_license_price, file_mp3_url, upload_date, profiles!beats_user_id_fkey(display_name, username, profile_image_url)";
        const { data, error } = await executeBeatSelectWithFallback((selectClause) => {
            return filterVisibleBeats(getSupabase()
                .from("beats")
                .select(selectClause)
                .in("id", ids));
        }, beatSelect);

        if (error) {
            console.error("Liked beats query failed", error);
            return [];
        }

        const cards = await Promise.all((data || [])
            .map((beat) => mapBeatRowToProfileCard(beat, { ownBeat: beat.user_id === state.authUser?.id })));

        return cards.sort((lhs, rhs) => (rank.get(lhs.id) ?? 9999) - (rank.get(rhs.id) ?? 9999));
    }

    async function fetchLikedSongCards(ids, rank) {
        if (!ids.length) return [];
        const { data, error } = await getSupabase()
            .from("songs")
            .select("id, user_id, title, album_art, export_file_url, producer_tags, artist_display_name, release_date, genre, tags")
            .in("id", ids);

        if (error) {
            console.error("Liked songs query failed", error);
            return [];
        }

        const cards = await Promise.all((data || []).map(mapSongRowToProfileCard));
        return cards.sort((lhs, rhs) => (rank.get(lhs.id) ?? 9999) - (rank.get(rhs.id) ?? 9999));
    }

    async function fetchIsFollowingProfile(targetUserId) {
        const currentUserId = state.authUser?.id;
        if (!currentUserId || currentUserId === targetUserId) return false;

        const followConfig = resolveFollowTableConfig();
        if (!followConfig) return false;

        const { data, error } = await getSupabase()
            .from(followConfig.table)
            .select("id")
            .eq("follower_id", currentUserId)
            .eq(followConfig.targetColumn, targetUserId)
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("Follow status query failed", error);
            return false;
        }

        return Boolean(data?.id);
    }

    function syncOwnProfileRelationshipSnapshot(profileData) {
        if (!profileData || profileData.id !== state.authUser?.id) return;
        state.profile = {
            ...(state.profile || {}),
            followers: Number(profileData.followers) || 0,
            following: Number(profileData.following) || 0,
            uploaded_beats: Number(profileData.beatsCount) || 0,
            uploaded_songs: Number(profileData.songsCount) || 0,
            profile_image_url: profileData.image || state.profile?.profile_image_url || "",
            profile_image_updated_at: profileData.imageVersion || state.profile?.profile_image_updated_at || ""
        };
    }

    async function refreshCurrentUserRelationshipSnapshot() {
        if (!state.authUser?.id || !state.profile) return;
        const counts = await fetchProfileRelationshipCounts(state.authUser.id, state.profile);
        state.profile = {
            ...(state.profile || {}),
            followers: Number(counts.followers) || 0,
            following: Number(counts.following) || 0
        };
    }

    function resolveFollowTableConfig() {
        return {
            table: "follows",
            targetColumn: "following_id"
        };
    }

    async function mapBeatRowToProfileCard(beat, options = {}) {
        const profileName = beat?.profiles?.display_name || beat?.profiles?.displayName || null;
        const profileUsername = beat?.profiles?.username || null;
        const profileImage = beat?.profiles?.profile_image_url || "";
        const additional = parseProducerCreditEntries(beat.additional_producers);
        const producerCreditState = await enrichBeatProducerCreditState(normalizeBeatProducerCredits({
            user_id: beat.user_id,
            username: profileUsername,
            display_name: profileName,
            profile_image_url: profileImage
        }, additional));
        const producers = producerCreditState.names.length
            ? producerCreditState.names
            : [beat.producer_display_name, profileName, ...additional.map((item) => item?.displayName || item?.display_name).filter(Boolean)].filter(Boolean);
        const license = beat.public_license_state === "free_for_non_profit" ? "Free for Non-Profit" : "License Required";

        return hydrateBeatCardMedia(normalizeSeedBeatCard({
            id: beat.id,
            userId: beat.user_id,
            title: beat.title || "Untitled Beat",
            image: beat.album_url || "",
            producers: producers.length ? producers : ["Unknown Producer"],
            creatorName: producers[0] || "Unknown Producer",
            creatorUsername: profileUsername || "",
            creatorHandle: profileUsername ? `@${profileUsername}` : "@soundswipe",
            creatorAvatar: profileImage,
            producerCredits: producerCreditState.all,
            linkedProducerCredits: producerCreditState.linked,
            manualProducerCredits: producerCreditState.manual,
            bpm: beat.bpm || null,
            key: beat.key || null,
            tags: Array.isArray(beat.tags) && beat.tags.length ? beat.tags : [beat.genre, beat.mood].filter(Boolean).slice(0, 2),
            description: beat.description || "",
            genre: beat.genre || "",
            mood: beat.mood || "",
            comments: Number(beat.comments) || 0,
            audioFile: beat.file_mp3_url || "",
            license,
            basicLicenseEnabled: beat.basic_license_enabled !== false,
            premiumLicenseEnabled: Boolean(beat.premium_license_enabled),
            exclusiveLicenseEnabled: Boolean(beat.exclusive_license_enabled),
            uploadDate: beat.upload_date || null,
            waveformSeed: beat.id,
            ownBeat: Boolean(options.ownBeat),
            href: buildPublicContentShareURL("beat", beat, beat.title, { absolute: false })
        }));
    }

    async function mapSongRowToProfileCard(song, profileRecord = null) {
        const producerTags = Array.isArray(song.producer_tags) ? song.producer_tags : [];
        const producers = producerTags
            .map((tag) => producerCreditDisplayName(tag))
            .filter(Boolean);
        const profileName = profileRecord?.display_name || profileRecord?.displayName || song?.profiles?.display_name || song?.profiles?.displayName || null;
        const profileUsername = profileRecord?.username || song?.profiles?.username || null;
        const profileImage = profileRecord?.profile_image_url || song?.profiles?.profile_image_url || "";

        return hydrateSongCardMedia(normalizeSeedSongCard({
            id: song.id,
            userId: song.user_id,
            title: song.title || "Untitled Song",
            image: song.album_art || "",
            audioFile: song.export_file_url || "",
            creatorName: profileName || producers[0] || "SoundSwipe Artist",
            creatorUsername: profileUsername || "",
            creatorHandle: profileUsername ? `@${profileUsername}` : "@soundswipe",
            creatorAvatar: profileImage,
            producers,
            tags: Array.isArray(song.tags) && song.tags.length ? song.tags : [song.genre, "Song"].filter(Boolean).slice(0, 2),
            description: song.description || "",
            genre: song.genre || "Song",
            releaseDate: song.release_date || null,
            waveformSeed: song.id,
            href: buildPublicContentShareURL("song", song, song.title, { absolute: false })
        }));
    }

    function prettifyUserType(value) {
        return normalizeUserTypeValue(value) || "Creator";
    }

    function normalizeUserTypeValue(value) {
        if (!value) return "";
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) return "";

        const includesArtist = [
            "artist",
            "vocalist",
            "singer",
            "rapper"
        ].some((token) => normalized.includes(token));

        const includesProducer = [
            "producer",
            "beat producer",
            "song producer",
            "full stack producer",
            "audio engineer",
            "dj"
        ].some((token) => normalized.includes(token));

        if (includesArtist && includesProducer) return "Artist / Producer";
        if (includesProducer) return "Producer";
        if (includesArtist) return "Artist";
        return "";
    }

    function buildUserTypeValue({ artist, producer }) {
        if (artist && producer) return "Artist / Producer";
        if (producer) return "Producer";
        if (artist) return "Artist";
        return "";
    }

    function parseUserTypeSelection(value) {
        const normalized = normalizeUserTypeValue(value);
        return {
            artist: normalized.includes("Artist"),
            producer: normalized.includes("Producer")
        };
    }

    function renderUserTypeCheckboxes(value, options = {}) {
        const selected = parseUserTypeSelection(value);
        const namePrefix = options.namePrefix || "user_type";
        return `
            <div class="user-type-picker">
                <label class="user-type-option">
                    <input type="checkbox" name="${escapeHtml(`${namePrefix}_artist`)}" ${selected.artist ? "checked" : ""}>
                    <span>Artist</span>
                </label>
                <label class="user-type-option">
                    <input type="checkbox" name="${escapeHtml(`${namePrefix}_producer`)}" ${selected.producer ? "checked" : ""}>
                    <span>Producer</span>
                </label>
            </div>
        `;
    }

    function buildFallbackProfilePageData(requestedId, isOwnProfile) {
        const name = isOwnProfile ? currentUserName() : "SoundSwipe Creator";
        const username = isOwnProfile ? currentUsername() : "@soundswipe";
        const image = isOwnProfile ? (state.profile?.profile_image_url || "") : "";

        return {
            id: requestedId || state.authUser?.id || "fallback-profile",
            isOwnProfile,
            isFollowing: false,
            isPrivateLocked: false,
            displayName: name,
            username,
            usernameRaw: username.replace(/^@/, ""),
            image,
            imageVersion: state.profile?.profile_image_updated_at || "",
            bio: isOwnProfile ? "Manage your beats, songs, playlists, and saved likes." : `${name} on SoundSwipe.`,
            isVerified: false,
            role: isOwnProfile ? prettifyUserType(state.profile?.user_type) : "Creator",
            followers: isOwnProfile ? Number(state.profile?.followers) || 0 : 0,
            following: isOwnProfile ? Number(state.profile?.following) || 0 : 0,
            beatsCount: isOwnProfile ? Number(state.profile?.uploaded_beats) || 0 : 0,
            songsCount: isOwnProfile ? Number(state.profile?.uploaded_songs) || 0 : 0,
            playlistsCount: 0,
            allowDirectMessages: true,
            email: "",
            beats: [],
            songs: [],
            playlists: [],
            likedBeats: [],
            likedSongs: []
        };
    }

    function renderProfilePage(mount) {
        const data = profilePageState.data;
        if (!mount || !data) return;

        if (profilePageState.activeTab === "likes" && !data.isOwnProfile) {
            profilePageState.activeTab = "beats";
        }

        const title = data.isOwnProfile ? "My Profile • SoundSwipe" : `${data.displayName} • SoundSwipe`;
        const canOpenRelationshipLists = hasSupabase() && Boolean(data.id);
        document.title = title;
        mount.innerHTML = `
            <div class="profile-page">
                <div class="content-panel profile-header-card">
                    <div class="profile-identity-block">
                        ${profileAvatarMarkup(data)}
                        <div class="profile-name-stack">
                            <div class="profile-name-row">
                                <h1>${escapeHtml(data.displayName)}</h1>
                                ${data.isVerified ? `<span class="profile-verified-badge" aria-label="Verified">✓</span>` : ""}
                                ${data.role ? `<span class="profile-role-pill">${escapeHtml(data.role)}</span>` : ""}
                            </div>
                            <div class="profile-handle">${escapeHtml(data.username)}</div>
                            ${data.bio ? `<p class="profile-bio">${escapeHtml(data.bio)}</p>` : ""}
                        </div>
                    </div>

                    <div class="profile-stats-row">
                        ${renderProfileStat("Songs", data.songsCount, { action: "songs", active: profilePageState.activeTab === "songs" })}
                        ${renderProfileStat("Beats", data.beatsCount, { action: "beats", active: profilePageState.activeTab === "beats" })}
                        ${renderProfileStat("Followers", data.followers, canOpenRelationshipLists ? { action: "followers" } : {})}
                        ${renderProfileStat("Following", data.following, canOpenRelationshipLists ? { action: "following" } : {})}
                    </div>

                    <div class="profile-action-row">
                        ${data.isOwnProfile ? `
                            <a class="button-secondary" href="edit-profile.html">Edit Profile</a>
                            <button class="button-secondary" type="button" data-profile-share>Share</button>
                            <button class="button" type="button" data-profile-upload>Upload</button>
                        ` : `
                            <button class="${data.isFollowing ? "button-secondary" : "button"}" type="button" data-profile-follow ${profilePageState.isFollowPending ? "disabled" : ""}>
                                ${profilePageState.isFollowPending ? "Updating…" : (data.isFollowing ? "Following" : "Follow")}
                            </button>
                            <button class="button-secondary" type="button" data-profile-message>Message</button>
                            <button class="button-secondary" type="button" data-profile-share>Share</button>
                        `}
                    </div>

                    ${profilePageState.feedback ? `<div class="profile-inline-note">${escapeHtml(profilePageState.feedback)}</div>` : ""}
                </div>

                <div class="profile-tabs-wrap">
                    <div class="profile-tabs" role="tablist" aria-label="Profile content tabs">
                        ${renderProfileTab("beats", "Beats")}
                        ${renderProfileTab("songs", "Songs")}
                        ${renderProfileTab("playlists", "Playlists")}
                        ${data.isOwnProfile ? renderProfileTab("likes", "Likes") : ""}
                    </div>
                    ${profilePageState.activeTab === "likes" && data.isOwnProfile ? `
                        <div class="profile-likes-filter" role="tablist" aria-label="Likes filter">
                            ${renderLikesFilterTab("beats", "Beats")}
                            ${renderLikesFilterTab("songs", "Songs")}
                        </div>
                    ` : ""}
                </div>

                <div class="profile-content-shell">
                    ${renderProfileContentArea(data)}
                </div>
            </div>
        `;

        bindProfilePageInteractions(mount);
        renderProfileRelationshipModal();
        initializeDiscoverPlayback();
        applyCanonicalPublicURL(buildPublicProfileURL(data, {
            absolute: false,
            tab: profilePageState.activeTab
        }));
    }

    function bindProfilePageInteractions(mount) {
        mount.querySelectorAll("[data-profile-stat-action]").forEach((button) => {
            button.addEventListener("click", async () => {
                const action = button.dataset.profileStatAction;
                if (action === "songs" || action === "beats") {
                    profilePageState.activeTab = action;
                    profilePageState.visibleCounts[action] = 9;
                    renderProfilePage(mount);
                    return;
                }

                if (action === "followers" || action === "following") {
                    await openProfileRelationshipModal(action);
                }
            });
        });

        mount.querySelectorAll("[data-profile-tab]").forEach((button) => {
            button.addEventListener("click", () => {
                profilePageState.activeTab = button.dataset.profileTab;
                profilePageState.visibleCounts[profileVisibleCountKey()] = 9;
                renderProfilePage(mount);
            });
        });

        mount.querySelectorAll("[data-likes-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                profilePageState.likesFilter = button.dataset.likesFilter;
                profilePageState.visibleCounts[profileVisibleCountKey()] = 9;
                renderProfilePage(mount);
            });
        });

        mount.querySelectorAll("[data-load-more^=\"profile-\"]").forEach((button) => {
            button.addEventListener("click", () => {
                const visibleKey = String(button.dataset.loadMore || "").replace(/^profile-/, "");
                profilePageState.visibleCounts[visibleKey] = (profilePageState.visibleCounts[visibleKey] || 9) + 9;
                renderProfilePage(mount);
            });
        });

        mount.querySelector("[data-profile-upload]")?.addEventListener("click", () => {
            openUploadChooser();
        });

        mount.querySelector("[data-profile-share]")?.addEventListener("click", async () => {
            await shareProfileLink(profilePageState.data);
        });

        mount.querySelector("[data-profile-follow]")?.addEventListener("click", async () => {
            await toggleWebsiteFollowState(mount);
        });

        mount.querySelector("[data-profile-message]")?.addEventListener("click", () => {
            profilePageState.feedback = "Direct messages are available in the SoundSwipe app right now.";
            renderProfilePage(mount);
        });

        mount.querySelector("[data-create-playlist]")?.addEventListener("click", () => {
            profilePageState.feedback = "Playlist creation is available in the app right now.";
            renderProfilePage(mount);
        });
    }

    async function shareProfileLink(profile) {
        const url = buildPublicProfileURL(profile, { absolute: true });

        const sharePayload = {
            title: `${profile.displayName} on SoundSwipe`,
            text: `Check out ${profile.displayName} on SoundSwipe.`,
            url
        };

        try {
            if (navigator.share) {
                await navigator.share(sharePayload);
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(sharePayload.url);
                profilePageState.feedback = "Profile link copied.";
            } else {
                profilePageState.feedback = sharePayload.url;
            }
        } catch (error) {
            if (error?.name !== "AbortError") {
                console.error("Profile share failed", error);
                profilePageState.feedback = "Couldn’t share the profile right now.";
            }
        }

        const mount = document.querySelector("[data-profile-detail]");
        if (mount) renderProfilePage(mount);
    }

    async function toggleWebsiteFollowState(mount) {
        const data = profilePageState.data;
        if (!data || !state.authUser?.id || data.isOwnProfile || profilePageState.isFollowPending) return;

        let followConfig = resolveFollowTableConfig();
        if (!followConfig) {
            profilePageState.feedback = "Following isn’t available right now.";
            renderProfilePage(mount);
            return;
        }

        profilePageState.isFollowPending = true;
        renderProfilePage(mount);

        const shouldFollow = !data.isFollowing;
        let error = null;
        let effectiveFollowedState = shouldFollow;
        let didMutateRelationship = false;

        if (shouldFollow) {
            const { data: existingFollow, error: existingFollowError } = await getSupabase()
                .from(followConfig.table)
                .select("id")
                .eq("follower_id", state.authUser.id)
                .eq(followConfig.targetColumn, data.id)
                .limit(1)
                .maybeSingle();

            if (existingFollowError) {
                console.error("Follow pre-check failed", existingFollowError);
            }

            if (existingFollow?.id) {
                effectiveFollowedState = true;
            } else {
                const { error: insertError } = await getSupabase()
                    .from(followConfig.table)
                    .insert({
                        follower_id: state.authUser.id,
                        [followConfig.targetColumn]: data.id
                    });
                error = insertError;

                if (error && (error.code === "23505" || /duplicate/i.test(String(error.message || "")))) {
                    error = null;
                    effectiveFollowedState = true;
                } else if (!error) {
                    didMutateRelationship = true;
                }
            }
        } else {
            const { error: deleteError } = await getSupabase()
                .from(followConfig.table)
                .delete()
                .eq("follower_id", state.authUser.id)
                .eq(followConfig.targetColumn, data.id);
            error = deleteError;
            if (!deleteError) {
                didMutateRelationship = true;
            }
        }

        if (error) {
            console.error("Follow toggle failed", error);
            profilePageState.feedback = describeFollowError(error);
            profilePageState.isFollowPending = false;
            renderProfilePage(mount);
            return;
        }

        const refreshedData = await loadLiveProfilePageData(data.id, data.isOwnProfile);
        if (refreshedData) {
            profilePageState.data = refreshedData;
            syncOwnProfileRelationshipSnapshot(refreshedData);
        }
        await refreshCurrentUserRelationshipSnapshot();

        profilePageState.feedback = effectiveFollowedState ? "Now following this creator." : "Unfollowed.";
        profilePageState.isFollowPending = false;

        if (profilePageState.relationshipModal.open) {
            void refreshProfileRelationshipModalData();
        }

        renderProfilePage(mount);
    }

    function describeFollowError(error) {
        const message = String(error?.message || error?.details || "").trim();
        const code = String(error?.code || "").trim();
        const combined = `${code} ${message}`.toLowerCase();

        if (combined.includes("row-level security") || code === "42501") {
            return "Following is blocked by a Supabase policy on the follow table.";
        }
        if (combined.includes("relation") && combined.includes("does not exist")) {
            return "The follow relationship table is missing in Supabase.";
        }
        if (combined.includes("permission denied")) {
            return "Following is blocked by missing database permissions.";
        }
        if (combined.includes("violates foreign key")) {
            return "The follow relationship could not be created because the target profile record was not found.";
        }
        if (combined.includes("duplicate") || code === "23505") {
            return "This account is already followed.";
        }

        return message ? `We couldn’t update follow status right now: ${message}` : "We couldn’t update follow status right now.";
    }

    async function openProfileRelationshipModal(mode) {
        const profile = profilePageState.data;
        if (!profile?.id) return;

        const title = mode === "followers" ? "Followers" : "Following";
        profilePageState.relationshipModal = {
            open: true,
            mode,
            title,
            profileId: profile.id,
            loading: true,
            error: "",
            items: []
        };
        renderProfileRelationshipModal();
        await refreshProfileRelationshipModalData();
    }

    function closeProfileRelationshipModal() {
        profilePageState.relationshipModal = {
            ...profilePageState.relationshipModal,
            open: false,
            loading: false,
            error: "",
            items: []
        };
        renderProfileRelationshipModal();
    }

    async function refreshProfileRelationshipModalData() {
        const modalState = profilePageState.relationshipModal;
        if (!modalState.open || !modalState.profileId) return;

        try {
            const items = await fetchProfileRelationshipList(modalState.profileId, modalState.mode);
            profilePageState.relationshipModal = {
                ...profilePageState.relationshipModal,
                loading: false,
                error: "",
                items
            };
        } catch (error) {
            console.error("Relationship list query failed", error);
            profilePageState.relationshipModal = {
                ...profilePageState.relationshipModal,
                loading: false,
                error: "We couldn’t load this list right now.",
                items: []
            };
        }

        renderProfileRelationshipModal();
    }

    async function fetchProfileRelationshipList(profileId, mode) {
        const followConfig = resolveFollowTableConfig();
        if (!followConfig) {
            throw new Error("No follow relationship table available.");
        }

        const sourceColumn = mode === "followers" ? followConfig.targetColumn : "follower_id";
        const targetColumn = mode === "followers" ? "follower_id" : followConfig.targetColumn;
        const { data, error } = await getSupabase()
            .from(followConfig.table)
            .select(`id, ${targetColumn}, created_at`)
            .eq(sourceColumn, profileId)
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) {
            throw error;
        }

        const orderedIds = Array.from(new Set((data || []).map((row) => row?.[targetColumn]).filter(Boolean)));
        if (!orderedIds.length) return [];

        const { data: profileRows, error: profileError } = await getSupabase()
            .from("profiles")
            .select("id, display_name, username, profile_image_url, profile_image_updated_at, is_verified, user_type, followers, following")
            .in("id", orderedIds);

        if (profileError) {
            throw profileError;
        }

        const hydratedProfiles = await hydrateProfilesMedia(profileRows || []);
        const profileMap = new Map(hydratedProfiles.map((profile) => [profile.id, profile]));

        return orderedIds
            .map((id) => profileMap.get(id))
            .filter(Boolean)
            .map((profile) => ({
                id: profile.id,
                displayName: profile.display_name || profile.username || "SoundSwipe User",
                username: profile.username ? `@${profile.username}` : "",
                image: profile.profile_image_url || "",
                imageVersion: profile.profile_image_updated_at || "",
                isVerified: Boolean(profile.is_verified),
                role: prettifyUserType(profile.user_type),
                followers: Number(profile.followers) || 0,
                following: Number(profile.following) || 0,
                href: buildPublicProfileURL({ id: profile.id, usernameRaw: profile.username }, { absolute: false })
            }));
    }

    function renderProfileRelationshipModal() {
        const modalMount = document.querySelector("[data-modals]");
        if (!modalMount) return;

        const existing = modalMount.querySelector("#profile-relationship-modal");
        if (!profilePageState.relationshipModal.open) {
            existing?.remove();
            return;
        }

        const modalState = profilePageState.relationshipModal;
        const ownerName = profilePageState.data?.displayName || "Profile";
        const subtitle = `${ownerName}'s ${modalState.mode}`;
        const content = modalState.loading
            ? `<div class="profile-relationship-empty"><strong>Loading ${escapeHtml(modalState.mode)}…</strong><span>Pulling in the real SoundSwipe accounts for this list.</span></div>`
            : modalState.error
                ? `<div class="profile-relationship-empty"><strong>Couldn’t load this list.</strong><span>${escapeHtml(modalState.error)}</span></div>`
                : modalState.items.length
                    ? `<div class="profile-relationship-list">${modalState.items.map(renderProfileRelationshipRow).join("")}</div>`
                    : `<div class="profile-relationship-empty"><strong>No ${escapeHtml(modalState.mode)} yet.</strong><span>${modalState.mode === "followers" ? "When people follow this profile, they’ll show up here." : "Accounts this profile follows will show up here."}</span></div>`;

        const modalMarkup = `
            <div class="modal-backdrop open" id="profile-relationship-modal" aria-hidden="false">
                <div class="modal-card profile-relationship-card" role="dialog" aria-modal="true" aria-labelledby="profile-relationship-title" tabindex="-1">
                    <div class="modal-header">
                        <div>
                            <h2 id="profile-relationship-title">${escapeHtml(modalState.title)}</h2>
                            <p class="muted">${escapeHtml(subtitle)}</p>
                        </div>
                        <button class="icon-button" type="button" data-close-profile-relationship aria-label="Close">×</button>
                    </div>
                    ${content}
                </div>
            </div>
        `;

        if (existing) {
            existing.outerHTML = modalMarkup;
        } else {
            modalMount.insertAdjacentHTML("beforeend", modalMarkup);
        }

        const modal = modalMount.querySelector("#profile-relationship-modal");
        const card = modal?.querySelector(".profile-relationship-card");
        card?.focus();
        modal?.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeProfileRelationshipModal();
            }
        });
        modal?.querySelector("[data-close-profile-relationship]")?.addEventListener("click", closeProfileRelationshipModal);
        card?.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeProfileRelationshipModal();
            }
        });
    }

    function renderProfileRelationshipRow(profile) {
        const isSelf = profile.id === state.authUser?.id;
        return `
            <a class="profile-relationship-row" href="${escapeHtml(profile.href)}">
                <span class="profile-relationship-avatar${profile.image ? " profile-relationship-avatar--image" : ""}">
                    ${profile.image
                        ? `<img src="${escapeHtml(cacheBustedImageURL(profile.image, profile.imageVersion))}" alt="${escapeHtml(profile.displayName)}" />`
                        : `<span>${escapeHtml(initialsForName(profile.displayName))}</span>`}
                </span>
                <span class="profile-relationship-copy">
                    <span class="profile-relationship-name-row">
                        <strong>${escapeHtml(profile.displayName)}</strong>
                        ${profile.isVerified ? `<span class="profile-verified-badge" aria-label="Verified">✓</span>` : ""}
                    </span>
                    <span class="profile-relationship-meta">
                        ${profile.username ? `<span>${escapeHtml(profile.username)}</span>` : ""}
                        ${profile.role ? `<span>${escapeHtml(profile.role)}</span>` : ""}
                    </span>
                </span>
                <span class="profile-relationship-trailing">
                    <span class="chip">${compactCount(profile.followers)} followers</span>
                    ${isSelf ? `<span class="chip">You</span>` : `<span class="chip">View</span>`}
                </span>
            </a>
        `;
    }

    function renderProfileContentArea(profile) {
        if (profile.isPrivateLocked) {
            return renderProfileCompactEmpty("This profile is private.", "Follow this creator to view their beats, songs, and playlists.");
        }

        switch (profilePageState.activeTab) {
        case "songs":
            return renderProfileMediaGrid(profile.songs, "songs");
        case "playlists":
            return renderProfilePlaylistsSection(profile);
        case "likes":
            return renderProfileLikesSection(profile);
        case "beats":
        default:
            return renderProfileMediaGrid(profile.beats, "beats");
        }
    }

    function renderProfileLikesSection(profile) {
        const items = profilePageState.likesFilter === "songs" ? profile.likedSongs : profile.likedBeats;
        const kind = profilePageState.likesFilter === "songs" ? "songs" : "beats";
        return renderProfileMediaGrid(items, kind, true);
    }

    function renderProfileMediaGrid(items, kind, likesMode = false) {
        if (!items.length) {
            const titleMap = {
                beats: likesMode ? "No liked beats yet." : "No beats yet.",
                songs: likesMode ? "No liked songs yet." : "No songs yet."
            };
            const bodyMap = {
                beats: likesMode ? "Beats you save will appear here." : "Uploaded beats will show up here.",
                songs: likesMode ? "Songs you save will appear here." : "Uploaded songs will show up here."
            };
            return renderProfileCompactEmpty(titleMap[kind] || "Nothing here yet.", bodyMap[kind] || "Content will appear here.");
        }

        const visibleKey = likesMode
            ? `likes_${kind}`
            : kind;
        const visibleCount = profilePageState.visibleCounts[visibleKey] || 9;
        const visibleItems = items.slice(0, visibleCount);

        return `
            <div class="search-card-grid profile-media-grid">
                ${visibleItems.map((item) => kind === "beats" ? renderSearchBeatCard(item) : renderSearchSongCard(item)).join("")}
            </div>
            ${renderLoadMoreButton(visibleCount, items.length, `profile-${visibleKey}`)}
        `;
    }

    function renderProfilePlaylistsSection(profile) {
        const controls = profile.isOwnProfile ? `
            <div class="profile-section-actions">
                <button class="button-secondary" type="button" data-create-playlist>Create Playlist</button>
            </div>
        ` : "";

        if (!profile.playlists.length) {
            return `
                ${controls}
                ${renderProfileCompactEmpty("No playlists yet.", profile.isOwnProfile ? "Your playlists will appear here." : "This creator hasn’t published any playlists yet.")}
            `;
        }

        return `
            ${controls}
            <div class="profile-playlist-grid">
                ${profile.playlists.map(renderProfilePlaylistCard).join("")}
            </div>
        `;
    }

    function renderProfilePlaylistCard(playlist) {
        return `
            <div class="profile-playlist-card">
                <div class="profile-playlist-cover ${playlist.image ? "has-image" : ""}">
                    ${playlist.image ? `<img src="${escapeHtml(playlist.image)}" alt="${escapeHtml(playlist.title)}" />` : `<span>${escapeHtml(playlist.title.slice(0, 1) || "P")}</span>`}
                </div>
                <div class="profile-playlist-copy">
                    <h3>${escapeHtml(playlist.title)}</h3>
                    <p>${escapeHtml(String(playlist.itemCount))} items</p>
                </div>
            </div>
        `;
    }

    function renderProfileStat(label, value, options = {}) {
        const classes = ["profile-stat"];
        if (options.action) classes.push("profile-stat--interactive");
        if (options.active) classes.push("active");
        const actionAttr = options.action ? `data-profile-stat-action="${escapeHtml(options.action)}"` : "";
        return `
            <button class="${classes.join(" ")}" type="button" ${actionAttr}>
                <strong>${escapeHtml(compactCount(value))}</strong>
                <span>${escapeHtml(label)}</span>
            </button>
        `;
    }

    function renderProfileTab(key, label) {
        const active = profilePageState.activeTab === key;
        return `<button class="profile-tab ${active ? "active" : ""}" type="button" data-profile-tab="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
    }

    function renderLikesFilterTab(key, label) {
        const active = profilePageState.likesFilter === key;
        return `<button class="profile-filter-tab ${active ? "active" : ""}" type="button" data-likes-filter="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
    }

    function renderProfileCompactEmpty(title, description) {
        return `
            <div class="profile-empty-state">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(description)}</span>
            </div>
        `;
    }

    function renderSettingsPage(mount, profile, stripeCommerce = null) {
        document.title = "Settings • SoundSwipe";
        const stripeStatusMarkup = renderStripeCommerceCard(stripeCommerce);
        mount.innerHTML = `
            <div class="edit-profile-page">
                <div class="content-panel edit-profile-header">
                    <div class="edit-profile-heading">
                        <span class="eyebrow">Settings</span>
                        <h1>Account settings</h1>
                        <p class="lede">Manage privacy, discovery, and messaging preferences.</p>
                    </div>
                    <a class="button-secondary" href="profile.html">Back to Profile</a>
                </div>

                <form class="content-panel edit-profile-form" data-settings-form>
                    <div class="form-grid">
                        <div class="field">
                            <label>Email</label>
                            <input value="${escapeHtml(profile.email || state.authUser?.email || "")}" disabled>
                        </div>
                        <div class="field">
                            <label>Username</label>
                            <input value="${escapeHtml(profile.username ? `@${profile.username}` : currentUsername())}" disabled>
                        </div>
                        <div class="field">
                            <label>Account Type</label>
                            <input value="${escapeHtml(prettifyUserType(profile.user_type))}" disabled>
                        </div>
                    </div>

                    <div class="settings-toggle-grid">
                        ${renderSettingsToggle("Private Account", "Approve who can view your full profile and content.", "is_private", Boolean(profile.is_private))}
                        ${renderSettingsToggle("Show in Discovery", "Let people find your profile in search and discovery.", "show_in_discovery", profile.show_in_discovery !== false)}
                        ${renderSettingsToggle("Direct Messages", "Allow other users to message you.", "allow_direct_messages", profile.allow_direct_messages !== false)}
                        ${renderSettingsToggle("Show Online Status", "Show when you’re active on SoundSwipe.", "show_online_status", profile.show_online_status !== false)}
                        ${renderSettingsToggle("Read Receipts", "Let people know when you’ve seen a message.", "allow_read_receipts", profile.allow_read_receipts !== false)}
                    </div>

                    ${stripeStatusMarkup}

                    <div class="upload-feedback" data-settings-feedback></div>

                    <div class="upload-actions edit-profile-actions">
                        <a class="button-secondary" href="profile.html">Cancel</a>
                        <button class="button" type="submit">Save Settings</button>
                    </div>
                </form>
            </div>
        `;
    }

    function renderStripeCommerceCard(stripeCommerce) {
        const status = stripeCommerce?.status || null;
        const recentSales = Array.isArray(stripeCommerce?.recentSales) ? stripeCommerce.recentSales : [];
        const connected = Boolean(stripeCommerce?.connected);
        const payoutReady = Boolean(stripeCommerce?.payoutReady);

        return `
            <section class="settings-commerce-card">
                <div class="settings-commerce-head">
                    <div>
                        <span class="eyebrow">Seller Payments</span>
                        <h2>Stripe Connect</h2>
                        <p class="muted">Connect Stripe to sell paid beat licenses, receive payouts, and keep your sales in sync across SoundSwipe.</p>
                    </div>
                    <div class="settings-commerce-actions">
                        <button class="${connected ? "button-secondary" : "button"}" type="button" data-stripe-connect>${connected ? "Update Stripe" : "Connect Stripe"}</button>
                        ${connected ? `<button class="button-secondary" type="button" data-stripe-dashboard>Open Stripe Dashboard</button>` : ""}
                    </div>
                </div>
                <div class="settings-commerce-grid">
                    ${renderSettingsCommerceStat("Connected", connected ? "Yes" : "No", connected ? "good" : "warn")}
                    ${renderSettingsCommerceStat("Payout Ready", payoutReady ? "Ready" : "Needs setup", payoutReady ? "good" : "warn")}
                    ${renderSettingsCommerceStat("Charges", status?.charges_enabled ? "Enabled" : "Pending", status?.charges_enabled ? "good" : "warn")}
                    ${renderSettingsCommerceStat("Account ID", status?.stripe_connect_id ? trimText(status.stripe_connect_id, 18) : "Not linked", status?.stripe_connect_id ? "" : "warn")}
                </div>
                <div class="settings-commerce-sales">
                    <div class="settings-commerce-sales-head">
                        <strong>Recent Sales</strong>
                        <span>${recentSales.length ? `${recentSales.length} recent purchase${recentSales.length === 1 ? "" : "s"}` : "No sales yet"}</span>
                    </div>
                    ${recentSales.length
                        ? `<div class="settings-commerce-sales-list">
                            ${recentSales.map((sale) => `
                                <div class="settings-commerce-sale-row">
                                    <div>
                                        <strong>${escapeHtml(sale.beat_title || "Beat sale")}</strong>
                                        <span>${escapeHtml(purchasedTierLabel(sale.license_type || "basic"))}</span>
                                    </div>
                                    <div>
                                        <strong>${escapeHtml(formatUSD(Number(sale.amount) || 0))}</strong>
                                        <span>${escapeHtml(formatCommentTimestamp(sale.created_at || ""))}</span>
                                    </div>
                                </div>
                            `).join("")}
                        </div>`
                        : `<p class="muted">New beat sales will appear here as they come in.</p>`}
                </div>
            </section>
        `;
    }

    function renderSettingsCommerceStat(label, value, tone = "") {
        return `
            <div class="settings-commerce-stat ${tone ? `is-${tone}` : ""}">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(String(value || ""))}</strong>
            </div>
        `;
    }

    function renderSettingsToggle(title, description, name, checked) {
        return `
            <label class="settings-toggle-card">
                <div class="settings-toggle-copy">
                    <strong>${escapeHtml(title)}</strong>
                    <span>${escapeHtml(description)}</span>
                </div>
                <span class="settings-switch ${checked ? "is-on" : ""}">
                    <input type="checkbox" name="${escapeHtml(name)}" ${checked ? "checked" : ""}>
                    <span class="settings-switch-track"></span>
                    <span class="settings-switch-thumb"></span>
                </span>
            </label>
        `;
    }

    function renderEditProfilePage(mount, profile) {
        const preview = editProfileState.previewURL || profile.profile_image_url || "";
        const isSetupStep = String(new URLSearchParams(window.location.search).get("setup") || "") === "1" || profile.preferences_completed === false;
        document.title = "Edit Profile • SoundSwipe";

        mount.innerHTML = `
            <div class="edit-profile-page">
                <div class="content-panel edit-profile-header">
                    <div class="edit-profile-heading">
                        <span class="eyebrow">${isSetupStep ? "Step 2" : "Edit Profile"}</span>
                        <h1>${isSetupStep ? "Finish your profile" : "Update your profile"}</h1>
                        <p class="lede">${isSetupStep ? "Add your photo, bio, and creator details so your SoundSwipe profile is ready to go." : "Keep your photo, name, username, and bio up to date."}</p>
                    </div>
                    <a class="button-secondary" href="profile.html">${isSetupStep ? "Finish Later" : "Back to Profile"}</a>
                </div>

                <form class="content-panel edit-profile-form" data-edit-profile-form>
                    <div class="edit-profile-photo-row">
                        <div class="edit-profile-photo-frame" data-edit-profile-preview>
                            ${renderEditProfilePhotoPreview(preview, profile)}
                        </div>
                        <div class="edit-profile-photo-copy">
                            <h2>Profile Photo</h2>
                            <p>Choose the image that appears on your SoundSwipe profile, then frame it inside the circular avatar.</p>
                            <div class="edit-profile-photo-actions">
                                <label class="button-secondary edit-profile-photo-button">
                                    <input type="file" accept="image/*" data-edit-profile-photo hidden>
                                    Change Photo
                                </label>
                                <button class="button-quiet edit-profile-photo-button" type="button" data-edit-profile-adjust ${editProfileState.sourceImageFile ? "" : "disabled"}>
                                    Adjust Crop
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="form-grid">
                        <div class="field">
                            <label for="edit-display-name">Display Name</label>
                            <input id="edit-display-name" name="display_name" maxlength="80" value="${escapeHtml(profile.display_name || "")}" required>
                        </div>
                        <div class="field">
                            <label for="edit-username">Username</label>
                            <input id="edit-username" name="username" maxlength="24" value="${escapeHtml(profile.username || "")}" required>
                        </div>
                        <div class="field">
                            <label for="edit-date-of-birth">Date of Birth</label>
                            <input id="edit-date-of-birth" type="date" name="date_of_birth" value="${escapeHtml(profile.date_of_birth || "")}">
                        </div>
                        <div class="field">
                            <label for="edit-user-type">Account Type</label>
                            <div id="edit-user-type">
                                ${renderUserTypeCheckboxes(profile.user_type, { namePrefix: "user_type" })}
                            </div>
                        </div>
                        <div class="field edit-profile-bio-field">
                            <label for="edit-bio">Bio</label>
                            <textarea id="edit-bio" name="bio" maxlength="240" placeholder="Tell people a little about yourself.">${escapeHtml(profile.bio || "")}</textarea>
                        </div>
                    </div>

                    <div class="upload-feedback ${editProfileState.feedback ? `show ${editProfileState.feedbackType}` : ""}" data-edit-profile-feedback>${escapeHtml(editProfileState.feedback || "")}</div>

                    <div class="upload-actions edit-profile-actions">
                        <a class="button-secondary" href="profile.html">${isSetupStep ? "Finish Later" : "Cancel"}</a>
                        <button class="button" type="submit">${isSetupStep ? "Complete Profile" : "Save Changes"}</button>
                    </div>
                </form>
            </div>
        `;
    }

    function renderEditProfilePhotoPreview(imageURL, profile) {
        if (imageURL) {
            return `<img src="${escapeHtml(imageURL)}" alt="${escapeHtml(profile.display_name || profile.username || "Profile")}" data-edit-profile-image>`;
        }

        return `<span class="edit-profile-photo-fallback" data-edit-profile-image-fallback>${escapeHtml(avatarFallbackLetter(profile.username, profile.display_name))}</span>`;
    }

    function wireEditProfileForm(mount, profile) {
        const form = mount.querySelector("[data-edit-profile-form]");
        const photoInput = mount.querySelector("[data-edit-profile-photo]");
        const adjustButton = mount.querySelector("[data-edit-profile-adjust]");
        const previewFrame = mount.querySelector("[data-edit-profile-preview]");
        const feedbackNode = mount.querySelector("[data-edit-profile-feedback]");
        if (!form || !previewFrame || !feedbackNode) return;

        const syncProfilePhotoPreview = (fileOrURL) => {
            if (!fileOrURL) {
                editProfileState.previewURL = profile.profile_image_url || "";
                previewFrame.innerHTML = renderEditProfilePhotoPreview(editProfileState.previewURL, profile);
                if (adjustButton) adjustButton.disabled = !editProfileState.sourceImageFile;
                return;
            }

            const url = typeof fileOrURL === "string" ? fileOrURL : URL.createObjectURL(fileOrURL);
            editProfileState.previewURL = url;
            previewFrame.innerHTML = renderEditProfilePhotoPreview(url, profile);
            if (adjustButton) adjustButton.disabled = !editProfileState.sourceImageFile;
        };

        photoInput?.addEventListener("change", () => {
            const file = photoInput.files?.[0] || null;
            if (!file) {
                editProfileState.selectedImageFile = null;
                editProfileState.sourceImageFile = null;
                editProfileState.crop = null;
                syncProfilePhotoPreview(null);
                return;
            }
            openProfileImageCropper(file, {
                input: photoInput,
                previewImage: previewFrame.querySelector("[data-edit-profile-image]"),
                fallbackURL: profile.profile_image_url || "",
                onPreviewChange: syncProfilePhotoPreview
            });
        });

        adjustButton?.addEventListener("click", () => {
            const sourceFile = editProfileState.sourceImageFile;
            if (!(sourceFile instanceof File)) return;
            openProfileImageCropper(sourceFile, {
                input: photoInput,
                previewImage: previewFrame.querySelector("[data-edit-profile-image]"),
                fallbackURL: profile.profile_image_url || "",
                onPreviewChange: syncProfilePhotoPreview
            });
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFeedbackNode(feedbackNode);

            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) submitButton.disabled = true;

            try {
                const displayName = form.display_name.value.trim();
                const username = form.username.value.trim().replace(/^@/, "").toLowerCase();
                const bio = form.bio.value.trim();
                const dateOfBirth = form.date_of_birth.value || null;
                const userType = buildUserTypeValue({
                    artist: Boolean(form.querySelector('[name="user_type_artist"]')?.checked),
                    producer: Boolean(form.querySelector('[name="user_type_producer"]')?.checked)
                }) || null;

                const validationError = validateEditProfileForm({ displayName, username, bio });
                if (validationError) throw new Error(validationError);

                const formData = new FormData();
                formData.set("display_name", displayName);
                formData.set("username", username);
                formData.set("bio", bio);
                formData.set("date_of_birth", dateOfBirth);
                formData.set("user_type", userType);
                formData.set("preferences_completed", "true");
                if (editProfileState.selectedImageFile) {
                    const normalizedProfileImage = await normalizeImageFile(editProfileState.selectedImageFile, 800, 800, 0.86);
                    formData.set("profile_image", normalizedProfileImage);
                }

                const result = await invokeUploadFunction("web-update-profile", formData);
                const data = result.profile;

                state.profile = {
                    ...(state.profile || {}),
                    ...data
                };
                editProfileState.selectedImageFile = null;
                editProfileState.sourceImageFile = null;
                editProfileState.crop = null;
                await syncSessionState();
                buildNav();
                await fillProfilePage();
                await fillSettingsPage();
                window.location.href = buildPublicProfileURL(state.profile || data, { absolute: false });
            } catch (error) {
                console.error("Profile update failed", error);
                editProfileState.feedback = normalizeAuthError(error, "We couldn’t save your profile right now.");
                editProfileState.feedbackType = "error";
                feedbackNode.textContent = editProfileState.feedback;
                feedbackNode.className = `upload-feedback show ${editProfileState.feedbackType}`;
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

    function validateEditProfileForm({ displayName, username, bio }) {
        if (!displayName) return "Display name is required.";
        if (!username) return "Username is required.";
        if (!/^[a-z0-9_]{3,24}$/.test(username)) {
            return "Username must be 3 to 24 characters and use only letters, numbers, or underscores.";
        }
        if (bio.length > 240) return "Bio must be 240 characters or fewer.";
        return "";
    }

    function wireSettingsForm(mount) {
        const form = mount.querySelector("[data-settings-form]");
        const feedbackNode = mount.querySelector("[data-settings-feedback]");
        if (!form || !feedbackNode) return;

        mount.querySelector("[data-stripe-connect]")?.addEventListener("click", async () => {
            await startStripeConnectOnboarding(feedbackNode, {
                returnURL: new URL("settings.html?stripe=return", window.location.href).toString(),
                refreshURL: new URL("settings.html?stripe=refresh", window.location.href).toString()
            });
        });

        mount.querySelector("[data-stripe-dashboard]")?.addEventListener("click", async () => {
            try {
                const payload = await invokeAuthedJSONFunction("stripe-connect", {}, "/create-login-link");
                if (payload?.url) {
                    window.open(payload.url, "_blank", "noopener,noreferrer");
                }
            } catch (error) {
                setFeedbackNode(feedbackNode, normalizeAuthError(error, "We couldn’t open the Stripe dashboard right now."), "error");
            }
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFeedbackNode(feedbackNode);

            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) submitButton.disabled = true;

            try {
                const formData = new FormData();
                formData.set("is_private", String(form.is_private.checked));
                formData.set("show_in_discovery", String(form.show_in_discovery.checked));
                formData.set("allow_direct_messages", String(form.allow_direct_messages.checked));
                formData.set("show_online_status", String(form.show_online_status.checked));
                formData.set("allow_read_receipts", String(form.allow_read_receipts.checked));

                const result = await invokeUploadFunction("web-update-profile", formData);
                state.profile = {
                    ...(state.profile || {}),
                    ...result.profile
                };
                await syncSessionState();
                setFeedbackNode(feedbackNode, "Settings updated.", "success");
                buildNav();
                await fillProfilePage();
                await fillEditProfilePage();
            } catch (error) {
                setFeedbackNode(feedbackNode, normalizeAuthError(error, "We couldn’t save your settings right now."), "error");
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

    async function normalizeImageFile(file, maxWidth, maxHeight, quality = 0.86) {
        if (!file) return file;
        if (file.type === "image/jpeg" || file.type === "image/jpg") {
            return file;
        }

        const dataURL = await readFileAsDataURL(file);
        const image = await loadImage(dataURL);
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return file;
        context.drawImage(image, 0, 0, width, height);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!(blob instanceof Blob)) return file;
        const normalizedName = `${file.name.replace(/\.[^.]+$/, "") || "profile"}-normalized.jpg`;
        return new File([blob], normalizedName, { type: "image/jpeg" });
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("File read failed."));
            reader.readAsDataURL(file);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Image load failed."));
            image.src = src;
        });
    }

    function profileAvatarMarkup(profile) {
        if (profile.image) {
            return `
                <div class="profile-avatar-large">
                    <img src="${escapeHtml(cacheBustedImageURL(profile.image, profile.imageVersion))}" alt="${escapeHtml(profile.displayName)}" />
                </div>
            `;
        }

        return `
            <div class="profile-avatar-large profile-avatar-large--fallback">
                <span>${escapeHtml(initialsForName(profile.displayName))}</span>
            </div>
        `;
    }

    function renderBeatPurchaseSection(beat) {
        const offers = Array.isArray(beat.licenseOffers) ? beat.licenseOffers : [];
        const purchaseState = beat.purchaseState || null;
        const selectedTierKey = purchaseState?.tierKey || offers[0]?.key || "";
        const canPurchase = !beat.isOwnedByCurrentUser && !purchaseState && offers.length > 0;
        const appURL = appPreviewHref;

        let statusMarkup = "";
        if (purchaseState) {
            statusMarkup = `
                <div class="beat-purchase-callout beat-purchase-callout--owned">
                    <span class="status-chip good">${escapeHtml(purchaseState.tierLabel)}</span>
                    <strong>You already own this beat.</strong>
                    <p>${escapeHtml(purchaseState.files.join(" + "))}${purchaseState.purchaseDate ? ` • Purchased ${escapeHtml(formatCommentTimestamp(purchaseState.purchaseDate))}` : ""}</p>
                    <div class="beat-purchase-owned-actions">
                        ${buildLicensedDownloadDescriptors(purchaseState.files).map((download) => `
                            <button
                                class="button-secondary purchased-download-button"
                                type="button"
                                data-licensed-download
                                data-beat-id="${escapeHtml(beat.id || "")}"
                                data-file-type="${escapeHtml(download.key)}"
                            >${escapeHtml(download.label)}</button>
                        `).join("")}
                    </div>
                </div>
            `;
        } else if (beat.isOwnedByCurrentUser) {
            statusMarkup = `
                <div class="beat-purchase-callout">
                    <span class="status-chip">Your Beat</span>
                    <strong>This listing is live with your selected license options.</strong>
                    <p>${offers.length ? `Buyers can choose from ${escapeHtml(beat.tierSummary)}.` : "No paid license tiers are enabled on this beat right now."}</p>
                </div>
            `;
        } else if (!offers.length && String(beat.publicLicenseState || "").toLowerCase().includes("free")) {
            statusMarkup = `
                <div class="beat-purchase-callout">
                    <span class="status-chip good">Free for Non-Profit</span>
                    <strong>This beat is open for non-profit use under the producer's terms.</strong>
                    <p>Commercial rights can still be offered separately by the producer.</p>
                </div>
            `;
        } else if (!offers.length) {
            statusMarkup = `
                <div class="beat-purchase-callout">
                    <span class="status-chip warn">License Required</span>
                    <strong>Purchase options are not available right now.</strong>
                    <p>Check back later to see if this beat becomes available for licensing on the web marketplace.</p>
                </div>
            `;
        }

        return `
            <section class="section beat-purchase-section" data-beat-purchase data-beat-id="${escapeHtml(beat.id || "")}">
                <div class="section-header">
                    <div>
                        <h3>Purchase & Licensing</h3>
                        <p>Choose the license tier that matches your release plan and recording workflow.</p>
                    </div>
                </div>
                ${statusMarkup}
                ${offers.length ? `
                    <div class="beat-license-grid">
                        ${offers.map((offer) => `
                            <button
                                class="beat-license-card ${selectedTierKey === offer.key ? "active" : ""} ${purchaseState?.tierKey === offer.key ? "owned" : ""}"
                                type="button"
                                data-license-tier="${escapeHtml(offer.key)}"
                            >
                                <div class="beat-license-head">
                                    <div>
                                        <strong>${escapeHtml(offer.label)}</strong>
                                        <span>${purchaseState?.tierKey === offer.key ? "Purchased" : "License tier"}</span>
                                    </div>
                                    <div class="beat-license-price">${escapeHtml(formatUSD(offer.price))}</div>
                                </div>
                                <div class="beat-license-points">
                                    ${offer.bullets.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
                                </div>
                            </button>
                        `).join("")}
                    </div>
                    <div class="beat-license-detail" data-license-detail>
                        ${offers.map((offer) => `
                            <div class="beat-license-detail-panel ${selectedTierKey === offer.key ? "active" : ""}" data-license-detail-panel="${escapeHtml(offer.key)}">
                                <div class="beat-license-detail-head">
                                    <div>
                                        <strong>${escapeHtml(offer.label)}</strong>
                                        <span>${escapeHtml(formatUSD(offer.price))}</span>
                                    </div>
                                    <span class="chip">${offer.key === "exclusive" ? "Beat removed from sale after purchase" : "Non-exclusive license"}</span>
                                </div>
                                <ul class="beat-license-detail-list">
                                    ${offer.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
                                </ul>
                            </div>
                        `).join("")}
                    </div>
                ` : ""}
                <div class="beat-purchase-actions">
                    <a
                        class="${canPurchase ? "button" : "button-secondary"}"
                        href="${escapeHtml(canPurchase ? "#" : appURL)}"
                        data-buy-now
                    >${purchaseState ? "Purchased on SoundSwipe" : (canPurchase ? "Buy Now" : "App Coming Soon")}</a>
                    <a
                        class="button-secondary"
                        href="${escapeHtml(appURL)}"
                    >See App Preview</a>
                </div>
                ${purchaseState
                    ? `<p class="beat-purchase-note">Your licensed files are unlocked here and in your Purchased Beats library.</p>`
                    : (!canPurchase
                        ? `<p class="beat-purchase-note">The mobile app is launching soon. For now, use the web marketplace to review beat details, licensing, and purchases.</p>`
                        : "")}
            </section>
        `;
    }

    function wireBeatPurchaseSection(mount, beat) {
        const section = mount.querySelector("[data-beat-purchase]");
        if (!section) return;

        section.querySelectorAll("[data-license-tier]").forEach((button) => {
            button.addEventListener("click", () => {
                const selectedTier = button.dataset.licenseTier;
                section.querySelectorAll("[data-license-tier]").forEach((node) => {
                    node.classList.toggle("active", node.dataset.licenseTier === selectedTier);
                });
                section.querySelectorAll("[data-license-detail-panel]").forEach((panel) => {
                    panel.classList.toggle("active", panel.dataset.licenseDetailPanel === selectedTier);
                });

                const selectedOffer = (beat.licenseOffers || []).find((offer) => offer.key === selectedTier);
                const buyNow = section.querySelector("[data-buy-now]");
                if (selectedOffer && buyNow && !beat.purchaseState && !beat.isOwnedByCurrentUser) {
                    buyNow.textContent = `Buy Now • ${formatUSD(selectedOffer.price)}`;
                }
            });
        });

        section.querySelector("[data-buy-now]")?.addEventListener("click", async (event) => {
            if (beat.purchaseState || beat.isOwnedByCurrentUser || !(beat.licenseOffers || []).length) {
                return;
            }

            event.preventDefault();
            if (!isLoggedIn()) {
                storePostAuthRedirect(currentRedirectURL());
                window.location.href = "login.html?redirect=" + encodeURIComponent(currentRedirectURL());
                return;
            }

            const activeTier = section.querySelector("[data-license-tier].active")?.dataset.licenseTier
                || beat.purchaseState?.tierKey
                || beat.licenseOffers?.[0]?.key;
            const button = event.currentTarget;
            if (!(button instanceof HTMLElement) || !activeTier) {
                return;
            }

            const originalLabel = button.textContent || "Buy Now";
            button.textContent = "Opening Checkout…";
            button.setAttribute("aria-busy", "true");

            try {
                const successURL = new URL(window.location.href);
                successURL.searchParams.set("checkout", "success");
                const cancelURL = new URL(window.location.href);
                cancelURL.searchParams.set("checkout", "cancel");

                const payload = await invokeAuthedJSONFunction("stripe-commerce", {
                    beat_id: beat.id,
                    tier: activeTier,
                    origin: window.location.origin,
                    success_url: successURL.toString(),
                    cancel_url: cancelURL.toString()
                }, "/checkout-session");

                if (!payload?.checkoutURL) {
                    throw new Error("Checkout URL was not returned.");
                }

                window.location.href = payload.checkoutURL;
            } catch (error) {
                console.error("Checkout launch failed", error);
                button.textContent = originalLabel;
                button.removeAttribute("aria-busy");
                window.alert(normalizeAuthError(error, "We couldn’t start checkout right now."));
            }
        });

        wireLicensedDownloadButtons(section);
    }

    function formatCommentTimestamp(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const diffMs = Date.now() - date.getTime();
        const diffMinutes = Math.floor(diffMs / 60000);
        if (diffMinutes < 1) return "Just now";
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;
        return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: diffDays > 365 ? "numeric" : undefined }).format(date);
    }

    function isBackendEntityId(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    }

    function renderDetailCommentsSection(entity) {
        const count = Number(entity.commentsCount) || 0;
        const disabled = Boolean(entity.commentsDisabled);
        const isRealEntity = isBackendEntityId(entity.id);
        const canPost = isRealEntity && isLoggedIn() && !disabled;
        return `
            <section class="section detail-comments-section" data-comments-section data-content-id="${escapeHtml(entity.id || "")}" data-content-type="${escapeHtml(entity.entityType || "")}">
                <div class="section-header">
                    <h3>Comments</h3>
                    <p>${count ? `${count} ${count === 1 ? "comment" : "comments"}` : "Join the conversation."}</p>
                </div>
                <div class="upload-feedback" data-comments-feedback></div>
                ${canPost ? `
                    <form class="detail-comment-form" data-comment-form>
                        <div class="detail-comment-avatar">
                            ${state.profile?.profile_image_url
                                ? `<img src="${escapeHtml(cacheBustedImageURL(state.profile.profile_image_url, state.profile?.profile_image_updated_at || ""))}" alt="${escapeHtml(currentUserName())}" />`
                                : `<span>${escapeHtml(initialsForName(currentUserName()))}</span>`}
                        </div>
                        <div class="detail-comment-inputs">
                            <textarea name="comment" placeholder="Add a comment" maxlength="500" required></textarea>
                            <div class="detail-comment-actions">
                                <span class="field-help">Be respectful and keep it constructive.</span>
                                <button class="button" type="submit">Post Comment</button>
                            </div>
                        </div>
                    </form>
                ` : `
                    <div class="detail-comments-gate">
                        <span>${!isRealEntity ? "Comments aren’t available for this content." : (disabled ? "Comments are disabled on this post." : (isLoggedIn() ? "You can read comments below." : "Log in to join the conversation."))}</span>
                        ${isRealEntity && !isLoggedIn() && !disabled ? `<a class="button-secondary" href="login.html">Log In</a>` : ""}
                    </div>
                `}
                <div class="detail-comments-list" data-comments-list>
                    <div class="comment-empty ${isRealEntity ? "comment-empty--loading" : ""}">${isRealEntity ? "Loading comments..." : "Comments aren’t available for this content."}</div>
                </div>
            </section>
        `;
    }

    function renderDetailLikeBar(entity) {
        const likesCount = Number(entity.likesCount) || 0;
        const isLiked = Boolean(entity.isLikedByCurrentUser);
        const shareUrl = buildPublicContentShareURL(entity.entityType, entity, entity.title);
        return `
            <div
                class="detail-like-bar"
                data-detail-like
                data-content-id="${escapeHtml(entity.id || "")}"
                data-content-type="${escapeHtml(entity.entityType || "")}"
            >
                <button
                    class="detail-like-button ${isLiked ? "active" : ""}"
                    type="button"
                    data-like-toggle
                    aria-pressed="${isLiked ? "true" : "false"}"
                    aria-label="${isLiked ? "Unlike this item" : "Like this item"}"
                >
                    <span class="detail-like-heart" aria-hidden="true">${isLiked ? "♥" : "♡"}</span>
                    <span class="detail-like-copy">
                        <strong data-like-count>${escapeHtml(compactCount(likesCount))}</strong>
                        <span data-like-label>${likesCount === 1 ? "Like" : "Likes"}</span>
                    </span>
                </button>
                <button
                    class="detail-share-button"
                    type="button"
                    data-detail-share
                    data-share-url="${escapeHtml(shareUrl)}"
                    aria-label="Share this ${escapeHtml(entity.entityType || "item")}"
                >
                    <span class="detail-share-icon" aria-hidden="true">↗</span>
                    <span>Share</span>
                </button>
            </div>
        `;
    }

    function renderDetailTopActions(entity) {
        if (!entity.isOwnedByCurrentUser) return "";
        const editHref = entity.entityType === "song"
            ? `upload.html?type=song&edit=${encodeURIComponent(entity.id || "")}`
            : `upload.html?type=beat&edit=${encodeURIComponent(entity.id || "")}`;
        return `
            <div class="detail-top-actions">
                <a
                    class="detail-edit-button"
                    href="${escapeHtml(editHref)}"
                    aria-label="Edit this ${escapeHtml(entity.entityType || "item")}"
                    title="Edit"
                >Edit</a>
                <button
                    class="detail-delete-button"
                    type="button"
                    data-detail-delete
                    data-content-id="${escapeHtml(entity.id || "")}"
                    data-content-type="${escapeHtml(entity.entityType || "")}"
                    aria-label="Delete this ${escapeHtml(entity.entityType || "item")}"
                    title="Delete"
                >🗑</button>
            </div>
        `;
    }

    function renderPostUploadShareBanner(entity) {
        return `
            <div class="post-upload-share-banner" data-post-upload-share>
                <div class="post-upload-share-copy">
                    <strong>${escapeHtml(entity.entityType === "beat" ? "Beat is live" : "Song is live")}</strong>
                    <span>Copy or share this link while you’re here.</span>
                </div>
                <div class="post-upload-share-actions">
                    <button class="button-secondary" type="button" data-post-upload-copy>Copy Link</button>
                    <button class="button" type="button" data-post-upload-share-button>Share Link</button>
                    <button class="button-quiet" type="button" data-post-upload-dismiss>Dismiss</button>
                </div>
            </div>
        `;
    }

    function wirePostUploadShareBanner(mount, entity) {
        const banner = mount?.querySelector("[data-post-upload-share]");
        if (!banner) return;

        const shareURL = buildPublicContentShareURL(entity.entityType, entity, entity.title);
        banner.querySelector("[data-post-upload-copy]")?.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(shareURL);
                showSiteToast("Link copied.", "success");
            } catch (error) {
                console.error("Post-upload copy failed", error);
                showSiteToast("We couldn’t copy the link right now.", "error");
            }
        });

        banner.querySelector("[data-post-upload-share-button]")?.addEventListener("click", async () => {
            try {
                if (navigator.share) {
                    await navigator.share({ title: entity.title || "SoundSwipe", url: shareURL });
                    showSiteToast("Link shared.", "success");
                } else {
                    await navigator.clipboard.writeText(shareURL);
                    showSiteToast("Link copied.", "success");
                }
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("Post-upload share failed", error);
                showSiteToast("We couldn’t share the link right now.", "error");
            }
        });

        banner.querySelector("[data-post-upload-dismiss]")?.addEventListener("click", () => {
            banner.remove();
        });
    }

    function renderDetailWavePlayer(entity) {
        if (!entity.audioFile) return "";
        const playerId = `detail-${entity.entityType || "content"}-${entity.id || entity.title || "player"}`;
        return `
            <div class="section detail-wave-player-section" data-carousel-card data-card-id="${escapeHtml(playerId)}">
                <div class="section-header"><h3>Preview</h3></div>
                <div class="detail-wave-player discover-replica-wavebar">
                    <button class="discover-replica-play" type="button" data-card-control data-play-toggle aria-label="Play ${escapeHtml(entity.title)}">
                        <span data-play-icon>▶</span>
                    </button>
                    <button class="discover-replica-waveform detail-waveform" type="button" data-card-control data-waveform data-waveform-source="${escapeHtml(entity.audioFile || entity.id || entity.title)}" aria-label="Seek ${escapeHtml(entity.title)}">
                        <canvas class="discover-replica-waveform-canvas" data-waveform-canvas aria-hidden="true"></canvas>
                        <span class="discover-replica-waveform-scrubber" data-waveform-scrubber style="left:0%"></span>
                    </button>
                    <span class="discover-replica-time detail-wave-player-time"><span data-current-time>0:00</span> / <span data-duration>0:00</span></span>
                </div>
                <audio preload="metadata" src="${escapeHtml(entity.audioFile)}" data-card-audio></audio>
            </div>
        `;
    }

    async function fetchDetailLikeState(contentId, contentType) {
        if (!hasSupabase() || !contentId || !isBackendEntityId(contentId)) {
            return { count: 0, isLiked: false };
        }

        const normalizedType = String(contentType || "").toLowerCase();
        const countRequest = getSupabase()
            .from("liked_content")
            .select("id", { count: "exact", head: true })
            .eq("content_id", contentId)
            .eq("content_type", normalizedType);

        const userLikeRequest = state.authUser?.id
            ? getSupabase()
                .from("liked_content")
                .select("id")
                .eq("user_id", state.authUser.id)
                .eq("content_id", contentId)
                .eq("content_type", normalizedType)
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null });

        const [countResult, userLikeResult] = await Promise.all([countRequest, userLikeRequest]);
        if (countResult.error) {
            throw countResult.error;
        }
        if (userLikeResult?.error) {
            throw userLikeResult.error;
        }

        return {
            count: Number(countResult.count) || 0,
            isLiked: Boolean(userLikeResult?.data?.id)
        };
    }

    async function toggleDetailLike(contentId, contentType, shouldLike) {
        if (!hasSupabase() || !state.authUser?.id) {
            throw new Error("You must be logged in to like posts.");
        }
        if (!isBackendEntityId(contentId)) {
            throw new Error("Likes aren’t available for this content.");
        }

        const normalizedType = String(contentType || "").toLowerCase();
        if (shouldLike) {
            const { error } = await getSupabase()
                .from("liked_content")
                .insert({
                    id: crypto.randomUUID(),
                    user_id: state.authUser.id,
                    content_id: contentId,
                    content_type: normalizedType,
                    liked_at: new Date().toISOString()
                });

            if (error && error.code !== "23505" && !/duplicate/i.test(String(error.message || ""))) {
                throw error;
            }
        } else {
            const { error } = await getSupabase()
                .from("liked_content")
                .delete()
                .eq("user_id", state.authUser.id)
                .eq("content_id", contentId)
                .eq("content_type", normalizedType);

            if (error) {
                throw error;
            }
        }
    }

    function updateDetailLikeBar(section, count, isLiked) {
        if (!section) return;
        const button = section.querySelector("[data-like-toggle]");
        const countNode = section.querySelector("[data-like-count]");
        const labelNode = section.querySelector("[data-like-label]");
        const heartNode = section.querySelector(".detail-like-heart");
        const safeCount = Math.max(0, Number(count) || 0);

        if (button) {
            button.classList.toggle("active", isLiked);
            button.setAttribute("aria-pressed", isLiked ? "true" : "false");
            button.setAttribute("aria-label", isLiked ? "Unlike this item" : "Like this item");
        }
        if (countNode) countNode.textContent = compactCount(safeCount);
        if (labelNode) labelNode.textContent = safeCount === 1 ? "Like" : "Likes";
        if (heartNode) heartNode.textContent = isLiked ? "♥" : "♡";
    }

    async function wireDetailLikeBar(mount, entity) {
        const section = mount?.querySelector("[data-detail-like]");
        const button = section?.querySelector("[data-like-toggle]");
        const shareButton = section?.querySelector("[data-detail-share]");
        if (!section || !button || !isBackendEntityId(entity.id)) return;

        const hydrate = async () => {
            const stateSnapshot = await fetchDetailLikeState(entity.id, entity.entityType);
            entity.likesCount = stateSnapshot.count;
            entity.isLikedByCurrentUser = stateSnapshot.isLiked;
            updateDetailLikeBar(section, stateSnapshot.count, stateSnapshot.isLiked);
        };

        try {
            await hydrate();
        } catch (error) {
            console.error("Detail like hydrate failed", error);
            updateDetailLikeBar(section, Number(entity.likesCount) || 0, Boolean(entity.isLikedByCurrentUser));
        }

        button.addEventListener("click", async () => {
            if (!isLoggedIn()) {
                storePostAuthRedirect(currentRedirectURL());
                window.location.href = "login.html?redirect=" + encodeURIComponent(currentRedirectURL());
                return;
            }

            const nextLikedState = !entity.isLikedByCurrentUser;
            const optimisticCount = Math.max(0, (Number(entity.likesCount) || 0) + (nextLikedState ? 1 : -1));
            entity.isLikedByCurrentUser = nextLikedState;
            entity.likesCount = optimisticCount;
            updateDetailLikeBar(section, optimisticCount, nextLikedState);
            button.setAttribute("aria-busy", "true");

            try {
                await toggleDetailLike(entity.id, entity.entityType, nextLikedState);
                await hydrate();
            } catch (error) {
                console.error("Detail like toggle failed", error);
                entity.isLikedByCurrentUser = !nextLikedState;
                entity.likesCount = Math.max(0, optimisticCount + (nextLikedState ? -1 : 1));
                updateDetailLikeBar(section, entity.likesCount, entity.isLikedByCurrentUser);
                window.alert(normalizeAuthError(error, "We couldn’t update your like right now."));
            } finally {
                button.removeAttribute("aria-busy");
            }
        });

        shareButton?.addEventListener("click", async () => {
            const shareUrl = shareButton.dataset.shareUrl || buildPublicContentShareURL(entity.entityType, entity, entity.title);
            try {
                if (navigator.share) {
                    await navigator.share({ title: entity.title || "SoundSwipe", url: shareUrl });
                    showSiteToast("Link shared.", "success");
                    return;
                }
                await navigator.clipboard.writeText(shareUrl);
                showSiteToast("Link copied.", "success");
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("Detail share failed", error);
                showSiteToast("Couldn’t share right now.", "error");
            }
        });
    }

    function wireDetailDeleteAction(mount, entity) {
        const button = mount?.querySelector("[data-detail-delete]");
        if (!button) return;

        button.addEventListener("click", async () => {
            const contentType = entity.entityType || button.dataset.contentType;
            const contentId = entity.id || button.dataset.contentId;
            if (!contentId || !contentType) return;

            const confirmed = window.confirm(`Delete this ${contentType}? This cannot be undone.`);
            if (!confirmed) return;

            try {
                const result = await deleteWebsiteContent(contentId, contentType);
                const wasArchived = Boolean(result?.archived);
                showSiteToast(
                    wasArchived && contentType === "beat"
                        ? "Beat removed from your profile and taken off sale."
                        : `${contentType === "beat" ? "Beat" : "Song"} deleted.`,
                    "success"
                );
                window.setTimeout(() => {
                    window.location.href = `profile.html?tab=${contentType === "beat" ? "beats" : "songs"}`;
                }, 250);
            } catch (error) {
                console.error("Detail delete failed", error);
                showSiteToast(error?.message || "Couldn’t delete this content right now.", "error");
            }
        });
    }

    function renderCommentRow(comment) {
        const displayName = comment.displayName || comment.username || "SoundSwipe User";
        const handle = comment.username ? `@${comment.username}` : "";
        return `
            <article class="detail-comment-row">
                <div class="detail-comment-avatar">
                    ${comment.profileImageURL
                        ? `<img src="${escapeHtml(cacheBustedImageURL(comment.profileImageURL))}" alt="${escapeHtml(displayName)}" />`
                        : `<span>${escapeHtml(initialsForName(displayName))}</span>`}
                </div>
                <div class="detail-comment-body">
                    <div class="detail-comment-meta">
                        <strong>${escapeHtml(displayName)}</strong>
                        ${handle ? `<span>${escapeHtml(handle)}</span>` : ""}
                        ${comment.isVerified ? `<span class="chip">Verified</span>` : ""}
                        <time>${escapeHtml(formatCommentTimestamp(comment.createdAt))}</time>
                    </div>
                    <p>${escapeHtml(comment.text)}</p>
                </div>
            </article>
        `;
    }

    async function fetchDetailComments(contentId, contentType) {
        if (!hasSupabase() || !contentId || !isBackendEntityId(contentId)) return [];
        const { data, error } = await getSupabase()
            .from("comments")
            .select("id, user_id, content_id, content_type, text, created_at, parent_comment_id, profiles:user_id(display_name, username, profile_image_url, is_verified)")
            .eq("content_id", contentId)
            .eq("content_type", contentType)
            .is("parent_comment_id", null)
            .order("created_at", { ascending: false });

        if (error) {
            throw error;
        }

        const comments = Array.isArray(data) ? data : [];
        return Promise.all(comments.map(async (comment) => ({
            id: comment.id,
            text: comment.text || "",
            createdAt: comment.created_at || "",
            displayName: comment.profiles?.display_name || "SoundSwipe User",
            username: comment.profiles?.username || "",
            profileImageURL: await resolveSignedBunnyURL(comment.profiles?.profile_image_url || ""),
            isVerified: Boolean(comment.profiles?.is_verified)
        })));
    }

    async function postDetailComment(contentId, contentType, text) {
        if (!hasSupabase() || !state.authUser?.id) {
            throw new Error("You must be logged in to comment.");
        }
        if (!isBackendEntityId(contentId)) {
            throw new Error("Comments aren’t available for this content.");
        }

        const trimmed = String(text || "").trim();
        if (!trimmed) {
            throw new Error("Comment text cannot be empty.");
        }

        const { error: insertError } = await getSupabase()
            .from("comments")
            .insert({
                user_id: state.authUser.id,
                content_id: contentId,
                content_type: contentType,
                text: trimmed,
                parent_comment_id: null
            });

        if (insertError) {
            throw insertError;
        }

        const tableName = contentType === "beat" ? "beats" : "songs";
        const { error: rpcError } = await getSupabase()
            .rpc("increment_comments", {
                content_id_input: contentId,
                table_name_input: tableName
            });

        if (rpcError) {
            console.warn("Comment count RPC failed", rpcError);
        }
    }

    async function wireDetailComments(mount, entity) {
        const section = mount?.querySelector("[data-comments-section]");
        const list = section?.querySelector("[data-comments-list]");
        const form = section?.querySelector("[data-comment-form]");
        const feedback = section?.querySelector("[data-comments-feedback]");
        const subtitle = section?.querySelector(".section-header p");
        if (!section || !list) return;
        if (!isBackendEntityId(entity.id)) return;

        const loadComments = async () => {
            list.innerHTML = `<div class="comment-empty comment-empty--loading">Loading comments...</div>`;
            try {
                const comments = await fetchDetailComments(entity.id, entity.entityType);
                entity.commentsCount = comments.length;
                if (subtitle) {
                    subtitle.textContent = comments.length ? `${comments.length} ${comments.length === 1 ? "comment" : "comments"}` : "Join the conversation.";
                }
                list.innerHTML = comments.length
                    ? comments.map(renderCommentRow).join("")
                    : `<div class="comment-empty">No comments yet. Start the conversation.</div>`;
            } catch (error) {
                list.innerHTML = `<div class="comment-empty">We couldn’t load comments right now.</div>`;
                if (feedback) {
                    setFeedbackNode(feedback, normalizeAuthError(error, "We couldn’t load comments right now."), "error");
                }
            }
        };

        await loadComments();

        if (form) {
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (feedback) clearFeedbackNode(feedback);
                const submitButton = form.querySelector('button[type="submit"]');
                const textarea = form.querySelector('textarea[name="comment"]');
                const text = textarea?.value || "";
                if (submitButton) submitButton.disabled = true;

                try {
                    await postDetailComment(entity.id, entity.entityType, text);
                    if (textarea) textarea.value = "";
                    entity.commentsCount = (Number(entity.commentsCount) || 0) + 1;
                    await loadComments();
                    if (feedback) {
                        setFeedbackNode(feedback, "Comment posted.", "success");
                    }
                } catch (error) {
                    if (feedback) {
                        setFeedbackNode(feedback, normalizeAuthError(error, "We couldn’t post your comment right now."), "error");
                    }
                } finally {
                    if (submitButton) submitButton.disabled = false;
                }
            });
        }
    }

    function beatDetailMarkup(beat) {
        const creditNames = (beat.producerCredits || []).map((credit) => credit.displayName).filter(Boolean);
        return `
            <div class="detail-layout">
                <div class="content-panel">
                    <div class="detail-cover">${renderCardArtwork(beat.image, beat.title)}</div>
                    ${renderDetailLikeBar(beat)}
                    ${renderDetailWavePlayer(beat)}
                </div>
                <div class="content-panel">
                    <div class="detail-heading-row">
                        <div>
                            <span class="eyebrow">Beat Card</span>
                            <h1 style="font-size:2.8rem; margin:16px 0 10px;">${escapeHtml(beat.title)}</h1>
                        </div>
                        ${renderDetailTopActions(beat)}
                    </div>
                    ${renderDetailCreatorBlock(beat)}
                    <p class="lede">Produced by ${escapeHtml((creditNames.length ? creditNames : beat.producers).join(", "))}.</p>
                    <div class="meta-row" style="margin:18px 0 20px;">
                        <span class="status-chip ${(beat.license || beat.publicLicenseState) === "Free for Non-Profit" ? "good" : "warn"}">${escapeHtml(beat.license || beat.publicLicenseState || "License Required")}</span>
                        ${beat.genre ? `<span class="chip">${escapeHtml(beat.genre)}</span>` : ""}
                        ${beat.mood ? `<span class="chip">${escapeHtml(beat.mood)}</span>` : ""}
                        ${beat.bpm ? `<span class="chip">${escapeHtml(String(beat.bpm))} BPM</span>` : ""}
                        ${beat.key ? `<span class="chip">${escapeHtml(beat.key)}</span>` : ""}
                    </div>
                    <div class="info-list">
                        <div class="info-row"><span class="info-label">Producer Credits</span><strong>${renderBeatProducerCreditsInline(beat)}</strong></div>
                        <div class="info-row"><span class="info-label">Purchase Tiers</span><strong>${escapeHtml(beat.tierSummary || "Not currently for sale")}</strong></div>
                        <div class="info-row"><span class="info-label">Starting Price</span><strong>${escapeHtml(beat.startingPriceLabel || beat.price || "View Tiers")}</strong></div>
                        <div class="info-row"><span class="info-label">Tags</span><strong>${escapeHtml((beat.tags || []).join(", ") || "None")}</strong></div>
                    </div>
                    ${renderBeatPurchaseSection(beat)}
                    ${beat.description ? `<div class="section"><div class="section-header"><h3>Description</h3></div><p class="lede">${escapeHtml(beat.description)}</p></div>` : ""}
                    ${renderDetailCommentsSection(beat)}
                </div>
            </div>
        `;
    }

    function songDetailMarkup(song) {
        return `
            <div class="detail-layout">
                <div class="content-panel">
                    <div class="detail-cover">${renderCardArtwork(song.image, song.title)}</div>
                    ${renderDetailLikeBar(song)}
                    ${renderDetailWavePlayer(song)}
                </div>
                <div class="content-panel">
                    <div class="detail-heading-row">
                        <div>
                            <span class="eyebrow">Song Card</span>
                            <h1 style="font-size:2.8rem; margin:16px 0 10px;">${escapeHtml(song.title)}</h1>
                        </div>
                        ${renderDetailTopActions(song)}
                    </div>
                    ${renderDetailCreatorBlock(song)}
                    ${song.genre ? `<p class="lede">${escapeHtml(song.genre)}</p>` : ""}
                    <div class="section" style="margin-top:18px;">
                        <div class="section-header"><h3>Produced by</h3></div>
                        <div class="chip-row">
                            ${(song.producers || []).map((producer) => `<span class="chip">${escapeHtml(producer)}</span>`).join("")}
                        </div>
                    </div>
                    <div class="section">
                        <div class="section-header"><h3>Description</h3></div>
                        <p class="lede">${escapeHtml(song.description || "")}</p>
                    </div>
                    ${(song.tags || []).length ? `<div class="meta-row" style="margin-top:18px;">${song.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
                    ${renderDetailCommentsSection(song)}
                </div>
            </div>
        `;
    }

    function creatorProfileHref(entity) {
        return buildPublicProfileURL({
            id: entity?.userId || "",
            usernameRaw: entity?.creatorUsername || ""
        }, { absolute: false });
    }

    function renderBeatProducerCreditsInline(beat) {
        const credits = Array.isArray(beat.producerCredits) ? beat.producerCredits : [];
        if (!credits.length) return escapeHtml((beat.producers || []).join(", "));
        return credits.map((credit) => {
            if (credit.isLinked) {
                return `<a class="detail-credit-link" href="${escapeHtml(buildPublicProfileURL({ id: credit.userId || "", usernameRaw: credit.username || "" }, { absolute: false }))}">${escapeHtml(credit.displayName || credit.username)}</a>`;
            }
            return `<span>${escapeHtml(credit.displayName)}</span>`;
        }).join(", ");
    }

    function renderDetailCreatorBlock(entity) {
        if (entity.entityType === "beat" && Array.isArray(entity.linkedProducerCredits) && entity.linkedProducerCredits.length > 1) {
            return `
                <div class="detail-creator-collab">
                    ${entity.linkedProducerCredits.map((credit) => `
                        <a class="detail-creator-link" href="${escapeHtml(buildPublicProfileURL({ id: credit.userId || "", usernameRaw: credit.username || "" }, { absolute: false }))}" aria-label="Open ${escapeHtml(credit.displayName)}'s profile">
                            ${renderReplicaAvatar(credit.profileImage || "", credit.displayName || credit.username || "Producer")}
                            <span class="detail-creator-copy">
                                <strong>${escapeHtml(credit.displayName)}</strong>
                                <span>${escapeHtml(credit.username ? `@${credit.username}` : "Producer")}</span>
                            </span>
                        </a>
                    `).join("")}
                </div>
            `;
        }
        const name = entity.creatorName || entity.creator || "SoundSwipe Artist";
        const handle = entity.creatorHandle || "@soundswipe";
        const href = creatorProfileHref(entity);
        return `
            <a class="detail-creator-link" href="${escapeHtml(href)}" aria-label="Open ${escapeHtml(name)}'s profile">
                ${renderReplicaAvatar(entity.creatorAvatar || "", name)}
                <span class="detail-creator-copy">
                    <strong>${escapeHtml(name)}</strong>
                    <span>${escapeHtml(handle)}</span>
                </span>
            </a>
        `;
    }

    async function fillPurchasedBeats() {
        const mount = document.querySelector("[data-purchased-grid]");
        if (!mount) return;

        const records = hasSupabase() && isLoggedIn() ? await fetchPurchasedBeatRecords() : [];
        renderPurchasedBeatsPage(mount, records);
    }

    async function fetchPurchasedBeatRecords() {
        const userId = state.authUser?.id;
        if (!userId) return [];

        let { data, error } = await getSupabase()
            .from("purchases")
            .select("id, beats_id, license_type, amount, created_at, entitlement_files")
            .eq("user_id", userId)
            .eq("content_type", "beat")
            .eq("status", "completed")
            .eq("environment", currentStripeEnvironment())
            .order("created_at", { ascending: false });

        if (purchaseEnvironmentColumnMissing(error)) {
            ({ data, error } = await getSupabase()
                .from("purchases")
                .select("id, beats_id, license_type, amount, created_at, entitlement_files")
                .eq("user_id", userId)
                .eq("content_type", "beat")
                .eq("status", "completed")
                .order("created_at", { ascending: false }));
        }

        if (error) {
            console.error("Purchased beats query failed", error);
            return [];
        }

        const rows = Array.isArray(data) ? data : [];
        const latestByBeat = new Map();
        rows.forEach((row) => {
            if (!row?.beats_id || latestByBeat.has(row.beats_id)) return;
            latestByBeat.set(row.beats_id, row);
        });

        const beatIds = Array.from(latestByBeat.keys());
        if (!beatIds.length) return [];

        const beatSelect = "id, user_id, title, album_url, bpm, key, tags, description, genre, mood, producer_display_name, additional_producers, public_license_state, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, basic_license_price, premium_license_price, exclusive_license_price, file_mp3_url, file_wav_url, stems_zip_url, upload_date, profiles!beats_user_id_fkey(display_name, username, profile_image_url)";
        const { data: beats, error: beatsError } = await executeBeatSelectWithFallback((selectClause) => {
            return getSupabase()
                .from("beats")
                .select(selectClause)
                .in("id", beatIds);
        }, beatSelect);

        if (beatsError) {
            console.error("Purchased beat details query failed", beatsError);
            return [];
        }

        const beatLookup = new Map((beats || []).map((beat) => [beat.id, beat]));
        const purchasedCards = await Promise.all(beatIds.map(async (beatId) => {
            const purchase = latestByBeat.get(beatId);
            const beat = beatLookup.get(beatId);
            if (!purchase || !beat) return null;
            const producerCreditState = await enrichBeatProducerCreditState(normalizeBeatProducerCredits({
                user_id: beat.user_id,
                username: beat.profiles?.username || "",
                display_name: beat.profiles?.display_name || beat.profiles?.username || "",
                profile_image_url: beat.profiles?.profile_image_url || ""
            }, beat.additional_producers));

            const licenseType = String(purchase.license_type || "basic").toLowerCase();
            const entitledFiles = Array.isArray(purchase.entitlement_files) && purchase.entitlement_files.length
                ? purchase.entitlement_files.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
                : purchasedFilesForTier(licenseType);
            return hydrateBeatCardMedia(normalizeSeedBeatCard({
                id: beat.id,
                userId: beat.user_id,
                title: beat.title || "Untitled Beat",
                image: beat.album_url || "",
                creatorName: producerCreditState.names[0] || beat.profiles?.display_name || beat.profiles?.username || "Unknown Producer",
                creatorUsername: beat.profiles?.username || "",
                creatorAvatar: beat.profiles?.profile_image_url || "",
                producers: producerCreditState.names,
                producerCredits: producerCreditState.all,
                linkedProducerCredits: producerCreditState.linked,
                manualProducerCredits: producerCreditState.manual,
                bpm: beat.bpm || null,
                key: beat.key || null,
                tags: Array.isArray(beat.tags) ? beat.tags : [],
                description: beat.description || "",
                genre: beat.genre || "",
                mood: beat.mood || "",
                publicLicenseState: beat.public_license_state === "free_for_non_profit" ? "Free for Non-Profit" : "License Required",
                basicLicenseEnabled: beat.basic_license_enabled !== false,
                premiumLicenseEnabled: Boolean(beat.premium_license_enabled),
                exclusiveLicenseEnabled: Boolean(beat.exclusive_license_enabled),
                basicLicensePrice: beat.basic_license_price,
                premiumLicensePrice: beat.premium_license_price,
                exclusiveLicensePrice: beat.exclusive_license_price,
                audioFile: beat.file_mp3_url || "",
                uploadDate: beat.upload_date || null,
                href: buildPublicContentShareURL("beat", beat, beat.title, { absolute: false }),
                purchasedTierKey: licenseType,
                purchasedTierLabel: purchasedTierLabel(licenseType),
                purchasedFiles: entitledFiles,
                purchasedDownloads: buildLicensedDownloadDescriptors(entitledFiles),
                purchaseDate: purchase.created_at || "",
                purchaseAmount: Number(purchase.amount) || 0
            }));
        }));

        return purchasedCards.filter(Boolean);
    }

    function renderPurchasedBeatsPage(mount, records) {
        const filtered = applyPurchasedBeatFilters(records);
        const visibleItems = filtered.slice(0, purchasedBeatsPageState.visibleCount);
        const summary = records.length
            ? `${filtered.length} of ${records.length} purchased beats`
            : "Unlocked beats will appear here with playback, files, and license details.";

        mount.innerHTML = `
            <div class="search-layout purchased-library-layout">
                <aside class="content-panel search-sidebar purchased-library-sidebar">
                    ${renderPurchasedBeatFilters(records)}
                </aside>
                <div class="search-results-shell purchased-library-results">
                    <div class="section-header purchased-library-header">
                        <div>
                            <h2>Purchased Beat Library</h2>
                            <p>${summary}</p>
                        </div>
                    </div>
                    ${filtered.length
                        ? `<div class="search-card-grid purchased-card-grid">${visibleItems.map(renderPurchasedBeatLibraryCard).join("")}</div>${renderLoadMoreButton(purchasedBeatsPageState.visibleCount, filtered.length, "purchased-beats")}`
                        : renderPurchasedBeatEmptyState(records.length)}
                </div>
            </div>
        `;

        bindPurchasedBeatFilters(mount, records);
        mount.querySelector('[data-load-more="purchased-beats"]')?.addEventListener("click", () => {
            purchasedBeatsPageState.visibleCount += 15;
            renderPurchasedBeatsPage(mount, records);
        });
        initializeDiscoverPlayback();
        wireLicensedDownloadButtons(mount);
    }

    function renderPurchasedBeatFilters(records) {
        const counts = {
            all: records.length,
            basic: records.filter((item) => item.purchasedTierKey === "basic").length,
            premium: records.filter((item) => item.purchasedTierKey === "premium").length,
            exclusive: records.filter((item) => item.purchasedTierKey === "exclusive").length
        };

        return `
            <div class="search-filter-panel purchased-filter-panel">
                <div>
                    <span class="eyebrow">Library Filters</span>
                    <h2>Purchased Beats</h2>
                    <p class="muted">Filter your private beat library just like the main beat discovery grid.</p>
                </div>
                <div class="search-filter-group">
                    <label>BPM</label>
                    ${renderBpmDualSlider(purchasedBeatsPageState.bpmMin, purchasedBeatsPageState.bpmMax, "purchased")}
                </div>
                <div class="field">
                    <label for="purchased-beat-key">Key</label>
                    <select id="purchased-beat-key" data-purchased-filter="beat-key">
                        <option value="">Any key</option>
                        ${renderBeatKeyOptionList(purchasedBeatsPageState.key)}
                    </select>
                </div>
                <div class="field">
                    <label for="purchased-beat-license-filter">Purchased Tier</label>
                    <select id="purchased-beat-license-filter" data-purchased-filter="license-tier">
                        <option value="all" ${purchasedBeatsPageState.filter === "all" ? "selected" : ""}>All (${counts.all})</option>
                        <option value="basic" ${purchasedBeatsPageState.filter === "basic" ? "selected" : ""}>Basic (${counts.basic})</option>
                        <option value="premium" ${purchasedBeatsPageState.filter === "premium" ? "selected" : ""}>Premium (${counts.premium})</option>
                        <option value="exclusive" ${purchasedBeatsPageState.filter === "exclusive" ? "selected" : ""}>Exclusive (${counts.exclusive})</option>
                    </select>
                </div>
            </div>
        `;
    }

    function bindPurchasedBeatFilters(mount, records) {
        mount.querySelectorAll("[data-purchased-filter]").forEach((field) => {
            const key = field.dataset.purchasedFilter;
            const applyState = () => {
                purchasedBeatsPageState.visibleCount = 15;
                if (key === "license-tier") purchasedBeatsPageState.filter = field.value || "all";
                if (key === "bpm-min") {
                const nextMin = Math.min(Number(field.value || 0), Number(purchasedBeatsPageState.bpmMax || 240));
                purchasedBeatsPageState.bpmMin = String(nextMin);
                    syncDualSliderUI("purchased", purchasedBeatsPageState.bpmMin, purchasedBeatsPageState.bpmMax);
                }
                if (key === "bpm-max") {
                    const nextMax = Math.max(Number(field.value || 240), Number(purchasedBeatsPageState.bpmMin || 0));
                    purchasedBeatsPageState.bpmMax = String(nextMax);
                    syncDualSliderUI("purchased", purchasedBeatsPageState.bpmMin, purchasedBeatsPageState.bpmMax);
                }
                if (key === "beat-key") purchasedBeatsPageState.key = field.value;
            };

            if (field.type === "range") {
                field.addEventListener("input", applyState);
                field.addEventListener("change", () => {
                    applyState();
                    renderPurchasedBeatsPage(mount, records);
                });
                field.addEventListener("pointerup", () => {
                    renderPurchasedBeatsPage(mount, records);
                });
                return;
            }

            const eventName = field.tagName === "SELECT" ? "change" : "input";
            field.addEventListener(eventName, () => {
                applyState();
                renderPurchasedBeatsPage(mount, records);
            });
        });

        syncDualSliderUI("purchased", purchasedBeatsPageState.bpmMin, purchasedBeatsPageState.bpmMax);
        bindDualSliderInteractions("purchased", {
            getMin: () => purchasedBeatsPageState.bpmMin || "0",
            getMax: () => purchasedBeatsPageState.bpmMax || "240",
            update: (which, value) => {
                if (which === "min") {
                    const nextMin = Math.min(value, Number(purchasedBeatsPageState.bpmMax || 240));
                    purchasedBeatsPageState.bpmMin = String(nextMin);
                } else {
                    const nextMax = Math.max(value, Number(purchasedBeatsPageState.bpmMin || 0));
                    purchasedBeatsPageState.bpmMax = String(nextMax);
                }
                purchasedBeatsPageState.visibleCount = 15;
                syncDualSliderUI("purchased", purchasedBeatsPageState.bpmMin, purchasedBeatsPageState.bpmMax);
            },
            commit: () => renderPurchasedBeatsPage(mount, records)
        });
    }

    function renderBpmDualSlider(minValue, maxValue, prefix) {
        const min = String(minValue || "0");
        const max = String(maxValue || "240");
        return `
            <div class="search-dual-slider" data-dual-slider="${escapeHtml(prefix)}">
                <div class="search-slider-summary">
                    <span data-dual-slider-min-label>${escapeHtml(min)} BPM</span>
                    <span data-dual-slider-max-label>${escapeHtml(max)} BPM</span>
                </div>
                <div class="search-dual-slider-track">
                    <div class="search-dual-slider-base"></div>
                    <div class="search-dual-slider-fill" data-dual-slider-fill></div>
                    <div class="search-dual-slider-handle is-min" aria-hidden="true"></div>
                    <div class="search-dual-slider-handle is-max" aria-hidden="true"></div>
                    <input type="range" min="0" max="240" step="1" value="${escapeHtml(min)}" data-${escapeHtml(prefix)}-filter="bpm-min">
                    <input type="range" min="0" max="240" step="1" value="${escapeHtml(max)}" data-${escapeHtml(prefix)}-filter="bpm-max">
                </div>
            </div>
        `;
    }

    function syncDualSliderUI(prefix, minValue, maxValue) {
        const slider = document.querySelector(`[data-dual-slider="${CSS.escape(prefix)}"]`);
        if (!slider) return;
        const min = Math.max(0, Math.min(240, Number(minValue || 0)));
        const max = Math.max(min, Math.min(240, Number(maxValue || 240)));
        const minLabel = slider.querySelector("[data-dual-slider-min-label]");
        const maxLabel = slider.querySelector("[data-dual-slider-max-label]");
        const fill = slider.querySelector("[data-dual-slider-fill]");
        const minInput = slider.querySelector(`[data-${prefix}-filter="bpm-min"]`);
        const maxInput = slider.querySelector(`[data-${prefix}-filter="bpm-max"]`);

        if (minLabel) minLabel.textContent = `${min} BPM`;
        if (maxLabel) maxLabel.textContent = `${max} BPM`;
        if (minInput) minInput.value = String(min);
        if (maxInput) maxInput.value = String(max);
        slider.style.setProperty("--dual-start-ratio", String(min / 240));
        slider.style.setProperty("--dual-end-ratio", String(max / 240));
        if (fill) {
            fill.style.left = `calc((var(--slider-thumb-size) / 2) + (100% - var(--slider-thumb-size)) * var(--dual-start-ratio))`;
            fill.style.width = `calc((100% - var(--slider-thumb-size)) * (var(--dual-end-ratio) - var(--dual-start-ratio)))`;
        }
    }

    function dualSliderValueFromClientX(track, clientX) {
        const rect = track.getBoundingClientRect();
        if (!rect.width) return 0;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(ratio * 240);
    }

    function bindDualSliderInteractions(prefix, config) {
        const slider = document.querySelector(`[data-dual-slider="${CSS.escape(prefix)}"]`);
        if (!slider) return;
        const track = slider.querySelector(".search-dual-slider-track");
        const minHandle = slider.querySelector(".search-dual-slider-handle.is-min");
        const maxHandle = slider.querySelector(".search-dual-slider-handle.is-max");
        if (!track || !minHandle || !maxHandle) return;

        const readClientX = (event) => event.touches?.[0]?.clientX
            ?? event.changedTouches?.[0]?.clientX
            ?? event.clientX;

        let activeDrag = null;

        const clearDragListeners = () => {
            if (!activeDrag) return;
            const { move, end } = activeDrag;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", end);
            window.removeEventListener("touchmove", move);
            window.removeEventListener("touchend", end);
            window.removeEventListener("touchcancel", end);
            activeDrag = null;
        };

        const startDrag = (which) => (event) => {
            event.preventDefault();
            clearDragListeners();

            if (typeof event.pointerId === "number" && event.currentTarget?.setPointerCapture) {
                try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // Safari and older browsers can throw here; window listeners still cover dragging.
                }
            }

            const updateFromPoint = (pointEvent) => {
                const clientX = readClientX(pointEvent);
                if (typeof clientX !== "number") return;
                const nextValue = dualSliderValueFromClientX(track, clientX);
                config.update(which, nextValue);
            };

            updateFromPoint(event);

            const move = (moveEvent) => {
                moveEvent.preventDefault();
                updateFromPoint(moveEvent);
            };

            const end = () => {
                clearDragListeners();
                config.commit();
            };

            activeDrag = { move, end };
            window.addEventListener("pointermove", move, { passive: false });
            window.addEventListener("pointerup", end, { passive: true });
            window.addEventListener("mousemove", move, { passive: false });
            window.addEventListener("mouseup", end, { passive: true });
            window.addEventListener("touchmove", move, { passive: false });
            window.addEventListener("touchend", end, { passive: true });
            window.addEventListener("touchcancel", end, { passive: true });
        };

        minHandle.addEventListener("pointerdown", startDrag("min"));
        maxHandle.addEventListener("pointerdown", startDrag("max"));
        minHandle.addEventListener("mousedown", startDrag("min"));
        maxHandle.addEventListener("mousedown", startDrag("max"));
        minHandle.addEventListener("touchstart", startDrag("min"), { passive: false });
        maxHandle.addEventListener("touchstart", startDrag("max"), { passive: false });

        const startTrackDrag = (event) => {
            if (event.target === minHandle || event.target === maxHandle) return;
            event.preventDefault();
            const clientX = readClientX(event);
            if (typeof clientX !== "number") return;
            const nextValue = dualSliderValueFromClientX(track, clientX);
            const currentMin = Number(config.getMin());
            const currentMax = Number(config.getMax());
            const which = Math.abs(nextValue - currentMin) <= Math.abs(nextValue - currentMax) ? "min" : "max";
            config.update(which, nextValue);
            startDrag(which)(event);
        };

        track.addEventListener("pointerdown", startTrackDrag);
        track.addEventListener("touchstart", startTrackDrag, { passive: false });
    }

    function applyPurchasedBeatFilters(records) {
        const { filter, bpmMin, bpmMax, key } = purchasedBeatsPageState;

        return records.filter((item) => {
            if (filter !== "all" && item.purchasedTierKey !== filter) return false;
            if (bpmMin && Number(item.bpm) < Number(bpmMin)) return false;
            if (bpmMax && Number(item.bpm) > Number(bpmMax)) return false;
            if (key && item.key !== key) return false;
            return true;
        });
    }

    function purchasedTierLabel(licenseType) {
        switch (licenseType) {
        case "premium":
            return "Premium Purchased";
        case "exclusive":
            return "Exclusive Purchased";
        case "basic":
        default:
            return "Basic Purchased";
        }
    }

    function purchasedFilesForTier(licenseType) {
        switch (licenseType) {
        case "premium":
            return ["MP3", "WAV"];
        case "exclusive":
            return ["MP3", "WAV", "Stems"];
        case "basic":
        default:
            return ["MP3"];
        }
    }

    function buildLicensedDownloadDescriptors(entitledFiles) {
        const labels = {
            MP3: "Download MP3",
            WAV: "Download WAV",
            STEMS: "Download Stems"
        };
        const unlocked = Array.from(new Set((entitledFiles || []).map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)));
        return unlocked
            .filter((key) => labels[key])
            .map((key) => ({ key, label: labels[key] }));
    }

    function renderPurchasedBeatLibraryCard(entry) {
        return renderSearchBeatCard({
            ...entry,
            tags: [entry.purchasedTierLabel || "Purchased", ...(entry.tags || [])].slice(0, 2)
        });
    }

    function renderPurchasedBeatEmptyState(hasRecords) {
        return `
            <div class="profile-empty-state purchased-empty-state">
                <strong>${hasRecords ? "No beats match this filter." : "No purchased beats."}</strong>
                <span>${hasRecords ? "Try a different license filter to browse the rest of your private library." : "Purchased beats will appear here once you unlock them in SoundSwipe."}</span>
            </div>
        `;
    }

    function wireLicensedDownloadButtons(scope = document) {
        scope.querySelectorAll("[data-licensed-download]").forEach((button) => {
            if (button.dataset.bound === "true") return;
            button.dataset.bound = "true";

            button.addEventListener("click", async () => {
                const beatId = button.dataset.beatId || "";
                const fileType = button.dataset.fileType || "";
                if (!beatId || !fileType) return;

                const originalLabel = button.textContent || "Download";
                button.textContent = "Preparing…";
                button.disabled = true;

                try {
                    const session = state.session || (await getSupabase().auth.getSession()).data.session;
                    if (!session?.access_token) {
                        throw new Error("You must be logged in to continue.");
                    }

                    const response = await fetch(`${window.SoundSwipeSupabaseConfig.url}/functions/v1/web-download-purchased-beat`, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${session.access_token}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            beat_id: beatId,
                            file_type: fileType
                        })
                    });

                    if (!response.ok) {
                        const payload = await response.json().catch(() => ({}));
                        throw new Error(payload.error || `Download failed with status ${response.status}`);
                    }

                    const blob = await response.blob();
                    const downloadURL = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = downloadURL;
                    link.download = "";
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    window.setTimeout(() => URL.revokeObjectURL(downloadURL), 1000);
                } catch (error) {
                    console.error("Licensed download failed", error);
                    window.alert(normalizeAuthError(error, "We couldn’t prepare that licensed download right now."));
                } finally {
                    button.textContent = originalLabel;
                    button.disabled = false;
                }
            });
        });
    }

    function fillUploadPage() {
        const mount = document.querySelector("[data-upload-page]");
        if (!mount) return;

        const params = new URLSearchParams(window.location.search);
        const type = params.get("type") || "";

        if (!type) {
            mount.innerHTML = `
                <div class="content-panel upload-home-shell">
                    <span class="eyebrow">Upload</span>
                    <h1 style="font-size:2.4rem; margin:16px 0 10px;">Choose your upload</h1>
                    <p class="lede">Pick the release you want to share.</p>
                    <div class="section upload-choice-grid">
                        <a class="choice-card" href="upload.html?type=beat">
                            <span class="eyebrow">Beat</span>
                            <h3>Upload Beat</h3>
                            <p>Artwork, audio, licensing, and beat details.</p>
                            <span class="button-secondary">Continue with Beat</span>
                        </a>
                        <a class="choice-card" href="upload.html?type=song">
                            <span class="eyebrow">Song</span>
                            <h3>Upload Song</h3>
                            <p>Artwork, audio, credits, and release details.</p>
                            <span class="button-secondary">Continue with Song</span>
                        </a>
                    </div>
                </div>
            `;
            return;
        }

        mount.innerHTML = type === "beat" ? beatUploadMarkup() : songUploadMarkup();
        setupUploadPage(type);
    }

    function beatUploadMarkup() {
        return `
            <div class="content-panel upload-shell">
                <div class="upload-section-head">
                    <div>
                        <span class="eyebrow">Upload Beat</span>
                        <h1 style="font-size:2.4rem; margin:16px 0 10px;">Release a beat</h1>
                        <p class="lede">Upload your beat artwork, audio, and licensing details.</p>
                    </div>
                </div>

                <form class="upload-form" id="beat-upload-form">
                    <section class="upload-section">
                        <div class="upload-section-head"><div><h2>Core Details</h2><p>Title, description, BPM, key, and tags.</p></div></div>
                        <div class="form-grid">
                            <div class="field"><label for="beat-title">Beat Title</label><input id="beat-title" name="title" placeholder="Beat title" maxlength="120" required></div>
                            <div class="field"><label for="beat-bpm">BPM</label><input id="beat-bpm" name="bpm" inputmode="numeric" placeholder="120"></div>
                            <div class="field">
                                <label for="beat-key-note">Key</label>
                                <div class="key-select-row">
                                    <select id="beat-key-note" aria-label="Beat key note">
                                        <option value="">Note</option>
                                        <option value="C">C</option>
                                        <option value="C#">C#</option>
                                        <option value="D">D</option>
                                        <option value="D#">D#</option>
                                        <option value="E">E</option>
                                        <option value="F">F</option>
                                        <option value="F#">F#</option>
                                        <option value="G">G</option>
                                        <option value="G#">G#</option>
                                        <option value="A">A</option>
                                        <option value="A#">A#</option>
                                        <option value="B">B</option>
                                    </select>
                                    <select id="beat-key-mode" aria-label="Beat key mode">
                                        <option value="">Mode</option>
                                        <option value="Major">Major</option>
                                        <option value="Minor">Minor</option>
                                    </select>
                                </div>
                                <input id="beat-key" name="key" type="hidden">
                            </div>
                            <div class="field">
                                <label for="beat-tags-input">Tags</label>
                                <div class="tag-entry-shell">
                                    <div class="tag-list" id="beat-tag-list"></div>
                                    <input id="beat-tags-input" type="text" placeholder="Add tags and press Enter">
                                </div>
                                <input id="beat-tags" name="tags" type="hidden">
                                <div class="tag-suggestions" id="beat-tag-suggestions" hidden></div>
                            </div>
                        </div>
                        <div class="form-grid single">
                            <div class="field">
                                <label for="beat-producer-search">Producer Credits</label>
                                <div class="tag-list" id="beat-producer-tags"></div>
                                <input id="beat-producer-search" name="producerSearch" placeholder="Search SoundSwipe producers or type a name and press Enter">
                                <div class="producer-search-results" id="beat-producer-results"></div>
                                <div class="field-help">Credit collaborators with linked accounts or add names manually.</div>
                            </div>
                        </div>
                        <div class="form-grid single">
                            <div class="field"><label for="beat-description">Description</label><textarea id="beat-description" name="description" placeholder="Describe your beat, the vibe, and how artists should think about it." minlength="10" required></textarea></div>
                        </div>
                    </section>

                    <section class="upload-section">
                        <div class="upload-section-head"><div><h2>Files & Artwork</h2><p>Add your preview file and cover artwork.</p></div></div>
                        <div class="form-grid">
                            <div class="field">
                                <label for="beat-mp3">Preview MP3</label>
                                <label class="file-dropzone" for="beat-mp3">
                                    <input id="beat-mp3" name="mp3File" type="file" accept=".mp3,audio/mpeg" required>
                                    <span class="file-dropzone-icon">♪</span>
                                    <strong>Select MP3</strong>
                                    <span class="file-dropzone-copy">Required</span>
                                    <span class="file-dropzone-filename" data-file-name="beat-mp3">No file selected</span>
                                </label>
                            </div>
                            <div class="field">
                                <label for="beat-artwork">Artwork</label>
                                <label class="file-dropzone file-dropzone--artwork" for="beat-artwork">
                                    <input id="beat-artwork" name="artworkFile" type="file" accept="image/*">
                                    <span class="file-dropzone-icon">▣</span>
                                    <strong>Select Artwork</strong>
                                    <span class="file-dropzone-copy">Crop to card frame</span>
                                    <span class="file-dropzone-filename" data-file-name="beat-artwork">Optional</span>
                                </label>
                            </div>
                        </div>
                        <div class="upload-preview-grid" id="beat-artwork-preview-wrap" hidden>
                            <div class="artwork-preview"><img id="beat-artwork-preview" alt="Beat artwork preview"></div>
                            <div>
                                <strong>Artwork</strong>
                                <p class="field-help">Cropped to fit the card artwork frame.</p>
                                <div class="upload-actions" style="margin-top:12px;">
                                    <button class="button-quiet" type="button" id="beat-artwork-adjust">Adjust Crop</button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="upload-section">
                        <div class="upload-section-head">
                            <div><h2>Licensing</h2><p>Set the public beat state and the license tiers you want to offer.</p></div>
                            <button class="license-help-button" id="beat-license-help" type="button" aria-label="Explain beat license options">?</button>
                        </div>
                        <div class="segmented-toggle" id="beat-license-state">
                            <button class="segmented-option active" data-license-state="free_for_non_profit" type="button">Free for Non-Profit</button>
                            <button class="segmented-option" data-license-state="license_required" type="button">License Required</button>
                        </div>
                        <input type="hidden" name="publicLicenseState" value="free_for_non_profit">

                        <div class="requirements-grid">
                            <div class="tier-toggle-card">
                                <div class="toggle-row">
                                    <div class="toggle-copy"><div class="tier-title-row"><strong>Basic License</strong><button class="tier-help-trigger" type="button" data-license-tier-help="basic" aria-label="Explain Basic License">?</button></div><span>MP3</span></div>
                                    <label class="switch">
                                        <input type="checkbox" id="beat-basic-enabled" name="basicLicenseEnabled" checked>
                                        <span class="switch-slider"></span>
                                    </label>
                                </div>
                                <div class="tier-inline-fields" id="beat-basic-pricing">
                                    <div class="field"><label for="beat-basic-price">Price</label><input id="beat-basic-price" name="basicLicensePrice" inputmode="decimal" value="29.99"></div>
                                </div>
                            </div>

                            <div class="tier-toggle-card">
                                <div class="toggle-row">
                                    <div class="toggle-copy"><div class="tier-title-row"><strong>Premium License</strong><button class="tier-help-trigger" type="button" data-license-tier-help="premium" aria-label="Explain Premium License">?</button></div><span>MP3 + WAV</span></div>
                                    <label class="switch">
                                        <input type="checkbox" id="beat-premium-enabled" name="premiumLicenseEnabled">
                                        <span class="switch-slider"></span>
                                    </label>
                                </div>
                                <div class="tier-inline-fields" id="beat-premium-pricing" hidden>
                                    <div class="field"><label for="beat-premium-price">Price</label><input id="beat-premium-price" name="premiumLicensePrice" inputmode="decimal" placeholder="149.00"></div>
                                </div>
                            </div>

                            <div class="tier-toggle-card">
                                <div class="toggle-row">
                                    <div class="toggle-copy"><div class="tier-title-row"><strong>Exclusive License</strong><button class="tier-help-trigger" type="button" data-license-tier-help="exclusive" aria-label="Explain Exclusive License">?</button></div><span>MP3 + WAV + optional stems</span></div>
                                    <label class="switch">
                                        <input type="checkbox" id="beat-exclusive-enabled" name="exclusiveLicenseEnabled">
                                        <span class="switch-slider"></span>
                                    </label>
                                </div>
                                <div class="tier-inline-fields" id="beat-exclusive-pricing" hidden>
                                    <div class="field"><label for="beat-exclusive-price">Price</label><input id="beat-exclusive-price" name="exclusiveLicensePrice" inputmode="decimal" placeholder="499.00"></div>
                                    <div class="toggle-row compact" id="beat-stems-toggle" hidden>
                                        <div class="toggle-copy"><strong>Include Stems</strong><span>Add stems with Exclusive</span></div>
                                        <label class="switch">
                                            <input type="checkbox" id="beat-exclusive-stems" name="exclusiveIncludesStems">
                                            <span class="switch-slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="requirements-grid upload-requirements-list">
                            <div class="field file-requirement-field" id="beat-wav-field" hidden>
                                <label for="beat-wav">WAV File</label>
                                <label class="file-dropzone compact" for="beat-wav">
                                    <input id="beat-wav" name="wavFile" type="file" accept=".wav,audio/wav">
                                    <span class="file-dropzone-icon">◌</span>
                                    <strong>Select WAV</strong>
                                    <span class="file-dropzone-copy">Required for Premium or Exclusive</span>
                                    <span class="file-dropzone-filename" data-file-name="beat-wav">No file selected</span>
                                </label>
                            </div>
                            <div class="field file-requirement-field" id="beat-stems-field" hidden>
                                <label for="beat-stems">Stems ZIP</label>
                                <label class="file-dropzone compact" for="beat-stems">
                                    <input id="beat-stems" name="stemsFile" type="file" accept=".zip,application/zip">
                                    <span class="file-dropzone-icon">◫</span>
                                    <strong>Select ZIP</strong>
                                    <span class="file-dropzone-copy">Required when stems are included</span>
                                    <span class="file-dropzone-filename" data-file-name="beat-stems">No file selected</span>
                                </label>
                            </div>
                        </div>
                    </section>

                    <div class="upload-feedback" data-upload-feedback></div>
                    <div class="upload-feedback" data-upload-success></div>
                    <div class="upload-feedback" data-stripe-warning></div>
                    <div class="upload-actions">
                        <button class="button" type="submit" data-submit-button disabled>Upload Beat</button>
                        <a class="button-quiet" href="profile.html">Cancel</a>
                    </div>
                </form>
            </div>
        `;
    }

    function songUploadMarkup() {
        return `
            <div class="content-panel upload-shell">
                <div class="upload-section-head">
                    <div>
                        <span class="eyebrow">Upload Song</span>
                        <h1 style="font-size:2.4rem; margin:16px 0 10px;">Release a song</h1>
                        <p class="lede">Upload your song artwork, audio, and release details.</p>
                    </div>
                </div>

                <form class="upload-form" id="song-upload-form">
                    <section class="upload-section">
                        <div class="upload-section-head"><div><h2>Song Details</h2><p>Title, description, credits, tags, and release options.</p></div></div>
                        <div class="form-grid">
                            <div class="field"><label for="song-title">Song Title</label><input id="song-title" name="title" placeholder="Song title" maxlength="120" required></div>
                            <div class="field"><label for="song-album">Album</label><input id="song-album" name="album" placeholder="Optional album name"></div>
                        </div>
                        <div class="form-grid single">
                            <div class="field"><label for="song-description">Description</label><textarea id="song-description" name="description" placeholder="Describe your song, credits, and release context." minlength="10" required></textarea></div>
                        </div>
                        <div class="form-grid">
                            <div class="field"><label for="song-featured-artists">Featured Artists</label><input id="song-featured-artists" name="featuredArtists" placeholder="Artist B, Artist C"></div>
                            <div class="field"><label for="song-tags">Tags</label><input id="song-tags" name="tags" placeholder="melodic, summer, chill"></div>
                        </div>
                        <div class="form-grid single">
                            <div class="field"><label for="song-lyrics">Lyrics</label><textarea id="song-lyrics" name="lyrics" placeholder="Optional lyrics for this release"></textarea></div>
                        </div>
                        <div class="toggle-row">
                            <div class="toggle-copy"><strong>Explicit Content</strong><span>Mark this release as explicit.</span></div>
                            <label class="switch">
                                <input type="checkbox" id="song-explicit" name="isExplicit">
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                    </section>

                    <section class="upload-section">
                        <div class="upload-section-head"><div><h2>Files & Artwork</h2><p>Add your audio file and cover artwork.</p></div></div>
                        <div class="form-grid">
                            <div class="field">
                                <label for="song-audio">Audio File</label>
                                <label class="file-dropzone" for="song-audio">
                                    <input id="song-audio" name="audioFile" type="file" accept=".mp3,.wav,.m4a,audio/*" required>
                                    <span class="file-dropzone-icon">♫</span>
                                    <strong>Select Audio</strong>
                                    <span class="file-dropzone-copy">MP3, WAV, or M4A</span>
                                    <span class="file-dropzone-filename" data-file-name="song-audio">No file selected</span>
                                </label>
                            </div>
                            <div class="field">
                                <label for="song-artwork">Artwork</label>
                                <label class="file-dropzone file-dropzone--artwork" for="song-artwork">
                                    <input id="song-artwork" name="artworkFile" type="file" accept="image/*">
                                    <span class="file-dropzone-icon">▣</span>
                                    <strong>Select Artwork</strong>
                                    <span class="file-dropzone-copy">Crop to card frame</span>
                                    <span class="file-dropzone-filename" data-file-name="song-artwork">Optional</span>
                                </label>
                            </div>
                        </div>
                        <div class="upload-preview-grid" id="song-artwork-preview-wrap" hidden>
                            <div class="artwork-preview"><img id="song-artwork-preview" alt="Song artwork preview"></div>
                            <div>
                                <strong>Artwork</strong>
                                <p class="field-help">Cropped to fit the card artwork frame.</p>
                                <div class="upload-actions" style="margin-top:12px;">
                                    <button class="button-quiet" type="button" id="song-artwork-adjust">Adjust Crop</button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="upload-section">
                        <div class="upload-section-head"><div><h2>Beat Producers</h2><p>Add the producers behind the beat.</p></div></div>
                        <div class="upload-feedback show info" id="song-producer-lock-message" hidden>These producer tags were filled in automatically and can’t be removed here.</div>
                        <div class="tag-list" id="song-producer-tags"></div>
                        <div class="form-grid single">
                            <div class="field"><label for="song-producer-search">Search producer accounts or type a producer name</label><input id="song-producer-search" name="producerSearch" placeholder="Search profiles or type a producer name"></div>
                        </div>
                        <div class="producer-search-results" id="song-producer-results"></div>
                        <div class="upload-actions">
                            <button class="button-quiet" type="button" id="song-add-manual-producer">Add typed producer manually</button>
                        </div>
                    </section>

                    <div class="upload-feedback" data-upload-feedback></div>
                    <div class="upload-feedback" data-upload-success></div>
                    <div class="upload-actions">
                        <button class="button" type="submit" data-submit-button disabled>Upload Song</button>
                        <a class="button-quiet" href="profile.html">Cancel</a>
                    </div>
                </form>
            </div>
        `;
    }

    function setupUploadPage(type) {
        if (type === "beat") {
            setupBeatUploadPage();
        } else if (type === "song") {
            setupSongUploadPage();
        }
    }

    function setupBeatUploadPage() {
        const form = document.querySelector("#beat-upload-form");
        if (!form) return;
        setUploadEditingUI("beat", Boolean(getUploadEditId("beat")));

        const musicalNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const commonBeatTags = [
            "trap", "dark", "808", "melodic", "pain", "summer", "drill", "lofi",
            "chill", "rage", "ambient", "guitar", "piano", "sad", "uplifting", "club"
        ];
        const publicStateInput = form.querySelector('[name="publicLicenseState"]');
        const keyInput = form.querySelector("#beat-key");
        const keyNoteSelect = form.querySelector("#beat-key-note");
        const keyModeSelect = form.querySelector("#beat-key-mode");
        const tierHelpButtons = form.querySelectorAll("[data-license-tier-help]");
        const tagsInput = form.querySelector("#beat-tags");
        const tagEntryInput = form.querySelector("#beat-tags-input");
        const tagList = form.querySelector("#beat-tag-list");
        const tagSuggestions = form.querySelector("#beat-tag-suggestions");
        const basicToggle = form.querySelector("#beat-basic-enabled");
        const premiumToggle = form.querySelector("#beat-premium-enabled");
        const exclusiveToggle = form.querySelector("#beat-exclusive-enabled");
        const stemsToggle = form.querySelector("#beat-exclusive-stems");
        const wavField = form.querySelector("#beat-wav-field");
        const stemsToggleRow = form.querySelector("#beat-stems-toggle");
        const stemsField = form.querySelector("#beat-stems-field");
        const artworkInput = form.querySelector("#beat-artwork");
        const artworkAdjust = form.querySelector("#beat-artwork-adjust");
        const feedback = form.querySelector("[data-upload-feedback]");
        const success = form.querySelector("[data-upload-success]");
        const stripeWarning = form.querySelector("[data-stripe-warning]");
        const submitButton = form.querySelector("[data-submit-button]");
        const basicPricing = form.querySelector("#beat-basic-pricing");
        const premiumPricing = form.querySelector("#beat-premium-pricing");
        const exclusivePricing = form.querySelector("#beat-exclusive-pricing");
        const selectedTags = [];
        const selectedProducerCredits = [];
        const producerSearch = form.querySelector("#beat-producer-search");
        const producerResults = form.querySelector("#beat-producer-results");

        const syncBeatKeyField = () => {
            const note = keyNoteSelect.value.trim();
            const mode = keyModeSelect.value.trim();
            keyInput.value = note && mode ? `${note} ${mode}` : "";
            updateBeatUploadState();
        };

        const syncBeatTagsField = () => {
            tagsInput.value = selectedTags.join(", ");
            tagList.innerHTML = selectedTags.map((tag, index) => `
                <span class="tag-chip">
                    <span>${escapeHtml(tag)}</span>
                    <button type="button" data-remove-beat-tag="${index}">×</button>
                </span>
            `).join("");

            tagList.querySelectorAll("[data-remove-beat-tag]").forEach((button) => {
                button.addEventListener("click", () => {
                    selectedTags.splice(Number(button.dataset.removeBeatTag), 1);
                    syncBeatTagsField();
                    updateBeatTagSuggestions();
                    updateBeatUploadState();
                });
            });
        };

        const addBeatTag = (rawValue) => {
            const tag = String(rawValue || "").trim().replace(/^#/, "");
            if (!tag) return;
            if (selectedTags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
            selectedTags.push(tag);
            tagEntryInput.value = "";
            syncBeatTagsField();
            updateBeatTagSuggestions();
            updateBeatUploadState();
        };

        const updateBeatTagSuggestions = () => {
            const query = tagEntryInput.value.trim().toLowerCase();
            const suggestions = commonBeatTags
                .filter((tag) => !selectedTags.some((existing) => existing.toLowerCase() === tag.toLowerCase()))
                .filter((tag) => !query || tag.includes(query))
                .slice(0, 6);

            tagSuggestions.hidden = suggestions.length === 0 || !query;
            tagSuggestions.innerHTML = suggestions.map((tag) => `
                <button class="tag-suggestion-chip" type="button" data-add-beat-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>
            `).join("");

            tagSuggestions.querySelectorAll("[data-add-beat-tag]").forEach((button) => {
                button.addEventListener("click", () => addBeatTag(button.dataset.addBeatTag));
            });
        };

        const renderBeatProducerCredits = () => {
            const producerTags = form.querySelector("#beat-producer-tags");
            if (!producerTags) return;
            producerTags.innerHTML = selectedProducerCredits.map((credit, index) => `
                <span class="tag-chip">
                    <span>${escapeHtml(credit.display_name || credit.username || "Producer")}</span>
                    <button type="button" data-remove-beat-producer="${index}">×</button>
                </span>
            `).join("");

            producerTags.querySelectorAll("[data-remove-beat-producer]").forEach((button) => {
                button.addEventListener("click", () => {
                    selectedProducerCredits.splice(Number(button.dataset.removeBeatProducer), 1);
                    renderBeatProducerCredits();
                    updateBeatUploadState();
                });
            });
        };

        const addBeatProducerCredit = (entry) => {
            const displayName = String(entry?.display_name || entry?.displayName || "").trim();
            const username = normalizeUsernameValue(entry?.username || "");
            const userId = String(entry?.user_id || entry?.userId || "").trim();
            const normalizedName = displayName || username;
            if (!normalizedName) return;
            const duplicate = selectedProducerCredits.some((credit) => {
                if (userId && credit.user_id && credit.user_id === userId) return true;
                return String(credit.display_name || "").toLowerCase() === normalizedName.toLowerCase()
                    || String(credit.username || "").toLowerCase() === username.toLowerCase();
            });
            if (duplicate) return;
            selectedProducerCredits.push({
                user_id: userId || null,
                username: username || null,
                display_name: displayName || username,
                profile_image_url: String(entry?.profile_image_url || entry?.profileImageUrl || "").trim() || null
            });
            if (producerSearch) producerSearch.value = "";
            if (producerResults) producerResults.innerHTML = "";
            renderBeatProducerCredits();
            updateBeatUploadState();
        };

        form.querySelectorAll("[data-license-state]").forEach((button) => {
            button.addEventListener("click", () => {
                form.querySelectorAll("[data-license-state]").forEach((item) => item.classList.remove("active"));
                button.classList.add("active");
                publicStateInput.value = button.dataset.licenseState;
                updateBeatUploadState();
            });
        });

        form.querySelector("#beat-license-help")?.addEventListener("click", openBeatLicenseHelpModal);

        const setConditionalFieldVisibility = (node, isVisible) => {
            if (!node) return;
            node.hidden = !isVisible;
            node.classList.toggle("is-hidden", !isVisible);
        };

        const refreshRequirements = () => {
            const needsWav = premiumToggle.checked || exclusiveToggle.checked;
            if (premiumToggle.checked && !form.premiumLicensePrice.value.trim()) {
                form.premiumLicensePrice.value = "149.00";
            }
            if (exclusiveToggle.checked && !form.exclusiveLicensePrice.value.trim()) {
                form.exclusiveLicensePrice.value = "499.00";
            }
            basicPricing.hidden = !basicToggle.checked;
            premiumPricing.hidden = !premiumToggle.checked;
            exclusivePricing.hidden = !exclusiveToggle.checked;
            setConditionalFieldVisibility(wavField, needsWav);
            setConditionalFieldVisibility(stemsToggleRow, exclusiveToggle.checked);
            setConditionalFieldVisibility(stemsField, exclusiveToggle.checked && stemsToggle.checked);
            updateBeatUploadState();
        };

        refreshBeatStripeStatus().then((stripeConnected) => {
            uploadState.beatStripeConnected = stripeConnected;
            uploadState.beatStripeChecked = true;
            updateBeatUploadState();
        }).catch(() => {
            uploadState.beatStripeConnected = false;
            uploadState.beatStripeChecked = true;
            updateBeatUploadState();
        });

        premiumToggle.addEventListener("change", refreshRequirements);
        exclusiveToggle.addEventListener("change", refreshRequirements);
        stemsToggle.addEventListener("change", refreshRequirements);
        tierHelpButtons.forEach((button) => {
            button.addEventListener("click", () => {
                openBeatTierHelpModal(button.dataset.licenseTierHelp || "");
            });
        });
        refreshRequirements();

        keyNoteSelect.addEventListener("change", syncBeatKeyField);
        keyModeSelect.addEventListener("change", syncBeatKeyField);

        tagEntryInput.addEventListener("input", () => {
            updateBeatTagSuggestions();
            updateBeatUploadState();
        });
        tagEntryInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                addBeatTag(tagEntryInput.value);
            }
        });
        tagEntryInput.addEventListener("blur", () => {
            window.setTimeout(() => {
                tagSuggestions.hidden = true;
            }, 120);
        });

        producerSearch?.addEventListener("input", async () => {
            const query = producerSearch.value.trim();
            if (!producerResults) return;
            if (query.length < 2) {
                producerResults.innerHTML = "";
                return;
            }

            try {
                const { data, error } = await getSupabase()
                    .from("profiles")
                    .select("id, display_name, username, profile_image_url")
                    .or(`display_name.ilike.%${query}%,username.ilike.%${query}%`)
                    .limit(8);

                if (error) throw error;

                producerResults.innerHTML = (data || []).filter((profile) => {
                    return !selectedProducerCredits.some((credit) => credit.user_id === profile.id);
                }).map((profile) => `
                    <button class="producer-result" type="button" data-beat-producer-id="${escapeHtml(profile.id)}" data-beat-producer-name="${escapeHtml(profile.display_name || "")}" data-beat-producer-username="${escapeHtml(profile.username || "")}" data-beat-producer-image="${escapeHtml(profile.profile_image_url || "")}">
                        <img src="${escapeHtml(profile.profile_image_url || "ProfilePage.png")}" alt="${escapeHtml(profile.display_name || profile.username || "Producer")}">
                        <div>
                            <strong>${escapeHtml(profile.display_name || profile.username || "Producer")}</strong>
                            <div class="field-help">${profile.username ? `@${escapeHtml(profile.username)}` : "Producer account"}</div>
                        </div>
                        <span class="chip">Add</span>
                    </button>
                `).join("");

                producerResults.querySelectorAll("[data-beat-producer-id]").forEach((button) => {
                    button.addEventListener("click", () => {
                        addBeatProducerCredit({
                            user_id: button.dataset.beatProducerId,
                            username: button.dataset.beatProducerUsername || null,
                            display_name: button.dataset.beatProducerName || button.dataset.beatProducerUsername || "",
                            profile_image_url: button.dataset.beatProducerImage || null
                        });
                    });
                });
            } catch {
                producerResults.innerHTML = "";
            }
        });

        producerSearch?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const name = producerSearch.value.trim();
                if (!name) return;
                addBeatProducerCredit({
                    user_id: null,
                    username: null,
                    display_name: name
                });
            }
        });

        form.querySelector("#beat-mp3")?.addEventListener("change", (event) => updateFileName(event.currentTarget));
        form.querySelector("#beat-wav")?.addEventListener("change", (event) => updateFileName(event.currentTarget));
        form.querySelector("#beat-stems")?.addEventListener("change", (event) => updateFileName(event.currentTarget));

        artworkInput.addEventListener("change", () => {
            clearArtworkSelection("beat", form);
            updateFileName(artworkInput);
            const file = artworkInput.files?.[0];
            if (file) {
                openArtworkCropper(file, "beat");
            }
        });
        artworkAdjust?.addEventListener("click", () => {
            const currentFile = artworkStateFor("beat")?.sourceFile || artworkInput.files?.[0];
            if (currentFile) {
                openArtworkCropper(currentFile, "beat");
            }
        });
        form.querySelectorAll("input, textarea, select").forEach((node) => {
            node.addEventListener("input", updateBeatUploadState);
            node.addEventListener("change", updateBeatUploadState);
        });

        function updateBeatUploadState() {
            const isPaidSelected = basicToggle.checked || premiumToggle.checked || exclusiveToggle.checked;
            const valid = validateBeatUploadForm(form, uploadState.beatStripeConnected, artworkStateFor("beat")).length === 0;

            if (stripeWarning) {
                if (isPaidSelected && !uploadState.beatStripeConnected) {
                    stripeWarning.className = "upload-feedback show info";
                    stripeWarning.style.whiteSpace = "normal";
                    stripeWarning.innerHTML = `
                        <div class="upload-inline-action">
                            <span>Connect Stripe to sell paid licenses.</span>
                            <button class="button-secondary" type="button" data-upload-stripe-connect>Connect Stripe Account</button>
                        </div>
                    `;
                    stripeWarning.querySelector("[data-upload-stripe-connect]")?.addEventListener("click", async () => {
                        await startStripeConnectOnboarding(feedback, {
                            returnURL: new URL("upload.html?type=beat", window.location.href).toString(),
                            refreshURL: new URL("upload.html?type=beat", window.location.href).toString()
                        });
                    });
                } else {
                    clearFeedbackNode(stripeWarning);
                }
            }

            if (submitButton) {
                submitButton.disabled = !valid;
                submitButton.classList.toggle("button-disabled", !valid);
            }
        }

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFeedbackNode(feedback);
            clearFeedbackNode(success);

            const errors = validateBeatUploadForm(form, uploadState.beatStripeConnected, artworkStateFor("beat"));
            if (errors.length) {
                setFeedbackNode(feedback, errors.map((item) => `• ${item}`).join("\n"), "error");
                return;
            }

            try {
                const isEditing = Boolean(uploadState.edit.beatId);
                if (submitButton) submitButton.textContent = isEditing ? "Saving..." : "Uploading...";
                const formData = new FormData();
                formData.set("title", form.title.value.trim());
                formData.set("description", form.description.value.trim());
                formData.set("bpm", form.bpm.value.trim());
                formData.set("key", form.key.value.trim());
                formData.set("tags", form.tags.value.trim());
                formData.set("producerCredits", JSON.stringify(selectedProducerCredits));
                formData.set("publicLicenseState", publicStateInput.value);
                formData.set("basicLicenseEnabled", String(basicToggle.checked));
                formData.set("premiumLicenseEnabled", String(premiumToggle.checked));
                formData.set("exclusiveLicenseEnabled", String(exclusiveToggle.checked));
                formData.set("basicLicensePrice", form.basicLicensePrice.value.trim());
                formData.set("premiumLicensePrice", form.premiumLicensePrice.value.trim());
                formData.set("exclusiveLicensePrice", form.exclusiveLicensePrice.value.trim());
                formData.set("exclusiveIncludesStems", String(stemsToggle.checked));
                if (uploadState.edit.beatId) formData.set("editId", uploadState.edit.beatId);
                if (form.mp3File.files[0]) formData.set("mp3File", form.mp3File.files[0]);
                if (form.wavFile.files[0]) formData.set("wavFile", form.wavFile.files[0]);
                if (form.stemsFile.files[0]) formData.set("stemsFile", form.stemsFile.files[0]);
                if (artworkStateFor("beat")?.croppedFile) formData.set("artworkFile", artworkStateFor("beat").croppedFile);

                const result = await invokeUploadFunction("web-upload-beat", formData);
                const beatId = result.beatId || uploadState.edit.beatId;
                const beatTitle = form.title.value.trim();
                const destination = buildPublicContentShareURL("beat", { id: beatId, title: beatTitle }, beatTitle, { absolute: false });
                storePostUploadSharePrompt({
                    id: beatId,
                    entityType: "beat",
                    title: beatTitle
                });
                window.location.href = destination;
            } catch (error) {
                setFeedbackNode(feedback, normalizeAuthError(error, "Beat upload failed."), "error");
                if (submitButton) submitButton.textContent = uploadState.edit.beatId ? "Save Beat" : "Upload Beat";
            }
        });

        if (keyInput.value) {
            const parts = keyInput.value.split(" ");
            if (musicalNotes.includes(parts[0])) keyNoteSelect.value = parts[0];
            if (parts[1]) keyModeSelect.value = parts.slice(1).join(" ");
        }

        syncBeatKeyField();
        syncBeatTagsField();
        renderBeatProducerCredits();
        updateBeatUploadState();
        loadBeatForEditing(form, selectedTags, selectedProducerCredits, syncBeatTagsField, renderBeatProducerCredits, syncBeatKeyField, refreshRequirements, updateBeatUploadState).catch((error) => {
            setFeedbackNode(feedback, normalizeAuthError(error, "We couldn’t load this beat right now."), "error");
        });
    }

    function setupSongUploadPage() {
        const form = document.querySelector("#song-upload-form");
        if (!form) return;
        setUploadEditingUI("song", Boolean(getUploadEditId("song")));

        const artworkInput = form.querySelector("#song-artwork");
        const artworkAdjust = form.querySelector("#song-artwork-adjust");
        const feedback = form.querySelector("[data-upload-feedback]");
        const success = form.querySelector("[data-upload-success]");
        const submitButton = form.querySelector("[data-submit-button]");
        const producerSearch = form.querySelector("#song-producer-search");
        const producerResults = form.querySelector("#song-producer-results");
        const producerTags = form.querySelector("#song-producer-tags");
        const addManualButton = form.querySelector("#song-add-manual-producer");
        const producerLockMessage = form.querySelector("#song-producer-lock-message");

        const uploadContext = getSongUploadContext();
        const selectedProducerTags = [...uploadContext.producerTags];
        const producerTagsLocked = uploadContext.lockProducerTags;

        const renderProducerTags = () => {
            producerTags.innerHTML = selectedProducerTags.map((tag, index) => `
                <span class="tag-chip">
                    <span>${escapeHtml(tag.username ? `@${tag.username}` : tag.display_name)}</span>
                    ${producerTagsLocked ? "" : `<button type="button" data-remove-producer="${index}">×</button>`}
                </span>
            `).join("");

            if (!producerTagsLocked) {
                producerTags.querySelectorAll("[data-remove-producer]").forEach((button) => {
                    button.addEventListener("click", () => {
                        selectedProducerTags.splice(Number(button.dataset.removeProducer), 1);
                        renderProducerTags();
                    });
                });
            }
        };

        if (uploadContext.title) form.title.value = uploadContext.title;
        if (uploadContext.album) form.album.value = uploadContext.album;
        if (uploadContext.description) form.description.value = uploadContext.description;
        if (producerTagsLocked) {
            producerSearch.disabled = true;
            addManualButton.disabled = true;
            producerLockMessage.hidden = false;
        }
        renderProducerTags();
        const updateSongUploadState = () => {
            const valid = validateSongUploadForm(form, artworkStateFor("song")).length === 0;
            if (submitButton) {
                submitButton.disabled = !valid;
                submitButton.classList.toggle("button-disabled", !valid);
            }
        };

        form.querySelector("#song-audio")?.addEventListener("change", (event) => updateFileName(event.currentTarget));

        artworkInput.addEventListener("change", () => {
            clearArtworkSelection("song", form);
            updateFileName(artworkInput);
            const file = artworkInput.files?.[0];
            if (file) {
                openArtworkCropper(file, "song");
            }
        });
        artworkAdjust?.addEventListener("click", () => {
            const currentFile = artworkStateFor("song")?.sourceFile || artworkInput.files?.[0];
            if (currentFile) {
                openArtworkCropper(currentFile, "song");
            }
        });
        form.querySelectorAll("input, textarea").forEach((node) => {
            node.addEventListener("input", updateSongUploadState);
            node.addEventListener("change", updateSongUploadState);
        });

        producerSearch.addEventListener("input", async () => {
            if (producerTagsLocked) return;

            const query = producerSearch.value.trim();
            const token = ++uploadState.songProducerSearchToken;

            if (query.length < 2) {
                producerResults.innerHTML = "";
                return;
            }

            try {
                const { data, error } = await getSupabase()
                    .from("profiles")
                    .select("id, display_name, username, profile_image_url")
                    .or(`display_name.ilike.%${query}%,username.ilike.%${query}%`)
                    .limit(8);

                if (token !== uploadState.songProducerSearchToken) return;
                if (error) throw error;

                producerResults.innerHTML = (data || []).filter((profile) => {
                    return !selectedProducerTags.some((tag) => tag.user_id === profile.id);
                }).map((profile) => `
                    <button class="producer-result" type="button" data-producer-id="${escapeHtml(profile.id)}" data-producer-name="${escapeHtml(profile.display_name || "")}" data-producer-username="${escapeHtml(profile.username || "")}">
                        <img src="${escapeHtml(profile.profile_image_url || "ProfilePage.png")}" alt="${escapeHtml(profile.display_name || profile.username || "Producer")}">
                        <div>
                            <strong>${escapeHtml(profile.display_name || profile.username || "Producer")}</strong>
                            <div class="field-help">${profile.username ? `@${escapeHtml(profile.username)}` : "Producer account"}</div>
                        </div>
                        <span class="chip">Add</span>
                    </button>
                `).join("");

                producerResults.querySelectorAll("[data-producer-id]").forEach((button) => {
                    button.addEventListener("click", () => {
                        selectedProducerTags.push({
                            user_id: button.dataset.producerId,
                            display_name: button.dataset.producerName || button.dataset.producerUsername,
                            username: button.dataset.producerUsername || null
                        });
                        producerSearch.value = "";
                        producerResults.innerHTML = "";
                        renderProducerTags();
                    });
                });
            } catch {
                producerResults.innerHTML = "";
            }
        });

        addManualButton.addEventListener("click", () => {
            if (producerTagsLocked) return;

            const name = producerSearch.value.trim();
            if (!name) return;
            if (selectedProducerTags.some((tag) => tag.display_name.toLowerCase() === name.toLowerCase())) return;
            selectedProducerTags.push({
                user_id: null,
                display_name: name,
                username: null
            });
            producerSearch.value = "";
            producerResults.innerHTML = "";
            renderProducerTags();
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFeedbackNode(feedback);
            clearFeedbackNode(success);

            const errors = validateSongUploadForm(form, artworkStateFor("song"));
            if (errors.length) {
                setFeedbackNode(feedback, errors.map((item) => `• ${item}`).join("\n"), "error");
                return;
            }

            try {
                const isEditing = Boolean(uploadState.edit.songId);
                if (submitButton) submitButton.textContent = isEditing ? "Saving..." : "Uploading...";
                const formData = new FormData();
                formData.set("title", form.title.value.trim());
                formData.set("album", form.album.value.trim());
                formData.set("featuredArtists", form.featuredArtists.value.trim());
                formData.set("tags", form.tags.value.trim());
                formData.set("lyrics", form.lyrics.value.trim());
                formData.set("isExplicit", String(form.isExplicit.checked));
                formData.set("producerTags", JSON.stringify(selectedProducerTags));
                if (uploadState.edit.songId) formData.set("editId", uploadState.edit.songId);
                if (form.audioFile.files[0]) formData.set("audioFile", form.audioFile.files[0]);
                if (artworkStateFor("song")?.croppedFile) formData.set("artworkFile", artworkStateFor("song").croppedFile);

                const result = await invokeUploadFunction("web-upload-song", formData);
                const songId = result.songId || uploadState.edit.songId;
                const songTitle = form.title.value.trim();
                const destination = buildPublicContentShareURL("song", { id: songId, title: songTitle }, songTitle, { absolute: false });
                storePostUploadSharePrompt({
                    id: songId,
                    entityType: "song",
                    title: songTitle
                });
                window.location.href = destination;
            } catch (error) {
                setFeedbackNode(feedback, normalizeAuthError(error, "Song upload failed."), "error");
                if (submitButton) submitButton.textContent = uploadState.edit.songId ? "Save Song" : "Upload Song";
            }
        });

        updateSongUploadState();
        loadSongForEditing(form, selectedProducerTags, renderProducerTags, updateSongUploadState).catch((error) => {
            setFeedbackNode(feedback, normalizeAuthError(error, "We couldn’t load this song right now."), "error");
        });
    }

    async function invokeUploadFunction(functionName, formData) {
        const session = state.session || (await getSupabase().auth.getSession()).data.session;
        if (!session?.access_token) {
            throw new Error("You must be logged in to upload.");
        }

        let response;
        try {
            response = await fetch(`${window.SoundSwipeSupabaseConfig.url}/functions/v1/${functionName}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.access_token}`
                },
                body: formData
            });
        } catch (error) {
            if (error instanceof TypeError) {
                throw new Error("We couldn’t complete that request right now. Please try again in a moment.");
            }
            throw error;
        }

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.error(`Upload function ${functionName} failed`, {
                status: response.status,
                payload
            });
            throw new Error(payload.error || `Upload failed with status ${response.status}`);
        }
        return payload;
    }

    async function invokeAuthedJSONFunction(functionName, body = {}, pathSuffix = "") {
        const session = state.session || (await getSupabase().auth.getSession()).data.session;
        if (!session?.access_token) {
            throw new Error("You must be logged in to continue.");
        }

        let response;
        try {
            response = await fetch(`${window.SoundSwipeSupabaseConfig.url}/functions/v1/${functionName}${pathSuffix || ""}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body || {})
            });
        } catch (error) {
            if (error instanceof TypeError) {
                throw new Error("We couldn’t complete that request right now. Please try again in a moment.");
            }
            throw error;
        }

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.error(`JSON function ${functionName} failed`, {
                status: response.status,
                payload
            });
            throw new Error(payload.error || `Request failed with status ${response.status}`);
        }

        return payload;
    }

    async function refreshBeatStripeStatus() {
        if (!hasSupabase() || !isLoggedIn()) return false;

        try {
            const stripeStatus = await invokeAuthedJSONFunction("stripe-connect", {}, "/status");
            const status = stripeStatus?.status || null;
            return Boolean(status?.stripe_connect_id && status?.payout_enabled && status?.onboarding_complete);
        } catch (error) {
            console.error("Stripe status refresh failed", error);
        }

        const { data, error } = await getSupabase()
            .from("producer_payments")
            .select("*")
            .eq("user_id", state.authUser.id)
            .maybeSingle();

        if (error || !data) return false;
        const environment = currentStripeEnvironment();
        const hasEnvironmentColumns = Object.prototype.hasOwnProperty.call(data, `stripe_connect_id_${environment}`)
            || Object.prototype.hasOwnProperty.call(data, `payout_enabled_${environment}`)
            || Object.prototype.hasOwnProperty.call(data, `onboarding_complete_${environment}`);
        const allowLegacyFallback = !hasEnvironmentColumns && environment === "test";
        const connectId = data[`stripe_connect_id_${environment}`] || (allowLegacyFallback ? data.stripe_connect_id : "");
        const payoutEnabled = data[`payout_enabled_${environment}`] ?? (allowLegacyFallback ? data.payout_enabled : false);
        const onboardingComplete = data[`onboarding_complete_${environment}`] ?? (allowLegacyFallback ? data.onboarding_complete : false);
        return Boolean(connectId && payoutEnabled && onboardingComplete);
    }

    function getSongUploadContext() {
        const params = new URLSearchParams(window.location.search);
        let producerTags = [];

        try {
            producerTags = JSON.parse(params.get("producerTags") || "[]");
        } catch {
            producerTags = [];
        }

        return {
            title: params.get("title") || "",
            album: params.get("album") || "",
            description: params.get("description") || "",
            producerTags: Array.isArray(producerTags) ? producerTags.map((tag) => ({
                user_id: tag?.user_id || tag?.userId || null,
                display_name: tag?.display_name || tag?.displayName || tag?.username || "",
                username: tag?.username || null
            })).filter((tag) => tag.display_name) : [],
            lockProducerTags: params.get("lockProducerTags") === "true"
        };
    }

    function getUploadEditId(type) {
        const params = new URLSearchParams(window.location.search);
        const editId = String(params.get("edit") || "").trim();
        if (!editId) return "";
        return type === "beat" || type === "song" ? editId : "";
    }

    function setUploadEditingUI(type, editing) {
        const heading = document.querySelector(".upload-shell h1");
        const lede = document.querySelector(".upload-shell .lede");
        const submitButton = document.querySelector("[data-submit-button]");
        const primaryAudioInput = document.querySelector(type === "beat" ? "#beat-mp3" : "#song-audio");
        if (type === "beat") {
            if (heading) heading.textContent = editing ? "Edit beat" : "Release a beat";
            if (lede) lede.textContent = editing ? "Update your beat details, files, and licensing." : "Upload your beat artwork, audio, and licensing details.";
            if (submitButton) submitButton.textContent = editing ? "Save Beat" : "Upload Beat";
        } else {
            if (heading) heading.textContent = editing ? "Edit song" : "Release a song";
            if (lede) lede.textContent = editing ? "Update your song details, files, and artwork." : "Upload your song artwork, audio, and release details.";
            if (submitButton) submitButton.textContent = editing ? "Save Song" : "Upload Song";
        }
        if (primaryAudioInput) {
            primaryAudioInput.required = !editing;
        }
    }

    function setPreviewFromURL(type, url) {
        const wrap = document.querySelector(`#${type}-artwork-preview-wrap`);
        const image = document.querySelector(`#${type}-artwork-preview`);
        if (!wrap || !image || !url) return;
        image.src = url;
        wrap.hidden = false;
        const nameLabel = document.querySelector(`[data-file-name="${type}-artwork"]`);
        if (nameLabel) {
            nameLabel.textContent = "Current artwork";
        }
    }

    async function loadBeatForEditing(form, selectedTags, selectedProducerCredits, syncBeatTagsField, renderBeatProducerCredits, syncBeatKeyField, refreshRequirements, updateBeatUploadState) {
        const editId = getUploadEditId("beat");
        uploadState.edit.beatId = editId;
        if (!editId || !hasSupabase() || !state.authUser?.id) return;

        setUploadEditingUI("beat", true);
        const beatSelect = "id, user_id, title, description, bpm, key, tags, additional_producers, public_license_state, basic_license_enabled, premium_license_enabled, exclusive_license_enabled, basic_license_price, premium_license_price, exclusive_license_price, exclusive_includes_stems, album_url, file_mp3_url, file_wav_url, stems_zip_url";
        const { data, error } = await executeBeatSelectWithFallback((selectClause) => {
            return getSupabase()
                .from("beats")
                .select(selectClause)
                .eq("id", editId)
                .eq("user_id", state.authUser.id)
                .limit(1)
                .maybeSingle();
        }, beatSelect);

        if (error || !data) {
            throw new Error("We couldn’t load this beat for editing.");
        }

        form.title.value = data.title || "";
        form.description.value = data.description || "";
        form.bpm.value = data.bpm || "";
        form.key.value = data.key || "";
        form.publicLicenseState.value = data.public_license_state || "free_for_non_profit";
        form.basicLicenseEnabled.checked = data.basic_license_enabled !== false;
        form.premiumLicenseEnabled.checked = Boolean(data.premium_license_enabled);
        form.exclusiveLicenseEnabled.checked = Boolean(data.exclusive_license_enabled);
        form.basicLicensePrice.value = data.basic_license_price ?? "";
        form.premiumLicensePrice.value = data.premium_license_price ?? "";
        form.exclusiveLicensePrice.value = data.exclusive_license_price ?? "";
        form.exclusiveIncludesStems.checked = Boolean(data.exclusive_includes_stems);
        form.dataset.hasExistingMp3 = data.file_mp3_url ? "true" : "false";
        form.dataset.hasExistingWav = data.file_wav_url ? "true" : "false";
        form.dataset.hasExistingStems = data.stems_zip_url ? "true" : "false";

        form.querySelectorAll("[data-license-state]").forEach((item) => {
            item.classList.toggle("active", item.dataset.licenseState === form.publicLicenseState.value);
        });

        selectedTags.length = 0;
        if (Array.isArray(data.tags)) {
            selectedTags.push(...data.tags.map((tag) => String(tag || "").trim()).filter(Boolean));
        }
        selectedProducerCredits.length = 0;
        const existingProducerCredits = parseProducerCreditEntries(data.additional_producers);
        if (existingProducerCredits.length) {
            selectedProducerCredits.push(...existingProducerCredits.map((credit) => ({
                user_id: credit?.user_id || credit?.userId || null,
                username: credit?.username || null,
                display_name: producerCreditDisplayName(credit),
                profile_image_url: credit?.profile_image_url || credit?.profileImageUrl || null
            })).filter((credit) => credit.display_name));
        }

        const keyParts = String(data.key || "").split(" ");
        const noteSelect = form.querySelector("#beat-key-note");
        const modeSelect = form.querySelector("#beat-key-mode");
        if (noteSelect && keyParts[0]) noteSelect.value = keyParts[0];
        if (modeSelect && keyParts[1]) modeSelect.value = keyParts.slice(1).join(" ");

        syncBeatTagsField();
        renderBeatProducerCredits();
        syncBeatKeyField();
        refreshRequirements();
        if (data.album_url) {
            setPreviewFromURL("beat", await resolveSignedBunnyURL(data.album_url));
        }

        const mp3Label = form.querySelector('[data-file-name="beat-mp3"]');
        const wavLabel = form.querySelector('[data-file-name="beat-wav"]');
        const stemsLabel = form.querySelector('[data-file-name="beat-stems"]');
        if (mp3Label && data.file_mp3_url) mp3Label.textContent = "Current MP3 retained";
        if (wavLabel && data.file_wav_url) wavLabel.textContent = "Current WAV retained";
        if (stemsLabel && data.stems_zip_url) stemsLabel.textContent = "Current stems retained";
        updateBeatUploadState();
    }

    async function loadSongForEditing(form, selectedProducerTags, renderProducerTags, updateSongUploadState) {
        const editId = getUploadEditId("song");
        uploadState.edit.songId = editId;
        if (!editId || !hasSupabase() || !state.authUser?.id) return;

        setUploadEditingUI("song", true);
        const { data, error } = await getSupabase()
            .from("songs")
            .select("id, user_id, title, album, featured_artists, tags, lyrics, is_explicit, producer_tags, album_art, export_file_url")
            .eq("id", editId)
            .eq("user_id", state.authUser.id)
            .limit(1)
            .maybeSingle();

        if (error || !data) {
            throw new Error("We couldn’t load this song for editing.");
        }

        form.title.value = data.title || "";
        form.album.value = data.album || "";
        form.featuredArtists.value = Array.isArray(data.featured_artists) ? data.featured_artists.join(", ") : "";
        form.tags.value = Array.isArray(data.tags) ? data.tags.join(", ") : "";
        form.lyrics.value = data.lyrics || "";
        form.isExplicit.checked = Boolean(data.is_explicit);
        form.dataset.hasExistingAudio = data.export_file_url ? "true" : "false";

        selectedProducerTags.length = 0;
        if (Array.isArray(data.producer_tags)) {
            selectedProducerTags.push(...data.producer_tags.map((tag) => ({
                user_id: tag?.user_id || tag?.userId || null,
                display_name: tag?.display_name || tag?.displayName || tag?.username || "",
                username: tag?.username || null
            })).filter((tag) => tag.display_name));
        }
        renderProducerTags();

        if (data.album_art) {
            setPreviewFromURL("song", await resolveSignedBunnyURL(data.album_art));
        }
        const audioLabel = form.querySelector('[data-file-name="song-audio"]');
        if (audioLabel && data.export_file_url) audioLabel.textContent = "Current audio retained";
        updateSongUploadState();
    }

    function updateFileName(input) {
        if (!input?.id) return;
        const label = document.querySelector(`[data-file-name="${input.id}"]`);
        if (!label) return;
        const file = input.files?.[0];
        label.textContent = file ? file.name : "No file selected";
    }

    function clearFileNameDisplays(form) {
        form?.querySelectorAll("[data-file-name]").forEach((node) => {
            node.textContent = node.dataset.fileName.includes("artwork") ? "Optional" : "No file selected";
        });
    }

    function previewCroppedArtwork(type, file) {
        const wrap = document.querySelector(`#${type}-artwork-preview-wrap`);
        const image = document.querySelector(`#${type}-artwork-preview`);
        previewImageFile(file, wrap, image);
        const nameLabel = document.querySelector(`[data-file-name="${type}-artwork"]`);
        if (nameLabel) {
            nameLabel.textContent = file.name;
        }
    }

    function artworkStateFor(type) {
        return uploadState.artwork[type];
    }

    function clearArtworkSelection(type, form) {
        const currentArtworkState = artworkStateFor(type);
        if (!currentArtworkState) return;
        currentArtworkState.sourceFile = null;
        currentArtworkState.croppedFile = null;
        currentArtworkState.crop = null;

        const previewWrap = form?.querySelector(`#${type}-artwork-preview-wrap`);
        const previewImage = form?.querySelector(`#${type}-artwork-preview`);
        if (previewWrap && previewImage) {
            previewImageFile(null, previewWrap, previewImage);
        }
    }

    function resetArtworkInputToCroppedFile(input, file) {
        if (!input || !(file instanceof File) || typeof DataTransfer === "undefined") return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
    }

    function notifyArtworkUpdated(type) {
        const input = document.querySelector(`#${type}-artwork`);
        if (input) {
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    function fileIdentityKey(file) {
        return file instanceof File ? `${file.name}:${file.size}:${file.lastModified}` : "";
    }

    function openProfileImageCropper(file, options = {}) {
        if (!(file instanceof File)) return;
        closeArtworkCropper();

        const modalMount = document.querySelector("[data-modals]");
        if (!modalMount) return;

        const modal = document.createElement("div");
        modal.className = "modal-backdrop open";
        modal.id = "artwork-crop-modal";
        modal.innerHTML = `
            <div class="modal-card artwork-crop-card artwork-crop-card--avatar">
                <div class="modal-header">
                    <div>
                        <h2>Crop Profile Photo</h2>
                        <p class="muted">Frame your photo so it fits perfectly inside the SoundSwipe avatar.</p>
                    </div>
                    <button class="icon-button" id="artwork-crop-close" type="button" aria-label="Close">×</button>
                </div>
                <div class="artwork-crop-stage">
                    <div class="artwork-crop-mask artwork-crop-mask--avatar">
                        <div class="artwork-crop-instructions">
                            <span>Drag to position</span>
                            <span>Scroll or use the slider to zoom</span>
                        </div>
                        <div class="artwork-crop-frame artwork-crop-frame--avatar" id="artwork-crop-frame">
                            <img id="artwork-crop-image" alt="Profile photo crop preview">
                        </div>
                    </div>
                </div>
                <div class="artwork-crop-controls">
                    <label class="field">
                        <span class="field-help">Zoom</span>
                        <div class="artwork-crop-zoom-row">
                            <input id="artwork-crop-zoom" type="range" min="100" max="500" step="1" value="100">
                            <strong id="artwork-crop-zoom-value">100%</strong>
                        </div>
                    </label>
                </div>
                <div class="upload-actions">
                    <button class="button-quiet" id="artwork-crop-reset" type="button">Reset</button>
                    <button class="button-quiet" id="artwork-crop-cancel" type="button">Cancel</button>
                    <button class="button" id="artwork-crop-save" type="button">Use Photo</button>
                </div>
            </div>
        `;
        modalMount.appendChild(modal);

        const frame = modal.querySelector("#artwork-crop-frame");
        const image = modal.querySelector("#artwork-crop-image");
        const zoom = modal.querySelector("#artwork-crop-zoom");
        const zoomValue = modal.querySelector("#artwork-crop-zoom-value");
        const resetButton = modal.querySelector("#artwork-crop-reset");
        const closeButtons = modal.querySelectorAll("#artwork-crop-close, #artwork-crop-cancel");

        const state = {
            file,
            imageURL: URL.createObjectURL(file),
            frameWidth: 0,
            frameHeight: 0,
            scale: 1,
            minScale: 1,
            maxScale: 1,
            x: 0,
            y: 0,
            dragOriginX: 0,
            dragOriginY: 0,
            startX: 0,
            startY: 0,
            naturalWidth: 0,
            naturalHeight: 0
        };

        uploadState.cropper = state;
        image.src = state.imageURL;

        const updateZoomValue = () => {
            if (zoomValue) {
                zoomValue.textContent = `${Math.round((state.scale / state.minScale) * 100)}%`;
            }
        };

        const centerImage = () => {
            const renderedWidth = state.naturalWidth * state.scale;
            const renderedHeight = state.naturalHeight * state.scale;
            state.x = (state.frameWidth - renderedWidth) / 2;
            state.y = (state.frameHeight - renderedHeight) / 2;
        };

        const clampPosition = () => {
            const renderedWidth = state.naturalWidth * state.scale;
            const renderedHeight = state.naturalHeight * state.scale;
            const minX = Math.min(0, state.frameWidth - renderedWidth);
            const minY = Math.min(0, state.frameHeight - renderedHeight);
            state.x = Math.min(0, Math.max(minX, state.x));
            state.y = Math.min(0, Math.max(minY, state.y));
        };

        const applyTransform = () => {
            const renderedWidth = state.naturalWidth * state.scale;
            const renderedHeight = state.naturalHeight * state.scale;
            image.style.width = `${renderedWidth}px`;
            image.style.height = `${renderedHeight}px`;
            image.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
            updateZoomValue();
        };

        const setScaleFromSlider = (sliderValue, originX = state.frameWidth / 2, originY = state.frameHeight / 2) => {
            const nextScale = state.minScale * (Number(sliderValue) / 100);
            const clampedScale = Math.min(state.maxScale, Math.max(state.minScale, nextScale));
            const scaleRatio = clampedScale / state.scale;
            state.x = originX - ((originX - state.x) * scaleRatio);
            state.y = originY - ((originY - state.y) * scaleRatio);
            state.scale = clampedScale;
            clampPosition();
            applyTransform();
        };

        image.addEventListener("load", () => {
            state.naturalWidth = image.naturalWidth;
            state.naturalHeight = image.naturalHeight;
            const frameRect = frame.getBoundingClientRect();
            state.frameWidth = frameRect.width;
            state.frameHeight = frameRect.height;
            state.minScale = Math.max(state.frameWidth / state.naturalWidth, state.frameHeight / state.naturalHeight);
            state.maxScale = state.minScale * 5;
            state.scale = state.minScale;
            centerImage();

            const savedCrop = editProfileState.crop;
            if (savedCrop?.sourceKey === fileIdentityKey(file)) {
                state.scale = Math.min(state.maxScale, Math.max(state.minScale, savedCrop.scale || state.minScale));
                state.x = Number.isFinite(savedCrop.x) ? savedCrop.x : state.x;
                state.y = Number.isFinite(savedCrop.y) ? savedCrop.y : state.y;
                clampPosition();
            }

            zoom.value = String(Math.round((state.scale / state.minScale) * 100));
            applyTransform();
        });

        frame.addEventListener("pointerdown", (event) => {
            frame.setPointerCapture(event.pointerId);
            state.dragOriginX = event.clientX;
            state.dragOriginY = event.clientY;
            state.startX = state.x;
            state.startY = state.y;
        });

        frame.addEventListener("pointermove", (event) => {
            if (!frame.hasPointerCapture(event.pointerId)) return;
            state.x = state.startX + (event.clientX - state.dragOriginX);
            state.y = state.startY + (event.clientY - state.dragOriginY);
            clampPosition();
            applyTransform();
        });

        const endDrag = (event) => {
            if (frame.hasPointerCapture(event.pointerId)) {
                frame.releasePointerCapture(event.pointerId);
            }
            clampPosition();
            applyTransform();
        };

        frame.addEventListener("pointerup", endDrag);
        frame.addEventListener("pointercancel", endDrag);
        frame.addEventListener("wheel", (event) => {
            event.preventDefault();
            const rect = frame.getBoundingClientRect();
            const nextValue = Math.min(
                Number(zoom.max),
                Math.max(Number(zoom.min), Number(zoom.value) - (event.deltaY * 0.08))
            );
            zoom.value = String(nextValue);
            setScaleFromSlider(nextValue, event.clientX - rect.left, event.clientY - rect.top);
        }, { passive: false });

        zoom.addEventListener("input", () => {
            setScaleFromSlider(zoom.value);
        });

        resetButton?.addEventListener("click", () => {
            state.scale = state.minScale;
            centerImage();
            zoom.value = "100";
            applyTransform();
        });

        closeButtons.forEach((button) => button.addEventListener("click", () => {
            options.onPreviewChange?.(editProfileState.selectedImageFile || options.fallbackURL || "");
            closeArtworkCropper();
        }));

        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                options.onPreviewChange?.(editProfileState.selectedImageFile || options.fallbackURL || "");
                closeArtworkCropper();
            }
        });

        modal.querySelector("#artwork-crop-save")?.addEventListener("click", async () => {
            const croppedFile = await createCroppedAvatarFile(state, frame);
            if (!croppedFile) return;

            editProfileState.sourceImageFile = file;
            editProfileState.selectedImageFile = croppedFile;
            editProfileState.crop = {
                sourceKey: fileIdentityKey(file),
                scale: state.scale,
                x: state.x,
                y: state.y
            };
            resetArtworkInputToCroppedFile(options.input, croppedFile);
            options.onPreviewChange?.(croppedFile);
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    closeArtworkCropper();
                });
            });
        });
    }

    function openArtworkCropper(file, type) {
        if (!(file instanceof File)) return;
        closeArtworkCropper();

        const modalMount = document.querySelector("[data-modals]");
        if (!modalMount) return;

        const modal = document.createElement("div");
        modal.className = "modal-backdrop open";
        modal.id = "artwork-crop-modal";
        modal.innerHTML = `
            <div class="modal-card artwork-crop-card">
                <div class="modal-header">
                    <div>
                        <h2>Crop Artwork</h2>
                        <p class="muted">Position your artwork inside the SoundSwipe card frame.</p>
                    </div>
                    <button class="icon-button" id="artwork-crop-close" type="button" aria-label="Close">×</button>
                </div>
                <div class="artwork-crop-stage">
                    <div class="artwork-crop-mask">
                        <div class="artwork-crop-instructions">
                            <span>Drag to position</span>
                            <span>Scroll or use the slider to zoom</span>
                        </div>
                        <div class="artwork-crop-frame" id="artwork-crop-frame">
                            <img id="artwork-crop-image" alt="Artwork crop preview">
                        </div>
                    </div>
                </div>
                <div class="artwork-crop-controls">
                    <label class="field">
                        <span class="field-help">Zoom</span>
                        <div class="artwork-crop-zoom-row">
                            <input id="artwork-crop-zoom" type="range" min="100" max="500" step="1" value="100">
                            <strong id="artwork-crop-zoom-value">100%</strong>
                        </div>
                    </label>
                </div>
                <div class="upload-actions">
                    <button class="button-quiet" id="artwork-crop-reset" type="button">Reset</button>
                    <button class="button-quiet" id="artwork-crop-cancel" type="button">Cancel</button>
                    <button class="button" id="artwork-crop-save" type="button">Use Crop</button>
                </div>
            </div>
        `;
        modalMount.appendChild(modal);

        const frame = modal.querySelector("#artwork-crop-frame");
        const image = modal.querySelector("#artwork-crop-image");
        const zoom = modal.querySelector("#artwork-crop-zoom");
        const zoomValue = modal.querySelector("#artwork-crop-zoom-value");
        const resetButton = modal.querySelector("#artwork-crop-reset");
        const closeButtons = modal.querySelectorAll("#artwork-crop-close, #artwork-crop-cancel");
        const currentArtworkState = artworkStateFor(type);

        const state = {
            type,
            file,
            imageURL: URL.createObjectURL(file),
            frameWidth: 0,
            frameHeight: 0,
            scale: 1,
            minScale: 1,
            maxScale: 1,
            x: 0,
            y: 0,
            dragOriginX: 0,
            dragOriginY: 0,
            startX: 0,
            startY: 0,
            naturalWidth: 0,
            naturalHeight: 0
        };

        uploadState.cropper = state;
        image.src = state.imageURL;

        const updateZoomValue = () => {
            if (zoomValue) {
                zoomValue.textContent = `${Math.round((state.scale / state.minScale) * 100)}%`;
            }
        };

        const centerImage = () => {
            const renderedWidth = state.naturalWidth * state.scale;
            const renderedHeight = state.naturalHeight * state.scale;
            state.x = (state.frameWidth - renderedWidth) / 2;
            state.y = (state.frameHeight - renderedHeight) / 2;
        };

        const clampPosition = () => {
            const renderedWidth = state.naturalWidth * state.scale;
            const renderedHeight = state.naturalHeight * state.scale;
            const minX = Math.min(0, state.frameWidth - renderedWidth);
            const minY = Math.min(0, state.frameHeight - renderedHeight);
            state.x = Math.min(0, Math.max(minX, state.x));
            state.y = Math.min(0, Math.max(minY, state.y));
        };

        const applyTransform = () => {
            const renderedWidth = state.naturalWidth * state.scale;
            const renderedHeight = state.naturalHeight * state.scale;
            image.style.width = `${renderedWidth}px`;
            image.style.height = `${renderedHeight}px`;
            image.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
            updateZoomValue();
        };

        const setScaleFromSlider = (sliderValue, originX = state.frameWidth / 2, originY = state.frameHeight / 2) => {
            const nextScale = state.minScale * (Number(sliderValue) / 100);
            const clampedScale = Math.min(state.maxScale, Math.max(state.minScale, nextScale));
            const scaleRatio = clampedScale / state.scale;
            state.x = originX - ((originX - state.x) * scaleRatio);
            state.y = originY - ((originY - state.y) * scaleRatio);
            state.scale = clampedScale;
            clampPosition();
            applyTransform();
        };

        image.addEventListener("load", () => {
            state.naturalWidth = image.naturalWidth;
            state.naturalHeight = image.naturalHeight;
            const frameRect = frame.getBoundingClientRect();
            state.frameWidth = frameRect.width;
            state.frameHeight = frameRect.height;
            state.minScale = Math.max(state.frameWidth / state.naturalWidth, state.frameHeight / state.naturalHeight);
            state.maxScale = state.minScale * 5;
            state.scale = state.minScale;
            centerImage();

            const savedCrop = currentArtworkState?.crop;
            if (savedCrop?.sourceKey === `${file.name}:${file.size}:${file.lastModified}`) {
                state.scale = Math.min(state.maxScale, Math.max(state.minScale, savedCrop.scale || state.minScale));
                state.x = Number.isFinite(savedCrop.x) ? savedCrop.x : state.x;
                state.y = Number.isFinite(savedCrop.y) ? savedCrop.y : state.y;
                clampPosition();
            }

            zoom.value = String(Math.round((state.scale / state.minScale) * 100));
            applyTransform();
        });

        frame.addEventListener("pointerdown", (event) => {
            frame.setPointerCapture(event.pointerId);
            state.dragOriginX = event.clientX;
            state.dragOriginY = event.clientY;
            state.startX = state.x;
            state.startY = state.y;
        });

        frame.addEventListener("pointermove", (event) => {
            if (!frame.hasPointerCapture(event.pointerId)) return;
            state.x = state.startX + (event.clientX - state.dragOriginX);
            state.y = state.startY + (event.clientY - state.dragOriginY);
            clampPosition();
            applyTransform();
        });

        const endDrag = (event) => {
            if (frame.hasPointerCapture(event.pointerId)) {
                frame.releasePointerCapture(event.pointerId);
            }
            clampPosition();
            applyTransform();
        };

        frame.addEventListener("pointerup", endDrag);
        frame.addEventListener("pointercancel", endDrag);
        frame.addEventListener("wheel", (event) => {
            event.preventDefault();
            const rect = frame.getBoundingClientRect();
            const nextValue = Math.min(
                Number(zoom.max),
                Math.max(Number(zoom.min), Number(zoom.value) - (event.deltaY * 0.08))
            );
            zoom.value = String(nextValue);
            setScaleFromSlider(nextValue, event.clientX - rect.left, event.clientY - rect.top);
        }, { passive: false });

        zoom.addEventListener("input", () => {
            setScaleFromSlider(zoom.value);
        });
        resetButton?.addEventListener("click", () => {
            state.scale = state.minScale;
            centerImage();
            zoom.value = "100";
            applyTransform();
        });

        closeButtons.forEach((button) => button.addEventListener("click", closeArtworkCropper));
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeArtworkCropper();
        });

        modal.querySelector("#artwork-crop-save")?.addEventListener("click", async () => {
            const croppedFile = await createCroppedArtworkFile(state, frame);
            if (!croppedFile) return;

            currentArtworkState.sourceFile = file;
            currentArtworkState.croppedFile = croppedFile;
            currentArtworkState.crop = {
                sourceKey: `${file.name}:${file.size}:${file.lastModified}`,
                scale: state.scale,
                x: state.x,
                y: state.y
            };
            resetArtworkInputToCroppedFile(document.querySelector(`#${type}-artwork`), croppedFile);
            previewCroppedArtwork(type, croppedFile);
            notifyArtworkUpdated(type);
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    closeArtworkCropper();
                });
            });
        });
    }

    function openBeatLicenseHelpModal() {
        const modalMount = document.querySelector("[data-modals]");
        if (!modalMount) return;

        modalMount.querySelector("#beat-license-help-modal")?.remove();

        const modal = document.createElement("div");
        modal.className = "modal-backdrop open";
        modal.id = "beat-license-help-modal";
        modal.innerHTML = `
            <div class="modal-card license-help-modal" role="dialog" aria-modal="true" aria-labelledby="beat-license-help-title">
                <div class="modal-header">
                    <div>
                        <h2 id="beat-license-help-title">Beat License Options</h2>
                        <p class="muted">Choose what artists can do before they buy a paid license.</p>
                    </div>
                    <button class="icon-button" type="button" data-close-license-help aria-label="Close">×</button>
                </div>
                <div class="license-help-grid">
                    <article class="license-help-card license-help-card--free">
                        <strong>Free for Non-Profit</strong>
                        <ul>
                            <li>Users can record on the beat.</li>
                            <li>Users can export MP3 and publish in-app.</li>
                            <li>Commercial release still requires a paid license.</li>
                        </ul>
                    </article>
                    <article class="license-help-card license-help-card--required">
                        <strong>License Required</strong>
                        <ul>
                            <li>Users can record and save the project.</li>
                            <li>Export requires a license purchase first.</li>
                            <li>In-app publishing requires a license purchase first.</li>
                        </ul>
                    </article>
                </div>
            </div>
        `;

        modalMount.appendChild(modal);

        const close = () => modal.remove();
        modal.addEventListener("click", (event) => {
            if (event.target === modal) close();
        });
        modal.querySelector("[data-close-license-help]")?.addEventListener("click", close);
    }

    function openBeatTierHelpModal(tierKey) {
        const modalMount = document.querySelector("[data-modals]");
        if (!modalMount) return;

        const tierCopy = {
            basic: {
                title: "Basic License",
                subtitle: "Good for smaller releases and demos.",
                bullets: [
                    "MP3 file included",
                    "Up to 5,000 sales or downloads",
                    "Up to 100,000 streams",
                    "1 music video",
                    "Non-exclusive"
                ]
            },
            premium: {
                title: "Premium License",
                subtitle: "For bigger releases that need higher quality audio.",
                bullets: [
                    "MP3 + WAV included",
                    "Higher sales and streaming ceiling than Basic",
                    "Multiple monetized releases",
                    "Music video use included",
                    "Non-exclusive"
                ]
            },
            exclusive: {
                title: "Exclusive License",
                subtitle: "Best when the buyer wants the most complete rights package.",
                bullets: [
                    "MP3 + WAV included",
                    "Optional stems if enabled",
                    "Beat removed from sale after purchase",
                    "Highest release flexibility",
                    "Exclusive to one buyer"
                ]
            }
        }[tierKey] || null;

        if (!tierCopy) return;
        modalMount.querySelector("#beat-tier-help-modal")?.remove();

        const modal = document.createElement("div");
        modal.className = "modal-backdrop open";
        modal.id = "beat-tier-help-modal";
        modal.innerHTML = `
            <div class="modal-card license-help-modal" role="dialog" aria-modal="true" aria-labelledby="beat-tier-help-title">
                <div class="modal-header">
                    <div>
                        <h2 id="beat-tier-help-title">${escapeHtml(tierCopy.title)}</h2>
                        <p class="muted">${escapeHtml(tierCopy.subtitle)}</p>
                    </div>
                    <button class="icon-button" type="button" data-close-license-help aria-label="Close">×</button>
                </div>
                <article class="license-help-card">
                    <strong>What the buyer gets</strong>
                    <ul>
                        ${tierCopy.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
                    </ul>
                </article>
            </div>
        `;

        modalMount.appendChild(modal);
        const close = () => modal.remove();
        modal.addEventListener("click", (event) => {
            if (event.target === modal) close();
        });
        modal.querySelector("[data-close-license-help]")?.addEventListener("click", close);
    }

    async function createCroppedArtworkFile(cropState, frame) {
        const canvas = document.createElement("canvas");
        const targetWidth = ARTWORK_EXPORT_WIDTH;
        const targetHeight = Math.round(targetWidth / ARTWORK_CARD_RATIO);
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const context = canvas.getContext("2d");
        if (!context) return null;

        const frameRect = frame.getBoundingClientRect();
        const renderedWidth = cropState.naturalWidth * cropState.scale;
        const renderedHeight = cropState.naturalHeight * cropState.scale;
        const sourceX = Math.max(0, (-cropState.x / renderedWidth) * cropState.naturalWidth);
        const sourceY = Math.max(0, (-cropState.y / renderedHeight) * cropState.naturalHeight);
        const sourceWidth = Math.min(cropState.naturalWidth - sourceX, (frameRect.width / renderedWidth) * cropState.naturalWidth);
        const sourceHeight = Math.min(cropState.naturalHeight - sourceY, (frameRect.height / renderedHeight) * cropState.naturalHeight);

        const imageBitmap = await createImageBitmap(cropState.file);
        context.drawImage(
            imageBitmap,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            canvas.width,
            canvas.height
        );

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
        if (!blob) return null;
        return new File([blob], cropState.file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }

    async function createCroppedAvatarFile(cropState, frame) {
        const canvas = document.createElement("canvas");
        const targetSize = 800;
        canvas.width = targetSize;
        canvas.height = targetSize;

        const context = canvas.getContext("2d");
        if (!context) return null;

        const frameRect = frame.getBoundingClientRect();
        const renderedWidth = cropState.naturalWidth * cropState.scale;
        const renderedHeight = cropState.naturalHeight * cropState.scale;
        const sourceX = Math.max(0, (-cropState.x / renderedWidth) * cropState.naturalWidth);
        const sourceY = Math.max(0, (-cropState.y / renderedHeight) * cropState.naturalHeight);
        const sourceWidth = Math.min(cropState.naturalWidth - sourceX, (frameRect.width / renderedWidth) * cropState.naturalWidth);
        const sourceHeight = Math.min(cropState.naturalHeight - sourceY, (frameRect.height / renderedHeight) * cropState.naturalHeight);

        const imageBitmap = await createImageBitmap(cropState.file);
        context.drawImage(
            imageBitmap,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            canvas.width,
            canvas.height
        );

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
        if (!blob) return null;
        return new File([blob], `${cropState.file.name.replace(/\.[^.]+$/, "") || "profile"}-avatar.jpg`, { type: "image/jpeg" });
    }

    function closeArtworkCropper() {
        const modal = document.querySelector("#artwork-crop-modal");
        if (modal) {
            modal.classList.remove("open");
            modal.setAttribute("aria-hidden", "true");
            modal.style.pointerEvents = "none";
            modal.style.opacity = "0";
            modal.style.visibility = "hidden";
            window.setTimeout(() => {
                if (modal.isConnected) modal.remove();
            }, 0);
        }
        if (uploadState.cropper?.imageURL) {
            URL.revokeObjectURL(uploadState.cropper.imageURL);
        }
        uploadState.cropper = null;
    }

    function validateBeatUploadForm(form, stripeConnected = false, artworkState = null) {
        const errors = [];
        const title = form.title.value.trim();
        const description = form.description.value.trim();
        const publicState = form.publicLicenseState.value;
        const basicEnabled = form.basicLicenseEnabled.checked;
        const premiumEnabled = form.premiumLicenseEnabled.checked;
        const exclusiveEnabled = form.exclusiveLicenseEnabled.checked;
        const exclusiveIncludesStems = form.exclusiveIncludesStems.checked;
        const bpm = String(form.bpm.value || "").trim();
        const key = String(form.key.value || "").trim();

        if (!title) errors.push("Title is required");
        else if (title.length < 3) errors.push("Title must be at least 3 characters");

        if (!description) errors.push("Description is required");
        else if (description.length < 10) errors.push("Description must be at least 10 characters");

        if (!bpm) {
            errors.push("BPM is required");
        } else {
            const bpmValue = Number(bpm);
            if (!Number.isFinite(bpmValue) || bpmValue <= 0 || bpmValue > 240) {
                errors.push("BPM must be a number between 1 and 240");
            }
        }

        if (!key) {
            errors.push("Key is required");
        }

        const hasExistingMp3 = form.dataset.hasExistingMp3 === "true";
        const hasExistingWav = form.dataset.hasExistingWav === "true";
        const hasExistingStems = form.dataset.hasExistingStems === "true";

        if (!form.mp3File.files[0] && !hasExistingMp3) errors.push("MP3 file is required");
        else if (form.mp3File.files[0] && form.mp3File.files[0].size > 20 * 1024 * 1024) errors.push("MP3 must be 20MB or smaller");

        if (publicState === "license_required" && !basicEnabled && !premiumEnabled && !exclusiveEnabled) {
            errors.push("Enable at least one paid license tier for License Required beats");
        }

        if (basicEnabled && !validPrice(form.basicLicensePrice.value)) errors.push("Basic License price must be between $0.99 and $9,999.99");
        if (premiumEnabled && !validPrice(form.premiumLicensePrice.value)) errors.push("Premium License price must be between $0.99 and $9,999.99");
        if (exclusiveEnabled && !validPrice(form.exclusiveLicensePrice.value)) errors.push("Exclusive License price must be between $0.99 and $9,999.99");
        if ((basicEnabled || premiumEnabled || exclusiveEnabled) && !stripeConnected) errors.push("Connect Stripe to sell paid licenses");

        if ((premiumEnabled || exclusiveEnabled) && !form.wavFile.files[0] && !hasExistingWav) errors.push("WAV upload required for Premium or Exclusive tiers");
        if (form.wavFile.files[0] && form.wavFile.files[0].size > 100 * 1024 * 1024) errors.push("WAV must be 100MB or smaller");

        if (exclusiveEnabled && exclusiveIncludesStems && !form.stemsFile.files[0] && !hasExistingStems) errors.push("Stems archive required when Exclusive includes stems");
        if (form.stemsFile.files[0] && form.stemsFile.files[0].size > 250 * 1024 * 1024) errors.push("Stems archive must be 250MB or smaller");
        if (form.artworkFile.files[0] && form.artworkFile.files[0].size > 5 * 1024 * 1024) errors.push("Artwork must be 5MB or smaller");
        if (form.artworkFile.files[0] && !artworkState?.croppedFile) errors.push("Crop your artwork before uploading");

        return errors;
    }

    function validateSongUploadForm(form, artworkState = null) {
        const errors = [];
        const title = form.title.value.trim();
        const audio = form.audioFile.files[0];
        const hasExistingAudio = form.dataset.hasExistingAudio === "true";

        if (!title) errors.push("Title is required");
        else if (title.length < 3) errors.push("Title must be at least 3 characters");

        if (!audio && !hasExistingAudio) errors.push("Audio file is required");
        else if (audio && audio.size > 100 * 1024 * 1024) errors.push("Audio file must be 100MB or smaller");

        if (form.artworkFile.files[0] && form.artworkFile.files[0].size > 5 * 1024 * 1024) {
            errors.push("Artwork must be 5MB or smaller");
        }
        if (form.artworkFile.files[0] && !artworkState?.croppedFile) {
            errors.push("Crop your artwork before uploading");
        }

        return errors;
    }

    function validPrice(value) {
        const numeric = Number.parseFloat(String(value).trim());
        return Number.isFinite(numeric) && numeric >= 0.99 && numeric <= 9999.99;
    }

    function previewImageFile(file, wrap, image) {
        if (!file) {
            wrap.hidden = true;
            image.removeAttribute("src");
            return;
        }
        const url = URL.createObjectURL(file);
        image.src = url;
        wrap.hidden = false;
    }

    function setFeedbackNode(node, message, type) {
        if (!node) return;
        node.textContent = message;
        node.className = `upload-feedback show ${type}`;
        node.style.whiteSpace = message.includes("\n") ? "pre-line" : "normal";
    }

    function clearFeedbackNode(node) {
        if (!node) return;
        node.textContent = "";
        node.className = "upload-feedback";
    }

    async function startStripeConnectOnboarding(feedbackNode = null, options = {}) {
        try {
            const returnURL = options.returnURL || new URL("settings.html?stripe=return", window.location.href).toString();
            const refreshURL = options.refreshURL || new URL("settings.html?stripe=refresh", window.location.href).toString();
            const payload = await invokeAuthedJSONFunction("stripe-connect", {
                return_url: returnURL,
                refresh_url: refreshURL
            }, "/create-account-link");
            if (payload?.url) {
                window.location.href = payload.url;
            }
        } catch (error) {
            if (feedbackNode) {
                setFeedbackNode(feedbackNode, normalizeAuthError(error, "We couldn’t start Stripe onboarding right now."), "error");
            }
        }
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    async function initialize() {
        preparePrettyRouteShell();
        if (!hasSupabase()) {
            buildNav();
            buildModals();
            buildFooter();
            await fillSearchPage();
            initializeHeroCarousel();
            await fillDiscoverPage();
            fillDynamicDetail();
            await fillProfilePage();
            await fillEditProfilePage();
            await fillSettingsPage();
            await fillSellerDashboardPage();
            await fillPurchasedBeats();
            fillUploadPage();
            return;
        }

        await syncSessionState();
        buildNav();
        buildModals();
        buildFooter();
        await handleProtectedPage();
        await wireAuthForms();
        await fillSearchPage();
        initializeHeroCarousel();
        await fillDiscoverPage();
        fillDynamicDetail();
        await fillProfilePage();
        await fillEditProfilePage();
        await fillSettingsPage();
        await fillSellerDashboardPage();
        await fillPurchasedBeats();
        fillUploadPage();
        await handleAuthCallbackPage();
        getSupabase().auth.onAuthStateChange(async (_event, session) => {
            state.session = session;
            state.authUser = session?.user || null;
            state.profile = null;
            if (state.authUser) {
                await ensureProfileForUser(state.authUser);
            } else {
                clearPendingVerification();
                signedMediaURLCache.clear();
            }
            buildNav();
            await fillProfilePage();
            await fillEditProfilePage();
            await fillSettingsPage();
            await fillSellerDashboardPage();
            await fillPurchasedBeats();
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        initialize().catch((error) => {
            console.error("SoundSwipe web initialization failed", error);
        });
    });
    function cacheBustedImageURL(url, version = "") {
        if (!url) return "";
        if (isBunnyCDNURL(url) && url.includes("token=") && url.includes("expires=")) {
            return url;
        }
        const separator = url.includes("?") ? "&" : "?";
        if (version) {
            return `${url}${separator}v=${encodeURIComponent(version)}`;
        }
        return `${url}${separator}v=1`;
    }
})();
