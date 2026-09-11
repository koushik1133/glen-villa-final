/**
 * The marketing vocabulary — formats, tones, languages, draft statuses.
 *
 * Deliberately free of imports. `gemini.ts` pulls in @google/genai and
 * `studio.ts` pulls in the service-role Supabase client, so neither can be
 * referenced from the studio's client component. This module can, which is why
 * the labels and the runtime allowlists live here rather than being written out
 * twice.
 *
 * The `value` strings are the villa_content_format / villa_content_tone /
 * villa_content_status Postgres enums. Adding one here without adding it to
 * supabase/migrations/001_schema.sql will fail on insert.
 */

export interface Option<T extends string> {
  value: T;
  label: string;
  /** One-line explanation of what the format actually produces. */
  hint?: string;
}

export const CONTENT_FORMATS = [
  { value: "post", label: "Social post", hint: "Square feed card" },
  { value: "reel_short", label: "Reel / Short", hint: "9:16 scene storyboard" },
  { value: "whatsapp", label: "WhatsApp message", hint: "Chat broadcast copy" },
  { value: "meta_ad", label: "Meta ad", hint: "Sponsored feed unit" },
  { value: "google_ad", label: "Google ad", hint: "Search result" },
] as const satisfies readonly Option<string>[];

export type ContentFormat = (typeof CONTENT_FORMATS)[number]["value"];

export const CONTENT_TONES = [
  { value: "ultra_luxury", label: "Ultra luxury", hint: "Restrained, aspirational" },
  { value: "urgency_scarcity", label: "Urgency / scarcity", hint: "Limited units, closing soon" },
  { value: "investor_roi", label: "Investor ROI", hint: "Appreciation and yield" },
  { value: "nri_special", label: "NRI special", hint: "Remote buying, repatriation" },
  { value: "architectural_spotlight", label: "Architectural spotlight", hint: "Design, materials, light" },
] as const satisfies readonly Option<string>[];

export type ContentTone = (typeof CONTENT_TONES)[number]["value"];

export const CONTENT_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hinglish", label: "Hinglish" },
  { value: "hi", label: "Hindi" },
  { value: "te", label: "Telugu" },
  { value: "ta", label: "Tamil" },
] as const satisfies readonly Option<string>[];

export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number]["value"];

export const CONTENT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const satisfies readonly Option<string>[];

export type ContentStatus = (typeof CONTENT_STATUSES)[number]["value"];

/**
 * Statuses the studio actually offers.
 *
 * 'scheduled' and 'published' are set by the publish flow, not by hand — there
 * is no scheduler, and claiming something is published is a statement about the
 * outside world that only the publish log can back up.
 */
export const EDITABLE_STATUSES: readonly ContentStatus[] = ["draft", "ready", "archived"];

function lookup<T extends string>(options: readonly Option<T>[]) {
  const byValue = new Map(options.map((o) => [o.value as string, o]));
  return {
    is: (value: string | null | undefined): value is T =>
      typeof value === "string" && byValue.has(value),
    /** Falls back to the raw value de-underscored, so an unmapped enum still reads. */
    label: (value: string): string =>
      byValue.get(value)?.label ?? value.replace(/_/g, " "),
  };
}

export const formats = lookup(CONTENT_FORMATS);
export const tones = lookup(CONTENT_TONES);
export const languages = lookup(CONTENT_LANGUAGES);
export const statuses = lookup(CONTENT_STATUSES);
