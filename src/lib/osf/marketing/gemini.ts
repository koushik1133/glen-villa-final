import { GoogleGenAI } from "@google/genai";
import { env } from "../env";
import type { Project, VillaType } from "../types";
import type { ContentFormat, ContentLanguage, ContentTone } from "./formats";

/**
 * Ad/social copy generation.
 *
 * Ported from a separate demo repo (villa-ai-system) — the prompt and output
 * schema were solid, so this keeps them close to the original rather than
 * reinventing. What's different: inputs come from real project data in
 * Supabase instead of hand-typed strings, and there is no "publish" step —
 * see the migration header for why.
 */

export type { ContentFormat, ContentLanguage, ContentTone } from "./formats";

export interface SceneScript {
  sceneNumber: number;
  timeRange: string;
  visualPrompt: string;
  voiceoverOrText: string;
  soundEffectOrAudio: string;
}

export interface GeneratedContent {
  format: ContentFormat;
  headline: string;
  primaryText: string;
  secondaryText?: string;
  hashtags: string[];
  callToAction: string;
  ctaButtonText: string;
  suggestedAudio?: string;
  videoScript?: SceneScript[];
  visualPrompt: string;
  targetAudienceAdvice: string;
  targetPlatforms: string[];
  /** False when this came from the offline fallback template, not Gemini. */
  generatedByAi: boolean;
}

export interface GenerateContentRequest {
  format: ContentFormat;
  projectName: string;
  location?: string;
  price?: string;
  bhk?: string;
  amenities?: string[];
  tone?: ContentTone;
  language?: ContentLanguage;
  customNotes?: string;
}

/** Pulls the strings the generator needs out of real DB records. */
export function inputsFromProject(project: Project, villaType?: VillaType | null) {
  const location = [project.village, project.district, project.state].filter(Boolean).join(", ");

  const price = villaType?.price_inr
    ? `₹${(villaType.price_inr / 10000000).toFixed(2)} Cr`
    : project.starting_price_inr
      ? `₹${(project.starting_price_inr / 10000000).toFixed(2)} Cr onwards`
      : undefined;

  const bhk = villaType?.bedrooms
    ? `${villaType.bedrooms} BHK`
    : project.configurations?.join(" & ");

  const amenities = Array.isArray(project.usps)
    ? (project.usps as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 6)
    : undefined;

  return { projectName: project.name, location: location || undefined, price, bhk, amenities };
}

// -----------------------------------------------------------------------------
// Offline fallback — used when GEMINI_API_KEY isn't configured, or the call
// fails. Keeps the marketing page usable during testing without a Gemini key.
// -----------------------------------------------------------------------------
function fallbackContent(params: GenerateContentRequest): GeneratedContent {
  const {
    format,
    projectName,
    location = "Hyderabad",
    price = "price on request",
    bhk = "3 & 4 BHK",
    amenities = [],
  } = params;
  const amenitiesList = amenities.length > 0 ? amenities.join(", ") : "premium amenities";

  const base = {
    generatedByAi: false,
    hashtags: ["#Villas", `#${projectName.replace(/\s+/g, "")}`, "#RealEstate"],
    targetPlatforms: ["instagram_feed", "facebook_feed"],
  };

  if (format === "reel_short") {
    return {
      ...base,
      format,
      headline: `Step inside ${bhk} villas at ${projectName}, ${location}`,
      primaryText: `A first look at ${projectName} — ${bhk} villas in ${location}.\n\n${amenitiesList}.\n\n📍 ${location}\n🏷️ ${price}\n\nDM for a private walkthrough.`,
      hashtags: [...base.hashtags, "#VillaLiving", "#ArchitecturalDesign"],
      callToAction: "DM to schedule a site visit",
      ctaButtonText: "Book a Tour",
      visualPrompt: `Modern villa exterior at ${projectName}, golden hour, photorealistic architectural photography`,
      targetAudienceAdvice: "Homebuyers and investors evaluating villa projects in this corridor.",
      targetPlatforms: ["instagram_reels", "facebook_reels", "youtube_shorts"],
    };
  }

  if (format === "whatsapp") {
    return {
      ...base,
      format,
      headline: `${projectName} — villa details`,
      primaryText: `*${projectName}*\n\n📍 ${location}\n🏡 ${bhk}\n🏷️ ${price}\n✨ ${amenitiesList}\n\nReply *YES* for the brochure and floor plans.`,
      callToAction: "Reply YES for the brochure",
      ctaButtonText: "Chat on WhatsApp",
      visualPrompt: `Clean invitation-style layout featuring ${projectName}`,
      targetAudienceAdvice: "Existing CRM contacts and referral leads.",
      targetPlatforms: ["whatsapp_status", "whatsapp_broadcast"],
    };
  }

  if (format === "meta_ad") {
    return {
      ...base,
      format,
      headline: `${bhk} villas in ${location} — starting ${price}`,
      primaryText: `${projectName} — ${bhk} villas in ${location}.\n\n${amenitiesList}.\n\nRegister for a site visit.`,
      callToAction: "Book a Site Visit",
      ctaButtonText: "Learn More",
      visualPrompt: `Front elevation of ${projectName}, warm architectural lighting, photorealistic`,
      targetAudienceAdvice: "Real estate investment and homeownership interest, age 28-55, this metro area.",
      targetPlatforms: ["meta_ads_feed", "instagram_feed", "facebook_feed"],
    };
  }

  if (format === "google_ad") {
    return {
      ...base,
      format,
      headline: `${projectName} — ${bhk} in ${location}`,
      secondaryText: `${price} | Download Floor Plans`,
      primaryText: `Explore ${projectName} in ${location}. ${bhk} villas featuring ${amenitiesList}. Book a site visit today.`,
      hashtags: [],
      callToAction: "Schedule a Site Visit",
      ctaButtonText: "Visit Site",
      visualPrompt: `Google Ads display creative for ${projectName}`,
      targetAudienceAdvice: `Search keywords: "villas in ${location.toLowerCase()}", "${bhk.toLowerCase()} villa for sale"`,
      targetPlatforms: ["google_search_ads"],
    };
  }

  return {
    ...base,
    format,
    headline: `${projectName} — ${bhk} villas in ${location}`,
    primaryText: `${projectName}, ${location}.\n\n${bhk} villas featuring ${amenitiesList}.\n\n🏷️ ${price}\n\nDM "BROCHURE" for the digital portfolio.`,
    hashtags: [...base.hashtags, "#LuxuryHomes"],
    callToAction: 'DM "BROCHURE" for the digital portfolio',
    ctaButtonText: "Send Message",
    visualPrompt: `${projectName} exterior, landscaped garden, photorealistic architectural rendering`,
    targetAudienceAdvice: "Instagram and Facebook organic reach, homebuyers and investors.",
  };
}

// -----------------------------------------------------------------------------
// Prompt shaping
// -----------------------------------------------------------------------------

/** What each tone actually means, so five tones don't collapse into one voice. */
const TONE_BRIEF: Record<ContentTone, string> = {
  ultra_luxury:
    "Restrained and aspirational. Short sentences, no exclamation marks, no emoji spam. Sell the feeling of arrival, not the discount.",
  urgency_scarcity:
    "Direct and time-bound. Reference only scarcity that is stated in the property details above — if no unit count or deadline is given, create urgency from the buying decision itself, never from an invented 'only 3 left'.",
  investor_roi:
    "Analytical. Talk corridor growth, rental demand and holding horizon. Do not quote an appreciation percentage or rental yield — no such figure has been supplied.",
  nri_special:
    "Written for a buyer who cannot walk the site. Emphasise virtual walkthroughs, documentation, and the sales team handling things locally. No tax or FEMA claims.",
  architectural_spotlight:
    "Design-led. Materials, proportion, light, elevation, landscaping. Describe what an architect would notice.",
};

const LANGUAGE_BRIEF: Record<ContentLanguage, string> = {
  en: "Write in English.",
  hinglish: "Write in Hinglish — conversational Hindi-English mix in Latin script, as urban Indian buyers actually text.",
  hi: "Write in Hindi, in Devanagari script.",
  te: "Write in Telugu script.",
  ta: "Write in Tamil script.",
};

// -----------------------------------------------------------------------------
// Response normalisation
// -----------------------------------------------------------------------------

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

function sceneArray(value: unknown): SceneScript[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scenes = value
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s, i) => ({
      sceneNumber: typeof s.sceneNumber === "number" ? s.sceneNumber : i + 1,
      timeRange: str(s.timeRange) ?? "",
      visualPrompt: str(s.visualPrompt) ?? "",
      voiceoverOrText: str(s.voiceoverOrText) ?? "",
      soundEffectOrAudio: str(s.soundEffectOrAudio) ?? "",
    }));
  return scenes.length > 0 ? scenes : undefined;
}

/**
 * Model output is untrusted input to a NOT NULL column.
 *
 * A truncated or reshaped response used to reach the insert whole, so a missing
 * `headline` surfaced as a Postgres constraint error rather than as "the model
 * misbehaved, here's the template instead". Anything essential missing means
 * the generation did not succeed, and the caller gets the fallback.
 */
function normalise(raw: unknown, params: GenerateContentRequest): GeneratedContent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const headline = str(r.headline);
  const primaryText = str(r.primaryText);
  if (!headline || !primaryText) return null;

  const template = fallbackContent(params);

  return {
    format: params.format,
    headline,
    primaryText,
    secondaryText: str(r.secondaryText),
    hashtags: strArray(r.hashtags),
    callToAction: str(r.callToAction) ?? template.callToAction,
    ctaButtonText: str(r.ctaButtonText) ?? template.ctaButtonText,
    suggestedAudio: str(r.suggestedAudio),
    videoScript: sceneArray(r.videoScript),
    visualPrompt: str(r.visualPrompt) ?? template.visualPrompt,
    targetAudienceAdvice: str(r.targetAudienceAdvice) ?? template.targetAudienceAdvice,
    targetPlatforms: strArray(r.targetPlatforms).length
      ? strArray(r.targetPlatforms)
      : template.targetPlatforms,
    generatedByAi: true,
  };
}

// -----------------------------------------------------------------------------
// Gemini call
// -----------------------------------------------------------------------------
export async function generateContent(params: GenerateContentRequest): Promise<GeneratedContent> {
  const apiKey = env.geminiApiKey;
  if (!apiKey) return fallbackContent(params);

  try {
    const ai = new GoogleGenAI({ apiKey });

    const tone = params.tone ?? "ultra_luxury";
    const language = params.language ?? "en";

    const prompt = `You are a creative director writing high-converting social/ad copy for a real estate villa developer.

Property Details:
- Project Name: ${params.projectName}
- Location: ${params.location || "Prime Location"}
- Starting Price: ${params.price || "price on request"}
- Configuration: ${params.bhk || "villas"}
- Key Amenities: ${params.amenities?.join(", ") || "premium amenities"}
- Content Format: ${params.format} (post, reel_short, whatsapp, meta_ad, google_ad)
- Custom Focus / Notes: ${params.customNotes || "Focus on the villa's genuine features — do not invent amenities, pricing, or approvals not listed above."}

Tone — ${tone}: ${TONE_BRIEF[tone]}
Language: ${LANGUAGE_BRIEF[language]}

Instructions:
1. A captivating headline.
2. Main caption/ad copy in the requested tone, only using facts given above — never invent price, amenities, approvals, or discounts.
3. If format is 'reel_short', a scene-by-scene 4-scene video script with visual descriptions, voiceover lines, and audio suggestions.
4. 6-8 relevant hashtags. For 'google_ad', return an empty hashtag array — hashtags do not render on search.
5. A call-to-action and button label.
6. An image-generation prompt (visualPrompt) describing the property honestly — label it as a concept/render, not a real photo.
7. Target audience advice.
8. Format constraints: 'google_ad' headline must be at most 30 characters and primaryText at most 90; 'whatsapp' may use WhatsApp markup (*bold*, _italic_) and must stay under 1000 characters.

Respond strictly as JSON matching this shape (no markdown fences, no extra text):
{
  "headline": "string",
  "primaryText": "string",
  "secondaryText": "string (optional)",
  "hashtags": ["string"],
  "callToAction": "string",
  "ctaButtonText": "string",
  "suggestedAudio": "string (optional)",
  "videoScript": [{"sceneNumber":1,"timeRange":"0:00 - 0:03","visualPrompt":"string","voiceoverOrText":"string","soundEffectOrAudio":"string"}],
  "visualPrompt": "string",
  "targetAudienceAdvice": "string",
  "targetPlatforms": ["string"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const cleaned = (response.text ?? "").replace(/```json/gi, "").replace(/```/g, "").trim();
    return normalise(JSON.parse(cleaned), params) ?? fallbackContent(params);
  } catch (error) {
    console.error("[gemini] generation failed, using fallback", error);
    return fallbackContent(params);
  }
}
