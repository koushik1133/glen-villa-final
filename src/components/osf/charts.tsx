"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Chart wrappers.
 *
 * Recharts needs the browser, so everything here is a client component —
 * server pages fetch the data and pass plain arrays in. Each wrapper fixes the
 * theme (grid colour, tooltip chrome, axis styling) so charts stay consistent
 * without every caller re-specifying twenty props.
 */

export const SERIES = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];

const AXIS = {
  stroke: "var(--color-line)",
  tick: { fill: "var(--color-muted)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip() {
  return (
    <Tooltip
      cursor={{ fill: "rgba(255,255,255,0.04)" }}
      contentStyle={{
        background: "var(--color-raised)",
        border: "1px solid var(--color-line-strong)",
        borderRadius: 12,
        fontSize: 12,
        color: "var(--color-ink)",
        boxShadow: "0 12px 32px -12px rgba(0,0,0,0.8)",
      }}
      labelStyle={{ color: "var(--color-muted)", marginBottom: 4 }}
    />
  );
}

export interface Point {
  label: string;
  [key: string]: string | number;
}

/** Trend over time. Gradient fill reads better than a bare line on dark. */
export function TrendChart({
  data,
  keys,
  height = 260,
}: {
  data: Point[];
  keys: { key: string; name: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {keys.map((k, i) => (
            <linearGradient key={k.key} id={`grad-${k.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={52} />
        <ChartTooltip />
        {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }} />}
        {keys.map((k, i) => (
          <Area
            key={k.key}
            type="monotone"
            dataKey={k.key}
            name={k.name}
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={2}
            fill={`url(#grad-${k.key})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({
  data,
  keys,
  height = 260,
  horizontal = false,
}: {
  data: Point[];
  keys: { key: string; name: string }[];
  height?: number;
  horizontal?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, left: horizontal ? 8 : -18, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...AXIS} />
            <YAxis type="category" dataKey="label" {...AXIS} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" {...AXIS} />
            <YAxis {...AXIS} width={52} />
          </>
        )}
        <ChartTooltip />
        {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }} />}
        {keys.map((k, i) => (
          <Bar
            key={k.key}
            dataKey={k.key}
            name={k.name}
            fill={SERIES[i % SERIES.length]}
            radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}
            maxBarSize={horizontal ? 22 : 48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  height = 240,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="var(--color-canvas)"
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES[i % SERIES.length]} />
          ))}
        </Pie>
        <ChartTooltip />
        <Legend
          wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }}
          formatter={(v: string, entry) => {
            const value = (entry?.payload as unknown as { value?: number })?.value ?? 0;
            const pct = total > 0 ? ((value / total) * 100).toFixed(0) : "0";
            return `${v} · ${pct}%`;
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SparkLine({ data, height = 40 }: { data: Point[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-gold-500)"
          strokeWidth={1.75}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Conversion funnel. Rendered with divs rather than a chart library — a real
 * funnel needs the drop-off percentage between adjacent stages, which reads
 * far more clearly as labelled bars than as a tapered polygon.
 */
export function FunnelChart({ stages }: { stages: { label: string; value: number }[] }) {
  const top = stages[0]?.value ?? 0;
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const pctOfTop = top > 0 ? (s.value / top) * 100 : 0;
        const prev = i > 0 ? stages[i - 1].value : null;
        const stepPct = prev && prev > 0 ? (s.value / prev) * 100 : null;
        return (
          <div key={s.label}>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-[--color-ink]">{s.label}</span>
              <span className="tabular-nums text-[--color-muted]">
                {s.value.toLocaleString("en-IN")}
                {stepPct !== null && (
                  <span className={stepPct < 40 ? "ml-2 text-[--color-danger]" : "ml-2 text-[--color-faint]"}>
                    {stepPct.toFixed(0)}% of previous
                  </span>
                )}
              </span>
            </div>
            <div className="h-7 overflow-hidden rounded-lg bg-[--color-line]">
              <div
                className="flex h-full items-center rounded-lg transition-all"
                style={{
                  width: `${Math.max(pctOfTop, s.value > 0 ? 4 : 0)}%`,
                  background: `linear-gradient(90deg, ${SERIES[i % SERIES.length]}, ${SERIES[i % SERIES.length]}aa)`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
