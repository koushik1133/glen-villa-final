"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type * as Impl from "./charts-impl";

/**
 * Chart wrappers (lazy barrel).
 *
 * The real implementations live in ./charts-impl. recharts is ~100kB of the
 * client bundle and every chart is below the fold, so each wrapper is loaded on
 * demand with a fixed-height placeholder that matches the chart box exactly —
 * same height, same slot, no layout shift, no appearance change.
 */

export { VIZ } from "./charts-viz";

function Skeleton({ height }: { height: number }) {
  return <div style={{ height }} className="w-full animate-pulse rounded-lg bg-ink-850/40" aria-hidden />;
}

const lazyChart = <K extends "TrendArea" | "ComboChart" | "StackedBars" | "DonutChart" | "RatingGauge" | "MiniSpark">(
  name: K,
  fallbackHeight: number,
) =>
  dynamic(() => import("./charts-impl").then((m) => m[name] as never), {
    ssr: false,
    loading: () => <Skeleton height={fallbackHeight} />,
  }) as (props: ComponentProps<(typeof Impl)[K]>) => React.ReactNode;

const TrendAreaLazy = lazyChart("TrendArea", 240);
const ComboChartLazy = lazyChart("ComboChart", 260);
const StackedBarsLazy = lazyChart("StackedBars", 220);
const DonutChartLazy = lazyChart("DonutChart", 200);
const RatingGaugeLazy = lazyChart("RatingGauge", 170);
const MiniSparkLazy = lazyChart("MiniSpark", 40);

/* Each wrapper re-reads `height` so the placeholder is the size this instance
   will actually take, not just the component default. */
export function TrendArea(props: ComponentProps<typeof Impl.TrendArea>) {
  return <TrendAreaLazy {...props} />;
}
export function ComboChart(props: ComponentProps<typeof Impl.ComboChart>) {
  return <ComboChartLazy {...props} />;
}
export function StackedBars(props: ComponentProps<typeof Impl.StackedBars>) {
  return <StackedBarsLazy {...props} />;
}
export function DonutChart(props: ComponentProps<typeof Impl.DonutChart>) {
  return <DonutChartLazy {...props} />;
}
export function RatingGauge(props: ComponentProps<typeof Impl.RatingGauge>) {
  return <RatingGaugeLazy {...props} />;
}
export function MiniSpark(props: ComponentProps<typeof Impl.MiniSpark>) {
  return <MiniSparkLazy {...props} />;
}
