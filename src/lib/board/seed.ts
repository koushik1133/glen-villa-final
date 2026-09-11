import type { Board, BoardCard, BoardColumn } from "../types";
import { uid } from "../ids";
import { COLUMN_COLORS, DEFAULT_FIELDS } from "./templates";

/**
 * DEMO SEED — NOT LIVE CLIENT DATA.
 *
 * A brand's first visit to /board used to land on three generic columns and an
 * empty canvas, which shows nothing about what the board is for. This module
 * seeds a social-marketing workflow and a set of sample cards so the screen
 * explains itself the moment it opens.
 *
 * Everything produced here is SAMPLE CONTENT written for demonstration. It is
 * deliberately plausible — real project names, real-looking briefs — because a
 * board full of "Card 1 / lorem ipsum" demonstrates nothing. That is exactly
 * why it is fenced off in a file named `seed.ts`, with every card carrying the
 * `Sample` tag and the `Seeded sample` automation label: nobody reading the
 * board, or this code, should be able to mistake it for a client's real plan.
 *
 * It is applied only to a board that has no cards at all — see
 * `src/app/(app)/board/page.tsx`. A board someone has actually used is never
 * overwritten.
 */

/** The workflow a social-marketing team actually runs, left to right. */
export const MARKETING_COLUMNS: Array<Omit<BoardColumn, "id">> = [
  { name: "Ideas", color: COLUMN_COLORS[7], hitl: false },
  { name: "Drafting", color: COLUMN_COLORS[4], hitl: false },
  { name: "Pending approval", color: COLUMN_COLORS[0], hitl: true },
  { name: "Scheduled", color: COLUMN_COLORS[1], hitl: false },
  { name: "Published", color: COLUMN_COLORS[2], hitl: false },
];

/** Tag every seeded card carries, so sample content is filterable and obvious. */
export const SEED_TAG = "Sample";
const SEED_LABEL = "Seeded sample";

type SeedCard = {
  /** Index into MARKETING_COLUMNS. */
  col: number;
  title: string;
  description: string;
  priority: BoardCard["priority"];
  dueDate?: string;
  assignee: string;
  tags: string[];
};

/**
 * Sample marketing cards for Glentree Homes (Glentree Serenity — 182 triplex
 * villas at Nadergul; Glentree Onyx — a 35-floor tower). Demonstration content.
 */
const SEED_CARDS: SeedCard[] = [
  // Ideas
  {
    col: 0,
    title: "Reel: sunrise drone pass over Serenity's triplex rows",
    description:
      "60-second aerial opening on the Nadergul approach road, ending on a completed triplex facade. Hook in the first 3 seconds: \"182 villas. One gated address.\" Needs a drone slot on a clear morning.",
    priority: "Medium",
    assignee: "Priya Rao",
    tags: [SEED_TAG, "Serenity", "Reel", "Instagram"],
  },
  {
    col: 0,
    title: "Carousel: \"Why South Hyderabad\" — Nadergul connectivity",
    description:
      "Five slides on ORR exit 13, airport drive time, schools and the upcoming metro spur. Positions Serenity for buyers still anchored to the west corridor.",
    priority: "Low",
    assignee: "Arjun Mehta",
    tags: [SEED_TAG, "Serenity", "Carousel", "Awareness"],
  },
  {
    col: 0,
    title: "Onyx: 35th-floor skyline time-lapse for launch teaser",
    description:
      "Terrace-level time-lapse from dusk to city lights, cut to 15 seconds for Reels and Shorts. Book the shoot once the terrace slab is cleared.",
    priority: "Medium",
    assignee: "Priya Rao",
    tags: [SEED_TAG, "Onyx", "Video", "Launch"],
  },

  // Drafting
  {
    col: 1,
    title: "Floor-plan carousel: Serenity triplex (East & West facing)",
    description:
      "Six slides — ground, first and second levels for both orientations, with carpet area callouts and the private terrace highlighted. Copy must state carpet area, not super built-up.",
    priority: "High",
    dueDate: "2026-09-16",
    assignee: "Arjun Mehta",
    tags: [SEED_TAG, "Serenity", "Carousel", "Floor plans"],
  },
  {
    col: 1,
    title: "Walkthrough video: Onyx 3BHK show flat",
    description:
      "Four-minute agent-led walkthrough of the 3BHK show flat — entrance, living, the double-height balcony, kitchen, master. Long cut for YouTube, 45-second vertical cut for Instagram and Facebook.",
    priority: "High",
    dueDate: "2026-09-18",
    assignee: "Sneha Kulkarni",
    tags: [SEED_TAG, "Onyx", "Video", "YouTube"],
  },
  {
    col: 1,
    title: "Meta ad creative: Serenity site-visit weekend",
    description:
      "Three static variants plus one video variant for the 20–21 September site-visit drive. Single CTA — book a slot — pointed at the WhatsApp flow so enquiries land in the inbox, not a form.",
    priority: "Urgent",
    dueDate: "2026-09-15",
    assignee: "Rahul Verma",
    tags: [SEED_TAG, "Serenity", "Meta ads", "Site visit"],
  },

  // Pending approval
  {
    col: 2,
    title: "Diwali post: \"Light up your own address\" — Serenity",
    description:
      "Festive still of a lit triplex portico with diyas along the drive. Greeting-led, no pricing. Waiting on brand sign-off for the lamp motif and the festive logo lockup.",
    priority: "High",
    dueDate: "2026-09-20",
    assignee: "Priya Rao",
    tags: [SEED_TAG, "Serenity", "Festive", "Diwali"],
  },
  {
    col: 2,
    title: "Possession update: Serenity Phase 1 handover milestone",
    description:
      "Announcement that Phase 1 villas enter handover from December. Every claim in the caption needs a sign-off from projects before it goes out — a slipped date posted publicly is a commitment.",
    priority: "Urgent",
    dueDate: "2026-09-14",
    assignee: "Sneha Kulkarni",
    tags: [SEED_TAG, "Serenity", "Possession", "Approval"],
  },
  {
    col: 2,
    title: "Testimonial post: Serenity homeowner, Block C",
    description:
      "Ninety-second interview cut with an early homeowner on why they picked a triplex over an apartment. Held until the written consent form for name and face is on file.",
    priority: "Medium",
    dueDate: "2026-09-17",
    assignee: "Arjun Mehta",
    tags: [SEED_TAG, "Serenity", "Testimonial", "Consent"],
  },

  // Scheduled
  {
    col: 3,
    title: "Site-visit campaign: Serenity open weekend, 20–21 Sept",
    description:
      "Organic push across Instagram, Facebook and the broker WhatsApp lists, staggered Thursday and Saturday morning. Pinned story with the slot-booking link for the full weekend.",
    priority: "High",
    dueDate: "2026-09-19",
    assignee: "Rahul Verma",
    tags: [SEED_TAG, "Serenity", "Site visit", "Instagram"],
  },
  {
    col: 3,
    title: "Onyx: construction progress reel — 22nd slab poured",
    description:
      "Thirty-second progress reel from the site camera, with the floor counter overlaid. Goes out Friday 9am, the slot that has consistently carried progress updates furthest.",
    priority: "Medium",
    dueDate: "2026-09-18",
    assignee: "Priya Rao",
    tags: [SEED_TAG, "Onyx", "Reel", "Progress"],
  },
  {
    col: 3,
    title: "Ugadi teaser: booking-window announcement for Onyx",
    description:
      "Festive teaser opening the Ugadi booking window, scheduled ahead of the festival so the offer terms clear legal first. Regional copy in Telugu and English.",
    priority: "Medium",
    dueDate: "2026-09-22",
    assignee: "Sneha Kulkarni",
    tags: [SEED_TAG, "Onyx", "Festive", "Ugadi"],
  },

  // Published
  {
    col: 4,
    title: "Reel: 3-minute drive from Serenity gate to ORR",
    description:
      "Dashcam-style reel answering the single most common enquiry on connectivity. Best-performing organic post of the month — 41k plays, 62 saves.",
    priority: "Medium",
    assignee: "Arjun Mehta",
    tags: [SEED_TAG, "Serenity", "Reel", "Connectivity"],
  },
  {
    col: 4,
    title: "Onyx launch-day carousel: tower, amenities, price band",
    description:
      "Launch announcement carousel with the amenity deck, sky lounge and the opening price band. Drove 180 enquiries in the first 48 hours.",
    priority: "High",
    assignee: "Rahul Verma",
    tags: [SEED_TAG, "Onyx", "Carousel", "Launch"],
  },
];

/** Seeded columns, each with a fresh id. */
export function marketingColumns(): BoardColumn[] {
  return MARKETING_COLUMNS.map((c) => ({ ...c, id: uid("col") }));
}

/**
 * Build the sample cards for a board. Cards are positioned in column order and
 * stamped with the seed's automation label so their origin is visible in the UI.
 */
export function seedMarketingCards(board: Board, now = new Date().toISOString()): BoardCard[] {
  const perColumn: number[] = MARKETING_COLUMNS.map(() => 0);
  return SEED_CARDS.flatMap((c) => {
    const column = board.columns[c.col];
    // A board whose columns were edited may not have this index. Dropping the
    // card beats writing an orphan that shows up in the orphan banner.
    if (!column) return [];
    const card: BoardCard = {
      id: uid("card"),
      boardId: board.id,
      brandId: board.brandId,
      columnId: column.id,
      title: c.title,
      description: c.description,
      priority: c.priority,
      dueDate: c.dueDate,
      tags: c.tags,
      assignee: c.assignee,
      automationLabel: SEED_LABEL,
      order: perColumn[c.col]++,
      createdAt: now,
      updatedAt: now,
    };
    return [card];
  });
}

/**
 * A marketing board plus its sample cards. Used for a brand's first board, and
 * to fill a board that exists but has never held a card.
 */
export function seedMarketingBoard(brandId: string, name: string): { board: Board; cards: BoardCard[] } {
  const now = new Date().toISOString();
  const board: Board = {
    id: uid("board"),
    brandId,
    name,
    columns: marketingColumns(),
    // The seeded cards carry automation labels, so that field is switched on.
    fields: { ...DEFAULT_FIELDS, automationLabel: true },
    templateId: "content",
    createdAt: now,
    updatedAt: now,
  };
  return { board, cards: seedMarketingCards(board, now) };
}
