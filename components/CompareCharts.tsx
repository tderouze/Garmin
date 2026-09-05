"use client";

import { useEffect, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts";
import { movingAverage, normalizeByDistance } from "@/lib/calculations";

export type CompareMetric = "pace" | "hr" | "cadence" | "power" | "elevation";

export interface CompareChartsProps {
  activities: ActivityWithPoints[];
  metric: CompareMetric;
  /** lissage window (1 = no smoothing, 5/7 = moyenne glissante) */
  smoothWindow?: number;
  /** group id for echarts connect (crosshair sync) */
  connectGroup?: string;
  /** when true, normalize x-axis to 0-100% distance */
  normalizeByDistance?: boolean;
}

export interface TrackPointLite {
  lat?: number;
  lng?: number;
  ele?: number | null;
  elevation?: number | null;
  hr?: number | null;
  cadence?: number | null;
  power?: number | null;
  speed?: number | null;
  pace?: number | null; // sec/km
  time?: string | Date;
  distanceM?: number;
}

export interface ActivityWithPoints {
  id: string;
  name?: string | null;
  date?: string | Date;
  trackPoints: TrackPointLite[];
  color?: string;
}

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#65a30d"];

const METRIC_LABEL: Record<CompareMetric, string> = {
  pace: "Allure (sec/km)",
  hr: "FC (bpm)",
  cadence: "Cadence (spm)",
  power: "Puissance (W)",
  elevation: "Élévation (m)",
};

function extractMetricValue(p: TrackPointLite, metric: CompareMetric): number | null {
  switch (metric) {
    case "pace": {
      if (p.pace != null && isFinite(p.pace as number) && (p.pace as number) > 0) return p.pace as number;
      if (p.speed != null && isFinite(p.speed as number) && (p.speed as number) > 0) {
        // speed m/s -> sec per km
        return 1000 / (p.speed as number);
      }
      return null;
    }
    case "hr":
      return p.hr != null && isFinite(p.hr as number) ? (p.hr as number) : null;
    case "cadence":
      return p.cadence != null && isFinite(p.cadence as number) ? (p.cadence as number) : null;
    case "power":
      return p.power != null && isFinite(p.power as number) ? (p.power as number) : null;
    case "elevation": {
      const v = (p.ele ?? p.elevation) as number | null | undefined;
      return v != null && isFinite(v as number) ? (v as number) : null;
    }
    default:
      return null;
  }
}

function formatPace(secPerKm: number): string {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export function CompareCharts({
  activities,
  metric,
  smoothWindow = 1,
  connectGroup = "compare",
  normalizeByDistance: normalizeByDistanceProp = false,
}: CompareChartsProps) {
  // echarts.connect syncs crosshair/tooltip across all charts sharing the same group
  useEffect(() => {
    if (!connectGroup) return;
    try {
      echarts.connect(connectGroup);
    } catch {
      // noop in SSR / missing echarts
    }
    return () => {
      try {
        echarts.disconnect(connectGroup);
      } catch {
        // noop
      }
    };
  }, [connectGroup]);

  const { option, hasData } = useMemo(() => {
    if (!activities || activities.length === 0) {
      return { option: null as EChartsOption | null, hasData: false };
    }

    const series: NonNullable<EChartsOption["series"]> = [];
    let anyValue = false;

    // Determine max length for x axis if not normalizing
    const maxLen = Math.max(...activities.map((a) => a.trackPoints?.length ?? 0), 0);
    const xIsPercent = normalizeByDistanceProp;

    for (let idx = 0; idx < activities.length; idx++) {
      const act = activities[idx];
      const pts = act.trackPoints ?? [];
      if (!pts.length) continue;
      const raw: (number | null)[] = pts.map((p) => extractMetricValue(p, metric));
      const hasSome = raw.some((v) => v != null);
      if (hasSome) anyValue = true;

      const smoothed = smoothWindow > 1 ? movingAverage(raw, smoothWindow) : raw;

      // Build data as [x, y] pairs so x can be percent or index — use real distance ratio when normalizing
      let data: (number | null)[] | [number, number | null][];

      if (xIsPercent) {
        const ratios = normalizeByDistance(pts);
        data = pts.map((_, i) => {
          const x = (ratios[i] ?? 0) * 100;
          const y = smoothed[i];
          return [Number(x.toFixed(2)), y] as [number, number | null];
        });
      } else {
        // use index as x implicitly — echarts category would also work, but value axis is more syncable
        // we push as y-only for simplicity, x will be index via xAxis category
        data = smoothed as (number | null)[];
      }

      const color = act.color ?? PALETTE[idx % PALETTE.length];

      series.push({
        name: act.name ?? act.id.slice(0, 8),
        type: "line",
        smooth: smoothWindow > 1 ? true : false,
        showSymbol: false,
        lineStyle: { color, width: 1.8 },
        data: data as any,
        connectNulls: false,
        emphasis: { focus: "series" },
      } as any);
    }

    const isPace = metric === "pace";

    // For percent mode, xAxis is value 0-100; otherwise category index
    const xAxis: EChartsOption["xAxis"] = xIsPercent
      ? {
          type: "value" as const,
          min: 0,
          max: 100,
          name: "Distance (%)",
          nameLocation: "middle",
          nameGap: 24,
          nameTextStyle: { fontSize: 11, color: "#71717a" },
          axisLabel: { fontSize: 11, formatter: "{value}%" },
          axisPointer: { show: true, label: { formatter: (p: any) => `${Number(p.value).toFixed(1)}%` } },
        }
      : ({
          type: "category" as const,
          data: Array.from({ length: maxLen }, (_, i) => String(i)),
          name: "Point",
          nameLocation: "middle",
          nameGap: 18,
          nameTextStyle: { fontSize: 11, color: "#71717a" },
          axisLabel: { fontSize: 10, interval: Math.max(0, Math.floor(maxLen / 10)) },
          boundaryGap: false,
        } as any);

    const yAxis: EChartsOption["yAxis"] = {
      type: "value" as const,
      inverse: isPace, // pace inverse: lower (faster) at top
      name: METRIC_LABEL[metric],
      nameTextStyle: { fontSize: 11, color: "#71717a" },
      axisLabel: {
        fontSize: 11,
        formatter: isPace ? (v: number) => formatPace(v) : undefined,
      },
      scale: true,
      axisPointer: { show: true },
    };

    const opt: EChartsOption = {
      // @ts-ignore group is not in EChartsOption type but supported by echarts
      group: connectGroup,
      // axisPointer.link syncs crosshair across charts in same group
      // @ts-ignore axisPointer is valid at top-level for linking
      axisPointer: { link: [{ xAxisIndex: "all" }] } as unknown as EChartsOption["axisPointer"],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", label: { backgroundColor: "#71717a" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ seriesName: string; data: any; color: string; value: any; dataIndex: number }>;
          if (!arr || !arr.length) return "";
          // extract x label
          const idx = arr[0]?.dataIndex;
          let title = "";
          if (xIsPercent) {
            const xVal = (arr[0]?.data as [number, number])?.[0];
            title = xVal != null ? `${xVal.toFixed(1)}%` : `#${idx}`;
          } else {
            title = `#${idx}`;
          }
          let html = `<div style="font-size:12px;margin-bottom:4px;font-weight:600">${title}</div>`;
          for (const p of arr) {
            let y: number | null = null;
            if (Array.isArray(p.data)) y = p.data[1] as number;
            else if (typeof p.data === "number") y = p.data;
            else if (p.value != null && Array.isArray(p.value)) y = p.value[1] as number;
            else if (p.value != null && typeof p.value === "number") y = p.value;
            const label = isPace && y != null ? formatPace(y) : y != null ? String(Math.round(y)) : "—";
            const unit = metric === "hr" ? " bpm" : metric === "cadence" ? " spm" : metric === "power" ? " W" : metric === "elevation" ? " m" : "";
            html += `<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;background:${p.color};border-radius:50%"></span>${p.seriesName}: ${y != null ? label + unit : "—"}</div>`;
          }
          return html;
        },
      },
      legend: {
        data: (series as any[]).map((s: any) => s.name),
        top: 0,
        type: "scroll",
        textStyle: { fontSize: 11 },
      },
      grid: { left: 62, right: 20, top: 32, bottom: xIsPercent ? 36 : 48, containLabel: true },
      xAxis,
      yAxis,
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 6 }],
      series,
      animation: false,
    };

    return { option: opt, hasData: anyValue };
  }, [activities, metric, smoothWindow, connectGroup, normalizeByDistanceProp]);

  if (!activities || activities.length === 0) {
    return (
      <div className="flex h-[360px] w-full items-center justify-center rounded-xl border bg-white text-sm text-zinc-500">
        Sélectionnez des activités pour afficher le graphique.
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex h-[360px] w-full items-center justify-center rounded-xl border bg-white text-sm text-zinc-500">
        Pas de données {METRIC_LABEL[metric]} pour la sélection.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-2 shadow-sm">
      <ReactECharts
        option={option as any}
        style={{ height: 360, width: "100%" }}
        opts={{ renderer: "canvas" }}
        // @ts-ignore echarts-for-react group sync is via instance group; we set option.group above and also ensure connect via notMerge
        notMerge={false}
      />
    </div>
  );
}
