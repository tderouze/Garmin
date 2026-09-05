"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import * as turf from "@turf/turf";
import type { Trace, TracePoint } from "./MapView";

export interface ElevationProfileProps {
  traces: Trace[];
  hoverPoint?: { traceId: string; index: number } | null;
  onHover?: (traceId: string, index: number, point: TracePoint) => void;
}

function cumulativeDistKm(points: TracePoint[]): number[] {
  if (!points.length) return [];
  const dists: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!isFinite(a.lat) || !isFinite(a.lng) || !isFinite(b.lat) || !isFinite(b.lng)) {
      dists.push(total);
      continue;
    }
    try {
      const d = turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: "kilometers" });
      total += d;
    } catch {
      // ignore
    }
    dists.push(total);
  }
  return dists;
}

export function ElevationProfile({ traces, hoverPoint, onHover }: ElevationProfileProps) {
  const { option, hasElevation } = useMemo(() => {
    if (!traces.length) {
      return { option: null as EChartsOption | null, hasElevation: false };
    }

    const series: EChartsOption["series"] = [];
    let hasEle = false;
    // Build x unified — we use distance axis per trace individually via [distance, ele] pairs
    for (const trace of traces) {
      const pts = trace.points;
      if (!pts.length) continue;
      const dists = cumulativeDistKm(pts);
      const data: [number, number | null][] = [];
      for (let i = 0; i < pts.length; i++) {
        const ele = pts[i].ele;
        if (ele != null && isFinite(ele as number)) hasEle = true;
        data.push([Number(dists[i].toFixed(3)), ele != null ? (ele as number) : null]);
      }
      // Filter null ele? keep but echarts will connect
      series.push({
        name: trace.id.slice(0, 8),
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: trace.color, width: 2 },
        areaStyle: { color: trace.color, opacity: 0.08 },
        data: data as unknown as number[][],
        emphasis: { focus: "series" },
      } as never);
    }

    const opt: EChartsOption = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: unknown) => {
          const arr = params as Array<{ seriesName: string; data: [number, number]; color: string }>;
          if (!arr || !arr.length) return "";
          const dist = arr[0]?.data?.[0];
          let html = `<div style="font-size:12px;margin-bottom:4px">${dist != null ? dist.toFixed(2) + " km" : ""}</div>`;
          for (const p of arr) {
            const ele = p.data?.[1];
            html += `<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;background:${p.color};border-radius:50%"></span>${p.seriesName}: ${ele != null ? Math.round(ele) + " m" : "—"}</div>`;
          }
          return html;
        },
      },
      legend: {
        data: (series as Array<{ name: string }>).map((s) => s.name),
        top: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 50, right: 20, top: 30, bottom: 30, containLabel: true },
      xAxis: {
        type: "value",
        name: "Distance (km)",
        nameLocation: "middle",
        nameGap: 24,
        nameTextStyle: { fontSize: 11, color: "#71717a" },
        axisLabel: { fontSize: 11 },
        min: 0,
      },
      yAxis: {
        type: "value",
        name: hasEle ? "Altitude (m)" : "Altitude",
        nameTextStyle: { fontSize: 11, color: "#71717a" },
        axisLabel: { fontSize: 11 },
        scale: true,
      },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 2 }],
      series: series as never,
      animation: false,
    };

    // Highlight hover point via markPoint on active series if hoverPoint provided
    if (hoverPoint) {
      const idx = traces.findIndex((t) => t.id === hoverPoint.traceId);
      if (idx >= 0 && series[idx]) {
        const s = series[idx] as unknown as Record<string, unknown>;
        const data = (s["data"] as [number, number][]) ?? [];
        const pt = data[hoverPoint.index];
        if (pt) {
          (s as Record<string, unknown>)["markPoint"] = {
            data: [{ coord: pt }],
            symbol: "circle",
            symbolSize: 10,
            itemStyle: { color: traces[idx].color, borderColor: "#fff", borderWidth: 2 },
          };
        }
      }
    }

    return { option: opt, hasElevation: hasEle };
  }, [traces, hoverPoint]);

  if (!traces.length) {
    return (
      <div className="flex h-[280px] w-full items-center justify-center rounded-xl border bg-white text-sm text-zinc-500">
        Sélectionnez des traces pour voir le profil d’élévation.
      </div>
    );
  }

  if (!option) {
    return (
      <div className="flex h-[280px] w-full items-center justify-center rounded-xl border bg-white text-sm text-zinc-500">
        Données d’élévation indisponibles.
      </div>
    );
  }

  const onEvents: Record<string, (params: unknown) => void> = {};
  if (onHover) {
    onEvents["updateAxisPointer"] = (params: unknown) => {
      const p = params as { dataIndex?: number; seriesIndex?: number };
      if (p.dataIndex != null && p.seriesIndex != null) {
        const trace = traces[p.seriesIndex];
        if (!trace) return;
        const pt = trace.points[p.dataIndex];
        if (pt) onHover(trace.id, p.dataIndex, pt);
      }
    };
    // also handle click
    onEvents["click"] = (params: unknown) => {
      const p = params as { dataIndex?: number; seriesIndex?: number };
      if (p.dataIndex != null && p.seriesIndex != null) {
        const trace = traces[p.seriesIndex];
        if (!trace) return;
        const pt = trace.points[p.dataIndex];
        if (pt) onHover(trace.id, p.dataIndex, pt);
      }
    };
  }

  return (
    <div className="rounded-xl border bg-white p-2 shadow-sm">
      <div className="px-2 pt-1 text-xs font-medium text-zinc-600">
        Profil d’élévation {hasElevation ? "" : "(altitude manquante — affichage à 0)"}
      </div>
      <ReactECharts
        option={option}
        style={{ height: 300, width: "100%" }}
        onEvents={onEvents}
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}
