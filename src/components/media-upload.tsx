"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Lock, Upload } from "lucide-react";
import clsx from "clsx";
import { Badge, Button } from "./ui";

/**
 * MEDIA UPLOAD
 *
 * The library was populated by a seed and nothing else: `/api/media/upload` was
 * fully built but had no caller anywhere in the app, so with the seed gone the
 * Studio had nothing to edit and read as broken. This is the missing front door.
 *
 * `XMLHttpRequest` rather than `fetch` purely for `upload.onprogress` — a 400 MB
 * video over a domestic uplink is minutes of silence otherwise, which is
 * indistinguishable from a hang. The server's own rejection text is shown
 * verbatim (too large / wrong container / rate limited), because those messages
 * already say precisely what to do and paraphrasing them loses the numbers.
 */

/**
 * Mirrors `validateUpload` in `src/lib/media/store.ts` exactly. The server
 * confirms the container from its magic bytes regardless; this only keeps the
 * file picker from offering files that are certain to be refused.
 */
const ACCEPT = "video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp";

/** Must match `MAX_BYTES` in `src/lib/media/store.ts`. */
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_MB = MAX_BYTES / 1048576;

type State =
  | { phase: "idle" }
  | { phase: "uploading"; name: string; percent: number | null }
  | { phase: "done"; name: string }
  | { phase: "error"; message: string };

export function MediaUpload({ canUpload, projectId }: { canUpload: boolean; projectId?: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: "idle" });

  if (!canUpload) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-800/40 p-3">
        <Lock size={13} className="mt-0.5 shrink-0 text-mist-400" />
        <p className="text-[11.5px] leading-relaxed text-mist-400">
          Uploading needs the <span className="text-mist-200">marketing.publish</span> permission, which this account
          does not have. Ask an administrator to grant it, or have someone who can publish add the clip.
        </p>
      </div>
    );
  }

  function pick() {
    inputRef.current?.click();
  }

  function onFile(file: File) {
    // Refuse oversize files here rather than after uploading half a gigabyte
    // only to be told by the server that it was never going to be accepted.
    if (file.size > MAX_BYTES) {
      setState({
        phase: "error",
        message: `That file is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${MAX_MB} MB.`,
      });
      return;
    }
    if (file.size === 0) {
      setState({ phase: "error", message: "The file is empty." });
      return;
    }

    const body = new FormData();
    body.append("file", file);
    if (projectId) body.append("projectId", projectId);

    setState({ phase: "uploading", name: file.name, percent: 0 });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");

    xhr.upload.onprogress = (e) => {
      setState({
        phase: "uploading",
        name: file.name,
        percent: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null,
      });
    };

    xhr.onload = () => {
      let json: { ok?: boolean; error?: string } = {};
      try {
        json = JSON.parse(xhr.responseText) as { ok?: boolean; error?: string };
      } catch {
        /* A non-JSON body means something upstream answered; fall through. */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.ok) {
        setState({ phase: "done", name: file.name });
        // The library is rendered by a Server Component, so the new row only
        // exists for the page once the server re-renders it.
        router.refresh();
        return;
      }
      setState({
        phase: "error",
        message: json.error ?? `Upload failed (${xhr.status || "no response"}).`,
      });
    };

    xhr.onerror = () => setState({ phase: "error", message: "Upload failed — the connection dropped." });
    xhr.onabort = () => setState({ phase: "idle" });

    xhr.send(body);
  }

  const uploading = state.phase === "uploading";

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Reset so picking the same file twice still fires a change event.
          e.target.value = "";
          if (f) onFile(f);
        }}
      />

      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={pick}
        disabled={uploading}
        className="w-full"
      >
        {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        {uploading ? "Uploading…" : "Upload clip"}
      </Button>

      <p className="text-[10.5px] leading-relaxed text-mist-400">
        MP4, MOV, WebM, JPEG, PNG or WebP · up to {MAX_MB} MB
      </p>

      {uploading && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[10.5px] text-mist-400">
            <span className="min-w-0 flex-1 truncate text-mist-300">{state.name}</span>
            <span className="tnum shrink-0">{state.percent === null ? "sending" : `${state.percent}%`}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className={clsx(
                "h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-300",
                state.percent === null && "animate-pulse",
              )}
              style={{ width: `${state.percent ?? 100}%` }}
            />
          </div>
          {state.percent === 100 && (
            <p className="text-[10.5px] text-mist-400">Transferred — the server is probing and storing it.</p>
          )}
        </div>
      )}

      {state.phase === "done" && (
        <div className="flex items-center gap-1.5">
          <Badge tone="good">
            <CheckCircle2 size={10} /> Added
          </Badge>
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-mist-400">{state.name}</span>
        </div>
      )}

      {state.phase === "error" && (
        <div className="flex items-start gap-1.5 rounded-lg border border-bad-500/30 bg-bad-500/10 p-2">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-bad-400" />
          <p className="min-w-0 text-[11px] leading-relaxed text-bad-400">{state.message}</p>
        </div>
      )}
    </div>
  );
}
