"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DOCUMENT_BYTES = exports.ALLOWED_MIME = exports.LocalDocumentStore = void 0;
exports.setDocumentStore = setDocumentStore;
exports.documentStore = documentStore;
exports.sha256 = sha256;
exports.signDocumentRef = signDocumentRef;
exports.verifyDocumentRef = verifyDocumentRef;
exports.buildStorageKey = buildStorageKey;
exports.validateUpload = validateUpload;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Local filesystem store. `.private/` is outside `public/` and gitignored. */
class LocalDocumentStore {
    root;
    constructor(root = process.env.OPS_DOCUMENT_DIR
        ? node_path_1.default.resolve(process.env.OPS_DOCUMENT_DIR)
        : process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
            ? node_path_1.default.join("/tmp", ".private", "documents")
            : node_path_1.default.join(process.cwd(), ".private", "documents")) {
        this.root = root;
    }
    resolve(key) {
        // Reject traversal explicitly rather than relying on the caller: a key of
        // "../../.env" must never resolve outside the store root.
        if (!/^[a-zA-Z0-9._/-]+$/.test(key) || key.includes("..")) {
            throw new Error("Invalid storage key");
        }
        const full = node_path_1.default.join(this.root, key);
        if (!full.startsWith(this.root))
            throw new Error("Path traversal rejected");
        return full;
    }
    async put(key, data) {
        const full = this.resolve(key);
        await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(full), { recursive: true });
        await node_fs_1.default.promises.writeFile(full, data, { mode: 0o600 });
        return { key, sizeBytes: data.byteLength, sha256: sha256(data) };
    }
    async get(key) {
        try {
            return await node_fs_1.default.promises.readFile(this.resolve(key));
        }
        catch {
            return null;
        }
    }
    async delete(key) {
        try {
            await node_fs_1.default.promises.unlink(this.resolve(key));
        }
        catch {
            /* already gone */
        }
    }
    async exists(key) {
        try {
            await node_fs_1.default.promises.access(this.resolve(key));
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.LocalDocumentStore = LocalDocumentStore;
let store = new LocalDocumentStore();
/** Swap the backend (S3, Supabase Storage) without touching call sites. */
function setDocumentStore(next) {
    store = next;
}
function documentStore() {
    return store;
}
function sha256(data) {
    return node_crypto_1.default.createHash("sha256").update(data).digest("hex");
}
/* -------------------------------------------------------------------------- */
/* Signed URLs                                                                 */
/* -------------------------------------------------------------------------- */
function signingSecret() {
    const s = process.env.OPS_DOCUMENT_SECRET ?? process.env.OPS_SESSION_SECRET;
    if (!s) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("OPS_DOCUMENT_SECRET must be set in production");
        }
        return "dev-only-insecure-document-secret";
    }
    return s;
}
/**
 * Sign a short-lived reference to a document.
 *
 * The signature binds the document id, the expiry AND the requesting member, so
 * a link leaked from one person's browser cannot be replayed by another. The
 * download route still re-checks permissions server-side — the signature is a
 * second lock, not the only one.
 */
function signDocumentRef(documentId, memberId, ttlSeconds = 300) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const payload = `${documentId}.${memberId}.${expiresAt}`;
    const signature = node_crypto_1.default.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
    return `${expiresAt}.${signature}`;
}
function verifyDocumentRef(documentId, memberId, token) {
    if (!token)
        return false;
    const [expiresRaw, signature] = token.split(".");
    const expiresAt = Number(expiresRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now())
        return false;
    const expected = node_crypto_1.default
        .createHmac("sha256", signingSecret())
        .update(`${documentId}.${memberId}.${expiresAt}`)
        .digest("base64url");
    const a = Buffer.from(signature ?? "");
    const b = Buffer.from(expected);
    return a.length === b.length && node_crypto_1.default.timingSafeEqual(a, b);
}
/** Keys are opaque and unguessable; the customer id is a folder, not a secret. */
function buildStorageKey(customerId, documentId, filename) {
    const ext = (filename.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    return `${customerId}/${documentId}.${ext || "bin"}`;
}
exports.ALLOWED_MIME = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "image/webp",
]);
exports.MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
/** Reject anything we are not prepared to store or render, with a clear reason. */
function validateUpload(mimeType, sizeBytes, acceptedFormats) {
    if (!exports.ALLOWED_MIME.has(mimeType))
        return `Unsupported file type: ${mimeType}`;
    if (sizeBytes > exports.MAX_DOCUMENT_BYTES)
        return `File is larger than ${Math.round(exports.MAX_DOCUMENT_BYTES / 1024 / 1024)}MB`;
    if (sizeBytes <= 0)
        return "File is empty";
    if (acceptedFormats?.length) {
        const ext = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1];
        const ok = acceptedFormats.some((f) => f.toLowerCase() === ext || (f === "jpg" && ext === "jpeg"));
        if (!ok)
            return `This item accepts ${acceptedFormats.join(", ")}`;
    }
    return null;
}
