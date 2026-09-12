import { read, resolveBrandId } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { apiError, apiFail, apiOk } from "@/lib/auth/http";
import { actorLabel, getSession } from "@/lib/auth/session";
import {
  ensureInventorySeed,
  InventoryError,
  listUnits,
  setUnitStatus,
  statusSummary,
  UNIT_STATUSES,
  type Project,
} from "@/lib/showcase/inventory";
import { HANDOVER_STAGES, isHandoverStage, paymentPosition, type HandoverStage, type PaymentPosition } from "@/lib/showcase/handover";
import type { InventoryUnit, UnitStatus } from "@/lib/types";

const PROJECTS: Project[] = ["serenity", "onyx"];

/**
 * The staff list the owner dropdown is built from.
 *
 * De-duplicated by name+role: the store carries repeats (a member can be
 * provisioned more than once), and a dropdown listing "Sales Manager 1" three
 * times makes the panel look broken.
 */
function teamOptions(): Array<{ id: string; name: string; role: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string; role: string }> = [];
  for (const m of read().teamMembers) {
    if (!m.active) continue;
    const key = `${m.name}::${m.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: m.id, name: m.name, role: m.role });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve the ids a unit stores into names the panel can print.
 *
 * The unit record keeps IDS and nothing else on purpose — a name copied onto
 * the unit goes stale the moment somebody is renamed, and then the master plan
 * quietly disagrees with the CRM about who a buyer is. Names are presentation,
 * so they are resolved per request here instead.
 *
 * `assignedTo` is deliberately NOT resolved here: it already stores the
 * person's name, the same convention `lead.assignedTo` uses, which is what lets
 * the two be mirrored directly.
 *
 * An id that resolves to nobody yields `undefined` rather than a placeholder:
 * whether that reads as "Unassigned" or as blank is the UI's call, not this
 * function's.
 */
function withNames(units: InventoryUnit[]): Array<InventoryUnit & {
  leadName?: string;
  customerName?: string;
}> {
  const db = read();
  const leads = new Map(db.leads.map((l) => [l.id, l.name]));
  const contacts = new Map(db.crmContacts.map((c) => [c.id, c.name]));
  return units.map((u) => ({
    ...u,
    leadName: u.leadId ? leads.get(u.leadId) : undefined,
    customerName: u.customerId ? contacts.get(u.customerId) : undefined,
  }));
}

/**
 * Payment position per unit, DERIVED from the linked contact's recorded
 * transactions. Never stored on the unit, never settable over this API — see
 * the comment on `paymentPosition()`.
 */
function paymentsFor(units: InventoryUnit[]): Record<string, PaymentPosition> {
  const contacts = read().crmContacts;
  const out: Record<string, PaymentPosition> = {};
  for (const u of units) {
    if (!u.customerId) continue;
    const contact = contacts.find((c) => c.id === u.customerId);
    const position = paymentPosition(contact?.transactions, u.project, u.unitNumber);
    if (position) out[u.id] = position;
  }
  return out;
}

function parseProject(value: string | null): Project | undefined | null {
  if (!value) return undefined;
  return PROJECTS.includes(value as Project) ? (value as Project) : null;
}

/** Units + per-status counts for one project (or the whole brand). */
export async function GET(req: Request) {
  // /showcase itself is gated on `marketing.read` (see page-access.ts), so a
  // marketing-only user must be able to read the statuses the page paints —
  // otherwise the fetch 403s and the layout silently shows every unit as
  // available. Customer-facing roles keep their existing access.
  const denied = (await guard("marketing.read")) && (await guard("customers.read"));
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const project = parseProject(url.searchParams.get("project"));
    if (project === null) return apiFail("Unknown project.");

    const brandId = resolveBrandId(read(), url.searchParams.get("brandId"));
    if (!brandId) return apiFail("No brand configured.", 404);

    // Seeding here keeps the layout clickable on a fresh clone; it never
    // touches a unit a person has already edited.
    ensureInventorySeed(brandId);

    const units = listUnits(brandId, project);
    return apiOk({
      brandId,
      project: project ?? null,
      units: withNames(units),
      summary: statusSummary(brandId, project),
      team: teamOptions(),
      payments: paymentsFor(units),
    });
  } catch (e) {
    return apiError(e);
  }
}

/** Move one unit's sale status. */
export async function PATCH(req: Request) {
  const denied = await guard("sales.write");
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as
      | {
          unitId?: string;
          status?: string;
          leadId?: string;
          customerId?: string;
          notes?: string;
          assignedTo?: string;
          buyerName?: string;
          blockedUntil?: string;
          handoverStage?: string;
          override?: boolean;
        }
      | null;

    if (!body?.unitId) return apiFail("unitId is required.");
    // `status` is optional: reassigning the owner or advancing the handover
    // stage must not force the caller to restate the sale status, which is how
    // a stale value in a form silently reverts a sale.
    if (body.status !== undefined && !UNIT_STATUSES.includes(body.status as UnitStatus)) {
      return apiFail(`status must be one of: ${UNIT_STATUSES.join(", ")}.`);
    }
    if (body.handoverStage !== undefined && !isHandoverStage(body.handoverStage)) {
      return apiFail(`handoverStage must be one of: ${HANDOVER_STAGES.join(", ")}.`);
    }
    if (body.status === undefined && body.handoverStage === undefined && body.assignedTo === undefined) {
      return apiFail("Nothing to change: send status, handoverStage or assignedTo.");
    }

    const actor = actorLabel(await getSession());
    const unit = setUnitStatus(body.unitId, (body.status as UnitStatus | undefined) ?? null, actor, {
      leadId: body.leadId,
      customerId: body.customerId,
      notes: body.notes,
      assignedTo: body.assignedTo,
      buyerName: body.buyerName,
      blockedUntil: body.blockedUntil,
      handoverStage: body.handoverStage as HandoverStage | undefined,
      override: body.override,
    });

    return apiOk({
      unit,
      summary: statusSummary(unit.brandId, unit.project),
      payments: paymentsFor([unit]),
    });
  } catch (e) {
    if (e instanceof InventoryError) return apiFail(e.message);
    return apiError(e);
  }
}
