"use strict";
/**
 * THE VIDEO-POSTING WORKFLOW CONTRACT
 *
 * The operator already runs an n8n workflow fronted by an n8n Form node: it
 * takes a video plus thumbnail material, renders and reviews the thumbnail, and
 * fans the video out to YouTube, Instagram, Facebook and X. This module is the
 * single written-down copy of that form's contract — field names, the platform
 * catalogue, and the ceilings we enforce before anything leaves the building.
 *
 * The field *names* are the form's own labels, verbatim, because that is what an
 * n8n Form trigger keys its incoming multipart parts on. Renaming one here to
 * something tidier (`videoTitle`, say) would produce a request n8n accepts with
 * a 200 and then silently drops every value from — the worst possible failure,
 * since the submitter is told it worked.
 *
 * Nothing here imports the store or the media probe, so the browser bundle can
 * use the same constants the server validates against and the form can never
 * offer a platform the server would reject.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INBOUND_PATH = exports.INBOUND_SECRET_HEADER = exports.VIDEO_FORM_URL_SETTING = exports.FORM_INACTIVE_MESSAGE = exports.WORKFLOW_ERROR_MESSAGE = exports.LIMITS = exports.MAX_TOTAL_BYTES = exports.MAX_IMAGE_BYTES = exports.MAX_REFERENCE_PHOTOS = exports.YES_NO = exports.FIELDS = exports.N8N_PLATFORMS = void 0;
exports.isN8nPlatform = isN8nPlatform;
/** Exactly the checkboxes the workflow offers, spelled the way it spells them. */
exports.N8N_PLATFORMS = ["YouTube", "Instagram", "Facebook", "X (Twitter)"];
function isN8nPlatform(v) {
    return typeof v === "string" && (exports.N8N_PLATFORMS.includes(v) || v === "X");
}
/**
 * Multipart part names. Used by the browser form, by the API route that
 * validates it, and by the request forwarded to n8n — one vocabulary end to end,
 * so a rename cannot half-land.
 */
exports.FIELDS = {
    video: "Video File",
    finalThumbnail: "Final Thumbnail",
    referencePhotos: "Thumbnail Reference Photos",
    title: "Video Title",
    description: "Video Description",
    thumbnailText: "Thumbnail Text",
    extraInstructions: "Extra Thumbnail Instructions",
    platforms: "Which Platforms to Post To",
    driveFolder: "Google Drive Folder Name",
    createFolder: "Create the folder if it does not exist?",
    publicLink: "Enable Anyone with link can view on the Drive folder?",
    telegramChatId: "Telegram Chat ID for thumbnail review",
    /**
     * Hidden text field carrying our submission id, so the workflow can call
     * back with `post_result`. A form without this field ignores the part.
     */
    submissionId: "Submission ID",
};
/** The two-option selects. Sent as the literal strings the workflow branches on. */
exports.YES_NO = ["yes", "no"];
/** The AI thumbnail step takes at most three faces/products to feature. */
exports.MAX_REFERENCE_PHOTOS = 3;
/** A reference photo or a finished thumbnail is a still image, not a master. */
exports.MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/**
 * Ceiling on the whole multipart body.
 *
 * The video alone is bounded by the media store's own limit; this bounds the
 * sum, so four attachments each just under their individual cap cannot combine
 * into a body that has to be held in memory twice — once to validate, once to
 * forward.
 */
exports.MAX_TOTAL_BYTES = 576 * 1024 * 1024;
/** Text ceilings. Generous, but a text field is an unbounded body without one. */
exports.LIMITS = {
    title: 200,
    description: 5_000,
    thumbnailText: 200,
    extraInstructions: 1_000,
    driveFolder: 200,
    telegramChatId: 64,
};
/** Shown when the workflow took the upload and then broke on a later step. */
exports.WORKFLOW_ERROR_MESSAGE = "Your publishing workflow received the video but stopped with an error. Open the workflow's execution history to see which step failed (usually a Drive/YouTube credential).";
/** Shown when the form URL answers 404 / "Problem loading form". */
exports.FORM_INACTIVE_MESSAGE = "The publishing workflow's form is not active or its URL is different. Open the form trigger, copy the exact production form URL, and make sure the workflow is switched on.";
/**
 * The environment setting holding the workflow's form/webhook URL.
 *
 * Named as a constant because three separate places have to tell the operator
 * which setting to fill in — the API refusal, the screen, and `.env.example` —
 * and a refusal that says "no URL is configured" without naming the setting
 * sends somebody hunting through the codebase.
 */
exports.VIDEO_FORM_URL_SETTING = "N8N_VIDEO_FORM_URL";
/** The header the inbound endpoint authenticates with. Its value is never shown. */
exports.INBOUND_SECRET_HEADER = "x-n8n-secret";
/** Where n8n POSTs back into this system. */
exports.INBOUND_PATH = "/api/webhooks/n8n";
