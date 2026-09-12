"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.read = read;
exports.mutate = mutate;
exports.replaceAll = replaceAll;
exports.resetToBootstrap = resetToBootstrap;
exports.resolveBrandId = resolveBrandId;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("./ops/types");
/**
 * Storage is a single JSON document behind a narrow repository interface.
 *
 * Why: it makes the whole system runnable with `npm run dev` and nothing else —
 * no Postgres, no Docker, no migrations — while keeping every read/write funnelled
 * through `read()` / `mutate()`. Swapping in Postgres/Drizzle later means
 * reimplementing exactly those two functions; no page or engine touches storage
 * directly.
 */
// Overridable so tests run against an isolated store instead of the dev data.
// In serverless environments like Vercel or AWS Lambda, process.cwd() is read-only at runtime,
// so fallback to /tmp/.data where writes are permitted.
const DATA_DIR = process.env.OPS_DATA_DIR
    ? node_path_1.default.resolve(process.env.OPS_DATA_DIR)
    : process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
        ? node_path_1.default.join("/tmp", ".data")
        : node_path_1.default.join(process.cwd(), ".data");
const DB_PATH = node_path_1.default.join(DATA_DIR, "db.json");
const EMPTY = {
    workspaces: [],
    appointments: [],
    availability: [],
    notificationLog: [],
    webhookSubscribers: [],
    webhookDeliveries: [],
    n8nSubmissions: [],
    brands: [],
    connections: [],
    media: [],
    posts: [],
    dailyStats: [],
    adCampaigns: [],
    adStats: [],
    reviews: [],
    rankGrid: [],
    competitors: [],
    suggestions: [],
    campaigns: [],
    conversations: [],
    ideas: [],
    reports: [],
    activity: [],
    boards: [],
    boardCards: [],
    leads: [],
    brokers: [],
    crmContacts: [],
    crmTasks: [],
    voiceCalls: [],
    voiceAgentConfigs: [],
    inventoryUnits: [],
    ...types_1.EMPTY_OPS,
};
let cache = null;
let cacheMtime = 0;
function ensureFile() {
    if (!node_fs_1.default.existsSync(DATA_DIR))
        node_fs_1.default.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    if (!node_fs_1.default.existsSync(DB_PATH)) {
        // If a seeded db exists in the repo bundle, copy it to the writable store
        const repoSeed = node_path_1.default.join(process.cwd(), "src", "lib", "seed-db.json");
        const dotDataSeed = node_path_1.default.join(process.cwd(), ".data", "db.json");
        const seedToUse = node_fs_1.default.existsSync(repoSeed) ? repoSeed : node_fs_1.default.existsSync(dotDataSeed) ? dotDataSeed : null;
        if (seedToUse && seedToUse !== DB_PATH) {
            try {
                node_fs_1.default.copyFileSync(seedToUse, DB_PATH);
                return;
            }
            catch {
                // fallback to buildBootstrap()
            }
        }
        // A fresh clone boots with the tenant shell only — no fabricated content.
        const { buildBootstrap } = require("./bootstrap");
        // 0600, and the directory 0700. This file holds plaintext OAuth tokens and
        // customer PII; the default 0644 made it readable by every account and every
        // process on the host.
        node_fs_1.default.writeFileSync(DB_PATH, JSON.stringify(buildBootstrap(), null, 0), { mode: 0o600 });
    }
}
/** Read the whole DB. Cached until the file changes on disk. */
function read() {
    ensureFile();
    const mtime = node_fs_1.default.statSync(DB_PATH).mtimeMs;
    if (!cache || mtime !== cacheMtime) {
        cache = { ...EMPTY, ...JSON.parse(node_fs_1.default.readFileSync(DB_PATH, "utf8")) };
        cacheMtime = mtime;
        // Self-healing: if connections are missing (e.g. from an empty cold-start /tmp file on Vercel),
        // restore the default connections from buildBootstrap()
        if (!cache.connections || cache.connections.length === 0) {
            const { buildBootstrap } = require("./bootstrap");
            const boot = buildBootstrap();
            cache.connections = boot.connections;
            if (!cache.brands || cache.brands.length === 0) {
                cache.brands = boot.brands;
            }
            try {
                node_fs_1.default.writeFileSync(DB_PATH, JSON.stringify(cache, null, 0), { mode: 0o600 });
                cacheMtime = node_fs_1.default.statSync(DB_PATH).mtimeMs;
            }
            catch { }
        }
    }
    return cache;
}
/**
 * Apply a mutation and persist atomically (write-temp + rename), so a crash
 * mid-write can never leave a truncated database behind.
 */
function mutate(fn) {
    const db = read();
    const result = fn(db);
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    // The temp file inherits the same restriction, or the atomic rename would
    // publish a 0644 copy of the tokens on every single write.
    node_fs_1.default.writeFileSync(tmp, JSON.stringify(db, null, 0), { mode: 0o600 });
    node_fs_1.default.renameSync(tmp, DB_PATH);
    cacheMtime = node_fs_1.default.statSync(DB_PATH).mtimeMs;
    cache = db;
    return result;
}
/** Overwrite everything — used by the reseed endpoint. */
function replaceAll(db) {
    ensureFile();
    node_fs_1.default.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), { mode: 0o600 });
    cache = db;
    cacheMtime = node_fs_1.default.statSync(DB_PATH).mtimeMs;
}
/**
 * Return the store to the bootstrap tenant shell, discarding every business
 * record. Named for what it does now: there is no seed dataset to restore.
 */
function resetToBootstrap() {
    const { buildBootstrap } = require("./bootstrap");
    const fresh = buildBootstrap();
    replaceAll(fresh);
    return fresh;
}
/** Resolve the brand to operate on: explicit id, else the first brand. */
function resolveBrandId(db, brandId) {
    if (brandId && db.brands.some((b) => b.id === brandId))
        return brandId;
    return db.brands[0]?.id ?? "";
}
