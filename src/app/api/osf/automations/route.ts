import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  createAutomation,
  isActionType,
  isConditionOperator,
  toggleAutomation,
  type AutomationAction,
  type AutomationCondition,
} from "@/lib/osf/automations";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create and toggle for /automations.
 *
 * Takes either a JSON body or a plain form POST, same as the Kanban move
 * route: the page submits forms so it works with no client JS, while a script
 * can send the richer JSON shape with multiple conditions and actions.
 */

function conditionFromForm(form: FormData): AutomationCondition[] {
  const field = form.get("conditionField");
  const operator = form.get("conditionOperator");
  const rawValue = form.get("conditionValue");

  // An unset condition row means "run on every lead for this trigger", which
  // is a legitimate rule — not an error.
  if (typeof field !== "string" || !field) return [];
  if (!isConditionOperator(operator)) return [];
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (value === "") return [];

  return [{ field, operator, value }];
}

function actionFromForm(form: FormData): AutomationAction[] {
  const type = form.get("actionType");
  if (!isActionType(type)) return [];

  const text = (key: string): string | undefined => {
    const v = form.get(key);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };

  const config: Record<string, unknown> = {};
  switch (type) {
    case "notify":
      config.title = text("actionTitle");
      config.description = text("actionDescription");
      config.severity = text("actionSeverity");
      break;
    case "create_task":
      config.title = text("actionTitle");
      config.description = text("actionDescription");
      config.priority = text("actionPriority");
      config.dueInHours = text("actionDueInHours");
      break;
    case "change_status":
      config.stage = text("actionStage");
      break;
    case "send_message":
      config.message = text("actionMessage");
      config.templateName = text("actionTemplateName");
      config.delayHours = text("actionDelayHours");
      break;
    case "generate_ai_followup":
      config.delayHours = text("actionDelayHours");
      break;
    case "assign_lead":
      break;
  }

  for (const key of Object.keys(config)) {
    if (config[key] === undefined) delete config[key];
  }

  return [{ type, config }];
}

function conditionsFromJson(value: unknown): AutomationCondition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const c = raw as Record<string, unknown>;
    if (typeof c.field !== "string" || !isConditionOperator(c.operator)) return [];
    const v = c.value;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return [];
    return [{ field: c.field, operator: c.operator, value: v }];
  });
}

function actionsFromJson(value: unknown): AutomationAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const a = raw as Record<string, unknown>;
    if (!isActionType(a.type)) return [];
    const config =
      a.config && typeof a.config === "object" && !Array.isArray(a.config)
        ? (a.config as Record<string, unknown>)
        : {};
    return [{ type: a.type, config }];
  });
}

export async function POST(request: Request) {
  const denied = await guard("workflows.manage");
  if (denied) return denied;
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");

  let intent: unknown;
  let id: unknown;
  let name = "";
  let description: string | null = null;
  let triggerEvent = "";
  let conditions: AutomationCondition[] = [];
  let actions: AutomationAction[] = [];
  let isActive = false;

  if (isJson) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    intent = body.intent ?? "create";
    id = body.id;
    name = typeof body.name === "string" ? body.name : "";
    description = typeof body.description === "string" ? body.description : null;
    triggerEvent = typeof body.triggerEvent === "string" ? body.triggerEvent : "";
    conditions = conditionsFromJson(body.conditions);
    actions = actionsFromJson(body.actions);
    isActive = body.isActive === true;
  } else {
    const form = await request.formData();
    intent = form.get("intent") ?? "create";
    id = form.get("id");
    name = typeof form.get("name") === "string" ? (form.get("name") as string) : "";
    const d = form.get("description");
    description = typeof d === "string" ? d : null;
    triggerEvent = typeof form.get("triggerEvent") === "string" ? (form.get("triggerEvent") as string) : "";
    conditions = conditionFromForm(form);
    actions = actionFromForm(form);
    isActive = form.get("isActive") === "on";
  }

  const fail = (error: string, status: number) => {
    if (isJson) return NextResponse.json({ error }, { status });
    const url = new URL("/inbox/whatsapp/automation/workflows", request.url);
    url.searchParams.set("error", error);
    return NextResponse.redirect(url, { status: 303 });
  };

  if (intent === "toggle") {
    if (typeof id !== "string" || !id) return fail("id is required", 400);
    const result = await toggleAutomation(id);
    if (!result.ok) return fail(result.error, 400);
    revalidatePath("/inbox/whatsapp/automation/workflows");
    return isJson
      ? NextResponse.json({ ok: true, isActive: result.isActive })
      : NextResponse.redirect(new URL("/inbox/whatsapp/automation/workflows", request.url), { status: 303 });
  }

  if (intent !== "create") return fail(`unknown intent: ${String(intent)}`, 400);

  const result = await createAutomation({
    name,
    description,
    triggerEvent,
    conditions,
    actions,
    isActive,
  });
  if (!result.ok) return fail(result.error, 400);

  revalidatePath("/inbox/whatsapp/automation/workflows");
  return isJson
    ? NextResponse.json({ ok: true, id: result.id })
    : NextResponse.redirect(new URL("/inbox/whatsapp/automation/workflows", request.url), { status: 303 });
}
