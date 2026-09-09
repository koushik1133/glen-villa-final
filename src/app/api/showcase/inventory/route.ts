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
import type { UnitStatus } from "@/lib/types";

const PROJECTS: Project[] = ["serenity", "onyx"];

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

    return apiOk({
      brandId,
      project: project ?? null,
      units: listUnits(brandId, project),
      summary: statusSummary(brandId, project),
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
          blockedUntil?: string;
          override?: boolean;
        }
      | null;

    if (!body?.unitId) return apiFail("unitId is required.");
    if (!body.status || !UNIT_STATUSES.includes(body.status as UnitStatus)) {
      return apiFail(`status must be one of: ${UNIT_STATUSES.join(", ")}.`);
    }

    const actor = actorLabel(await getSession());
    const unit = setUnitStatus(body.unitId, body.status as UnitStatus, actor, {
      leadId: body.leadId,
      customerId: body.customerId,
      notes: body.notes,
      assignedTo: body.assignedTo,
      blockedUntil: body.blockedUntil,
      override: body.override,
    });

    return apiOk({ unit, summary: statusSummary(unit.brandId, unit.project) });
  } catch (e) {
    if (e instanceof InventoryError) return apiFail(e.message);
    return apiError(e);
  }
}
