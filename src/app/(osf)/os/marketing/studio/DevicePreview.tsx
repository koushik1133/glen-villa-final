"use client";

import { useState, type ReactNode } from "react";
import {
  Bookmark,
  ChevronLeft,
  Clock,
  Ellipsis,
  Globe,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  Music,
  Phone,
  Play,
  Search,
  Send,
  Smile,
  Video,
} from "lucide-react";
import { formats, type ContentFormat } from "@/lib/osf/marketing/formats";
import type { StudioDraft } from "@/lib/osf/marketing/studio";

/**
 * Device mockups for the content studio.
 *
 * These are previews of copy, not of results. Two rules hold everywhere below:
 * no engagement number is ever rendered (a like count, a view count or a reach
 * figure would be invented — nothing in this system knows one), and no image is
 * ever fabricated. Where a real post would carry a photo, the frame shows the
 * art-direction brief the generator wrote and says plainly that no image
 * exists yet.
 */

export interface Brand {
  name: string;
  logoUrl: string | null;
  website: string | null;
}

// -----------------------------------------------------------------------------
// WhatsApp markup
// -----------------------------------------------------------------------------

/** *bold*, _italic_, ~strike~ and ```mono``` — the four WhatsApp actually renders. */
const WA_TOKEN = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;

function waFormat(text: string): ReactNode[] {
  return text.split(WA_TOKEN).map((part, i) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(1, -1)}
        </strong>
      );
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("~") && part.endsWith("~") && part.length > 2) {
      return (
        <span key={i} className="line-through">
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith("```") && part.endsWith("```") && part.length > 6) {
      return (
        <code key={i} className="rounded bg-black/30 px-1 font-mono text-[12px]">
          {part.slice(3, -3)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// -----------------------------------------------------------------------------
// Shared chrome
// -----------------------------------------------------------------------------

/**
 * The account avatar in every mockup.
 *
 * The image is drawn only for a same-origin logo. next.config.ts sets
 * `img-src 'self' data: blob:`, so a remote URL would be blocked by the browser
 * and leave a broken-image glyph in the middle of the preview — the monogram is
 * the honest fallback, and /settings explains how to get the real logo in.
 */
function Avatar({ brand, size = 32 }: { brand: Brand; size?: number }) {
  const initial = brand.name.trim().charAt(0).toUpperCase() || "V";
  const local = brand.logoUrl && brand.logoUrl.startsWith("/os") && !brand.logoUrl.startsWith("//");
  return (
    <span
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] text-[11px] font-semibold text-[var(--color-gold-300)]"
    >
      {local ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/image would
        // route this through the optimiser, which is pointless for a local file
        // and adds a second failure mode to a preview.
        <img src={brand.logoUrl!} alt="" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}

/**
 * Stands in for the photo or video that does not exist yet.
 *
 * Deliberately not a stock image or a generated one: the generator writes an
 * art-direction brief, and showing that brief is the truthful rendering of
 * "there is no asset here".
 */
function ConceptFrame({
  prompt,
  aspect,
  label = "No image generated",
  align = "center",
}: {
  prompt: string | null;
  aspect: string;
  label?: string;
  /** "top" keeps the brief clear of anything overlaid on the middle of the frame. */
  align?: "center" | "top";
}) {
  return (
    <div
      style={{ aspectRatio: aspect }}
      className="relative w-full overflow-hidden bg-[linear-gradient(150deg,#1b1a17_0%,#0f0f12_55%,#141319_100%)]"
    >
      <div className="absolute inset-3 rounded-lg border border-dashed border-[var(--color-gold-line)]/60" />
      <div
        className={`absolute inset-0 flex flex-col items-center gap-2 p-6 text-center ${
          align === "top" ? "justify-start pt-14" : "justify-center"
        }`}
      >
        <ImageIcon size={18} strokeWidth={1.5} aria-hidden className="text-[var(--color-gold-500)]/70" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-gold-500)]/80">
          {label}
        </p>
        {prompt && (
          <p className="line-clamp-4 max-w-[92%] text-[11px] leading-relaxed text-[var(--color-muted)]">
            {prompt}
          </p>
        )}
      </div>
    </div>
  );
}

function Hashtags({ tags, className = "" }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <p className={`text-[12px] leading-relaxed text-[#5a8fd6] ${className}`}>
      {tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}
    </p>
  );
}

/** Repeats under every frame so a mockup is never mistaken for a live post. */
function FrameNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-center text-[11px] text-[var(--color-faint)]">{children}</p>;
}

function EmptyFrame({ format }: { format: ContentFormat }) {
  return (
    <div className="flex min-h-[380px] w-full items-center justify-center rounded-2xl border border-dashed border-[var(--color-line)] px-8 text-center">
      <div>
        <p className="text-sm text-[var(--color-muted)]">
          Nothing to preview as a {formats.label(format).toLowerCase()} yet.
        </p>
        <p className="mt-1.5 text-xs text-[var(--color-faint)]">
          Fill in the brief and generate, or pick an existing draft from the library below.
        </p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// reel_short — 9:16 phone
// -----------------------------------------------------------------------------

function ReelPreview({ draft, brand }: { draft: StudioDraft; brand: Brand }) {
  const scenes = draft.video_script ?? [];

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[296px] rounded-[2.5rem] border-[9px] border-[#101014] bg-black shadow-[0_32px_64px_-24px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.06)]">
        <div className="absolute left-1/2 top-1.5 z-20 h-[18px] w-[86px] -translate-x-1/2 rounded-full bg-[#101014]" />
        <div className="h-[526px] overflow-y-auto overscroll-contain rounded-[1.9rem] bg-[var(--color-void)]">
          {/* Cover — what a viewer sees before they tap play. */}
          <div className="relative">
            <ConceptFrame
              prompt={draft.visual_prompt}
              aspect="9 / 13"
              label="Cover — no footage yet"
              align="top"
            />

            {/* Clears the notch, which occupies the first 24px of the screen. */}
            <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-7 text-[10px] font-medium text-white/80">
              <span>Reels</span>
              <span className="flex items-center gap-1">
                <Music size={10} strokeWidth={2} aria-hidden />
                {draft.suggested_audio ? "Audio picked" : "Audio TBD"}
              </span>
            </div>

            {/* Sits below the art-direction brief rather than over it. */}
            <div className="absolute inset-x-0 top-[58%] grid -translate-y-1/2 place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-black/50 backdrop-blur-sm ring-1 ring-white/25">
                <Play size={20} strokeWidth={1.75} fill="currentColor" aria-hidden className="ml-0.5 text-white" />
              </span>
            </div>

            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 pt-10">
              <div className="mb-2 flex items-center gap-2">
                <Avatar brand={brand} size={24} />
                <span className="text-[12px] font-semibold text-white">{brand.name}</span>
              </div>
              <p className="text-[12px] font-medium leading-snug text-white">{draft.headline}</p>
              {draft.call_to_action && (
                <p className="mt-1 text-[11px] text-white/70">{draft.call_to_action}</p>
              )}
            </div>
          </div>

          {/* Storyboard, inside the phone — this is the deliverable an editor shoots from. */}
          <div className="space-y-2.5 p-3">
            <p className="label px-0.5">Storyboard</p>
            {scenes.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[11px] text-[var(--color-faint)]">
                No scene breakdown in this draft. Regenerate as a Reel / Short to get one.
              </p>
            ) : (
              scenes.map((scene) => (
                <div
                  key={scene.sceneNumber}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--color-gold-300)]">
                      Scene {scene.sceneNumber}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--color-faint)]">
                      {scene.timeRange || "—"}
                    </span>
                  </div>
                  <SceneLine label="Visual" value={scene.visualPrompt} />
                  <SceneLine label="Voiceover" value={scene.voiceoverOrText} />
                  <SceneLine label="Audio" value={scene.soundEffectOrAudio} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <FrameNote>
        9:16 · scroll inside the phone for the full storyboard
        {draft.suggested_audio ? ` · audio: ${draft.suggested_audio}` : ""}
      </FrameNote>
    </div>
  );
}

function SceneLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <span className="text-[var(--color-faint)]">{label}: </span>
      {value}
    </p>
  );
}

// -----------------------------------------------------------------------------
// post — 1:1 / 4:5 feed card
// -----------------------------------------------------------------------------

function PostPreview({ draft, brand }: { draft: StudioDraft; brand: Brand }) {
  const [ratio, setRatio] = useState<"1 / 1" | "4 / 5">("1 / 1");

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 inline-flex rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5">
        {(["1 / 1", "4 / 5"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRatio(r)}
            className={`rounded-md px-3 py-1 text-[11px] font-medium transition ${
              ratio === r
                ? "bg-[var(--color-gold-soft)] text-[var(--color-gold-300)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {r.replace(" / ", ":")}
          </button>
        ))}
      </div>

      <div className="w-[352px] max-w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[#0d0d10] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Avatar brand={brand} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-[var(--color-ink)]">{brand.name}</p>
            <p className="truncate text-[10px] text-[var(--color-faint)]">Organic post</p>
          </div>
          <Ellipsis size={15} strokeWidth={2} aria-hidden className="text-[var(--color-muted)]" />
        </div>

        <ConceptFrame prompt={draft.visual_prompt} aspect={ratio} />

        <div className="flex items-center gap-3.5 px-3 pt-2.5 text-[var(--color-ink)]">
          <Heart size={19} strokeWidth={1.6} aria-hidden />
          <MessageCircle size={19} strokeWidth={1.6} aria-hidden />
          <Send size={19} strokeWidth={1.6} aria-hidden />
          <Bookmark size={19} strokeWidth={1.6} aria-hidden className="ml-auto" />
        </div>

        <div className="space-y-1.5 px-3 pb-3.5 pt-2.5">
          <p className="text-[12px] font-semibold text-[var(--color-ink)]">{draft.headline}</p>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-muted)]">
            {draft.primary_text}
          </p>
          <Hashtags tags={draft.hashtags} />
          {draft.call_to_action && (
            <p className="pt-0.5 text-[11px] text-[var(--color-faint)]">{draft.call_to_action}</p>
          )}
        </div>
      </div>

      <FrameNote>Engagement counts are omitted — this post has not been published anywhere.</FrameNote>
    </div>
  );
}

// -----------------------------------------------------------------------------
// whatsapp — chat bubble
// -----------------------------------------------------------------------------

/** Faint doodle wallpaper, built from gradients so no asset has to ship. */
const CHAT_WALLPAPER = {
  backgroundColor: "#0b141a",
  backgroundImage:
    "radial-gradient(circle at 12% 18%, rgba(212,175,55,0.05) 0 1.5px, transparent 2px)," +
    "radial-gradient(circle at 62% 44%, rgba(255,255,255,0.035) 0 1.5px, transparent 2px)," +
    "radial-gradient(circle at 34% 78%, rgba(255,255,255,0.03) 0 1.5px, transparent 2px)",
  backgroundSize: "72px 72px, 96px 96px, 60px 60px",
};

function WhatsappPreview({ draft, brand }: { draft: StudioDraft; brand: Brand }) {
  const chars = draft.primary_text.length;

  return (
    <div className="flex flex-col items-center">
      <div className="w-[352px] max-w-full overflow-hidden rounded-2xl border border-[var(--color-line)] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2.5 bg-[#1f2c33] px-3 py-2.5">
          <ChevronLeft size={16} strokeWidth={2} aria-hidden className="text-white/60" />
          <Avatar brand={brand} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-white">{brand.name}</p>
            <p className="truncate text-[10px] text-white/50">Business account</p>
          </div>
          <Video size={15} strokeWidth={1.75} aria-hidden className="text-white/50" />
          <Phone size={14} strokeWidth={1.75} aria-hidden className="text-white/50" />
        </div>

        <div style={CHAT_WALLPAPER} className="space-y-2 px-3 py-4">
          <p className="mx-auto w-fit rounded-md bg-black/30 px-2 py-1 text-[10px] text-white/50">
            Draft — not sent
          </p>

          <div className="flex justify-end">
            <div className="max-w-[86%] rounded-xl rounded-tr-sm bg-[#0f3b32] shadow-sm">
              <div className="px-2.5 py-2">
                <p className="mb-1 text-[12px] font-semibold text-[#8fd6b4]">{draft.headline}</p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#e9edef]">
                  {waFormat(draft.primary_text)}
                </p>
                <div className="mt-1 flex items-center justify-end gap-1 text-white/40">
                  <Clock size={10} strokeWidth={2} aria-hidden />
                  <span className="text-[10px]">queued</span>
                </div>
              </div>
              {/* A reply button is part of the message bubble, not a second one. */}
              {draft.cta_button_text && (
                <p className="border-t border-white/10 px-2.5 py-2 text-center text-[13px] font-medium text-[#53bdeb]">
                  {draft.cta_button_text}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-[#1f2c33] px-3 py-2.5">
          <Smile size={16} strokeWidth={1.75} aria-hidden className="text-white/40" />
          <span className="flex-1 rounded-full bg-[#2a3942] px-3 py-1.5 text-[11px] text-white/30">
            Message
          </span>
          <Send size={15} strokeWidth={1.75} aria-hidden className="text-white/40" />
        </div>
      </div>

      <FrameNote>
        {chars} characters ·{" "}
        {chars > 1024
          ? "over WhatsApp's 1024-character template body limit"
          : "within WhatsApp's 1024-character template body limit"}
        {" · "}delivery and read status are not shown because this app stores no status webhooks
      </FrameNote>
    </div>
  );
}

// -----------------------------------------------------------------------------
// meta_ad — sponsored feed unit
// -----------------------------------------------------------------------------

function displayHost(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function MetaAdPreview({ draft, brand }: { draft: StudioDraft; brand: Brand }) {
  const host = displayHost(brand.website);

  return (
    <div className="flex flex-col items-center">
      <div className="w-[352px] max-w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[#0d0d10] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Avatar brand={brand} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-[var(--color-ink)]">{brand.name}</p>
            <p className="flex items-center gap-1 text-[10px] text-[var(--color-faint)]">
              Sponsored
              <span aria-hidden>·</span>
              <Globe size={9} strokeWidth={2} aria-hidden />
            </p>
          </div>
          <Ellipsis size={15} strokeWidth={2} aria-hidden className="text-[var(--color-muted)]" />
        </div>

        <div className="px-3 pb-2.5">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-ink)]">
            {draft.primary_text}
          </p>
          <Hashtags tags={draft.hashtags} className="mt-1.5" />
        </div>

        <ConceptFrame prompt={draft.visual_prompt} aspect="1.91 / 1" />

        <div className="flex items-center gap-3 bg-[#16161a] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
              {host ?? "No website set in Settings"}
            </p>
            <p className="truncate text-[12px] font-semibold text-[var(--color-ink)]">{draft.headline}</p>
            {draft.secondary_text && (
              <p className="truncate text-[11px] text-[var(--color-muted)]">{draft.secondary_text}</p>
            )}
          </div>
          <span className="shrink-0 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-raised)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-ink)]">
            {draft.cta_button_text ?? "Learn More"}
          </span>
        </div>
      </div>

      <FrameNote>
        Meta Ads Manager placement preview. No ad account is connected, so this is copy only — nothing
        is submitted for review.
      </FrameNote>
    </div>
  );
}

// -----------------------------------------------------------------------------
// google_ad — SERP preview
// -----------------------------------------------------------------------------

/** Google's responsive search ad limits — worth flagging before Ads Manager does. */
const GOOGLE_HEADLINE_MAX = 30;
const GOOGLE_DESCRIPTION_MAX = 90;

function CharCount({ value, max, label }: { value: number; max: number; label: string }) {
  const over = value > max;
  return (
    <span className={`tabular-nums ${over ? "text-[var(--color-danger)]" : "text-[var(--color-faint)]"}`}>
      {label} {value}/{max}
      {over ? " — too long" : ""}
    </span>
  );
}

function GoogleAdPreview({ draft, brand }: { draft: StudioDraft; brand: Brand }) {
  const host = displayHost(brand.website);
  // Sitelinks are a Google Ads asset this app does not model. Rather than
  // inventing four, the frame shows only the fields the draft really carries.
  const sitelinks = [draft.secondary_text, draft.call_to_action].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );

  return (
    <div className="flex flex-col items-center">
      <div className="w-[420px] max-w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-white shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search size={14} strokeWidth={2} aria-hidden className="text-slate-400" />
          <span className="flex-1 text-[12px] text-slate-400">
            {draft.headline.split(/\s+/).slice(0, 5).join(" ").toLowerCase()}
          </span>
        </div>

        <div className="px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="font-semibold text-slate-800">Sponsored</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
              {brand.name.trim().charAt(0).toUpperCase() || "V"}
            </span>
            <div className="leading-tight">
              <p className="text-[12px] font-medium text-slate-800">{brand.name}</p>
              <p className="text-[11px] text-slate-500">{host ?? "yourdomain — set Website in Settings"}</p>
            </div>
          </div>

          <p className="mt-2 text-[17px] leading-snug text-[#1a0dab] hover:underline">{draft.headline}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">
            {draft.primary_text.replace(/\s+/g, " ")}
          </p>

          {sitelinks.length > 0 ? (
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2.5">
              {sitelinks.map((link, i) => (
                <p key={i} className="truncate text-[12.5px] text-[#1a0dab] hover:underline">
                  {link}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-400">
              No sitelinks in this draft — they are configured on the campaign in Google Ads.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px]">
        <CharCount value={draft.headline.length} max={GOOGLE_HEADLINE_MAX} label="Headline" />
        <CharCount
          value={draft.primary_text.length}
          max={GOOGLE_DESCRIPTION_MAX}
          label="Description"
        />
      </div>
      <FrameNote>
        Sitelinks are drafted from this draft&apos;s second headline and CTA. Google Ads sitelink assets
        live on the campaign, not here.
      </FrameNote>
    </div>
  );
}

// -----------------------------------------------------------------------------

export function DevicePreview({
  format,
  draft,
  brand,
}: {
  format: ContentFormat;
  draft: StudioDraft | null;
  brand: Brand;
}) {
  if (!draft) return <EmptyFrame format={format} />;

  switch (draft.format) {
    case "reel_short":
      return <ReelPreview draft={draft} brand={brand} />;
    case "whatsapp":
      return <WhatsappPreview draft={draft} brand={brand} />;
    case "meta_ad":
      return <MetaAdPreview draft={draft} brand={brand} />;
    case "google_ad":
      return <GoogleAdPreview draft={draft} brand={brand} />;
    default:
      return <PostPreview draft={draft} brand={brand} />;
  }
}
