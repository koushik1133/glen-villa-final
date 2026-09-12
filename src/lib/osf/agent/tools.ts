import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tool definitions.
 *
 * This array is a module-level constant with a fixed order. Tools render at
 * position 0 of the prompt, so adding, removing or reordering an entry
 * invalidates the entire prompt cache. Append new tools at the end.
 *
 * TOKEN BUDGET — read before editing.
 *
 * These schemas are resent on EVERY call and are the largest single item in
 * each request, so on the Groq free tier (8k tokens/minute) prose here is paid
 * per turn and directly costs reply latency. Keep every description
 * telegraphic: one clause for what the tool does, one for when to call it, and
 * nothing else. Do NOT restore explanatory prose. Anything a parameter NAME
 * already says (project_slug, villa_type, verbatim) gets no description at all,
 * and anything execute.ts already enforces (title/body/caption length caps)
 * must not be re-stated here.
 *
 * The clauses that ARE kept are load-bearing behaviour, not decoration:
 *   - search_knowledge_base must run BEFORE a factual answer, and an empty
 *     result means the agent does not know.
 *   - send_media's url must be copied from a get_assets result. A composed URL
 *     once sent a 404 page to a customer as "brochure.pdf".
 *   - "brochure" means ALL approved brochures, one send_media call each.
 *   - a location/map is a text link, never send_media.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Approved facts. Call BEFORE any factual answer; no hit = you don't know.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project_slug: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_villa_types",
    description:
      "Real configs/sizes/prices. Call before describing or recommending; null = unconfirmed.",
    input_schema: {
      type: "object",
      properties: {
        project_slug: { type: "string" },
        max_budget_inr: { type: "number" },
        bedrooms: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "check_availability",
    description:
      "Live inventory. If none, the team confirms; never invent a unit or count.",
    input_schema: {
      type: "object",
      properties: {
        project_slug: { type: "string" },
        villa_type: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "get_assets",
    description:
      'Fetch approved files; does not send. "Brochure" = ALL returned. location_map gives a map_link for your text.',
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [
            "brochure",
            "floor_plan",
            "site_plan",
            "master_plan",
            "price_sheet",
            "image",
            "video",
            "virtual_tour",
            "location_map",
            "other",
          ],
        },
        project_slug: { type: "string" },
        villa_type: { type: "string" },
      },
      required: ["kind"],
    },
  },
  {
    name: "send_media",
    description:
      "Send a file. url must be copied exactly from get_assets, never composed. No web/map links, never location_map. One call per file.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "brochure",
            "floor_plan",
            "site_plan",
            "master_plan",
            "price_sheet",
            "image",
            "video",
            "virtual_tour",
            "location_map",
            "other",
          ],
        },
        caption: { type: "string" },
      },
      required: ["url", "kind"],
    },
  },
  {
    name: "send_options",
    description: "2-10 tappable choices. Closed questions only.",
    input_schema: {
      type: "object",
      properties: {
        body: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
            },
            required: ["id", "title"],
          },
        },
        list_button_label: { type: "string" },
        footer: { type: "string" },
      },
      required: ["body", "options"],
    },
  },
  {
    name: "update_lead",
    description: "Save what they reveal to the CRM now, not later.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        city: { type: "string" },
        country: { type: "string" },
        is_nri: { type: "boolean" },
        bedrooms: { type: "number" },
        budget_min_inr: { type: "number", description: "Rupees. 1 Cr = 10000000." },
        budget_max_inr: { type: "number" },
        buyer_purpose: {
          type: "string",
          enum: [
            "self_use",
            "family",
            "investment",
            "second_home",
            "vacation_home",
            "rental_income",
            "nri_purchase",
            "undecided",
          ],
        },
        purchase_timeline: {
          type: "string",
          enum: [
            "immediate",
            "within_1_month",
            "1_3_months",
            "3_6_months",
            "6_12_months",
            "researching",
            "unknown",
          ],
        },
        financing_preference: {
          type: "string",
          enum: ["cash", "home_loan", "combination", "undecided"],
        },
        facing_preference: { type: "string" },
        preferred_location: { type: "string" },
        project_slug: { type: "string" },
        villa_type: { type: "string" },
        amenities_of_interest: { type: "array", items: { type: "string" } },
        requirements_notes: { type: "string" },
        preferred_language: { type: "string", description: "ISO code: en, hi, te." },
      },
      required: [],
    },
  },
  {
    name: "schedule_site_visit",
    description: "Log a visit request. The team confirms the slot; never say booked.",
    input_schema: {
      type: "object",
      properties: {
        preferred_date: { type: "string", description: "ISO YYYY-MM-DD." },
        preferred_time: { type: "string" },
        visitor_count: { type: "number" },
        visit_type: { type: "string", enum: ["site", "virtual"] },
        special_requirements: { type: "string" },
      },
      required: ["visit_type"],
    },
  },
  {
    name: "request_human_handoff",
    description:
      "Hand to a human rep with a briefing — see the reason enum. update_lead first. Once per conversation.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "asked_for_salesperson",
            "wants_to_negotiate",
            "ready_to_book",
            "site_visit_ready",
            "legal_question",
            "tax_question",
            "financing_question",
            "complaint",
            "outside_knowledge_base",
            "high_value_lead",
            "strong_buying_intent",
            "other",
          ],
        },
        summary: { type: "string", description: "Who, what they want, next step." },
        urgency: { type: "string", enum: ["immediate", "today", "this_week"] },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "log_objection",
    description: "Log push-back, even if handled well.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "price",
            "location",
            "distance",
            "size",
            "amenities",
            "financing",
            "possession",
            "developer_trust",
            "maintenance",
            "legal",
            "family_approval",
            "other",
          ],
        },
        verbatim: { type: "string" },
      },
      required: ["category"],
    },
  },
  {
    name: "log_unanswered_question",
    description: "Log what you couldn't answer and promised to check.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        verbatim: { type: "string" },
      },
      required: ["topic"],
    },
  },
  {
    name: "opt_out",
    description: "Mark opted out. Call at once on stop/unsubscribe, any language.",
    input_schema: {
      type: "object",
      properties: {
        verbatim: { type: "string" },
      },
      required: [],
    },
  },
];
