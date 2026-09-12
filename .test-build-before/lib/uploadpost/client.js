"use strict";
/**
 * UPLOAD-POST API CLIENT
 *
 * Unified social media publishing client integrating with https://api.upload-post.com.
 * Allows publishing video, reels, shorts and photos to Instagram, YouTube,
 * Facebook, LinkedIn and X via managed social account connections.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadPostApiKey = uploadPostApiKey;
exports.uploadPostUser = uploadPostUser;
exports.isUploadPostConfigured = isUploadPostConfigured;
exports.checkUploadPostStatus = checkUploadPostStatus;
exports.uploadPostVideo = uploadPostVideo;
exports.uploadPostPhotos = uploadPostPhotos;
const UPLOAD_POST_BASE_URL = "https://api.upload-post.com/api";
function uploadPostApiKey() {
    return process.env.UPLOAD_POST_API_KEY?.trim();
}
function uploadPostUser() {
    return process.env.UPLOAD_POST_USER?.trim() || "default";
}
function isUploadPostConfigured() {
    return Boolean(uploadPostApiKey());
}
async function checkUploadPostStatus() {
    const key = uploadPostApiKey();
    const profileUser = uploadPostUser();
    if (!key) {
        return {
            configured: false,
            valid: false,
            activeProfile: profileUser,
            profiles: [],
            connectedAccounts: {},
            error: "The publishing connector is not configured",
        };
    }
    try {
        const meRes = await fetch(`${UPLOAD_POST_BASE_URL}/uploadposts/me`, {
            method: "GET",
            headers: {
                Authorization: `Apikey ${key}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
        });
        if (!meRes.ok) {
            return {
                configured: true,
                valid: false,
                activeProfile: profileUser,
                profiles: [],
                connectedAccounts: {},
                error: `HTTP ${meRes.status}: ${meRes.statusText}`,
            };
        }
        const meData = (await meRes.json());
        const usersRes = await fetch(`${UPLOAD_POST_BASE_URL}/uploadposts/users`, {
            method: "GET",
            headers: {
                Authorization: `Apikey ${key}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
        });
        let profiles = [];
        if (usersRes.ok) {
            const usersData = (await usersRes.json());
            profiles = usersData.profiles ?? [];
        }
        const active = profiles.find((p) => p.username.toLowerCase() === profileUser.toLowerCase()) ?? profiles[0];
        const connected = {};
        if (active && active.social_accounts) {
            const accounts = active.social_accounts;
            if (accounts.instagram && typeof accounts.instagram === "object" && accounts.instagram.handle) {
                connected.instagram = accounts.instagram;
            }
            if (accounts.youtube && typeof accounts.youtube === "object" && accounts.youtube.handle) {
                connected.youtube = accounts.youtube;
            }
            if (accounts.linkedin && typeof accounts.linkedin === "object" && accounts.linkedin.handle) {
                connected.linkedin = accounts.linkedin;
            }
            if (accounts.facebook && typeof accounts.facebook === "object" && accounts.facebook.handle) {
                connected.facebook = accounts.facebook;
            }
            if (accounts.google_business && typeof accounts.google_business === "object" && accounts.google_business.handle) {
                connected.google_business = accounts.google_business;
            }
        }
        return {
            configured: true,
            valid: Boolean(meData.success),
            email: meData.email,
            plan: meData.plan,
            activeProfile: active ? active.username : profileUser,
            profiles,
            connectedAccounts: connected,
        };
    }
    catch (err) {
        return {
            configured: true,
            valid: false,
            activeProfile: profileUser,
            profiles: [],
            connectedAccounts: {},
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
async function uploadPostVideo(opts) {
    const key = uploadPostApiKey();
    if (!key)
        return { ok: false, error: "The publishing connector is not configured" };
    const targetUser = opts.user || uploadPostUser();
    const form = new FormData();
    form.append("user", targetUser);
    for (const p of opts.platforms) {
        form.append("platform[]", p);
    }
    if (opts.title)
        form.append("title", opts.title);
    if (opts.description)
        form.append("description", opts.description);
    if (opts.mediaType)
        form.append("media_type", opts.mediaType);
    if (opts.shareToFeed !== undefined)
        form.append("share_to_feed", String(opts.shareToFeed));
    if (typeof opts.video === "string") {
        form.append("video", opts.video);
    }
    else if (Buffer.isBuffer(opts.video)) {
        const blob = new Blob([new Uint8Array(opts.video)], { type: "video/mp4" });
        form.append("video", blob, opts.filename || "video.mp4");
    }
    else if (opts.video instanceof Blob) {
        form.append("video", opts.video, opts.filename || "video.mp4");
    }
    try {
        const res = await fetch(`${UPLOAD_POST_BASE_URL}/upload`, {
            method: "POST",
            headers: {
                Authorization: `Apikey ${key}`,
            },
            body: form,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            return {
                ok: false,
                error: json?.message || `Upload failed with HTTP ${res.status}`,
                data: json,
            };
        }
        return { ok: true, data: json };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
async function uploadPostPhotos(opts) {
    const key = uploadPostApiKey();
    if (!key)
        return { ok: false, error: "The publishing connector is not configured" };
    const targetUser = opts.user || uploadPostUser();
    const form = new FormData();
    form.append("user", targetUser);
    for (const p of opts.platforms) {
        form.append("platform[]", p);
    }
    if (opts.title)
        form.append("title", opts.title);
    if (opts.description)
        form.append("description", opts.description);
    opts.photos.forEach((photo, idx) => {
        if (typeof photo === "string") {
            form.append("photos[]", photo);
        }
        else if (Buffer.isBuffer(photo)) {
            const blob = new Blob([new Uint8Array(photo)], { type: "image/jpeg" });
            form.append("photos[]", blob, `photo-${idx}.jpg`);
        }
        else if (photo instanceof Blob) {
            form.append("photos[]", photo, `photo-${idx}.jpg`);
        }
    });
    try {
        const res = await fetch(`${UPLOAD_POST_BASE_URL}/upload_photos`, {
            method: "POST",
            headers: {
                Authorization: `Apikey ${key}`,
            },
            body: form,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            return {
                ok: false,
                error: json?.message || `Upload photos failed with HTTP ${res.status}`,
                data: json,
            };
        }
        return { ok: true, data: json };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
