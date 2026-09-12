"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExchangeError = void 0;
exports.exchangeCode = exchangeCode;
class ExchangeError extends Error {
    channel;
    constructor(message, channel) {
        super(message);
        this.channel = channel;
        this.name = "ExchangeError";
    }
}
exports.ExchangeError = ExchangeError;
/** Standard OAuth2 authorization-code POST. Most providers accept exactly this. */
async function postForToken(url, params, channel) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams(params).toString(),
        cache: "no-store",
    });
    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        throw new ExchangeError(`${channel}: token endpoint returned non-JSON (HTTP ${res.status})`, channel);
    }
    if (!res.ok) {
        // Providers disagree on the error shape; try the three common ones before
        // falling back to the status, so the operator sees the provider's own reason.
        const detail = body.error_description ??
            body.error?.message ??
            (typeof body.error === "string" ? body.error : null) ??
            `HTTP ${res.status}`;
        throw new ExchangeError(`${channel}: ${detail}`, channel);
    }
    return body;
}
function env(name, channel) {
    const v = process.env[name];
    if (!v)
        throw new ExchangeError(`${channel}: ${name} is not set`, channel);
    return v;
}
/* -------------------------------------------------------------------------- */
/* Meta — Instagram, Facebook Pages, WhatsApp, Meta Ads                       */
/* -------------------------------------------------------------------------- */
const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
/**
 * Meta returns a short-lived user token. It is exchanged for a long-lived one
 * immediately, because the short one dies in about an hour and a connection
 * that silently expires the same afternoon is worse than one that never
 * connected.
 */
async function metaLongLivedToken(shortToken, channel) {
    const url = new URL(`${GRAPH()}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", env("META_APP_ID", channel));
    url.searchParams.set("client_secret", env("META_APP_SECRET", channel));
    url.searchParams.set("fb_exchange_token", shortToken);
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json());
    if (!res.ok || !body.access_token) {
        throw new ExchangeError(`${channel}: ${body.error?.message ?? "could not extend token"}`, channel);
    }
    return body.access_token;
}
async function metaExchange(code, redirectUri, channel) {
    const first = await postForToken(`${GRAPH()}/oauth/access_token`, {
        client_id: env("META_APP_ID", channel),
        client_secret: env("META_APP_SECRET", channel),
        redirect_uri: redirectUri,
        code,
    }, channel);
    const userToken = await metaLongLivedToken(String(first.access_token ?? ""), channel);
    // A user token cannot publish. Publishing happens as a Page (and, for
    // Instagram, as the IG account attached to that Page), each with its own
    // token — so resolve the Page and use *its* token from here on.
    const pagesRes = await fetch(`${GRAPH()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`, { cache: "no-store" });
    const pages = (await pagesRes.json());
    if (!pagesRes.ok)
        throw new ExchangeError(`${channel}: ${pages.error?.message ?? "could not list Pages"}`, channel);
    const page = pages.data?.[0];
    if (!page) {
        throw new ExchangeError(`${channel}: this account manages no Facebook Page. Instagram and Facebook publishing both act through a Page.`, channel);
    }
    if (channel === "instagram") {
        const ig = page.instagram_business_account;
        if (!ig) {
            throw new ExchangeError("instagram: no Instagram Business account is linked to that Page. Link one in Meta Business Suite, then reconnect.", channel);
        }
        return {
            accessToken: page.access_token,
            externalId: ig.id,
            handle: ig.username ? `@${ig.username}` : page.name,
        };
    }
    if (channel === "meta_ads") {
        const adAccount = process.env.META_AD_ACCOUNT_ID;
        if (!adAccount)
            throw new ExchangeError("meta_ads: META_AD_ACCOUNT_ID is not set", channel);
        return { accessToken: userToken, externalId: adAccount, handle: adAccount };
    }
    if (channel === "whatsapp") {
        const phoneId = env("WHATSAPP_PHONE_NUMBER_ID", channel);
        return { accessToken: userToken, externalId: phoneId, handle: page.name };
    }
    return { accessToken: page.access_token, externalId: page.id, handle: page.name };
}
/* -------------------------------------------------------------------------- */
/* Google — YouTube, Business Profile, Google Ads                             */
/* -------------------------------------------------------------------------- */
async function googleExchange(code, redirectUri, channel) {
    const clientId = channel === "google_ads" ? "GOOGLE_ADS_CLIENT_ID" : "GOOGLE_CLIENT_ID";
    const clientSecret = channel === "google_ads" ? "GOOGLE_ADS_CLIENT_SECRET" : "GOOGLE_CLIENT_SECRET";
    const body = await postForToken("https://oauth2.googleapis.com/token", {
        client_id: env(clientId, channel),
        client_secret: env(clientSecret, channel),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
    }, channel);
    const accessToken = String(body.access_token ?? "");
    const refreshToken = body.refresh_token ? String(body.refresh_token) : undefined;
    const expiresIn = Number(body.expires_in) || undefined;
    if (channel === "youtube") {
        const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
        const j = (await res.json());
        const ch = j.items?.[0];
        if (!ch)
            throw new ExchangeError("youtube: that Google account has no YouTube channel", channel);
        return { accessToken, refreshToken, expiresIn, externalId: ch.id, handle: ch.snippet?.title ?? ch.id };
    }
    if (channel === "google_business") {
        // GBP location ids are configured rather than discovered: an account can own
        // hundreds, and picking the first one silently would post to the wrong shop.
        const loc = process.env.GBP_LOCATION_ID;
        if (!loc) {
            throw new ExchangeError("google_business: set GBP_LOCATION_ID to the location you want to manage", channel);
        }
        return { accessToken, refreshToken, expiresIn, externalId: loc, handle: loc };
    }
    const customerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    if (!customerId)
        throw new ExchangeError("google_ads: GOOGLE_ADS_LOGIN_CUSTOMER_ID is not set", channel);
    return { accessToken, refreshToken, expiresIn, externalId: customerId, handle: customerId };
}
/* -------------------------------------------------------------------------- */
/* LinkedIn, TikTok, X                                                        */
/* -------------------------------------------------------------------------- */
async function linkedinExchange(code, redirectUri, channel) {
    const body = await postForToken("https://www.linkedin.com/oauth/v2/accessToken", {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env("LINKEDIN_CLIENT_ID", channel),
        client_secret: env("LINKEDIN_CLIENT_SECRET", channel),
    }, channel);
    const accessToken = String(body.access_token ?? "");
    // Publishing is as an organisation, and the URN is configured rather than
    // discovered — the same token may administer several.
    const urn = process.env.LINKEDIN_ORG_URN;
    if (!urn)
        throw new ExchangeError("linkedin: set LINKEDIN_ORG_URN to the organisation to post as", channel);
    return { accessToken, expiresIn: Number(body.expires_in) || undefined, externalId: urn, handle: urn };
}
async function tiktokExchange(code, redirectUri, channel) {
    const body = await postForToken("https://open.tiktokapis.com/v2/oauth/token/", {
        client_key: env("TIKTOK_CLIENT_KEY", channel),
        client_secret: env("TIKTOK_CLIENT_SECRET", channel),
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
    }, channel);
    const accessToken = String(body.access_token ?? "");
    const openId = String(body.open_id ?? "");
    if (!accessToken || !openId)
        throw new ExchangeError("tiktok: token response was missing access_token or open_id", channel);
    const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
    });
    const j = (await res.json());
    return {
        accessToken,
        refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
        expiresIn: Number(body.expires_in) || undefined,
        externalId: openId,
        handle: j.data?.user?.display_name ?? openId,
    };
}
async function xExchange(code, redirectUri, channel) {
    const id = env("X_CLIENT_ID", channel);
    const secret = env("X_CLIENT_SECRET", channel);
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            // X requires HTTP Basic for confidential clients; the body client_id alone is rejected.
            authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            // Matches the `code_challenge=challenge&code_challenge_method=plain` sent
            // at authorize time in oauth.ts.
            code_verifier: "challenge",
        }).toString(),
        cache: "no-store",
    });
    const body = (await res.json());
    if (!res.ok) {
        throw new ExchangeError(`x: ${body.error_description ?? `HTTP ${res.status}`}`, channel);
    }
    const accessToken = String(body.access_token ?? "");
    const me = await fetch("https://api.twitter.com/2/users/me", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
    });
    const mj = (await me.json());
    if (!mj.data?.id)
        throw new ExchangeError("x: could not identify the authorising account", channel);
    return {
        accessToken,
        refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
        expiresIn: Number(body.expires_in) || undefined,
        externalId: mj.data.id,
        handle: mj.data.username ? `@${mj.data.username}` : mj.data.id,
    };
}
/* -------------------------------------------------------------------------- */
/**
 * Exchange an authorization code for a usable connection.
 *
 * Throws `ExchangeError` with the provider's own wording wherever possible —
 * "no Instagram Business account is linked to that Page" is actionable, and
 * "connect failed" is not.
 */
async function exchangeCode(channel, code, redirectUri) {
    switch (channel) {
        case "instagram":
        case "facebook":
        case "whatsapp":
        case "meta_ads":
            return metaExchange(code, redirectUri, channel);
        case "youtube":
        case "google_business":
        case "google_ads":
            return googleExchange(code, redirectUri, channel);
        case "linkedin":
            return linkedinExchange(code, redirectUri, channel);
        case "tiktok":
            return tiktokExchange(code, redirectUri, channel);
        case "x":
            return xExchange(code, redirectUri, channel);
        default:
            throw new ExchangeError(`${channel}: no connect flow implemented`, channel);
    }
}
