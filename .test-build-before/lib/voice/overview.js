"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadVoiceOverview = loadVoiceOverview;
const db_1 = require("../db");
const customers_1 = require("../ops/customers");
const seed_1 = require("../ops/seed");
const client_1 = require("../bolna/client");
const calls_1 = require("./calls");
const MAX_CALLS = 200;
const MAX_AGENTS_QUERIED = 4;
const FUNNEL_VISIT_STATUSES = new Set(["site_visit_scheduled", "negotiation", "booking_token_paid", "won"]);
/**
 * Pull the provider's history for calls we have not seen. Bounded to a few
 * agents and tolerant of every failure: the client view must render from the
 * local log even when the provider is down.
 */
async function backfill(brandId) {
    const problems = [];
    const pinned = (0, client_1.configuredAgentId)();
    let agentIds = pinned ? [pinned] : [];
    if (!agentIds.length) {
        const agents = await (0, client_1.listAgents)();
        if (!agents.ok)
            return [`Could not list agents: ${agents.error}`];
        agentIds = agents.data.slice(0, MAX_AGENTS_QUERIED).map((a) => a.id);
    }
    const orgId = (0, seed_1.defaultOrgId)();
    const results = await Promise.all(agentIds.map((id) => (0, client_1.listExecutions)(id).then((r) => [id, r])));
    for (const [id, r] of results) {
        if (!r.ok) {
            problems.push(`Could not load history for agent ${id}: ${r.error}`);
            continue;
        }
        const known = new Set((0, db_1.read)().voiceCalls.map((c) => c.executionId));
        for (const execution of r.data) {
            // Non-terminal executions are re-ingested so a call in progress at the
            // last backfill picks up its final status on the next one.
            const existing = known.has(execution.id) ? (0, db_1.read)().voiceCalls.find((c) => c.executionId === execution.id) : undefined;
            if (existing?.finalisedAt)
                continue;
            try {
                (0, calls_1.ingestExecution)(execution, { brandId, orgId });
            }
            catch (e) {
                problems.push(`Could not ingest call ${execution.id}: ${e.message}`);
            }
        }
    }
    return problems;
}
const overviewCache = new Map();
const OVERVIEW_CACHE_TTL = 60_000;
async function loadVoiceOverview(brandId, opts) {
    const cacheKey = `${brandId}:${opts.days}:${opts.diagnostics}`;
    const hit = overviewCache.get(cacheKey);
    if (hit && Date.now() - hit.at < OVERVIEW_CACHE_TTL) {
        return hit.data;
    }
    const connected = (0, client_1.isConfigured)();
    const [problems, [status, account]] = await Promise.all([
        connected ? backfill(brandId).catch(() => []) : Promise.resolve([]),
        opts.diagnostics && connected
            ? Promise.all([(0, client_1.checkBolnaStatus)().catch(() => null), (0, client_1.getAccount)().catch(() => null)])
            : Promise.resolve([null, null]),
    ]);
    const db = (0, db_1.read)();
    const since = Date.now() - opts.days * 86_400_000;
    const leadsById = new Map(db.leads.map((l) => [l.id, l]));
    const customersById = new Map(db.customers.map((c) => [c.id, c]));
    const calls = db.voiceCalls
        .filter((c) => c.brandId === brandId && new Date(c.startedAt).getTime() >= since)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, MAX_CALLS)
        .map(({ cost: _cost, agentId: _agentId, ...c }) => ({
        ...c,
        leadName: c.leadId ? leadsById.get(c.leadId)?.name ?? null : null,
        customerName: c.customerId ? customersById.get(c.customerId)?.name ?? null : null,
    }));
    // A site visit counts when the lead the call produced has moved to (or past)
    // the visit stage, or an appointment exists for the caller's number after
    // the call. Both are the client's own records, not a provider's guess.
    const callerKeys = new Set(calls.map((c) => (c.callerPhone ? (0, customers_1.normalisePhone)(c.callerPhone) : "")).filter(Boolean));
    const leadIds = new Set(calls.map((c) => c.leadId).filter((id) => Boolean(id)));
    const visitLeads = [...leadIds].filter((id) => {
        const l = leadsById.get(id);
        return l && (FUNNEL_VISIT_STATUSES.has(l.status) || Boolean(l.siteVisitAt));
    });
    const visitAppointments = db.appointments.filter((a) => a.brandId === brandId && a.status !== "cancelled" && callerKeys.has((0, customers_1.normalisePhone)(a.customerPhone)) &&
        new Date(a.createdAt ?? a.startsAt).getTime() >= since && !(a.leadId && leadIds.has(a.leadId)));
    const overview = {
        brandId,
        days: opts.days,
        connected,
        calls,
        funnel: {
            calls: calls.length,
            answered: calls.filter((c) => c.outcome === "completed").length,
            leads: leadIds.size,
            siteVisits: visitLeads.length + visitAppointments.length,
        },
    };
    if (opts.diagnostics) {
        const spend = db.voiceCalls
            .filter((c) => c.brandId === brandId && c.cost !== null)
            .reduce((s, c) => s + (c.cost ?? 0), 0);
        if (account && !account.ok)
            problems.push(`Account: ${account.error}`);
        overview.diagnostics = {
            provider: "Bolna",
            apiKey: connected,
            agentId: (0, client_1.configuredAgentId)(),
            status: status?.message ?? "BOLNA_API_KEY is not set",
            agentCount: status?.agentCount ?? null,
            balance: account?.ok && account.data?.balance !== null && account.data
                ? `${account.data.balance} ${account.data.currency ?? ""}`.trim()
                : null,
            spend: db.voiceCalls.some((c) => c.brandId === brandId && c.cost !== null) ? spend : null,
            webhookSecret: Boolean(process.env.VOICE_WEBHOOK_SECRET),
            problems,
        };
    }
    overviewCache.set(cacheKey, { at: Date.now(), data: overview });
    return overview;
}
