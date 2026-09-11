"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";

/**
 * Regenerate the idea list.
 *
 * The result is reported honestly: when the store holds nothing to derive from,
 * the API says so and that message is shown, rather than a silent no-op that
 * looks like a broken button.
 */
export function GenerateIdeasButton({ brandId }: { brandId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const qs = brandId ? `?brand=${encodeURIComponent(brandId)}` : "";
      const res = await fetch(`/api/ideas/generate${qs}`, { method: "POST" });
      const json = (await res.json()) as {
        ok?: boolean;
        created?: number;
        note?: string;
        signals?: string[];
        error?: string;
      };
      if (!res.ok || json.error) {
        setError(json.error ?? `Could not generate ideas (${res.status}).`);
        return;
      }
      if (!json.created) {
        setMessage(json.note ?? "Nothing to derive from yet.");
        return;
      }
      const n = json.signals?.length ?? 0;
      setMessage(
        `${json.created} idea${json.created === 1 ? "" : "s"} from ${n} signal${n === 1 ? "" : "s"} in your own data.`,
      );
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-[12px] font-medium text-[var(--a-on)] transition hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />}
        {busy ? "Reading your data…" : "Generate ideas"}
      </button>
      {message && <span className="text-[11.5px] text-mist-400">{message}</span>}
      {error && <span className="text-[11.5px] text-bad-400">{error}</span>}
    </div>
  );
}
