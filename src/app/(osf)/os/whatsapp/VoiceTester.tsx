"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/osf/ui";

/**
 * Records a voice note in the browser and pushes it through the same
 * transcribe → agent path a real WhatsApp voice note takes, so the voice
 * pipeline can be verified before Meta is connected at all.
 */
export function VoiceTester() {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [reply, setReply] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setError(null);
    setTranscript(null);
    setReply([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void upload(new Blob(chunksRef.current, { type: rec.mimeType }));
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError("Microphone access was denied, or this browser can't record audio.");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function upload(blob: Blob) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "voice.webm");
      const res = await fetch("/api/osf/whatsapp/test-voice", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Transcription failed");
      } else {
        setTranscript(data.transcript);
        setLanguage(data.language ?? null);
        setReply(data.replies ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Test voice notes"
      hint="Record here and it runs the exact path a WhatsApp voice note takes: download, Whisper transcription, then the sales agent. Works before Meta is connected."
    >
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <button onClick={start} disabled={busy} className="btn-gold">
            {busy ? "Processing…" : "● Record a voice note"}
          </button>
        ) : (
          <button onClick={stop} className="btn-ghost">
            ■ Stop and transcribe
          </button>
        )}
        {recording && (
          <span className="flex items-center gap-2 text-xs text-[var(--color-danger)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-danger)]" />
            recording — try Hindi or Telugu too
          </span>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-[var(--color-danger)]/30 bg-[rgba(244,105,95,0.08)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {transcript && (
        <div className="mt-4 space-y-3">
          <div>
            <p className="label">
              Transcribed{language ? ` · detected ${language}` : ""}
            </p>
            <p className="mt-1 rounded-xl bg-[var(--color-void)] px-4 py-3 text-sm">{transcript}</p>
          </div>
          {reply.length > 0 && (
            <div>
              <p className="label">Agent reply</p>
              {reply.map((r, i) => (
                <p
                  key={i}
                  className="mt-1 whitespace-pre-wrap rounded-xl bg-[var(--color-gold-soft)] px-4 py-3 text-sm"
                >
                  {r}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
