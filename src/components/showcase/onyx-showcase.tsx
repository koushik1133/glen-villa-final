"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  Building2, Layers, MapPin, Phone, Mail, ExternalLink, Compass,
  ChevronUp, ChevronDown, X, Loader2, AlertTriangle,
} from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import { PanoramaViewer } from "./panorama-viewer";
import { OnyxTowerExplorer, type ExplorerUnit } from "./onyx-tower-explorer";
import { onyxTourForUnit } from "@/lib/showcase/panorama-scenes";
import {
  ONYX_PLATE_LAYOUT,
  ONYX_UNIT_PLANS_OVERVIEW,
  ONYX_UNIT_TYPES,
  onyxUnitPosition,
  onyxUnitType,
} from "@/lib/showcase/onyx-units";

/* ------------------------------------------------------------------ */
/* Facts. Everything here comes from the client brief. Anything not    */
/* supplied by the client is rendered as "to be confirmed" — never     */
/* guessed.                                                            */
/* ------------------------------------------------------------------ */

const FLOORS = 35;
const TOTAL_UNITS = 245;
const PROJECT = "onyx";
const SITE_URL = "https://glentreehomes.in/glentree-onyx/";

/** Derived from the modelled unit types so it can never drift from them. */
const CONFIGURATIONS = `${Array.from(
  new Set(
    ONYX_UNIT_TYPES.map((t) => t.bhk).filter((b): b is string => Boolean(b)),
  ),
)
  .map((b) => b.replace(/\s*BHK$/i, ""))
  .sort((a, b) => Number(a) - Number(b))
  .join(" / ")} BHK`;

const FACTS: { label: string; value: string }[] = [
  { label: "Structure", value: "Single tower, 35 floors" },
  { label: "Units", value: "245 residences" },
  { label: "Land", value: "1.82 acres" },
  { label: "Configurations", value: CONFIGURATIONS },
  { label: "Built-up area", value: "2,032 - 2,945 sq ft" },
  { label: "Clubhouse", value: "34,000 sq ft" },
  { label: "Amenities", value: "50+" },
  { label: "Car parking", value: "2 per flat across 5 levels" },
  { label: "Vastu", value: "100% vastu compliant" },
  { label: "Location", value: "RTC X Roads, Hyderabad" },
  { label: "Pricing", value: "From approx ₹1.89 Cr" },
  { label: "Possession", value: "To be confirmed" },
];

const APPROVALS: { label: string; value: string }[] = [
  { label: "RERA", value: "P02500010245" },
  { label: "GHMC permit", value: "1638/GHMC/SWBP/SEC1/2025" },
];

const TOWER_POSTER = "/showcase/onyx/tower.webp";

function TowerSkeleton() {
  return (
    <div className="relative aspect-[5/3] w-full overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={TOWER_POSTER} alt="Glentree Onyx tower" className="absolute inset-0 size-full opacity-70" />
      <div className="absolute inset-0 grid place-items-center bg-ink-900/30">
        <Loader2 className="size-5 animate-spin text-mist-200" aria-hidden />
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

type UnitStatus = "available" | "no_leads" | "enquiry" | "deal_pending" | "blocked" | "sold";

type Unit = {
  id: string;
  number: string;
  floor: number;
  bhk: string;
  sizeSqft: number | null;
  facing: string | null;
  status: UnitStatus;
  priceLabel: string | null;
  leadName: string | null;
  leadId: string | null;
};

const STATUS_META: Record<UnitStatus, { label: string; tone: "good" | "warn" | "brand" | "bad" | "neutral"; fill: string; stroke: string }> = {
  available: { label: "Available", tone: "good", fill: "#10b98133", stroke: "#34d399" },
  no_leads: { label: "No leads yet", tone: "neutral", fill: "#94a3b826", stroke: "#94a3b8" },
  enquiry: { label: "Enquiry", tone: "brand", fill: "#6366f133", stroke: "#818cf8" },
  deal_pending: { label: "Deal pending", tone: "warn", fill: "#f59e0b33", stroke: "#fbbf24" },
  blocked: { label: "Blocked", tone: "warn", fill: "#f9731633", stroke: "#fb923c" },
  sold: { label: "Sold", tone: "bad", fill: "#ef444433", stroke: "#f87171" },
};

const STATUS_ORDER: UnitStatus[] = ["available", "no_leads", "enquiry", "deal_pending", "blocked", "sold"];

/** Sellable = still open to a buyer. Drives the elevation colour ramp. */
const SELLABLE = new Set<UnitStatus>(["available", "no_leads", "enquiry"]);

function toStatus(v: unknown): UnitStatus {
  const s = String(v ?? "").toLowerCase();
  return (STATUS_ORDER as string[]).includes(s) ? (s as UnitStatus) : "available";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}

/** The inventory endpoint is owned by another part of the app; accept the
 *  common shapes rather than hard-coding one. */
function normalize(raw: unknown): Unit[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { units?: unknown[] })?.units)
    ? (raw as { units: unknown[] }).units
    : Array.isArray((raw as { items?: unknown[] })?.items)
    ? (raw as { items: unknown[] }).items
    : Array.isArray((raw as { data?: unknown[] })?.data)
    ? (raw as { data: unknown[] }).data
    : [];

  const out: Unit[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const number = str(r.unitNumber ?? r.number ?? r.unit ?? r.code);
    if (!number) continue;
    const floor = num(r.floor) ?? num(number.slice(0, -2));
    out.push({
      id: String(r.id ?? number),
      number,
      floor: floor ?? 0,
      bhk: str(r.bhk ?? r.config ?? r.configuration) ?? "To be confirmed",
      sizeSqft: num(r.builtUpSqFt ?? r.sizeSqft ?? r.size),
      facing: str(r.facing ?? r.orientation),
      status: toStatus(r.status ?? r.state),
      priceLabel: num(r.priceInr) ? `₹${((num(r.priceInr) as number) / 10000000).toFixed(2)} Cr` : null,
      leadName: str(r.leadName ?? r.customerName),
      leadId: str(r.leadId ?? r.customerId),
    });
  }
  return out.filter((u) => u.floor >= 1 && u.floor <= FLOORS);
}

/** Provisional grid used only when live inventory cannot be read. It carries
 *  no invented sales data — every unit reads "to be confirmed". */
function provisionalUnits(): Unit[] {
  const perFloor = Math.round(TOTAL_UNITS / FLOORS); // 7
  const out: Unit[] = [];
  for (let f = 1; f <= FLOORS; f++) {
    for (let i = 1; i <= perFloor; i++) {
      const number = `${f}${String(i).padStart(2, "0")}`;
      out.push({
        id: `provisional-${number}`,
        number,
        floor: f,
        bhk: "To be confirmed",
        sizeSqft: null,
        facing: null,
        status: "available",
        priceLabel: null,
        leadName: null,
        leadId: null,
      });
    }
  }
  return out;
}


/* ------------------------------------------------------------------ */

export function OnyxShowcase({ brandId }: { brandId: string }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [provisional, setProvisional] = useState(false);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(true);
  const [floor, setFloor] = useState(FLOORS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/showcase/inventory?project=${PROJECT}&brandId=${encodeURIComponent(brandId)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as unknown;
      const parsed = normalize(json);
      if (typeof (json as { canWrite?: boolean })?.canWrite === "boolean") {
        setCanWrite((json as { canWrite: boolean }).canWrite);
      }
      if (parsed.length) {
        setUnits(parsed);
        setProvisional(false);
      } else {
        setUnits(provisionalUnits());
        setProvisional(true);
      }
    } catch {
      setUnits(provisionalUnits());
      setProvisional(true);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byFloor = useMemo(() => {
    const map = new Map<number, Unit[]>();
    for (let f = 1; f <= FLOORS; f++) map.set(f, []);
    for (const u of units) map.get(u.floor)?.push(u);
    for (const list of map.values()) list.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    return map;
  }, [units]);

  /** One row per floor for the tower overlay: how many units are still sellable. */
  const floorSummaries = useMemo(
    () =>
      Array.from({ length: FLOORS }, (_, i) => {
        const f = i + 1;
        const list = byFloor.get(f) ?? [];
        return { floor: f, open: list.filter((u) => SELLABLE.has(u.status)).length, total: list.length };
      }),
    [byFloor],
  );

  const floorUnits = byFloor.get(floor) ?? [];

  /** The same units the plate below shows, with their sale status resolved to
   *  the colours the explorer paints — one source of truth for both. */
  const explorerUnitsByFloor: ReadonlyMap<number, ExplorerUnit[]> = useMemo(
    () =>
      new Map(
        [...byFloor.entries()].map(([f, list]) => [
          f,
          list.map((u) => {
            const meta = STATUS_META[u.status];
            const type = onyxUnitType(u.number);
            return {
              id: u.id,
              number: u.number,
              bhk: u.bhk !== "To be confirmed" ? u.bhk : type?.bhk ?? u.bhk,
              sizeSqft: u.sizeSqft ?? type?.sqFt ?? null,
              facing: u.facing ?? type?.facing ?? null,
              priceLabel: u.priceLabel,
              statusLabel: meta.label,
              fill: meta.fill,
              stroke: meta.stroke,
              sellable: SELLABLE.has(u.status),
            };
          }),
        ]),
      ),
    [byFloor],
  );
  const selected = units.find((u) => u.id === selectedId) ?? null;

  const totals = useMemo(() => {
    const t = Object.fromEntries(STATUS_ORDER.map((k) => [k, 0])) as Record<UnitStatus, number>;
    for (const u of units) t[u.status]++;
    return t;
  }, [units]);

  const setStatus = useCallback(
    async (unit: Unit, status: UnitStatus) => {
      if (provisional) return;
      setSaving(true);
      setNotice(null);
      const prev = unit.status;
      setUnits((list) => list.map((u) => (u.id === unit.id ? { ...u, status } : u)));
      try {
        const res = await fetch("/api/showcase/inventory", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ unitId: unit.id, status }),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!res.ok || json?.ok === false) throw new Error(String(res.status));
      } catch (e) {
        setUnits((list) => list.map((u) => (u.id === unit.id ? { ...u, status: prev } : u)));
        setNotice(
          String(e).includes("403")
            ? "You do not have permission to change sale status."
            : "Could not save that status change. Please try again.",
        );
      } finally {
        setSaving(false);
      }
    },
    [brandId, provisional],
  );

  return (
    <div className="space-y-6">
      {provisional && !loading && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warn-500/30 bg-warn-500/10 px-4 py-3 text-[12.5px] text-warn-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Live inventory is unavailable, so the tower is drawn from the published unit count
            (245 across 35 floors). Unit numbers, sizes and sale status here are provisional and to be confirmed.
          </p>
        </div>
      )}

      {/* A — the tower render, with a clickable floor overlay */}
      <Card className="overflow-hidden">
        <SectionTitle
          title="The tower"
          hint="Click a floor on the render to open it — or use the rail and the arrow keys. Colour shows how much of that floor is still open for sale."
          action={<Badge tone="brand">35 floors · {units.length || TOTAL_UNITS} units</Badge>}
        />
        <div className="flex flex-col gap-5 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            {loading ? (
              <TowerSkeleton />
            ) : (
              <OnyxTowerExplorer
                summaries={floorSummaries}
                unitsByFloor={explorerUnitsByFloor}
                floor={floor}
                onFloorChange={setFloor}
                onSelectUnit={setSelectedId}
                brandId={brandId}
                src={TOWER_POSTER}
              />
            )}
          </div>
          <FloorRail byFloor={byFloor} floor={floor} onSelect={setFloor} />
        </div>
        <Legend totals={totals} />
      </Card>

      {/* B — floor plate */}
      <Card>
        <SectionTitle
          title={`Floor ${floor} plate`}
          hint={
            floorUnits.length
              ? `${floorUnits.length} unit${floorUnits.length === 1 ? "" : "s"} on this floor · positions follow the key plan printed on the apartment plan sheets: 2, 3, 4 across the north edge, 1 and 5 beside the lift core, 7 and 6 along the south edge`
              : "No units recorded on this floor"
          }
          action={
            <Badge tone="good">
              {floorUnits.filter((u) => SELLABLE.has(u.status)).length} open
            </Badge>
          }
        />
        <FloorPlate
          units={floorUnits}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <details className="mt-4 rounded-xl border border-ink-700/70 bg-ink-800/40 px-4 py-3">
          <summary className="cursor-pointer text-[12.5px] font-medium text-mist-200">
            3D apartment plans — all seven units on a typical floor
          </summary>
          <p className="mt-2 text-[11.5px] text-mist-400">
            The same seven plans repeat on every floor from 1 to {FLOORS}. Sizes and facings on this
            sheet are the client&apos;s published figures.
          </p>
          <PlanSheet
            src={ONYX_UNIT_PLANS_OVERVIEW}
            alt="Overview sheet showing the seven apartment plans, their built-up areas and facings"
            label="3D apartment plans overview"
          />
        </details>
      </Card>

      {/* C — unit detail + D — interior */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <UnitDetail
          unit={selected}
          canWrite={canWrite && !provisional}
          saving={saving}
          notice={notice}
          onStatus={setStatus}
          onClose={() => setSelectedId(null)}
        />
        <InteriorViewer unit={selected} brandId={brandId} />
      </div>

      {/* E — project information */}
      <ProjectInfo />
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* A. Tower — 3D                                                       */
/* ------------------------------------------------------------------ */

function FloorRail({
  byFloor,
  floor,
  onSelect,
}: {
  byFloor: Map<number, Unit[]>;
  floor: number;
  onSelect: (f: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [floor]);

  return (
    <div className="flex w-full shrink-0 flex-col gap-2 lg:w-[200px]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-mist-400">Floor</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Floor up"
            onClick={() => onSelect(Math.min(FLOORS, floor + 1))}
            disabled={floor >= FLOORS}
          >
            <ChevronUp className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Floor down"
            onClick={() => onSelect(Math.max(1, floor - 1))}
            disabled={floor <= 1}
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      <div
        ref={railRef}
        role="listbox"
        aria-label="Select a floor"
        className="max-h-[420px] overflow-y-auto rounded-xl border border-ink-700/70 bg-ink-800/40 p-1.5"
      >
        {Array.from({ length: FLOORS }, (_, i) => {
          const f = FLOORS - i;
          const list = byFloor.get(f) ?? [];
          const avail = list.filter((u) => SELLABLE.has(u.status)).length;
          const active = f === floor;
          return (
            <button
              key={f}
              type="button"
              role="option"
              aria-selected={active}
              data-active={active}
              onClick={() => onSelect(f)}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-[12px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                active ? "bg-brand-500/20 text-mist-100" : "text-mist-300 hover:bg-ink-700/60",
              )}
            >
              <span className="tnum font-medium">Floor {f}</span>
              <span className="tnum text-[11px] text-mist-400">{avail}/{list.length}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ totals }: { totals: Record<UnitStatus, number> }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      {STATUS_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 text-[11.5px] text-mist-300">
          <span
            className="size-2.5 rounded-[3px] border"
            style={{ background: STATUS_META[s].fill, borderColor: STATUS_META[s].stroke }}
            aria-hidden
          />
          {STATUS_META[s].label}
          <span className="tnum text-mist-400">{totals[s]}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* B. Floor plate                                                      */
/* ------------------------------------------------------------------ */

const PLATE_W = 720;
const PLATE_H = 380;

const PLATE_PAD = 18;
const PLATE_COL_W = 214;
const PLATE_ROW_H = 110;
const PLATE_COL_X = [PLATE_PAD, PLATE_PAD + PLATE_COL_W + 20, PLATE_W - PLATE_PAD - PLATE_COL_W];
const PLATE_ROW_Y = [PLATE_PAD, PLATE_PAD + PLATE_ROW_H + 8, PLATE_PAD + (PLATE_ROW_H + 8) * 2];

/** The real arrangement, read off the key-plan inset printed on every
 *  APARTMENT PLAN sheet: 2·3·4 across the top, 1 and 5 flanking the core,
 *  7 and 6 along the bottom. A number the layout does not cover gets no slot. */
function plateSlot(unitNumber: string): { x: number; y: number; w: number; h: number } | null {
  const pos = onyxUnitPosition(unitNumber);
  const cell = pos ? ONYX_PLATE_LAYOUT[pos] : undefined;
  if (!cell) return null;
  return { x: PLATE_COL_X[cell.col], y: PLATE_ROW_Y[cell.row], w: PLATE_COL_W, h: PLATE_ROW_H };
}

function FloorPlate({
  units,
  selectedId,
  onSelect,
}: {
  units: Unit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ordered = useMemo(
    () => units.map((u) => ({ u, s: plateSlot(u.number) })).filter((e): e is { u: Unit; s: NonNullable<ReturnType<typeof plateSlot>> } => !!e.s),
    [units],
  );

  if (!units.length) {
    return (
      <p className="rounded-xl border border-ink-700/70 bg-ink-800/40 px-4 py-8 text-center text-[12.5px] text-mist-400">
        No units are recorded on this floor.
      </p>
    );
  }

  return (
    <div className="relative overflow-x-auto">
      <div className="relative min-w-[560px]">
        <svg
          viewBox={`0 0 ${PLATE_W} ${PLATE_H}`}
          className="relative w-full"
          style={{ aspectRatio: `${PLATE_W} / ${PLATE_H}` }}
          role="group"
          aria-label="Floor plate — select a unit"
        >
          <rect x="0" y="0" width={PLATE_W} height={PLATE_H} rx="14" fill="#0d1424" stroke="#ffffff14" />

          {/* central core: lift lobby + staircase, between units 1 and 5 */}
          <g>
            <rect
              x={PLATE_COL_X[1]}
              y={PLATE_ROW_Y[1]}
              width={PLATE_COL_W}
              height={PLATE_ROW_H * 2 + 8}
              rx="6"
              fill="#ffffff0d"
              stroke="#ffffff26"
            />
            <rect x={PLATE_COL_X[1] + 16} y={PLATE_ROW_Y[1] + 18} width="80" height="54" rx="3" fill="#ffffff0f" stroke="#ffffff2e" />
            <rect x={PLATE_COL_X[1] + 116} y={PLATE_ROW_Y[1] + 18} width="80" height="54" rx="3" fill="#ffffff0f" stroke="#ffffff2e" />
            <text x={PLATE_COL_X[1] + PLATE_COL_W / 2} y={PLATE_ROW_Y[1] + 94} textAnchor="middle" fontSize="10" fill="#94a3b8">Lift lobby</text>
            <text x={PLATE_COL_X[1] + PLATE_COL_W / 2} y={PLATE_ROW_Y[1] + 128} textAnchor="middle" fontSize="10" fill="#94a3b8">Staircase</text>
          </g>

          {ordered.map(({ u, s }) => {
            const meta = STATUS_META[u.status];
            const active = u.id === selectedId;
            return (
              <g key={u.id}>
                <rect
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  rx="5"
                  fill={meta.fill}
                  stroke={active ? "#e2e8f0" : meta.stroke}
                  strokeWidth={active ? 2 : 1}
                />
                <text x={s.x + 12} y={s.y + s.h / 2 - 2} fontSize="13" fontWeight="600" fill="#e2e8f0">
                  {u.number}
                </text>
                <text x={s.x + 12} y={s.y + s.h / 2 + 13} fontSize="10" fill="#94a3b8">
                  {u.bhk}
                  {(() => {
                    const t = onyxUnitType(u.number);
                    const sq = u.sizeSqft ?? t?.sqFt ?? null;
                    const face = u.facing ?? t?.facing ?? null;
                    return `${sq ? ` · ${sq.toLocaleString("en-IN")} sq ft` : ""}${face ? ` · ${face}` : ""}`;
                  })()}
                </text>
                <text x={s.x + s.w - 10} y={s.y + s.h / 2 + 4} textAnchor="end" fontSize="9.5" fill={meta.stroke}>
                  {meta.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* real buttons layered over the polygons: keyboard reachable */}
        <div className="absolute inset-0">
          {ordered.map(({ u, s }) => {
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onSelect(u.id)}
                aria-pressed={u.id === selectedId}
                className="absolute rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                style={{
                  left: `${(s.x / PLATE_W) * 100}%`,
                  top: `${(s.y / PLATE_H) * 100}%`,
                  width: `${(s.w / PLATE_W) * 100}%`,
                  height: `${(s.h / PLATE_H) * 100}%`,
                }}
              >
                <span className="sr-only">
                  Unit {u.number}, {u.bhk}
                  {u.sizeSqft ? `, ${u.sizeSqft} square feet` : ""}, {STATUS_META[u.status].label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* C. Unit detail                                                      */
/* ------------------------------------------------------------------ */

/** A plan sheet: lazy thumbnail, click to enlarge over the page. */
function PlanSheet({ src, alt, label }: { src: string; alt: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (failed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 block w-full overflow-hidden rounded-xl border border-ink-700/70 bg-white outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        aria-label={`${label} — enlarge`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="w-full object-contain"
        />
      </button>
      <p className="mt-1 text-[11px] text-mist-400">{label} — click to enlarge</p>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg object-contain" />
          <Button
            variant="secondary"
            size="sm"
            aria-label="Close plan"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4"
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-800/80 py-1.5 last:border-0">
      <span className="text-[11.5px] text-mist-400">{label}</span>
      <span className="text-[12.5px] font-medium text-mist-100">{value}</span>
    </div>
  );
}

function UnitDetail({
  unit,
  canWrite,
  saving,
  notice,
  onStatus,
  onClose,
}: {
  unit: Unit | null;
  canWrite: boolean;
  saving: boolean;
  notice: string | null;
  onStatus: (u: Unit, s: UnitStatus) => void;
  onClose: () => void;
}) {
  if (!unit) {
    return (
      <Card>
        <SectionTitle title="Unit detail" hint="Pick a unit on the floor plate to see it here." />
        <p className="py-8 text-center text-[12.5px] text-mist-400">No unit selected.</p>
      </Card>
    );
  }
  const meta = STATUS_META[unit.status];
  const type = onyxUnitType(unit.number);
  return (
    <Card>
      <SectionTitle
        title={`Unit ${unit.number}`}
        hint={type ? `Floor ${unit.floor} · position ${type.position} on the plate` : `Floor ${unit.floor}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <Button variant="ghost" size="sm" aria-label="Clear selection" onClick={onClose}>
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
        }
      />
      <div>
        <Row label="Configuration" value={unit.bhk !== "To be confirmed" ? unit.bhk : type?.bhk ?? "To be confirmed"} />
        <Row
          label="Built-up area"
          value={
            unit.sizeSqft
              ? `${unit.sizeSqft.toLocaleString("en-IN")} sq ft`
              : type
              ? `${type.sqFt.toLocaleString("en-IN")} sq ft`
              : "To be confirmed"
          }
        />
        <Row label="Facing" value={unit.facing ?? type?.facing ?? "To be confirmed"} />
        <Row label="Price" value={unit.priceLabel ?? "From approx ₹1.89 Cr — exact price to be confirmed"} />
        <Row label="Linked lead" value={unit.leadName ?? "None linked"} />
      </div>

      {type && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-mist-400">Rooms</p>
          <ul className="grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
            {type.rooms.map((r, i) => (
              <li
                key={`${r.name}-${i}`}
                className="flex items-baseline justify-between gap-3 border-b border-ink-800/60 py-1 text-[12px] last:border-0"
              >
                <span className="text-mist-300">{r.name}</span>
                <span className="tabular-nums text-mist-400">{r.dimensions ?? "—"}</span>
              </li>
            ))}
          </ul>
          {type.keyPlanNote && <p className="mt-2 text-[11.5px] text-mist-400">{type.keyPlanNote}</p>}
          <PlanSheet
            src={type.planImage}
            alt={`Apartment plan for unit position ${type.position}, ${type.sqFt} sq ft ${type.facing.toLowerCase()} facing`}
            label={`Apartment plan — unit ${type.position}`}
          />
        </div>
      )}

      {canWrite && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-mist-400">Set status</p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ORDER.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === unit.status ? "primary" : "secondary"}
                disabled={saving || s === unit.status}
                onClick={() => onStatus(unit, s)}
              >
                {STATUS_META[s].label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {notice && <p className="mt-3 text-[11.5px] text-bad-400">{notice}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* D. Interior / 360                                                   */
/* ------------------------------------------------------------------ */

/**
 * The 360 tour is a separate chunk: /showcase must not carry it until an Onyx
 * unit is actually opened.
 */
const OnyxTour = dynamic(() => import("./onyx-tour").then((m) => m.OnyxTour), {
  ssr: false,
  loading: () => (
    <Card>
      <div className="grid h-64 place-items-center text-mist-400">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
    </Card>
  ),
});

function InteriorViewer({ unit, brandId }: { unit: Unit | null; brandId: string }) {
  // Every unit on the plate has the same five-room tour — the panoramas are
  // representative interiors, identical for every flat. With a unit selected
  // the captions, header and minimap are that unit's own plan data; with
  // nothing selected the same tour runs as a TYPICAL residence, which is what
  // it honestly is. There is no placeholder branch: both paths paint panoramas.
  return <OnyxTour unitNumber={unit?.number} brandId={brandId} />;
}

/* ------------------------------------------------------------------ */
/* E. Project information                                              */
/* ------------------------------------------------------------------ */

function ProjectInfo() {
  return (
    <Card>
      <SectionTitle
        title="Glentree Onyx"
        hint="RTC X Roads, Hyderabad"
        action={
          <a
            href={SITE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] text-brand-300 hover:text-brand-200"
          >
            Official site <ExternalLink className="size-3.5" aria-hidden />
          </a>
        }
      />
      <div className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
        {FACTS.map((f) => (
          <Row key={f.label} label={f.label} value={f.value} />
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-700/70 bg-ink-800/40 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-mist-400">
            <Building2 className="size-3.5" aria-hidden /> Approvals
          </p>
          {APPROVALS.map((a) => (
            <Row key={a.label} label={a.label} value={a.value} />
          ))}
        </div>
        <div className="rounded-xl border border-ink-700/70 bg-ink-800/40 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-mist-400">
            <Phone className="size-3.5" aria-hidden /> Sales enquiries
          </p>
          <div className="space-y-1.5 text-[12.5px] text-mist-200">
            <p><a className="hover:text-mist-100" href="tel:+919646644644">+91 96466 44644</a></p>
            <p><a className="hover:text-mist-100" href="tel:+919133555509">+91 91335 55509</a></p>
            <p className="flex items-center gap-1.5">
              <Mail className="size-3.5 text-mist-400" aria-hidden />
              <a className="hover:text-mist-100" href="mailto:sales@glentreehomes.in">sales@glentreehomes.in</a>
            </p>
            <p className="flex items-center gap-1.5 text-mist-400">
              <MapPin className="size-3.5" aria-hidden /> RTC X Roads, Hyderabad
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-mist-400">
        <Layers className="size-3.5" aria-hidden />
        Elevation and floor plates are schematic sales aids drawn from the published unit mix.
        <Compass className="size-3.5" aria-hidden />
        Dimensions and unit orientation to be confirmed against the sanctioned plan.
      </p>
    </Card>
  );
}

export default OnyxShowcase;
