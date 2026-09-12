"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoFormUrl = videoFormUrl;
exports.videoFormUrlProblem = videoFormUrlProblem;
exports.readFields = readFields;
exports.checkVideo = checkVideo;
exports.checkImage = checkImage;
exports.checkReferenceCount = checkReferenceCount;
exports.buildOutbound = buildOutbound;
exports.looksInactive = looksInactive;
exports.classifyForwardResponse = classifyForwardResponse;
exports.classifyProbe = classifyProbe;
exports.openSubmission = openSubmission;
exports.settleSubmission = settleSubmission;
exports.recordPlatformResult = recordPlatformResult;
exports.recentSubmissions = recentSubmissions;
const db_1 = require("../db");
const bus_1 = require("../events/bus");
const ids_1 = require("../ids");
const store_1 = require("../media/store");
const types_1 = require("./types");
/**
 * VIDEO POSTING — validation and the submission log.
 *
 * The browser never talks to n8n directly. It posts here, this checks the
 * submission, and the route forwards it server-side. Two reasons, both
 * structural rather than stylistic: the workflow URL is a capability (anyone
 * holding it can inject a post into the operator's YouTube channel), so it must
 * not be shipped to a browser; and an n8n Form endpoint sends no CORS headers,
 * so a direct fetch from the page would fail opaquely with nothing useful to
 * show the person who just waited out a 400 MB upload.
 */
/** How many rows the operator's history keeps. Matches the delivery log's shape. */
const MAX_SUBMISSION_LOG = 200;
/** The configured workflow URL, or "" when the setting is unset or blank. */
function videoFormUrl() {
    try {
        const db = (0, db_1.read)();
        const dbUrl = db.workflowFormUrl;
        if (typeof dbUrl === "string" && dbUrl.trim())
            return dbUrl.trim();
    }
    catch {
        /* fallback to environment */
    }
    return (process.env[types_1.VIDEO_FORM_URL_SETTING] ?? "").trim();
}
/**
 * Why the forward cannot be attempted, or null when it can.
 *
 * The URL goes through the same `checkWebhookUrl` the subscriber registry uses.
 * It arrives from the environment rather than from a request, so this is not
 * guarding against a hostile submitter — it is guarding against a typo that
 * would otherwise send the video, and the Drive/Telegram material with it, over
 * plaintext http or at a host on the deployment's own private network.
 */
function videoFormUrlProblem() {
    const url = videoFormUrl();
    if (!url) {
        return `Publishing workflow URL is not configured. Set ${types_1.VIDEO_FORM_URL_SETTING} in the environment or save one under "Configure Endpoint".`;
    }
    const problem = (0, bus_1.checkWebhookUrl)(url);
    return problem ? `Workflow URL is not usable: ${problem}` : null;
}
function text(form, name, max) {
    const v = form.get(name);
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}
/**
 * Read the non-file half of the form.
 *
 * Platforms are accepted either as repeated parts (what a checkbox group posts)
 * or as one comma-separated value (what n8n itself uses), because this endpoint
 * is reachable by anything holding `marketing.publish`, not only by our own
 * page, and rejecting the shape the downstream system speaks would be perverse.
 */
function readFields(form) {
    const title = text(form, types_1.FIELDS.title, types_1.LIMITS.title);
    if (!title)
        return { ok: false, error: `${types_1.FIELDS.title} is required.` };
    const description = text(form, types_1.FIELDS.description, types_1.LIMITS.description);
    if (!description)
        return { ok: false, error: `${types_1.FIELDS.description} is required.` };
    const rawPlatforms = form
        .getAll(types_1.FIELDS.platforms)
        .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
        .map((v) => v.trim())
        .filter(Boolean);
    const platforms = [];
    for (const p of rawPlatforms) {
        if (!(0, types_1.isN8nPlatform)(p)) {
            return { ok: false, error: `Unknown platform "${p.slice(0, 40)}". Choose from: ${types_1.N8N_PLATFORMS.join(", ")}.` };
        }
        // Deduplicated, or a double-submitted checkbox posts the same video twice.
        if (!platforms.includes(p))
            platforms.push(p);
    }
    if (!platforms.length)
        return { ok: false, error: `Choose at least one platform under "${types_1.FIELDS.platforms}".` };
    const createFolderRaw = text(form, types_1.FIELDS.createFolder, 8).toLowerCase() || "yes";
    const publicLinkRaw = text(form, types_1.FIELDS.publicLink, 8).toLowerCase() || "no";
    for (const [label, value] of [
        [types_1.FIELDS.createFolder, createFolderRaw],
        [types_1.FIELDS.publicLink, publicLinkRaw],
    ]) {
        if (!types_1.YES_NO.includes(value)) {
            return { ok: false, error: `"${label}" must be yes or no.` };
        }
    }
    return {
        ok: true,
        fields: {
            title,
            description,
            thumbnailText: text(form, types_1.FIELDS.thumbnailText, types_1.LIMITS.thumbnailText),
            extraInstructions: text(form, types_1.FIELDS.extraInstructions, types_1.LIMITS.extraInstructions),
            platforms,
            driveFolder: text(form, types_1.FIELDS.driveFolder, types_1.LIMITS.driveFolder),
            createFolder: createFolderRaw,
            publicLink: publicLinkRaw,
            telegramChatId: text(form, types_1.FIELDS.telegramChatId, types_1.LIMITS.telegramChatId),
        },
    };
}
/**
 * Confirm the video is a video from its own bytes.
 *
 * `validateUpload` already refuses an unknown container and an oversized file;
 * the extra `kind` check exists because it happily accepts a JPEG, and a JPEG
 * forwarded as the "Video File" would fail deep inside somebody else's workflow
 * — after the upload, the Drive folder and the thumbnail run had all happened.
 */
function checkVideo(bytes) {
    const verdict = (0, store_1.validateUpload)(bytes);
    if ("error" in verdict)
        return { ok: false, error: `${types_1.FIELDS.video}: ${verdict.error}` };
    if (verdict.kind !== "video")
        return { ok: false, error: `${types_1.FIELDS.video} must be a video — MP4, MOV or WebM.` };
    // The detected type is handed back rather than discarded so the forwarded part
    // carries the container we proved, not the one the browser claimed.
    return { ok: true, mime: verdict.mime };
}
/** Same, for the thumbnail and the reference photos, which must be stills. */
function checkImage(label, bytes) {
    if (bytes.byteLength > types_1.MAX_IMAGE_BYTES) {
        return {
            ok: false,
            error: `${label}: ${(bytes.byteLength / 1048576).toFixed(1)} MB is over the ${types_1.MAX_IMAGE_BYTES / 1048576} MB image limit.`,
        };
    }
    const verdict = (0, store_1.validateUpload)(bytes);
    if ("error" in verdict)
        return { ok: false, error: `${label}: ${verdict.error}` };
    if (verdict.kind !== "image")
        return { ok: false, error: `${label} must be an image — JPEG, PNG or WebP.` };
    return { ok: true, mime: verdict.mime };
}
function checkReferenceCount(n) {
    return n > types_1.MAX_REFERENCE_PHOTOS
        ? `${types_1.FIELDS.referencePhotos}: at most ${types_1.MAX_REFERENCE_PHOTOS} photos.`
        : null;
}
/**
 * Build the multipart body the workflow receives — every label exactly once.
 *
 * An earlier version also appended each value under guessed aliases
 * (`field-0`, `videoFile`, …) "in case" the form keyed on them. It does not:
 * an n8n Form trigger keys on the label, and the duplicates tripled the body
 * (the video went across three times) for no gain.
 */
function buildOutbound(fields, files, submissionId) {
    const out = new FormData();
    out.append(types_1.FIELDS.title, fields.title);
    out.append(types_1.FIELDS.description, fields.description);
    out.append(types_1.FIELDS.thumbnailText, fields.thumbnailText);
    out.append(types_1.FIELDS.extraInstructions, fields.extraInstructions);
    // n8n's own form posts a multi-checkbox as one comma-separated value.
    out.append(types_1.FIELDS.platforms, fields.platforms.join(","));
    out.append(types_1.FIELDS.driveFolder, fields.driveFolder);
    out.append(types_1.FIELDS.createFolder, fields.createFolder);
    out.append(types_1.FIELDS.publicLink, fields.publicLink);
    out.append(types_1.FIELDS.telegramChatId, fields.telegramChatId);
    out.append(types_1.FIELDS.submissionId, submissionId);
    out.append(types_1.FIELDS.video, files.video.blob, files.video.name);
    if (files.thumbnail)
        out.append(types_1.FIELDS.finalThumbnail, files.thumbnail.blob, files.thumbnail.name);
    for (const r of files.references)
        out.append(types_1.FIELDS.referencePhotos, r.blob, r.name);
    return out;
}
/** Does this look like n8n's "form not active" page rather than a workflow fault? */
function looksInactive(status, body) {
    return status === 404 || /Problem loading form|deactivated or no longer exist/i.test(body);
}
/**
 * Turn the workflow's HTTP answer into a submission outcome.
 *
 * `bodySent` is whether fetch completed the upload before the reply came. A
 * Form trigger answers 499 (or 5xx) only *after* it has run the workflow on the
 * received submission and a later node threw — so with the body fully sent
 * that status means "got the video, then broke", and the fix is in the
 * workflow's execution history, not in the connection.
 */
function classifyForwardResponse(status, body, bodySent) {
    // The inactive page is checked first: n8n has served it with a 200 before.
    if (looksInactive(status, body))
        return { status: "failed", error: types_1.FORM_INACTIVE_MESSAGE };
    if (status >= 200 && status < 400)
        return { status: "forwarded" };
    if (bodySent && (status === 499 || status >= 500)) {
        return { status: "received_workflow_error", error: types_1.WORKFLOW_ERROR_MESSAGE };
    }
    return { status: "failed", error: `The publishing workflow answered ${status}. Check its execution history.` };
}
/** Classify a GET of the form URL — no video is sent. */
function classifyProbe(status, body) {
    if (looksInactive(status, body))
        return { state: "inactive", detail: types_1.FORM_INACTIVE_MESSAGE };
    if (status >= 200 && status < 400)
        return { state: "active", detail: "The publishing workflow's form is active and reachable." };
    return { state: "unreachable", detail: `The publishing workflow answered ${status} to a connection test.` };
}
/* -------------------------------------------------------------------------- */
/* Submission log                                                             */
/* -------------------------------------------------------------------------- */
/**
 * Record the attempt before it is made.
 *
 * Deliberately not "record the result afterwards": the forward can take minutes
 * with a large file, and a crash or a redeploy in the middle would otherwise
 * erase all trace of a video that n8n may well have received and published.
 */
function openSubmission(input) {
    const row = {
        id: (0, ids_1.uid)("n8nsub"),
        at: new Date().toISOString(),
        by: input.by,
        title: input.title,
        platforms: input.platforms,
        status: "queued",
    };
    (0, db_1.mutate)((d) => {
        d.n8nSubmissions = [...(d.n8nSubmissions ?? []), row].slice(-MAX_SUBMISSION_LOG);
    });
    return row;
}
function settleSubmission(id, patch) {
    return (0, db_1.mutate)((d) => {
        const row = (d.n8nSubmissions ?? []).find((s) => s.id === id);
        if (!row)
            return null;
        const now = new Date();
        row.status = patch.status;
        row.n8nStatus = patch.n8nStatus;
        row.error = patch.error;
        row.settledAt = now.toISOString();
        row.elapsedMs = Math.max(0, now.getTime() - new Date(row.at).getTime());
        return row;
    });
}
/**
 * Record what the workflow reported back for one platform.
 *
 * Keyed on platform, so a workflow that retries and reports twice overwrites
 * rather than duplicates. Refuses a platform the submission never asked for:
 * a callback claiming "published to X" on a YouTube-only post is a bug in the
 * workflow, and a row that shows it would be a lie.
 */
function recordPlatformResult(id, result) {
    return (0, db_1.mutate)((d) => {
        const row = (d.n8nSubmissions ?? []).find((s) => s.id === id);
        if (!row)
            return { ok: false, error: "Unknown submission id.", status: 404 };
        if (!row.platforms.includes(result.platform)) {
            return { ok: false, error: `This submission was not sent to ${result.platform}.`, status: 409 };
        }
        const entry = { ...result, at: new Date().toISOString() };
        row.results = [...(row.results ?? []).filter((r) => r.platform !== result.platform), entry];
        // A callback proves the workflow ran, whatever the HTTP answer said.
        if (row.status === "queued" || row.status === "received_workflow_error") {
            // Drop the stale "stopped with an error" text and the 499/5xx code: the
            // panel would otherwise show them under a row whose badge says forwarded.
            if (row.status === "received_workflow_error") {
                row.error = undefined;
                row.n8nStatus = undefined;
            }
            row.status = "forwarded";
        }
        return { ok: true, submission: row };
    });
}
/** Newest first. */
function recentSubmissions(limit = 25) {
    return ((0, db_1.read)().n8nSubmissions ?? []).slice(-limit).reverse();
}
