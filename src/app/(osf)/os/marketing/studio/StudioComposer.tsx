"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Sparkles, Wand2 } from "lucide-react";
import { Badge, Card } from "@/components/osf/ui";
import {
  CONTENT_FORMATS,
  CONTENT_LANGUAGES,
  CONTENT_TONES,
  formats,
  type ContentFormat,
  type ContentLanguage,
  type ContentTone,
} from "@/lib/osf/marketing/formats";
import type { StudioDraft } from "@/lib/osf/marketing/studio";
import type { Project, VillaType } from "@/lib/osf/types";
import { DevicePreview, type Brand } from "./DevicePreview";

/**
 * The brief on the left, the device mockup on the right.
 *
 * Client-side because the preview has to change as the brief does — everything
 * below it (the draft library, the publish queue) is server-rendered and posts
 * plain forms. After a successful generation this refreshes the route so the
 * new draft appears in that library without a second copy of it living here.
 */

export function StudioComposer({
  projects,
  villaTypes,
  brand,
  initialDraft,
  initialFormat,
  geminiConfigured,
}: {
  projects: Project[];
  villaTypes: VillaType[];
  brand: Brand;
  initialDraft: StudioDraft | null;
  initialFormat: ContentFormat;
  geminiConfigured: boolean;
}) {
  const router = useRouter();

  const [projectId, setProjectId] = useState(initialDraft?.project_id ?? projects[0]?.id ?? "");
  const [villaTypeId, setVillaTypeId] = useState(initialDraft?.villa_type_id ?? "");
  const [format, setFormat] = useState<ContentFormat>(initialFormat);
  const [tone, setTone] = useState<ContentTone>(initialDraft?.tone ?? "ultra_luxury");
  const [language, setLanguage] = useState<ContentLanguage>(
    (initialDraft?.language as ContentLanguage) ?? "en",
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudioDraft | null>(initialDraft);

  const typeOptions = villaTypes.filter((t) => t.project_id === projectId);
  const mismatch = preview !== null && preview.format !== format;

  async function generate() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/osf/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          villaTypeId: villaTypeId || undefined,
          format,
          tone,
          language,
          customNotes: notes || undefined,
        }),
      });
      const data = (await res.json()) as { draft?: StudioDraft; error?: string };
      if (!res.ok || !data.draft) {
        setError(data.error ?? "Generation failed");
        return;
      }
      setPreview(data.draft);
      // The library and the publish queue below are server-rendered, so the
      // new draft only exists down there after the route re-renders.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card title="Brief" hint="Facts come from the project record — the generator is told not to invent any." className="xl:col-span-5">
        <div className="space-y-4">
          <Labelled label="Project">
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setVillaTypeId("");
              }}
              className="field"
            >
              {projects.length === 0 && <option value="">No active projects</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Labelled>

          <Labelled label="Villa type" hint="Optional — pins the price and bedroom count to one type.">
            <select value={villaTypeId} onChange={(e) => setVillaTypeId(e.target.value)} className="field">
              <option value="">Whole project</option>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Labelled>

          <div>
            <p className="label mb-2">Format</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CONTENT_FORMATS.map((f) => {
                const on = f.value === format;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFormat(f.value)}
                    aria-pressed={on}
                    className={`rounded-xl border px-3 py-2 text-left transition ${
                      on
                        ? "border-[var(--color-gold-line)] bg-[var(--color-gold-soft)]"
                        : "border-[var(--color-line)] bg-[var(--color-void)] hover:border-[var(--color-line-strong)]"
                    }`}
                  >
                    <span
                      className={`block text-[12px] font-semibold ${
                        on ? "text-[var(--color-gold-100)]" : "text-[var(--color-ink)]"
                      }`}
                    >
                      {f.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-[var(--color-faint)]">
                      {f.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Labelled label="Tone">
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as ContentTone)}
                className="field"
              >
                {CONTENT_TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.hint}
                  </option>
                ))}
              </select>
            </Labelled>

            <Labelled label="Language">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
                className="field"
              >
                {CONTENT_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Labelled>
          </div>

          <Labelled label="Notes" hint="What to emphasise. Anything factual here must already be true.">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="e.g. lead with the clubhouse and the 40ft road frontage"
              className="field resize-y"
            />
          </Labelled>

          <button type="button" onClick={generate} disabled={busy || !projectId} className="btn-gold w-full">
            <Wand2 size={15} strokeWidth={1.75} aria-hidden />
            {busy ? "Generating…" : "Generate"}
          </button>

          {error && (
            <p className="flex items-start gap-1.5 text-xs text-[var(--color-danger)]">
              <AlertCircle size={13} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <p className="flex items-start gap-1.5 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
            <Sparkles size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
            {geminiConfigured
              ? "GEMINI_API_KEY is set — copy is written by Gemini. If a call fails, the fixed template is used instead and the draft is badged as such."
              : "GEMINI_API_KEY is not set, so every draft will come from the built-in template, not from a model. Set it in .env.local to generate real copy."}
          </p>
        </div>
      </Card>

      <Card
        title="Live preview"
        hint="How the copy sits in the surface it is written for. No image is generated and no engagement figure is shown."
        actions={
          preview ? (
            <Badge tone={preview.generated_by_ai ? "gold" : "warning"}>
              {preview.generated_by_ai ? "Generated by AI" : "Template fallback"}
            </Badge>
          ) : null
        }
        className="xl:col-span-7"
      >
        {mismatch && (
          <p className="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)]/50 px-3.5 py-2.5 text-xs text-[var(--color-muted)]">
            Showing a <span className="text-[var(--color-ink)]">{formats.label(preview.format)}</span> draft.
            Generate to see this brief as a{" "}
            <span className="text-[var(--color-ink)]">{formats.label(format).toLowerCase()}</span>.
          </p>
        )}
        <div className={busy ? "pointer-events-none opacity-50 transition-opacity" : "transition-opacity"}>
          <DevicePreview format={format} draft={preview} brand={brand} />
        </div>
      </Card>
    </div>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {hint && <span className="mb-1.5 mt-0.5 block text-[11px] text-[var(--color-faint)]">{hint}</span>}
      <span className={`block ${hint ? "" : "mt-1.5"}`}>{children}</span>
    </label>
  );
}
