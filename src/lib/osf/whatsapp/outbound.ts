import { db } from "../supabase";
import { env } from "../env";
import { sendText, sendTemplate } from "./client";
import { deliverToWhatsApp } from "./deliver";
import { deliverToEvolution, sendEvolutionText } from "../evolution/client";
import type { AgentReply } from "../types";

/**
 * Provider-aware outbound facade.
 *
 * Everything that sends WhatsApp messages outside the webhook reply path —
 * hot-lead alerts, follow-ups, broadcasts, the communication console — goes
 * through here, so flipping WHATSAPP_PROVIDER moves the whole app at once
 * instead of leaving call sites pinned to the old transport.
 */

export function activeProvider(): "meta" | "evolution" {
  return env.whatsappProvider;
}

export async function deliverReply(to: string, reply: AgentReply): Promise<void> {
  if (activeProvider() === "evolution") return deliverToEvolution(to, reply);
  return deliverToWhatsApp(to, reply);
}

export async function sendPlainText(to: string, body: string) {
  if (activeProvider() === "evolution") return sendEvolutionText(to, body);
  return sendText(to, body);
}

/**
 * Sends re-engagement content outside the 24-hour window.
 *
 * On Meta that legally requires a Meta-approved template, addressed by name.
 * On Evolution there is no window and no approval — but the *text* still has
 * to come from somewhere, so the same name is resolved against our own
 * villa_templates registry and its {{n}} placeholders filled from `params`.
 * One template name works on both providers; only who renders it differs.
 */
export async function sendReengagement(
  to: string,
  template: { name: string; language?: string; params?: string[] },
  renderedBody?: string,
) {
  if (activeProvider() === "evolution") {
    const body = renderedBody ?? (await renderFromRegistry(template));
    if (!body) {
      throw new Error(
        `No text to send: template "${template.name}" is not in villa_templates and no rendered body was supplied.`,
      );
    }
    return sendEvolutionText(to, body);
  }
  return sendTemplate(to, template.name, template.language ?? "en", template.params ?? []);
}

async function renderFromRegistry(template: {
  name: string;
  language?: string;
  params?: string[];
}): Promise<string | null> {
  const { data } = await db()
    .from("villa_templates")
    .select("body")
    .eq("name", template.name)
    .order("language", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.body) return null;
  // {{1}}-style placeholders, exactly as Meta numbers them. A param that was
  // never provided renders as "" rather than leaking the "{{2}}" literal.
  return (data.body as string).replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    return template.params?.[Number(n) - 1] ?? "";
  });
}
