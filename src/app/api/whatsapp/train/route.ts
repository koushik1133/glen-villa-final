import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { mutate, read } from "@/lib/db";
import type { Database } from "@/lib/types";

type WhatsAppConfig = {
  propertyInfo: string;
  localKnowledge: string;
  salesTeam: string;
  bookingFlow: string;
  faqs: string;
  customPrompt: string;
  systemPrompt: string;
  updatedAt: string;
};

type DbWithWhatsApp = Database & { whatsappConfig?: Record<string, WhatsAppConfig> };

/**
 * POST /api/whatsapp/train
 * Saves the WhatsApp AI knowledge base configuration for a brand.
 *
 * `workflows.manage`, the same permission the other configuration surfaces
 * take. This route had NO permission check at all: the middleware only proves
 * a session exists, so every provisioned account — a receptionist holding
 * nothing but `customers.read`, or an account with no permissions whatsoever —
 * could POST here and rewrite `systemPrompt`, the instruction block the agent
 * runs on when it answers real buyers over WhatsApp. That is remote control of
 * what the company says to its customers, handed to the lowest-privileged
 * account in the building.
 *
 * The GET is gated too, and for the same reason it is not merely a mirror: the
 * stored config carries the sales team's direct contacts and the internal
 * pricing and booking playbook, which is not front-desk reading.
 */
export async function POST(req: NextRequest) {
  const denied = await guard("workflows.manage");
  if (denied) return denied;
  try {
    const body = await req.json() as {
      brandId: string;
      propertyInfo: string;
      localKnowledge: string;
      salesTeam: string;
      bookingFlow: string;
      faqs: string;
      customPrompt?: string;
    };

    if (!body.brandId) {
      return NextResponse.json({ ok: false, error: "brandId is required" }, { status: 400 });
    }

    const existing = read();
    const brand = existing.brands.find((b: { id: string }) => b.id === body.brandId);
    if (!brand) {
      return NextResponse.json({ ok: false, error: "Brand not found" }, { status: 404 });
    }

    const systemPrompt = buildSystemPrompt(body);

    const config: WhatsAppConfig = {
      propertyInfo: body.propertyInfo ?? "",
      localKnowledge: body.localKnowledge ?? "",
      salesTeam: body.salesTeam ?? "",
      bookingFlow: body.bookingFlow ?? "",
      faqs: body.faqs ?? "",
      customPrompt: body.customPrompt ?? "",
      systemPrompt,
      updatedAt: new Date().toISOString(),
    };

    mutate((db: DbWithWhatsApp) => {
      if (!db.whatsappConfig) db.whatsappConfig = {};
      db.whatsappConfig[body.brandId] = config;
    });

    return NextResponse.json({ ok: true, systemPrompt });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "An internal error occurred." },
      { status: 500 },
    );
  }
}

/** GET /api/whatsapp/train?brandId=xxx — returns the saved config */
export async function GET(req: NextRequest) {
  const denied = await guard("workflows.manage");
  if (denied) return denied;

  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ ok: false, error: "brandId required" }, { status: 400 });

  const db = read() as DbWithWhatsApp;
  const config = db.whatsappConfig?.[brandId] ?? null;
  return NextResponse.json({ ok: true, config });
}

function buildSystemPrompt(data: {
  propertyInfo: string;
  localKnowledge: string;
  salesTeam: string;
  bookingFlow: string;
  faqs: string;
  customPrompt?: string;
}): string {
  const parts: string[] = [
    `You are a helpful real estate assistant. You are polite, professional, and knowledgeable.`,
    `Always respond in the language the user writes in (English, Hindi, Telugu, etc.).`,
    `Keep responses concise and friendly. Use bullet points when listing options.`,
    ``,
    `## Properties & Pricing`,
    data.propertyInfo || "(Not configured yet — admin needs to fill this in)",
    ``,
    `## Local Knowledge`,
    data.localKnowledge || "(Not configured yet)",
    ``,
    `## Sales Team`,
    data.salesTeam || "(Not configured yet)",
    ``,
    `## Booking & Scheduling`,
    data.bookingFlow || "(Not configured yet)",
    ``,
    `## Frequently Asked Questions`,
    data.faqs || "(Not configured yet)",
  ];

  if (data.customPrompt?.trim()) {
    parts.push(``, `## Additional Instructions`, data.customPrompt.trim());
  }

  parts.push(
    ``,
    `## Guidelines`,
    `- If asked about prices, refer ONLY to the Properties & Pricing section.`,
    `- If asked about schools, hospitals or amenities, refer to Local Knowledge.`,
    `- If the user wants to speak to a salesman or schedule a call, share the Sales Team contacts.`,
    `- If the user asks how to book or schedule a visit, explain the Booking process.`,
    `- If you don't know something, say you'll connect them with a team member.`,
    `- Never make up facts. Only use information provided in the sections above.`,
  );

  return parts.join("\n");
}
