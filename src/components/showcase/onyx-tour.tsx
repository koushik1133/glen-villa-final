"use client";

/**
 * The Glentree Onyx 360 tour.
 *
 * It is a shell around the existing <PanoramaViewer/> — the projection maths
 * and the interaction model are that component's, unchanged. What lives here is
 * the tour: room pills with a soft cross-fade, a yaw-synced minimap of the
 * plate and of the room you are standing in, a thumbnail strip, the time-inside
 * counter and the site-visit CTA that writes a real CRM lead.
 *
 * The panoramas are representative interiors, not photographs of this
 * apartment; REPRESENTATIVE_NOTE is on screen the whole time it is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CalendarClock, Check, Compass, Loader2, MapPin } from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import { PanoramaViewer } from "./panorama-viewer";
import {
  ONYX_TOUR_ROOMS,
  REPRESENTATIVE_NOTE,
  onyxTourFor,
  roomCentre,
  type OnyxRoomId,
} from "@/lib/showcase/onyx-tour";
import { ONYX_PLATE_LAYOUT, onyxUnitPosition } from "@/lib/showcase/onyx-units";

export function OnyxTour({
  unitNumber,
  brandId,
}: {
  unitNumber: string;
  brandId: string;
}) {
  const tour = useMemo(() => onyxTourFor(unitNumber), [unitNumber]);
  const [roomId, setRoomId] = useState<OnyxRoomId>("living");
  const [yaw, setYaw] = useState(0);
  const [visible, setVisible] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const scene = tour.scenes.find((s) => s.id === roomId) ?? tour.scenes[0];
  const position = onyxUnitPosition(unitNumber);

  // Soft cross-fade: the incoming room fades up over the frame that is already
  // painted, so switching rooms never flashes the page background.
  useEffect(() => {
    setVisible(false);
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [roomId]);

  // Time inside the home — the same engagement signal the sales team reads off
  // a site visit.
  useEffect(() => {
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [unitNumber]);

  const onCamera = useCallback((cam: { yaw: number }) => {
    setYaw((prev) => (Math.abs(prev - cam.yaw) < 0.01 ? prev : cam.yaw));
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <Card>
      <SectionTitle
        title="360° interior tour"
        hint="Drag to look around, scroll to zoom, and step through a doorway to walk into the next room."
        action={
          <div className="flex items-center gap-1.5">
            <Badge tone="neutral">{tour.headline}</Badge>
            <span className="hidden rounded-full border border-ink-700 px-2 py-0.5 font-mono text-[11px] text-mist-400 sm:inline">
              In home {mm}:{ss}
            </span>
          </div>
        }
      />

      {/* Room pills */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Room">
        {tour.scenes.map((s) => (
          <Button
            key={s.id}
            size="sm"
            role="tab"
            aria-selected={s.id === scene.id}
            variant={s.id === scene.id ? "primary" : "secondary"}
            onClick={() => setRoomId(s.id)}
          >
            {s.title}
          </Button>
        ))}
      </div>

      <div
        className={clsx(
          "transition-opacity duration-500 motion-reduce:transition-none",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        <PanoramaViewer
          scene={scene}
          scenes={tour.scenes}
          onSceneChange={(id) => setRoomId(id as OnyxRoomId)}
          onCamera={onCamera}
          watermark={null}
          overlay={
            <>
              <Minimap roomId={scene.id} yaw={yaw} position={position} onPick={setRoomId} />
              <span className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[62%] rounded-md bg-ink-900/70 px-2 py-1 text-[10px] leading-tight text-mist-300 backdrop-blur">
                Representative interior imagery · layout and dimensions are from the Glentree Onyx plan
              </span>
            </>
          }
          caption={`${scene.plan} — unit ${unitNumber} apartment plan. ${REPRESENTATIVE_NOTE}`}
        />
      </div>

      {/* Thumbnail strip */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {tour.scenes.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setRoomId(s.id)}
            aria-current={s.id === scene.id}
            className={clsx(
              "group relative h-14 w-24 shrink-0 overflow-hidden rounded-lg border transition",
              s.id === scene.id
                ? "border-brand-400"
                : "border-ink-700/70 opacity-70 hover:opacity-100",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.image}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 bg-ink-900/75 px-1.5 py-0.5 text-left text-[10px] text-mist-200">
              {s.title}
            </span>
          </button>
        ))}
      </div>

      <SiteVisitCta unitNumber={unitNumber} brandId={brandId} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Minimap: the plate above, the room you are in below.                */
/* ------------------------------------------------------------------ */

function Minimap({
  roomId,
  yaw,
  position,
  onPick,
}: {
  roomId: OnyxRoomId;
  yaw: number;
  position: number | null;
  onPick: (id: OnyxRoomId) => void;
}) {
  const room = ONYX_TOUR_ROOMS.find((r) => r.id === roomId)!;
  const centre = roomCentre(room);
  const deg = (yaw * 180) / Math.PI;

  return (
    <div
      className="absolute right-2 top-12 z-10 hidden w-44 rounded-xl border border-ink-700/80 bg-ink-900/75 p-2 backdrop-blur sm:block"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between px-0.5 text-[9px] uppercase tracking-[0.2em] text-mist-400">
        <span>You are here</span>
        <span>N ↑</span>
      </div>

      {/* Floor plate key plan — the selected unit lit up. */}
      <svg viewBox="0 0 100 46" className="mb-1.5 w-full" aria-hidden>
        <rect x="40" y="16" width="20" height="14" rx="2" fill="#1f2937" stroke="#475569" strokeWidth="1" />
        <text x="50" y="25" fontSize="5" textAnchor="middle" fill="#94a3b8">CORE</text>
        {Object.entries(ONYX_PLATE_LAYOUT).map(([pos, cell]) => {
          const x = 4 + cell.col * 32;
          const y = 2 + cell.row * 15;
          const on = Number(pos) === position;
          return (
            <g key={pos}>
              <rect
                x={x}
                y={y}
                width="28"
                height="12"
                rx="2"
                fill={on ? "#6366f1" : "#111827"}
                fillOpacity={on ? 0.75 : 1}
                stroke={on ? "#a5b4fc" : "#374151"}
                strokeWidth="1"
              />
              <text x={x + 14} y={y + 8.5} fontSize="6" textAnchor="middle" fill={on ? "#fff" : "#64748b"}>
                {pos}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Rooms of this unit, with the direction cone. */}
      <svg viewBox="0 0 100 100" className="h-28 w-full">
        {ONYX_TOUR_ROOMS.map((r) => {
          const on = r.id === roomId;
          return (
            <g key={r.id} className="cursor-pointer" onClick={() => onPick(r.id)}>
              <title>{r.label}</title>
              <rect
                x={r.rect.x}
                y={r.rect.y}
                width={r.rect.w}
                height={r.rect.h}
                rx="2"
                fill={on ? "#312e81" : "#111827"}
                stroke={on ? "#818cf8" : "#374151"}
                strokeWidth="1"
              />
              <text
                x={r.rect.x + 2.5}
                y={r.rect.y + 8}
                fontSize="5.5"
                fontWeight="700"
                fill={on ? "#c7d2fe" : "#64748b"}
              >
                {r.label.toUpperCase().slice(0, 9)}
              </text>
            </g>
          );
        })}
        <g
          style={{
            transform: `translate(${centre.x}px, ${centre.y}px)`,
            transition: "transform 600ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <g transform={`rotate(${deg})`}>
            <path d="M0 0 L-9 -16 A18 18 0 0 1 9 -16 Z" fill="#818cf8" fillOpacity="0.45" />
          </g>
          <circle r="3" fill="#818cf8" stroke="#fff" strokeWidth="1.2" />
        </g>
      </svg>
      <p className="px-0.5 pt-1 text-[10px] text-mist-400">{room.label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CTA — a real lead on the existing CRM path.                          */
/* ------------------------------------------------------------------ */

function SiteVisitCta({ unitNumber, brandId }: { unitNumber: string; brandId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("A name and a phone number are needed to raise the lead.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The CRM's own endpoint — no separate capture path for the showcase.
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brandId,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          source: "website",
          projectInterest: "Glentree Onyx",
          unitType: `Unit ${unitNumber}`,
          notes: `Site visit requested from the 360 tour of unit ${unitNumber}.`,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? String(res.status));
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `The lead could not be saved (${err.message}). Take the details down manually.`
          : "The lead could not be saved. Take the details down manually.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="mt-4 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-200">
        <Check className="size-3.5" aria-hidden />
        Lead created for unit {unitNumber}. It is in the CRM pipeline as a new enquiry.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            <CalendarClock className="mr-1.5 size-3.5" aria-hidden />
            Schedule a site visit
          </Button>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-mist-400">
            <MapPin className="size-3" aria-hidden /> RTC X Roads, Hyderabad
            <Compass className="ml-2 size-3" aria-hidden /> Sales team follows up from the CRM
          </span>
        </div>
      ) : (
        <form onSubmit={submit} className="rounded-xl border border-ink-700/70 bg-ink-800/40 p-3">
          <p className="mb-2 text-[12px] text-mist-300">
            Site visit for unit {unitNumber} — this raises a lead in the CRM.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoComplete="off"
              className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-2 text-[12.5px] outline-none placeholder:text-mist-500 focus:border-brand-500"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              inputMode="tel"
              autoComplete="off"
              className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-2 text-[12.5px] outline-none placeholder:text-mist-500 focus:border-brand-500"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              autoComplete="off"
              className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-2 text-[12.5px] outline-none placeholder:text-mist-500 focus:border-brand-500"
            />
          </div>
          {error && <p className="mt-2 text-[12px] text-amber-300">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : null}
              Create the lead
            </Button>
            <Button size="sm" variant="secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default OnyxTour;
