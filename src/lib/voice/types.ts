/**
 * VOICE MODULE — store types.
 *
 * The voice agent is white-labelled: nothing in these records names the
 * provider, the model or the voice. `VoiceCallRecord` is the shape the client
 * UI reads, so provider cost lives here only for the admin diagnostics view and
 * is never serialised into the client-facing overview.
 */

export interface VoiceTurn {
  /** "agent" | "caller" — normalised from whatever the provider called them. */
  role: "agent" | "caller";
  text: string;
}

export type VoiceOutcome =
  /** The call finished and somebody spoke. */
  | "completed"
  /** Rang out, busy, voicemail, cancelled. */
  | "no_answer"
  /** Provider or telephony fault. */
  | "failed"
  /** Not terminal yet. */
  | "in_progress";

export interface VoiceCallRecord {
  id: string;
  brandId: string;
  /** Provider execution id — the idempotency key for webhook replays. */
  executionId: string;
  agentId: string | null;
  /** Provider's raw status string, e.g. "completed", "no-answer". */
  status: string;
  outcome: VoiceOutcome;
  direction: "inbound" | "outbound" | null;
  /** E.164 where the provider gave one. */
  from: string | null;
  to: string | null;
  /** The customer's number — the inbound caller or the outbound recipient. */
  callerPhone: string | null;
  startedAt: string;
  durationSec: number | null;
  turns: VoiceTurn[];
  /** Plain-text transcript when the provider gave no turns. */
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
  /** Flattened extraction results: "Category · Field" → value. */
  extracted: Record<string, string>;
  /** Provider-side spend. Admin diagnostics only; stripped from client views. */
  cost: number | null;
  /** Linked records, filled once the call reaches a terminal status. */
  customerId: string | null;
  leadId: string | null;
  /** True when a lead was created from this call. */
  leadCreated: boolean;
  /** Why a lead was (or was not) created — shown in the detail drawer. */
  intent: "interested" | "callback" | "none";
  /** Set once the terminal-status side effects (customer, lead, notification) ran. */
  finalisedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const VOICE_LANGUAGES = ["Hindi", "English", "Telugu"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

/**
 * Everything the client may edit about how the agent talks. Text only, on
 * purpose: model, voice and telephony choices are the operator's, not the
 * end client's, and none of them appear here.
 */
export interface VoiceAgentConfig {
  brandId: string;
  businessName: string;
  greeting: string;
  officeHours: string;
  location: string;
  offerings: string[];
  pricingGuidance: string;
  languages: VoiceLanguage[];
  transferTo: string;
  doNotSay: string[];
  updatedAt: string;
  updatedBy: string;
  /** Result of the last push to the provider, for the settings page banner. */
  lastSync: { at: string; ok: boolean; message: string } | null;
}

/**
 * OUTBOUND CALL QUEUE — one number the desk asked the agent to ring.
 *
 * `attempts` counts dials made, not dials remaining, so a run that is retried
 * after a redeploy cannot get a fresh allowance. `notBefore` is how a
 * no-answer waits an hour without a timer having to survive anywhere.
 */
export type VoiceQueueStatus = "queued" | "calling" | "done" | "failed" | "cancelled";

export interface VoiceQueueEntry {
  id: string;
  brandId: string;
  /** The provider agent that will do the talking. */
  agentId: string;
  /** E.164. Validated at enqueue — nothing downstream guesses a country code. */
  phone: string;
  name: string | null;
  /** Set when the number came from a lead rather than a paste. */
  leadId: string | null;
  status: VoiceQueueStatus;
  attempts: number;
  maxAttempts: number;
  /** Provider execution id, once the dial is accepted. Links to VoiceCallRecord. */
  executionId: string | null;
  /** The provider's own words when a dial failed. Shown to the operator. */
  lastError: string | null;
  /** Retry backoff, and the reason a queued entry is not being dialled yet. */
  notBefore: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
