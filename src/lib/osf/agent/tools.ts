import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tool definitions.
 *
 * This array is a module-level constant with a fixed order. Tools render at
 * position 0 of the prompt, so adding, removing or reordering an entry
 * invalidates the entire prompt cache. Append new tools at the end.
 *
 * Descriptions are prescriptive about WHEN to call, not just what the tool
 * does — that measurably raises the should-call rate.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Search the approved project knowledge base. Call this BEFORE answering any factual question about a project — amenities, clubhouse, parks, specifications, materials, construction, approvals, RERA, HMDA, possession date, location, connectivity, distances, nearby schools or hospitals, sustainability, security, utilities, parking, or anything the customer asks 'what', 'how many', 'is there' or 'do you have' about. Returns only approved content. If it returns nothing relevant, you do not know the answer.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What the customer wants to know, in your own words. e.g. 'clubhouse size and facilities' or 'distance to airport'.",
        },
        project_slug: {
          type: "string",
          description:
            "Optional. Restrict to one project when the customer named it. Omit to search all projects.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_villa_types",
    description:
      "List the real villa configurations for a project — plot size, built-up area, facing, bedrooms, floors and price. Call this whenever the customer asks about sizes, BHK, plot area, square footage, facing, or layouts, and ALWAYS before recommending an option. Never describe a villa type from memory. A null price or null bedroom count means that fact is unconfirmed and you must say the sales team will confirm it.",
    input_schema: {
      type: "object",
      properties: {
        project_slug: { type: "string", description: "Optional project slug filter." },
        max_budget_inr: {
          type: "number",
          description:
            "Optional. Filter to types at or under this rupee amount. Types with no recorded price are always returned, flagged as unconfirmed.",
        },
        bedrooms: { type: "number", description: "Optional bedroom count filter." },
      },
      required: [],
    },
  },
  {
    name: "check_availability",
    description:
      "Check live unit inventory. Call whenever the customer asks what is available, what is left, how many are unsold, or about a specific unit number. If this reports that no live inventory is connected, tell the customer the sales team will confirm current availability — do NOT imply you can see stock, and never invent a unit number or a count.",
    input_schema: {
      type: "object",
      properties: {
        project_slug: { type: "string", description: "Optional project slug filter." },
        villa_type: { type: "string", description: "Optional villa type name filter." },
      },
      required: [],
    },
  },
  {
    name: "get_assets",
    description:
      "Retrieve approved marketing material — brochure, floor plan, site plan, master plan, price sheet, images, video, virtual tour, location map. Call when the customer asks for any of these, or when sending one would obviously help (e.g. after recommending a villa type, get its floor plan). Returns only the current approved version. Retrieving does not send it — call send_media to actually deliver it.",
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
          description: "Which kind of material to fetch.",
        },
        project_slug: { type: "string", description: "Optional project slug filter." },
        villa_type: {
          type: "string",
          description: "Optional villa type name, for type-specific floor plans.",
        },
      },
      required: ["kind"],
    },
  },
  {
    name: "send_media",
    description:
      "Deliver a retrieved asset to the customer on WhatsApp. Only pass a URL that came back from get_assets in this conversation — never a URL you constructed. Include a short caption saying what it is.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Asset URL returned by get_assets." },
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
        caption: { type: "string", description: "One short line describing the file." },
      },
      required: ["url", "kind"],
    },
  },
  {
    name: "send_options",
    description:
      "Send your message with tappable choices instead of asking the customer to type. Use this whenever the answer is one of a small known set — villa type, budget band, site-visit day, financing method, yes/no. It measurably raises reply rates over free text, so prefer it for any closed question. Do not use it for open questions, and do not send options the customer did not ask to choose between.",
    input_schema: {
      type: "object",
      properties: {
        body: {
          type: "string",
          description: "The question, in your normal voice. Max 1024 characters.",
        },
        options: {
          type: "array",
          description:
            "2 to 10 choices. Up to 3 render as buttons; 4 or more become a tappable menu automatically.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Short stable identifier, e.g. 'budget_3_4cr'. Comes back to you verbatim when tapped.",
              },
              title: {
                type: "string",
                description: "What the customer sees. Keep under 20 characters or it gets trimmed.",
              },
              description: {
                type: "string",
                description: "Optional second line, menu style only. Under 72 characters.",
              },
            },
            required: ["id", "title"],
          },
        },
        list_button_label: {
          type: "string",
          description:
            "Only for 4+ options: the label on the button that opens the menu, e.g. 'View villa types'. Defaults to 'Choose'.",
        },
        footer: { type: "string", description: "Optional small print under the options." },
      },
      required: ["body", "options"],
    },
  },
  {
    name: "update_lead",
    description:
      "Record what you have learned about this customer in the CRM. Call this the moment they reveal anything — name, city, country, budget, bedrooms, purpose, timeline, financing, facing preference, or what matters to them. Do not batch it to the end of the conversation; the sales team reads this live. Only pass fields you actually learned; omit the rest.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        city: { type: "string" },
        country: { type: "string" },
        is_nri: { type: "boolean", description: "True if they live outside India." },
        bedrooms: { type: "number" },
        budget_min_inr: { type: "number", description: "Lower bound in rupees. 1 crore = 10000000." },
        budget_max_inr: { type: "number", description: "Upper bound in rupees." },
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
        facing_preference: { type: "string", description: "e.g. East, West, no preference." },
        preferred_location: { type: "string" },
        project_slug: { type: "string", description: "Project they are interested in." },
        villa_type: { type: "string", description: "Villa type they are interested in." },
        amenities_of_interest: { type: "array", items: { type: "string" } },
        requirements_notes: {
          type: "string",
          description: "Anything else worth the sales team knowing, in one or two lines.",
        },
        preferred_language: { type: "string", description: "ISO code, e.g. en, hi, te." },
      },
      required: [],
    },
  },
  {
    name: "schedule_site_visit",
    description:
      "Log a site visit or virtual tour request. Call as soon as the customer agrees to visit or asks to. Collect the date and rough time first. This creates a request for the sales team to confirm — tell the customer the team will confirm the slot, never that it is already booked.",
    input_schema: {
      type: "object",
      properties: {
        preferred_date: { type: "string", description: "ISO date, YYYY-MM-DD." },
        preferred_time: { type: "string", description: "e.g. 'Saturday morning', '4pm'." },
        visitor_count: { type: "number" },
        visit_type: {
          type: "string",
          enum: ["site", "virtual"],
          description: "'virtual' for a video walkthrough, typically for NRI or remote buyers.",
        },
        special_requirements: { type: "string" },
      },
      required: ["visit_type"],
    },
  },
  {
    name: "request_human_handoff",
    description:
      "Hand the conversation to a human sales representative and send them a full briefing. Call when the customer asks for a salesperson or manager, wants to negotiate or asks for a discount, is ready to book, asks a legal / tax / financing question beyond approved material, complains or is upset, asks something the knowledge base cannot answer, or shows strong buying intent. Call update_lead first so the briefing is complete. Do not call this twice for the same conversation.",
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
        summary: {
          type: "string",
          description:
            "Two or three sentences the rep can read in under 30 seconds: who this is, what they want, and what to do next.",
        },
        urgency: { type: "string", enum: ["immediate", "today", "this_week"] },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "log_objection",
    description:
      "Record a concern or push-back the customer raised — price, location, distance, size, amenities, financing, possession timeline, developer trust, maintenance, legal, or needing family approval. Log it even when you address it successfully. This is aggregated anonymously for the marketing team, so log every occurrence.",
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
        verbatim: { type: "string", description: "What the customer actually said." },
      },
      required: ["category"],
    },
  },
  {
    name: "log_unanswered_question",
    description:
      "Record a question you could not answer from the knowledge base. Call this every time you tell a customer you will have the team confirm something — otherwise nobody follows up and you have made a promise the company cannot keep.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Short topic label, e.g. 'maintenance charges'." },
        verbatim: { type: "string", description: "The customer's question." },
      },
      required: ["topic"],
    },
  },
  {
    name: "opt_out",
    description:
      "Mark this customer as opted out of all messaging. Call immediately and without argument if they say stop, unsubscribe, remove me, don't message me, do not contact me, or anything equivalent in any language. Acknowledge briefly and politely, then send nothing further.",
    input_schema: {
      type: "object",
      properties: {
        verbatim: { type: "string", description: "What they said." },
      },
      required: [],
    },
  },
];
