import { revalidatePath } from "next/cache";
import { readPost, respond, safePath, type ActionResult, type PostBody } from "@/lib/osf/form-post";
import {
  createAutomation,
  deleteAutomation,
  isActionType,
  isConditionOperator,
  toggleAutomation,
  type AutomationAction,
  type AutomationCondition,
} from "@/lib/osf/automations";
import { markAllRead, markRead } from "@/lib/osf/notifications";
import { rebalanceUnassigned } from "@/lib/osf/routing";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every write behind /automation — workflows, routing and notifications.
 *
 * One handler rather than three because the three pages act on the same two
 * tables: a routing rule *is* a villa_automations row, and a notification
 * preference *is* a notify action on one. Splitting them would have meant
 * three routes able to disagree about what a rule looks like.
 *
 * Takes a plain form POST or JSON. The field names are identical either way —
 * flat and repeated-by-index — so a script and the browser exercise exactly
 * the same parser.
 */

const WORKFLOWS = "/os/automation/workflows";
const ROUTING = "/os/automation/routing";
const NOTIFICATIONS = "/os/automation/notifications";

/** Condition rows the form may submit, as `condition0Field`, `condition1Field`… */
const MAX_CONDITIONS = 6;

function conditions(body: PostBody): AutomationCondition[] {
  const rows: AutomationCondition[] = [];

  for (let i = 0; i < MAX_CONDITIONS; i += 1) {
    const field = body.get(`condition${i}Field`);
    const operator = body.get(`condition${i}Operator`);
    const value = body.get(`condition${i}Value`);

    // A row with no value means "every lead on this trigger", which is a
    // legitimate rule rather than an error — skip it silently.
    if (!field || !isConditionOperator(operator) || value === undefined) continue;
    rows.push({ field, operator, value });
  }

  return rows;
}

/** Numbers reach the config as numbers, so a stored rule reads as it was typed. */
function numeric(body: PostBody, name: string): number | undefined {
  const raw = body.get(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function prune(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(config)) {
    if (config[key] === undefined) delete config[key];
  }
  return config;
}

function assignConfig(body: PostBody): Record<string, unknown> {
  return prune({
    matchLeadLanguage: body.bool("actionMatchLeadLanguage") || undefined,
    language: body.get("actionLanguage"),
    department: body.get("actionDepartment"),
    memberId: body.get("actionMemberId"),
    reassign: body.bool("actionReassign") || undefined,
  });
}

function action(body: PostBody): AutomationAction[] {
  const type = body.get("actionType");
  if (!isActionType(type)) return [];

  switch (type) {
    case "notify":
      return [
        {
          type,
          config: prune({
            title: body.get("actionTitle"),
            description: body.get("actionDescription"),
            severity: body.get("actionSeverity"),
            href: body.get("actionHref"),
          }),
        },
      ];
    case "create_task":
      return [
        {
          type,
          config: prune({
            title: body.get("actionTitle"),
            description: body.get("actionDescription"),
            priority: body.get("actionPriority"),
            taskType: body.get("actionTaskType"),
            dueInHours: numeric(body, "actionDueInHours"),
          }),
        },
      ];
    case "change_status":
      return [{ type, config: prune({ stage: body.get("actionStage") }) }];
    case "send_message":
      return [
        {
          type,
          config: prune({
            message: body.get("actionMessage"),
            templateName: body.get("actionTemplateName"),
            channel: body.get("actionChannel"),
            delayHours: numeric(body, "actionDelayHours"),
          }),
        },
      ];
    case "generate_ai_followup":
      return [{ type, config: prune({ delayHours: numeric(body, "actionDelayHours") }) }];
    case "assign_lead":
      return [{ type, config: assignConfig(body) }];
  }
}

export async function POST(request: Request) {
  const denied = await guard("workflows.manage");
  if (denied) return denied;
  const body = await readPost(request);
  const intent = body.get("intent");
  const id = body.get("id");

  const fallback =
    intent === "rebalance" || intent === "create-routing-rule"
      ? ROUTING
      : intent === "mark-read" || intent === "mark-all-read"
        ? NOTIFICATIONS
        : WORKFLOWS;
  const back = safePath(body.get("next"), fallback);

  const done = (result: ActionResult) => {
    // Every one of these pages reads from villa_automations or
    // villa_notifications, so a write on any of them can stale the others.
    if (result.ok) {
      revalidatePath(WORKFLOWS);
      revalidatePath(ROUTING);
      revalidatePath(NOTIFICATIONS);
    }
    return respond(request, body, back, result);
  };

  switch (intent) {
    case "create-rule": {
      const result = await createAutomation({
        name: body.get("name") ?? "",
        description: body.get("description") ?? null,
        triggerEvent: body.get("triggerEvent") ?? "",
        conditions: conditions(body),
        actions: action(body),
        isActive: body.bool("isActive"),
      });
      return done(result.ok ? { ok: true, id: result.id } : result);
    }

    // A routing rule is an ordinary automation — trigger lead_created with an
    // assign_lead action — so /automation/routing reuses the same engine and
    // the same run log rather than owning a second assignment path.
    case "create-routing-rule": {
      const language = body.get("actionLanguage");
      const matchLead = body.bool("actionMatchLeadLanguage");
      const name =
        body.get("name") ??
        (matchLead
          ? "Route by the lead's own language"
          : language
            ? `Route ${language} speakers`
            : "Route new leads round-robin");

      const result = await createAutomation({
        name,
        description: body.get("description") ?? null,
        triggerEvent: "lead_created",
        conditions: conditions(body),
        actions: [{ type: "assign_lead", config: assignConfig(body) }],
        isActive: body.bool("isActive"),
      });
      return done(result.ok ? { ok: true, id: result.id } : result);
    }

    case "toggle-rule": {
      if (!id) return done({ ok: false, error: "id is required" });
      const result = await toggleAutomation(id);
      return done(result.ok ? { ok: true, isActive: result.isActive } : result);
    }

    case "delete-rule": {
      if (!id) return done({ ok: false, error: "id is required" });
      return done(await deleteAutomation(id));
    }

    case "rebalance": {
      const result = await rebalanceUnassigned();
      return done(result.ok ? { ok: true, ...result.result } : result);
    }

    case "mark-read": {
      if (!id) return done({ ok: false, error: "id is required" });
      await markRead(id);
      return done({ ok: true });
    }

    case "mark-all-read": {
      await markAllRead();
      return done({ ok: true });
    }

    default:
      return done({ ok: false, error: `unknown intent: ${String(intent)}` });
  }
}
