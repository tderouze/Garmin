"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CompareCharts, type ActivityWithPoints, type CompareMetric } from "@/components/CompareCharts";
import { weeklyVolume, estimateVMA } from "@/lib/calculations";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

type PeriodKey = "7j" | "30j" | "90j" | "1an" | "tout";

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: "7j", label: "7j", days: 7 },
  { key: "30j", label: "30j", days: 30 },
  { key: "90j", label: "90j", days: 90 },
  { key: "1an", label: "1an", days: 365 },
  { key: "tout", label: "Tout", days: null },
];

const METRICS: { key: CompareMetric; label: string }[] = [
  { key: "pace", label: "Allure" },
  { key: "hr", label: "FC" },
  { key: "cadence", label: "Cadence" },
  { key: "power", label: "Puissance" },
  { key: "elevation", label: "Élévation" },
];

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#65a30d"];

interface ActivitySummary {
  id: string;
  garminId?: string | null;
  type: string;
  name?: string | null;
  date: string;
  distance: number;
  duration: number;
  elevationGain?: number | null;
  avgPace?: number | null;
  avgHR?: number | null;
  maxHR?: number | null;
  avgCadence?: number | null;
  avgPower?: number | null;
  calories?: number | null;
  tss?: number | null;
}

function formatDistance(m: number): string {
  if (!m) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}
function formatDuration(s: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}
function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return "—";
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, "0")} /km`;
}
function formatDate(d: string | Date): string {
  const date = new Date(d);
  return date.toLocaleDateString("fr-FR");
}

function periodToFromISO(period: PeriodKey): string | null {
  if (period === "tout") return null;
  const entry = PERIODS.find((p) => p.key === period);
  if (!entry || entry.days == null) return null;
  const from = new Date();
  from.setDate(from.getDate() - entry.days);
  from.setHours(0, 0, 0, 0);
  return from.toISOString();
}

export default function ComparePage() {
  const [period, setPeriod] = useState<PeriodKey>("30j");
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [traces, setTraces] = useState<ActivityWithPoints[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [tracesError, setTracesError] = useState<string | null>(null);
  const [metric, setMetric] = useState<CompareMetric>("pace");
  const [smoothWindow, setSmoothWindow] = useState(1);
  const [normalize, setNormalize] = useState(false);

  // Fetch list with period filter
  useEffect(() => {
    let cancelled = false;
    async function fetchList() {
      setLoading(true);
      setLoadError(null);
      try {
        const from = periodToFromISO(period);
        const params = new URLSearchParams({ type: "running", limit: "100" });
        if (from) params.set("from", from);
        const res = await fetch(`/api/activities?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ActivitySummary[];
        if (!cancelled) {
          const list = Array.isArray(data) ? data : [];
          setActivities(list);
          // If period changes and current selection not in new filtered list, optionally clear? keep but limit
          // Auto-select first 2 for demo if none selected and list >=2 and period !== tout manual not used? Keep previous selection but if empty, select first 2? No, keep empty.
        }
      } catch (e: unknown) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchList();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 10) return prev;
      return [...prev, id];
    });
  }, []);

  // Fetch detailed traces for selected
  useEffect(() => {
    if (selected.length === 0) {
      setTraces([]);
      setTracesError(null);
      return;
    }
    let cancelled = false;
    async function fetchTraces() {
      setTracesLoading(true);
      setTracesError(null);
      try {
        const results = await Promise.all(
          selected.map(async (id, idx) => {
            const res = await fetch(`/api/activities/${id}`);
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error((body as { error?: string }).error ?? `Activity ${id} fetch failed: ${res.status}`);
            }
            const act = (await res.json()) as {
              id: string;
              name?: string | null;
              trackPoints: Array<{
                lat: number;
                lng: number;
                ele?: number | null;
                time: string;
                hr?: number | null;
                cadence?: number | null;
                power?: number | null;
                speed?: number | null;
              }>;
            };
            const color = PALETTE[idx % PALETTE.length];
            const points = (act.trackPoints ?? []).map((tp) => ({
              lat: tp.lat,
              lng: tp.lng,
              ele: tp.ele,
              time: tp.time,
              hr: tp.hr,
              cadence: tp.cadence,
              power: tp.power,
              speed: tp.speed,
            }));
            return { id: act.id, name: (act as any).name ?? id.slice(0, 8), trackPoints: points, color } as ActivityWithPoints;
          })
        );
        if (!cancelled) setTraces(results);
      } catch (e: unknown) {
        if (!cancelled) setTracesError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setTracesLoading(false);
      }
    }
    fetchTraces();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Tableau récap data derived from selected activities (or all if none selected? use selected if exists else first period list)
  const recapActivities = useMemo(() => {
    if (selected.length > 0) {
      const map = new Map(activities.map((a) => [a.id, a] as const));
      return selected.map((id) => map.get(id)).filter((a): a is ActivitySummary => a != null);
    }
    // If no manual selection, recap shows whole period (first 20)
    return activities.slice(0, 20);
  }, [activities, selected]);

  // Best highlights for tableau récap
  const bestIds = useMemo(() => {
    if (recapActivities.length === 0) return {} as Record<string, string>;
    const best: Record<string, string> = {};
    // fastest pace = smallest avgPace
    let bestPace: ActivitySummary | null = null;
    let bestDist: ActivitySummary | null = null;
    let bestHR: ActivitySummary | null = null;
    let bestPower: ActivitySummary | null = null;
    let bestEle: ActivitySummary | null = null;
    for (const a of recapActivities) {
      if (a.avgPace != null && (bestPace == null || (a.avgPace as number) < (bestPace.avgPace as number))) bestPace = a;
      if (bestDist == null || a.distance > bestDist.distance) bestDist = a;
      if (a.avgHR != null && (bestHR == null || (a.avgHR as number) > (bestHR.avgHR as number))) bestHR = a;
      if (a.avgPower != null && (bestPower == null || (a.avgPower as number) > (bestPower.avgPower as number))) bestPower = a;
      if (a.elevationGain != null && (bestEle == null || (a.elevationGain as number) > (bestEle.elevationGain as number))) bestEle = a;
    }
    if (bestPace) best["pace"] = bestPace.id;
    if (bestDist) best["distance"] = bestDist.id;
    if (bestHR) best["hr"] = bestHR.id;
    if (bestPower) best["power"] = bestPower.id;
    if (bestEle) best["ele"] = bestEle.id;
    return best;
  }, [recapActivities]);

  // Courbe progression: avg pace vs date (sorted asc)
  const progressionOption = useMemo<EChartsOption | null>(() => {
    if (!activities.length) return null;
    const sorted = [...activities].filter((a) => a.avgPace != null).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (!sorted.length) return null;
    const dates = sorted.map((a) => formatDate(a.date));
    const paces = sorted.map((a) => a.avgPace as number);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "line" } },
      grid: { left: 62, right: 20, top: 22, bottom: 30, containLabel: true },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10, rotate: 20 } },
      yAxis: {
        type: "value",
        inverse: true,
        name: "Allure moy",
        nameTextStyle: { fontSize: 11, color: "#71717a" },
        axisLabel: {
          fontSize: 11,
          formatter: (v: number) => formatPace(v),
        },
        scale: true,
      },
      series: [
        {
          name: "Allure moy",
          type: "line",
          data: paces,
          smooth: true,
          showSymbol: true,
          symbolSize: 4,
          lineStyle: { color: "#2563eb", width: 2 },
          areaStyle: { color: "#2563eb", opacity: 0.06 },
        } as any,
      ],
      animation: false,
    } as EChartsOption;
  }, [activities]);

  // Volume hebdo option
  const weeklyData = useMemo(() => weeklyVolume(activities as any), [activities]);
  const volumeOption = useMemo<EChartsOption | null>(() => {
    if (!weeklyData.length) return null;
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const arr = params as Array<{ value: number; axisValue: string; marker: string }>;
          const p = arr?.[0];
          if (!p) return "";
          const km = (p.value / 1000).toFixed(1);
          return `${p.axisValue}<br/>${p.marker} ${km} km`;
        },
      },
      grid: { left: 52, right: 16, top: 16, bottom: 26, containLabel: true },
      xAxis: { type: "category", data: weeklyData.map((w) => w.week.slice(5)), axisLabel: { fontSize: 10 } },
      yAxis: {
        type: "value",
        name: "km / sem",
        nameTextStyle: { fontSize: 11, color: "#71717a" },
        axisLabel: { fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(0)}` },
      },
      series: [
        {
          name: "Volume",
          type: "bar",
          data: weeklyData.map((w) => w.distance),
          itemStyle: { color: "#16a34a", borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 28,
        } as any,
      ],
      animation: false,
    } as EChartsOption;
  }, [weeklyData]);

  const vma = useMemo(() => estimateVMA(activities as any), [activities]);

  const selectedSet = new Set(selected);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Comparaison performances</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Comparez allure, FC, cadence, puissance et élévation. Sélectionnez N activités ou filtrez par période.
        </p>
      </header>

      {/* Period + metric filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-700">Période</span>
          <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Période">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium ${period === p.key ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
                aria-pressed={period === p.key}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-6 w-px bg-zinc-200" aria-hidden />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-zinc-700">Métrique</span>
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${metric === m.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}
              aria-pressed={metric === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <span className="font-medium text-zinc-700">Lissage {smoothWindow > 1 ? `x${smoothWindow}` : "off"}</span>
            <input
              type="range"
              min={1}
              max={9}
              step={2}
              value={smoothWindow}
              onChange={(e) => setSmoothWindow(parseInt(e.target.value, 10))}
              className="w-24"
              aria-label="Lissage"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            Normaliser par distance
          </label>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Left: activity list */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Activités (course)</h2>
              <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white" data-testid="selection-count">
                {selected.length} sélectionnée(s)
              </span>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-zinc-500">Chargement…</div>
            ) : loadError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-500">Aucune activité pour cette période.</div>
            ) : (
              <ul className="max-h-[420px] divide-y divide-zinc-100 overflow-auto rounded-lg border">
                {activities.map((a) => {
                  const checked = selectedSet.has(a.id);
                  const disabled = !checked && selected.length >= 10;
                  return (
                    <li key={a.id} className="flex items-center gap-3 p-3 hover:bg-zinc-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(a.id)}
                        className="h-4 w-4 rounded border-zinc-300 disabled:opacity-40"
                        aria-label={`Sélectionner ${a.name ?? a.id}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-zinc-900">{a.name ?? `Activité ${a.id.slice(0, 8)}`}</div>
                        <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                          <span>{formatDate(a.date)}</span>
                          <span>{formatDistance(a.distance)}</span>
                          <span>{formatPace(a.avgPace)}</span>
                        </div>
                      </div>
                      {checked && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-white shadow"
                          style={{ backgroundColor: PALETTE[selected.indexOf(a.id) % PALETTE.length] }}
                          aria-hidden
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setSelected([])}
                className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                disabled={selected.length === 0}
              >
                Effacer sélection
              </button>
              <button
                type="button"
                onClick={() => {
                  // sélectionner les 3 plus récentes pour demo rapide
                  setSelected(activities.slice(0, Math.min(3, activities.length)).map((a) => a.id));
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
                disabled={activities.length === 0}
              >
                Sélection rapide (3)
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Sélectionnez jusqu’à 10 activités pour comparer les courbes.</p>
          </div>

          {/* progression + volume + VMA */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Progression & volume</h3>
            {vma != null && (
              <div className="mt-2 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                VMA estimée (Léger) : <span className="font-bold">{vma.toFixed(1)} km/h</span> — sur {activities.length} activité(s)
              </div>
            )}
            <div className="mt-3">
              <div className="text-xs font-medium text-zinc-700">Allure moyenne — évolution</div>
              {progressionOption ? (
                <ReactECharts option={progressionOption} style={{ height: 220, width: "100%" }} opts={{ renderer: "canvas" }} />
              ) : (
                <div className="flex h-[160px] items-center justify-center text-xs text-zinc-500">Données d’allure insuffisantes.</div>
              )}
            </div>
            <div className="mt-3">
              <div className="text-xs font-medium text-zinc-700">Volume hebdomadaire</div>
              {volumeOption ? (
                <ReactECharts option={volumeOption} style={{ height: 200, width: "100%" }} opts={{ renderer: "canvas" }} />
              ) : (
                <div className="flex h-[160px] items-center justify-center text-xs text-zinc-500">Pas assez d’activités pour le volume hebdo.</div>
              )}
            </div>
          </div>

          <a href="/" className="text-sm text-zinc-600 underline hover:text-zinc-900">
            ← Retour dashboard
          </a>
        </div>

        {/* Right: charts + recap */}
        <div className="flex flex-col gap-4">
          {tracesError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{tracesError}</div>
          )}

          {/* Primary compare chart — single metric with sync group "compare" */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-800">
                Graphique : {METRICS.find((m) => m.key === metric)?.label} {normalize ? "(normalisé 0-100%)" : ""}
              </h2>
              <span className="text-xs text-zinc-500">Crosshair synchronisé • axe {metric === "pace" ? "inversé (plus bas = plus rapide)" : "standard"}</span>
            </div>
            {tracesLoading ? (
              <div className="flex h-[360px] w-full items-center justify-center rounded-xl border bg-white text-sm text-zinc-500">
                Chargement des tracés…
              </div>
            ) : (
              <div data-testid="compare-chart">
                <CompareCharts activities={traces} metric={metric} smoothWindow={smoothWindow} normalizeByDistance={normalize} connectGroup="compare" />
              </div>
            )}
          </div>

          {/* Secondary mini charts for other metrics (all in same group so crosshair syncs) */}
          {traces.length > 0 && !tracesLoading && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["hr", "elevation", "power", "cadence"] as CompareMetric[])
                .filter((m) => m !== metric)
                .slice(0, 2)
                .map((m) => (
                  <div key={m}>
                    <div className="mb-1 text-xs font-medium text-zinc-600">{METRICS.find((x) => x.key === m)?.label}</div>
                    <CompareCharts activities={traces} metric={m} smoothWindow={smoothWindow} normalizeByDistance={normalize} connectGroup="compare" />
                  </div>
                ))}
            </div>
          )}

          {/* Tableau récap */}
          <div className="rounded-xl border bg-white p-4 shadow-sm overflow-x-auto">
            <h3 className="text-sm font-semibold">Tableau récapitulatif</h3>
            <p className="mt-1 text-xs text-zinc-500">Tri par date décroissante • meilleur surligné en vert</p>
            {recapActivities.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-500">Aucune activité à afficher.</div>
            ) : (
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-zinc-500">
                    <th className="py-2 pr-2 font-medium">Activité</th>
                    <th className="py-2 pr-2 font-medium">Date</th>
                    <th className="py-2 pr-2 font-medium">Distance</th>
                    <th className="py-2 pr-2 font-medium">Durée</th>
                    <th className="py-2 pr-2 font-medium">Allure moy</th>
                    <th className="py-2 pr-2 font-medium">FC moy/max</th>
                    <th className="py-2 pr-2 font-medium">Cadence</th>
                    <th className="py-2 pr-2 font-medium">D+</th>
                    <th className="py-2 pr-2 font-medium">Cal / TSS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {[...recapActivities]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((a) => {
                      const isBestPace = bestIds["pace"] === a.id;
                      const isBestDist = bestIds["distance"] === a.id;
                      return (
                        <tr key={a.id} className="hover:bg-zinc-50">
                          <td className="py-2 pr-2 font-medium text-zinc-900">{a.name ?? a.id.slice(0, 8)}</td>
                          <td className="py-2 pr-2 text-zinc-600">{formatDate(a.date)}</td>
                          <td className={`py-2 pr-2 ${isBestDist ? "bg-emerald-50 font-semibold text-emerald-700" : "text-zinc-700"}`}>{formatDistance(a.distance)}</td>
                          <td className="py-2 pr-2 text-zinc-700">{formatDuration(a.duration)}</td>
                          <td className={`py-2 pr-2 ${isBestPace ? "bg-emerald-50 font-semibold text-emerald-700" : "text-zinc-700"}`}>{formatPace(a.avgPace)}</td>
                          <td className="py-2 pr-2 text-zinc-700">
                            {a.avgHR != null ? `${a.avgHR} bpm` : "—"} {a.maxHR != null ? `/ ${a.maxHR}` : ""}
                          </td>
                          <td className="py-2 pr-2 text-zinc-700">{a.avgCadence != null ? `${Math.round(a.avgCadence as number)} spm` : "—"}</td>
                          <td className="py-2 pr-2 text-zinc-700">{a.elevationGain != null ? `${Math.round(a.elevationGain as number)} m` : "—"}</td>
                          <td className="py-2 pr-2 text-zinc-700">
                            {a.calories != null ? `${a.calories}` : "—"} {a.tss != null ? `/ ${Math.round(a.tss as number)}` : ""}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
