"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Minus, Plus, RotateCcw, Search, X, Loader2, MapPinned, Compass,
} from "lucide-react";
import clsx from "clsx";
import { Card, SectionTitle } from "../ui";
import { PanoramaViewer } from "./panorama-viewer";
import { serenityTourForPlot } from "@/lib/showcase/panorama-scenes";
import {
  HANDOVER_STAGES,
  HANDOVER_STAGE_DEPARTMENT,
  HANDOVER_STAGE_DESCRIPTION,
  HANDOVER_STAGE_LABEL,
  isHandoverStage,
  type HandoverStage,
  type PaymentPosition,
} from "@/lib/showcase/handover";

export type UnitStatus =
  | "available" | "no_leads" | "enquiry" | "deal_pending" | "blocked" | "sold";

export interface PlanPlot {
  villaNo: string;
  xPct: number;
  yPct: number;
  cluster: string;
  plotSqYds: number;
  bhk: string;
  builtUpSqFt: string;
  /**
   * Matched published villa type. `exact` is false when the plot size is not
   * one of the three sizes the client published a sheet for — the figures are
   * then a reference for the nearest type, not this plot's own specification.
   */
  villaType?: {
    key: string;
    plotSqYds: number;
    facing: string;
    totalSqFt: number;
    floors: { ground: number; first: number; second: number };
    planImage: string;
    bhk: string;
    exact: boolean;
  };
}

export interface PlanMeta {
  image: string;
  /** Optional 2x source, fetched lazily once the user zooms in. */
  imageHd?: string;
  width: number;
  height: number;
  note?: string;
  clusters: string[];
  plotSizes: number[];
}

interface UnitRow {
  id: string;
  unitNumber: string;
  status: UnitStatus;
  leadId?: string;
  customerId?: string;
  leadName?: string;
  customerName?: string;
  /** The sales person who owns this villa. */
  assignedTo?: string;
  /** The buyer, typed in by the desk. */
  buyerName?: string;
  handoverStage?: HandoverStage;
}

interface TeamOption {
  id: string;
  name: string;
  role: string;
}

const STATUSES: UnitStatus[] = [
  "available", "no_leads", "enquiry", "deal_pending", "blocked", "sold",
];

const STATUS_LABEL: Record<UnitStatus, string> = {
  available: "Available",
  no_leads: "No leads yet",
  enquiry: "Enquiry",
  deal_pending: "Deal pending",
  blocked: "Blocked",
  sold: "Sold",
};

/** Dot colour / badge classes per status. Chosen to stay legible on the dark plan. */
const STATUS_STYLE: Record<UnitStatus, { dot: string; badge: string }> = {
  available: { dot: "bg-emerald-400 ring-emerald-200/40", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  no_leads: { dot: "bg-sky-400 ring-sky-200/40", badge: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  enquiry: { dot: "bg-amber-400 ring-amber-200/40", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  deal_pending: { dot: "bg-violet-400 ring-violet-200/40", badge: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  blocked: { dot: "bg-orange-400 ring-orange-200/40", badge: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  sold: { dot: "bg-rose-500 ring-rose-200/40", badge: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
};

const MIN_SCALE = 1;
/** Above this zoom the 3000px plan goes soft, so the 2x source is worth its weight. */
const HD_SCALE = 1.4;
const MAX_SCALE = 6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Reads whatever shape the inventory API returns without trusting any of it. */
function normaliseUnits(payload: unknown): UnitRow[] {
  const root = payload as Record<string, unknown> | null;
  const list =
    (Array.isArray(root?.units) && root!.units) ||
    (Array.isArray(root?.inventory) && root!.inventory) ||
    (Array.isArray(root?.data) && root!.data) ||
    (Array.isArray(payload) ? payload : []);
  const out: UnitRow[] = [];
  for (const raw of list as unknown[]) {
    const u = raw as Record<string, unknown>;
    const unitNumber = typeof u.unitNumber === "string" ? u.unitNumber : undefined;
    if (!unitNumber) continue;
    const status = STATUSES.includes(u.status as UnitStatus) ? (u.status as UnitStatus) : "available";
    out.push({
      id: typeof u.id === "string" ? u.id : unitNumber,
      unitNumber,
      status,
      leadId: typeof u.leadId === "string" ? u.leadId : undefined,
      customerId: typeof u.customerId === "string" ? u.customerId : undefined,
      buyerName: typeof u.buyerName === "string" ? u.buyerName : undefined,
      leadName: typeof u.leadName === "string" ? u.leadName : undefined,
      customerName: typeof u.customerName === "string" ? u.customerName : undefined,
      assignedTo: typeof u.assignedTo === "string" && u.assignedTo ? u.assignedTo : undefined,
      handoverStage: isHandoverStage(u.handoverStage) ? u.handoverStage : undefined,
    });
  }
  return out;
}

/** Same defensive read for the staff list the owner dropdown is built from. */
function normaliseTeam(payload: unknown): TeamOption[] {
  const root = payload as Record<string, unknown> | null;
  if (!Array.isArray(root?.team)) return [];
  const out: TeamOption[] = [];
  for (const raw of root.team as unknown[]) {
    const m = raw as Record<string, unknown>;
    if (typeof m.name !== "string" || !m.name) continue;
    out.push({
      id: typeof m.id === "string" ? m.id : m.name,
      name: m.name,
      role: typeof m.role === "string" ? m.role : "",
    });
  }
  return out;
}

/** `payments` is keyed by unit id; nothing here is ever written back. */
function normalisePayments(payload: unknown): Record<string, PaymentPosition> {
  const root = payload as Record<string, unknown> | null;
  const raw = root?.payments;
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, PaymentPosition>;
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const money = (n: number) => `₹${INR.format(Math.round(n))}`;

function roleLabel(role: string): string {
  return role ? role.toLowerCase().replace(/_/g, " ") : "";
}

const Hotspots = memo(function Hotspots({
  plots,
  statusOf,
  dimmed,
  activeVilla,
  onSelect,
  onHover,
}: {
  plots: PlanPlot[];
  statusOf: (villaNo: string) => UnitStatus;
  dimmed: (villaNo: string) => boolean;
  activeVilla: string | null;
  onSelect: (villaNo: string) => void;
  onHover: (villaNo: string | null) => void;
}) {
  return (
    <>
      {plots.map((p) => {
        const st = statusOf(p.villaNo);
        const off = dimmed(p.villaNo);
        return (
          <button
            key={p.villaNo}
            type="button"
            data-villa={p.villaNo}
            onClick={() => onSelect(p.villaNo)}
            onMouseEnter={() => onHover(p.villaNo)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(p.villaNo)}
            onBlur={() => onHover(null)}
            aria-label={`Villa ${p.villaNo}, ${p.plotSqYds} sq yds, ${STATUS_LABEL[st]}`}
            style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
            className={clsx(
              "absolute h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full",
              "ring-2 ring-black/40 transition-[transform,opacity] duration-150",
              "focus:outline-none focus-visible:ring-4 focus-visible:ring-white",
              "hover:scale-125",
              STATUS_STYLE[st].dot,
              off ? "opacity-20" : "opacity-95",
              // Selection must not be read as a STATUS. A white ring alone was
              // ambiguous on a sold villa, whose dot is already red: picking one
              // looked much like the colour meaning "sold". The selected dot now
              // carries a dark halo outside a white ring — two rings of opposite
              // value, which reads as "this one" against every status colour and
              // against the printed plan underneath — and it grows more than
              // hover does so it stays findable when the map is zoomed out.
              activeVilla === p.villaNo &&
                "z-10 scale-[1.7] ring-[3px] ring-white shadow-[0_0_0_3px_rgba(0,0,0,0.55),0_0_0_9px_rgba(255,255,255,0.28)]",
            )}
          />
        );
      })}
    </>
  );
});

export function SerenityMasterPlan({
  plan,
  plots,
  brandId,
  canWrite,
}: {
  plan: PlanMeta;
  plots: PlanPlot[];
  brandId: string;
  canWrite: boolean;
}) {
  const [units, setUnits] = useState<Record<string, UnitRow>>({});
  const [team, setTeam] = useState<TeamOption[]>([]);
  /** Derived, read-only payment position per unit id. Never edited here. */
  const [payments, setPayments] = useState<Record<string, PaymentPosition>>({});
  const [loading, setLoading] = useState(true);
  const [imageOk, setImageOk] = useState(true);
  const [hdSrc, setHdSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Floor-plan lightbox: the image path currently opened larger, if any. */
  const [planZoom, setPlanZoom] = useState<string | null>(null);
  /** Interior tour overlay: which scene is showing, and whether the real render tab is up. */
  const [tour, setTour] = useState<{ tourId: string; sceneId: string; tab: "tour" | "render" } | null>(null);
  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState<UnitStatus | "all">("all");
  const [fCluster, setFCluster] = useState<string>("all");
  const [fSize, setFSize] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hdAsked = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/showcase/inventory?project=serenity&brandId=${encodeURIComponent(brandId)}`)
      .then(async (r) => {
        if (r.ok) return r.json();
        // Without this the plan would paint every villa green "available" and
        // present a load failure as fact.
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Could not load sale statuses (${r.status}).`);
      })
      .then((json) => {
        if (!alive) return;
        const map: Record<string, UnitRow> = {};
        for (const u of normaliseUnits(json)) map[u.unitNumber] = u;
        setUnits(map);
        setTeam(normaliseTeam(json));
        setPayments(normalisePayments(json));
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setUnits({});
        setTeam([]);
        setPayments({});
        setError(e instanceof Error ? e.message : "Could not load sale statuses.");
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [brandId]);

  const statusOf = useCallback(
    (villaNo: string): UnitStatus => units[villaNo]?.status ?? "available",
    [units],
  );

  const matches = useCallback(
    (p: PlanPlot) => {
      if (fStatus !== "all" && statusOf(p.villaNo) !== fStatus) return false;
      if (fCluster !== "all" && p.cluster !== fCluster) return false;
      if (fSize !== "all" && String(p.plotSqYds) !== fSize) return false;
      if (query.trim() && !p.villaNo.toLowerCase().includes(query.trim().toLowerCase())) return false;
      return true;
    },
    [fStatus, fCluster, fSize, query, statusOf],
  );

  const dimmed = useCallback((villaNo: string) => {
    const p = plots.find((x) => x.villaNo === villaNo);
    return p ? !matches(p) : false;
  }, [plots, matches]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of plots) {
      const s = statusOf(p.villaNo);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [plots, statusOf]);

  const visible = useMemo(() => plots.filter(matches), [plots, matches]);

  // Wheel zoom about the pointer. Registered non-passively so the page does not
  // scroll away underneath the plan.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setScale((s) => {
        const next = clamp(s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_SCALE, MAX_SCALE);
        setPan((p) => ({
          x: cx - ((cx - p.x) * next) / s,
          y: cy - ((cy - p.y) * next) / s,
        }));
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /**
   * Escape closes the topmost layer only.
   *
   * Three overlays stack here — the villa detail, the full-screen layout image
   * and the interior tour — and only the first of them listened for Escape. The
   * other two could be dismissed solely by finding a small X, which is exactly
   * the wrong thing to hunt for while a customer is watching the screen. Order
   * matters: closing the tour must not also drop the villa panel underneath it.
   */
  useEffect(() => {
    if (!selected && !planZoom && !tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (tour) setTour(null);
      else if (planZoom) setPlanZoom(null);
      else setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, planZoom, tour]);

  // The 2x plan (~1.3 MB) is never part of first paint: it is fetched only once
  // the user zooms past HD_SCALE, and swapped in only after it has decoded, so
  // there is no flash and no layout shift.
  useEffect(() => {
    if (hdAsked.current || !plan.imageHd || !imageOk || scale < HD_SCALE) return;
    hdAsked.current = true;
    const src = plan.imageHd;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    let alive = true;
    const show = () => { if (alive) setHdSrc(src); };
    (img.decode ? img.decode().then(show, () => { img.onload = show; }) : Promise.resolve().then(show));
    return () => { alive = false; };
  }, [scale, plan.imageHd, imageOk]);

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button[data-villa]")) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  }
  function onPointerUp() { drag.current = null; }

  const zoomBy = (f: number) => setScale((s) => clamp(s * f, MIN_SCALE, MAX_SCALE));
  const reset = () => { setScale(1); setPan({ x: 0, y: 0 }); };

  /** Centres the view on one villa, so search jumps somewhere useful. */
  const jumpTo = useCallback((villaNo: string) => {
    const p = plots.find((x) => x.villaNo.toLowerCase() === villaNo.toLowerCase());
    const el = viewportRef.current;
    if (!p || !el) return;
    const next = Math.max(scale, 2.5);
    const w = el.clientWidth;
    const h = el.clientHeight;
    setScale(next);
    setPan({
      x: w / 2 - (p.xPct / 100) * w * next,
      y: h / 2 - (p.yPct / 100) * h * next,
    });
    setSelected(p.villaNo);
  }, [plots, scale]);

  /**
   * One PATCH for every editable field on the panel.
   *
   * Only the field the user touched is sent: the route no longer demands a
   * `status`, so changing the owner or the handover stage cannot accidentally
   * re-assert a sale status this tab last saw minutes ago.
   */
  async function patchUnit(
    villaNo: string,
    patch: {
      status?: UnitStatus;
      assignedTo?: string;
      handoverStage?: HandoverStage;
      buyerName?: string;
    },
  ) {
    const before = units[villaNo];
    setSaving(true);
    setError(null);
    setUnits((u) => {
      const row = u[villaNo] ?? { id: villaNo, unitNumber: villaNo, status: "available" as UnitStatus };
      return {
        ...u,
        [villaNo]: {
          ...row,
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.assignedTo !== undefined ? { assignedTo: patch.assignedTo || undefined } : {}),
          ...(patch.handoverStage ? { handoverStage: patch.handoverStage } : {}),
        },
      };
    });
    try {
      const res = await fetch("/api/showcase/inventory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unitId: before?.id ?? `unit_${brandId}_serenity_${villaNo}`,
          unitNumber: villaNo,
          project: "serenity",
          brandId,
          ...patch,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || (json && json.ok === false)) {
        setError(json?.error ?? "Could not save the change.");
        setUnits((u) => (before ? { ...u, [villaNo]: before } : u));
      }
    } catch {
      setError("Could not reach the inventory service.");
      setUnits((u) => (before ? { ...u, [villaNo]: before } : u));
    } finally {
      setSaving(false);
    }
  }

  const selectedPlot = selected ? plots.find((p) => p.villaNo === selected) ?? null : null;
  const vt = selectedPlot?.villaType;
  const hoverPlot = hover ? plots.find((p) => p.villaNo === hover) ?? null : null;

  return (
    <Card className="overflow-hidden">
      <SectionTitle
        title="Interactive master plan"
        hint={`${plots.length} villas · click any villa number for its sale status`}
        action={
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out"
              className="rounded-lg border border-ink-700 bg-ink-800/70 p-1.5 text-mist-300 hover:text-mist-100">
              <Minus size={14} />
            </button>
            <span className="tnum w-11 text-center text-[11px] text-mist-400">{scale.toFixed(1)}×</span>
            {hdSrc && (
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-semibold tracking-wider text-emerald-300">
                HD
              </span>
            )}
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in"
              className="rounded-lg border border-ink-700 bg-ink-800/70 p-1.5 text-mist-300 hover:text-mist-100">
              <Plus size={14} />
            </button>
            <button type="button" onClick={reset} aria-label="Reset view"
              className="rounded-lg border border-ink-700 bg-ink-800/70 p-1.5 text-mist-300 hover:text-mist-100">
              <RotateCcw size={14} />
            </button>
          </div>
        }
      />

      {/* Search + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); if (query.trim()) jumpTo(query.trim()); }}
          className="flex items-center gap-1.5 rounded-xl border border-ink-700 bg-ink-900/60 px-2.5 py-1.5"
        >
          <Search size={13} className="text-mist-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find villa no."
            aria-label="Find a villa number"
            className="w-32 bg-transparent text-xs text-mist-100 outline-none placeholder:text-mist-500"
          />
        </form>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value as UnitStatus | "all")}
          aria-label="Filter by status"
          className="rounded-xl border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-xs text-mist-200">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={fCluster} onChange={(e) => setFCluster(e.target.value)}
          aria-label="Filter by cluster"
          className="rounded-xl border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-xs text-mist-200">
          <option value="all">All clusters</option>
          {plan.clusters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fSize} onChange={(e) => setFSize(e.target.value)}
          aria-label="Filter by plot size"
          className="rounded-xl border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-xs text-mist-200">
          <option value="all">All plot sizes</option>
          {plan.plotSizes.map((s) => <option key={s} value={String(s)}>{s} sq yds</option>)}
        </select>
        <span className="tnum text-[11px] text-mist-400">
          {loading ? "loading inventory…" : `${visible.length} of ${plots.length} shown`}
        </span>
      </div>

      {error && !loading && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
          {error} Sale status is not being shown.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div
          ref={viewportRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative touch-none select-none overflow-hidden rounded-2xl border border-ink-700/60 bg-ink-950"
          style={{ aspectRatio: `${plan.width} / ${plan.height}`, cursor: drag.current ? "grabbing" : "grab" }}
        >
          <div
            className="absolute inset-0 origin-top-left will-change-transform"
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})` }}
          >
            {imageOk ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={hdSrc ?? plan.image}
                alt="Serenity master plan"
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => setImageOk(false)}
                className="pointer-events-none h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(56,189,148,0.12),transparent_60%)]">
                <div className="flex h-full items-center justify-center text-[11px] text-mist-500">
                  Master plan drawing to be confirmed — hotspots shown on the layout grid.
                </div>
              </div>
            )}
            <Hotspots
              plots={plots}
              statusOf={statusOf}
              dimmed={dimmed}
              activeVilla={selected ?? hover}
              onSelect={setSelected}
              onHover={setHover}
            />
          </div>

          {hoverPlot && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl border border-ink-700 bg-ink-900/95 px-3 py-2 text-[11px] shadow-lg">
              <span className="font-semibold text-mist-100">{hoverPlot.villaNo}</span>
              <span className="text-mist-400"> · {hoverPlot.plotSqYds} sq yds · </span>
              <span className="text-mist-200">{STATUS_LABEL[statusOf(hoverPlot.villaNo)]}</span>
            </div>
          )}

          {/* Legend */}
          <div className="pointer-events-none absolute right-3 top-3 rounded-xl border border-ink-700 bg-ink-900/90 p-2.5">
            <ul className="space-y-1">
              {STATUSES.map((s) => (
                <li key={s} className="flex items-center gap-2 text-[10.5px] text-mist-300">
                  <span className={clsx("h-2 w-2 rounded-full", STATUS_STYLE[s].dot)} />
                  {STATUS_LABEL[s]}
                  <span className="tnum ml-auto text-mist-500">{counts[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Detail drawer */}
        <div className="rounded-2xl border border-ink-700/60 bg-ink-900/50 p-4">
          {!selectedPlot ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-[11px] text-mist-500">
              <MapPinned size={18} />
              Select a villa on the plan to see its details.
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-mist-100">Villa {selectedPlot.villaNo}</h3>
                  <p className="text-[11px] text-mist-400">{selectedPlot.cluster} cluster</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} aria-label="Close villa details"
                  className="rounded-lg border border-ink-700 p-1 text-mist-400 hover:text-mist-100">
                  <X size={13} />
                </button>
              </div>

              <span className={clsx(
                "mt-3 inline-block rounded-full border px-2.5 py-1 text-[10.5px] font-semibold",
                STATUS_STYLE[statusOf(selectedPlot.villaNo)].badge,
              )}>
                {STATUS_LABEL[statusOf(selectedPlot.villaNo)]}
              </span>

              <dl className="mt-4 space-y-2 text-[11.5px]">
                <div className="flex justify-between"><dt className="text-mist-400">Plot size</dt><dd className="tnum text-mist-100">{selectedPlot.plotSqYds} sq yds</dd></div>
                <div className="flex justify-between"><dt className="text-mist-400">Configuration</dt><dd className="text-mist-100">{vt?.exact ? vt.bhk : selectedPlot.bhk}</dd></div>
                <div className="flex justify-between">
                  <dt className="text-mist-400">Villa type</dt>
                  <dd className="text-mist-100">
                    {vt ? `${vt.exact ? "" : "≈ "}${vt.plotSqYds} sq yds · ${vt.facing} facing` : "To be confirmed"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mist-400">Facing</dt>
                  <dd className="text-mist-100">{vt?.exact ? vt.facing : "To be confirmed"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mist-400">Built-up</dt>
                  <dd className="tnum text-mist-100">
                    {vt?.exact ? `${vt.totalSqFt.toLocaleString()} sq ft` : "To be confirmed"}
                  </dd>
                </div>
                {vt && (
                  <>
                    {!vt.exact && (
                      <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">
                        Nearest published type · indicative
                      </div>
                    )}
                    <div className="flex justify-between"><dt className="text-mist-400 pl-2">Ground floor</dt><dd className="tnum text-mist-300">{vt.floors.ground.toLocaleString()} sq ft</dd></div>
                    <div className="flex justify-between"><dt className="text-mist-400 pl-2">First floor</dt><dd className="tnum text-mist-300">{vt.floors.first.toLocaleString()} sq ft</dd></div>
                    <div className="flex justify-between"><dt className="text-mist-400 pl-2">Second floor</dt><dd className="tnum text-mist-300">{vt.floors.second.toLocaleString()} sq ft</dd></div>
                    <div className="flex justify-between"><dt className="text-mist-400 pl-2">Total</dt><dd className="tnum text-mist-300">{vt.totalSqFt.toLocaleString()} sq ft</dd></div>
                  </>
                )}
                <div className="flex justify-between">
                  <dt className="text-mist-400">Linked</dt>
                  <dd className="text-mist-100">
                    {units[selectedPlot.villaNo]?.customerName
                      ?? units[selectedPlot.villaNo]?.leadName
                      ?? units[selectedPlot.villaNo]?.customerId
                      ?? units[selectedPlot.villaNo]?.leadId
                      ?? "—"}
                  </dd>
                </div>
              </dl>

              {vt && !vt.exact && (
                <p className="mt-2 text-[10.5px] leading-snug text-amber-300/80">
                  Indicative only: no plan is published for a {selectedPlot.plotSqYds} sq yd plot.
                  Areas shown are the nearest published type ({vt.plotSqYds} sq yds, {vt.facing} facing);
                  this villa&apos;s own built-up area is to be confirmed.
                </p>
              )}

              {vt && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setPlanZoom(vt.planImage)}
                    className="block w-full overflow-hidden rounded-xl border border-ink-700 bg-white/5"
                    aria-label={`Open the ${vt.plotSqYds} sq yds ${vt.facing} facing indicative layout overview larger`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={vt.planImage}
                      alt={`${vt.plotSqYds} sq yds ${vt.facing} facing villa indicative layout overview`}
                      loading="lazy"
                      decoding="async"
                      className="h-36 w-full object-cover object-top"
                    />
                  </button>
                  <p className="mt-1 text-[10px] text-mist-500">
                    Indicative layout overview · click to enlarge. Room dimensions are not
                    legible at this resolution; measured plans to be confirmed.
                  </p>
                </div>
              )}

              {(() => {
                // A 360 tour exists only for the villa types that have been
                // generated. Anything else gets a plain note, not a stand-in.
                const t = vt?.exact ? serenityTourForPlot(vt.plotSqYds, vt.facing) : undefined;
                if (!t) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setTour({ tourId: t.id, sceneId: t.scenes[0].id, tab: "tour" })}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-400/40 bg-brand-500/10 px-3 py-2 text-[12px] font-semibold text-brand-200 transition hover:bg-brand-500/20"
                  >
                    <Compass size={14} />
                    Tour interior
                  </button>
                );
              })()}

              {(() => {
                const row = units[selectedPlot.villaNo];
                const stage: HandoverStage = row?.handoverStage ?? "not_started";
                const dept = HANDOVER_STAGE_DEPARTMENT[stage];
                const pos = row ? payments[row.id] : undefined;
                return (
                  <div className="mt-4 space-y-3 border-t border-ink-800 pt-3">
                    {canWrite ? (
                      <div>
                        <label htmlFor="villa-status" className="text-[10.5px] font-semibold uppercase tracking-wider text-mist-400">
                          Change status
                        </label>
                        <div className="mt-1.5 flex items-center gap-2">
                          <select
                            id="villa-status"
                            value={statusOf(selectedPlot.villaNo)}
                            onChange={(e) => patchUnit(selectedPlot.villaNo, { status: e.target.value as UnitStatus })}
                            className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-900/70 px-2.5 py-1.5 text-xs text-mist-100"
                          >
                            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                          {saving && <Loader2 size={14} className="animate-spin text-mist-400" />}
                        </div>
                      </div>
                    ) : null}

                    {/* Who bought it. Free text: a sale is usually agreed before
                        the buyer exists as a CRM record, and the desk should not
                        have to create one to write the name down. Saved on blur
                        rather than per keystroke so it is one write, not twenty. */}
                    <div>
                      <label
                        htmlFor="villa-buyer"
                        className="text-[10.5px] font-semibold uppercase tracking-wider text-mist-400"
                      >
                        Buyer
                      </label>
                      {canWrite ? (
                        <input
                          id="villa-buyer"
                          type="text"
                          defaultValue={row?.buyerName ?? ""}
                          key={`buyer-${selectedPlot.villaNo}-${row?.buyerName ?? ""}`}
                          placeholder="Name of the person who bought it"
                          autoComplete="off"
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next !== (row?.buyerName ?? "")) {
                              void patchUnit(selectedPlot.villaNo, { buyerName: next });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          className="mt-1.5 w-full min-w-0 rounded-xl border border-ink-700 bg-ink-900/70 px-2.5 py-1.5 text-xs text-mist-100 placeholder:text-mist-500 focus:border-brand-500/60 focus:outline-none"
                        />
                      ) : (
                        <p className="mt-1 text-[11.5px] text-mist-100">
                          {row?.buyerName ?? row?.customerName ?? "Not recorded"}
                        </p>
                      )}
                    </div>

                    {/* Who sold it. */}
                    <div>
                      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-mist-400">Owner</span>
                      {canWrite ? (
                        <select
                          aria-label="Sales owner"
                          value={row?.assignedTo ?? ""}
                          onChange={(e) => patchUnit(selectedPlot.villaNo, { assignedTo: e.target.value })}
                          className="mt-1.5 w-full min-w-0 rounded-xl border border-ink-700 bg-ink-900/70 px-2.5 py-1.5 text-xs text-mist-100"
                        >
                          <option value="">Unassigned</option>
                          {team.map((m) => (
                            <option key={`${m.name}::${m.role}`} value={m.name}>
                              {m.role ? `${m.name} · ${roleLabel(m.role)}` : m.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="mt-1 text-[11.5px] text-mist-100">{row?.assignedTo ?? "Unassigned"}</p>
                      )}
                    </div>

                    {/* Which department has it, and what they are doing. */}
                    <div>
                      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-mist-400">Handover stage</span>
                      {canWrite ? (
                        <select
                          aria-label="Handover stage"
                          value={stage}
                          onChange={(e) => patchUnit(selectedPlot.villaNo, { handoverStage: e.target.value as HandoverStage })}
                          className="mt-1.5 w-full min-w-0 rounded-xl border border-ink-700 bg-ink-900/70 px-2.5 py-1.5 text-xs text-mist-100"
                        >
                          {HANDOVER_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {HANDOVER_STAGE_DEPARTMENT[s]
                                ? `${HANDOVER_STAGE_LABEL[s]} · ${HANDOVER_STAGE_DEPARTMENT[s]}`
                                : HANDOVER_STAGE_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="mt-1 text-[11.5px] text-mist-100">{HANDOVER_STAGE_LABEL[stage]}</p>
                      )}
                      <p className="mt-1 text-[10.5px] leading-snug text-mist-500">
                        {dept ? `${dept} · ` : ""}{HANDOVER_STAGE_DESCRIPTION[stage]}
                      </p>
                    </div>

                    {/* Payment position. Read-only: these figures are summed from
                        the receipts accounts recorded against this villa, so there
                        is nothing here a person may type. A wrong number is fixed
                        by a transaction in the ledger, never by an edit here. */}
                    <div>
                      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-mist-400">Payments</span>
                      {!pos ? (
                        <p className="mt-1 text-[11.5px] text-mist-400">No payment record linked yet</p>
                      ) : (
                        <dl className="mt-1.5 space-y-1 text-[11.5px]">
                          <div className="flex justify-between gap-2">
                            <dt className="text-mist-400">Collected</dt>
                            <dd className="tnum text-emerald-300">{money(pos.paid)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-mist-400">Pending</dt>
                            <dd className="tnum text-mist-100">{money(pos.pending)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-mist-400">Overdue</dt>
                            <dd className={clsx("tnum", pos.overdue > 0 ? "text-rose-300" : "text-mist-100")}>
                              {money(pos.overdue)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-mist-400">Next due</dt>
                            <dd className="text-right text-mist-100">
                              {pos.next
                                ? `${pos.next.label} · ${money(pos.next.amount)} · ${pos.next.date.slice(0, 10)}`
                                : "Fully collected"}
                            </dd>
                          </div>
                        </dl>
                      )}
                      <p className="mt-1 text-[10px] leading-snug text-mist-500">
                        Derived from recorded transactions · read-only here.
                      </p>
                    </div>

                    {error && <p className="text-[11px] text-rose-400">{error}</p>}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {planZoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Villa indicative layout overview"
          onClick={() => setPlanZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            onClick={() => setPlanZoom(null)}
            aria-label="Close layout overview"
            className="absolute right-4 top-4 rounded-lg border border-ink-700 bg-ink-900/80 p-1.5 text-mist-300 hover:text-mist-100"
          >
            <X size={16} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={planZoom} alt="Villa indicative layout overview" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}

      {tour && (() => {
        const t = serenityTourForPlot(267, "East");
        const scene = t?.scenes.find((sc) => sc.id === tour.sceneId) ?? t?.scenes[0];
        if (!t || !scene) return null;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Villa interior tour"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          >
            <div className="w-full max-w-4xl rounded-2xl border border-ink-700 bg-ink-900/95 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-mist-100">{t.label}</h3>
                  <p className="text-[11px] text-mist-400">{t.source}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTour(null)}
                  aria-label="Close interior tour"
                  className="rounded-lg border border-ink-700 p-1.5 text-mist-400 hover:text-mist-100"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Schematic panoramas and real photography are never mixed on the
                  same tab — the label says which one you are looking at. */}
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {t.scenes.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setTour({ ...tour, sceneId: sc.id, tab: "tour" })}
                    className={clsx(
                      "rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition",
                      tour.tab === "tour" && sc.id === scene.id
                        ? "border-brand-400/60 bg-brand-500/20 text-brand-100"
                        : "border-ink-700 text-mist-300 hover:text-mist-100",
                    )}
                  >
                    {sc.title}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-ink-700" aria-hidden />
                <button
                  type="button"
                  onClick={() => setTour({ ...tour, tab: "render" })}
                  className={clsx(
                    "rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition",
                    tour.tab === "render"
                      ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                      : "border-ink-700 text-mist-300 hover:text-mist-100",
                  )}
                >
                  Render
                </button>
              </div>

              {tour.tab === "render" ? (
                <div>
                  <div className="overflow-hidden rounded-xl border border-ink-700/70 bg-ink-800/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/showcase/serenity/interior-bedroom.webp"
                      alt="Master bedroom interior render supplied by the client"
                      className="w-full object-cover"
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-emerald-300/80">
                    Photoreal interior render supplied by the client. Furnishings and finishes are
                    an artist&apos;s impression.
                  </p>
                </div>
              ) : (
                <PanoramaViewer
                  scene={scene}
                  scenes={t.scenes}
                  onSceneChange={(id) => setTour({ ...tour, sceneId: id, tab: "tour" })}
                  caption={`${scene.plan} — ${t.source}.`}
                />
              )}
            </div>
          </div>
        );
      })()}

      {plan.note && <p className="mt-3 text-[10.5px] text-mist-500">{plan.note}</p>}
    </Card>
  );
}
