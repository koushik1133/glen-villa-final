import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { readPost, respond, safePath, type ActionResult } from "@/lib/osf/form-post";
import { completeFollowUp, completeTask, createFollowUp, createTask } from "@/lib/osf/tasks";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates and completes both tasks and follow-ups — one endpoint, four actions. */
export async function POST(request: Request) {
  const denied = await guard("sales.write");
  if (denied) return denied;
  const body = await readPost(request);
  const action = body.get("action");
  const redirectTo = safePath(body.get("next"), "/os/crm/tasks");

  let result: ActionResult;

  switch (action) {
    case "create_task": {
      result = await createTask({
        title: body.get("title") ?? "",
        description: body.get("description") ?? null,
        leadId: body.get("leadId") ?? null,
        assignedTo: body.get("assignedTo") ?? null,
        priority: body.get("priority"),
        taskType: body.get("taskType"),
        dueAt: body.get("dueAt") ?? null,
      });
      break;
    }

    case "complete_task": {
      const id = body.get("id");
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      result = await completeTask(id);
      break;
    }

    case "create_follow_up": {
      result = await createFollowUp({
        leadId: body.get("leadId") ?? "",
        scheduledAt: body.get("scheduledAt") ?? "",
        assignedTo: body.get("assignedTo") ?? null,
        channel: body.get("channel"),
        message: body.get("message") ?? null,
        templateName: body.get("templateName") ?? null,
        notes: body.get("notes") ?? null,
      });
      break;
    }

    case "complete_follow_up": {
      const id = body.get("id");
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      result = await completeFollowUp(id);
      break;
    }

    default:
      return NextResponse.json(
        {
          error:
            "action must be one of create_task, complete_task, create_follow_up, complete_follow_up",
        },
        { status: 400 },
      );
  }

  if (result.ok) revalidatePath("/os/crm/tasks");

  return respond(request, body, redirectTo, result);
}
