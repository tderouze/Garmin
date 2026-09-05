"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { PersonalRecords } from "@/components/PersonalRecords";
import {
  detectRaces,
  computePBs,
  getCanonicalDistance,
  CANONICAL_LABELS,
  formatDuration,
  formatPace,
  type PersonalRecord,
} from "@/lib/personalRecords";

interface ActivitySummary {
  id: string;
  type: string;
  name?: string | null;
  date: string;
  distance: number;
  duration: number;
  avgPace?: number | null;
  avgHR?: number | null;
  elevationGain?: number | null;
}

interface ActivityDetail extends ActivitySummary {
  laps?: Array<{ idx: number; distance: number; duration: number; avgPace?: number | null; avgHR?: number | null }>;
  trackPoints?: Array<{ lat: number; lng: number; ele?: number | null; time: string; hr?: number | null; speed?: number | null }>;
}

function formatDate(d: string | Date): string {
  const date = new Date(d as string | Date);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(d: string | Date): string {
  const date = new Date(d as string | Date);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function deltaLabel(deltaSec: number): { text: string; color: string } {
  const sign = deltaSec > 0 ? "+" : deltaSec < 0 ? "−" : "±";
  const abs = Math.abs(deltaSec);
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  const txt = `${sign}${m}:${String(s).padStart(2, "0")}`;
  if (deltaSec === 0) return { text: txt, color: "text-emerald-600 bg-emerald-50 border-emerald-200" };
  if (deltaSec > 0) return { text: txt, color: "text-amber-700 bg-amber-50 border-amber-200" };
  return { text: txt, color: "text-emerald-700 bg-emerald-50 border-emerald-200" };
}

// Tiny sparkline component for pace progression per distance
function Sparkline({ values, color = "#2563eb" }: { values: number[]; color?: string }) {
  const option = useMemo<EChartsOption>(() => {
    if (!values.length) return {} as EChartsOption;
    return {
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: "category", show: false, data: values.map((_, i) => String(i)) },
      yAxis: { type: "value", show: false, scale: true },
      series: [
        {
          type: "line",
          data: values,
          smooth: true,
          showSymbol: false,
          lineStyle: { color, width: 1.6 },
          areaStyle: { color, opacity: 0.08 },
        } as any,
      ],
      tooltip: { show: false },
      animation: false,
    } as EChartsOption;
  }, [values, color]);

  if (!values.length) return <span className="text-xs text-zinc-400">—</span>;
  return <ReactECharts option={option} style={{ height: 28, width: 80 }} opts={{ renderer: "canvas" }} />;
}

export default function RacesPage() {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pbs, setPbs] = useState<PersonalRecord[]>([]);
  const [pbsLoading, setPbsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, ActivityDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<Record<string, string>>({});

  // Fetch activities and PBs in parallel
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setPbsLoading(true);
      setError(null);
      try {
        const [actRes, pbRes] = await Promise.all([
          fetch("/api/activities?limit=100"),
          fetch("/api/personal-records"),
        ]);

        if (!actRes.ok) {
          const body = await actRes.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `Activities HTTP ${actRes.status}`);
        }
        const actData = (await actRes.json()) as ActivitySummary[];
        const list = Array.isArray(actData) ? actData : [];
        if (!cancelled) setActivities(list);

        // PBs: try API, fallback to local compute if API empty/fails but activities exist
        let pbList: PersonalRecord[] = [];
        if (pbRes.ok) {
          const raw = (await pbRes.json()) as Array<Omit<PersonalRecord, "date"> & { date: string }>;
          if (Array.isArray(raw) && raw.length > 0) {
            pbList = raw.map((r) => ({ ...r, date: new Date(r.date) })) as PersonalRecord[];
          }
        }
        // Fallback local compute if API returned empty but we have activities (e.g. DB not reachable locally)
        if (pbList.length === 0 && list.length > 0) {
          const local = computePBs(
            list.map((a) => ({
              ...a,
              date: new Date(a.date),
            })) as unknown as Parameters<typeof computePBs>[0],
          );
          if (local.length > 0) pbList = local;
        }

        if (!cancelled) setPbs(pbList);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPbsLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const races = useMemo(() => {
    const detected = detectRaces(activities as unknown as { type: string; distance: number }[]) as unknown as ActivitySummary[];
    // sort chrono inverse (most recent first)
    return [...detected].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activities]);

  const pbByCanonical = useMemo(() => {
    const m = new Map<number, PersonalRecord>();
    for (const pb of pbs) m.set(pb.canonical, pb);
    return m;
  }, [pbs]);

  const pbActivityIds = useMemo(() => new Set(pbs.map((p) => p.activityId)), [pbs]);

  // Pre-compute sparkline values per canonical: list of durations sorted by date asc for that distance
  const sparklineByCanonical = useMemo(() => {
    const map = new Map<number, number[]>();
    const grouped = new Map<number, ActivitySummary[]>();
    for (const r of races) {
      const c = getCanonicalDistance(r.distance);
      if (c == null) continue;
      if (!grouped.has(c)) grouped.set(c, []);
      grouped.get(c)!.push(r);
    }
    for (const [c, arr] of grouped.entries()) {
      const sorted = [...arr].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      map.set(c, sorted.map((a) => a.duration));
    }
    return map;
  }, [races]);

  const handleToggleDetail = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (detailCache[id]) return;
      setDetailLoading(id);
      setDetailError((prev) => ({ ...prev, [id]: "" }));
      try {
        const res = await fetch(`/api/activities/${id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ActivityDetail;
        setDetailCache((prev) => ({ ...prev, [id]: data }));
      } catch (e: unknown) {
        setDetailError((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }));
      } finally {
        setDetailLoading(null);
      }
    },
    [expandedId, detailCache],
  );

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Courses & records personnels</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Détection automatique : <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">type == race</code> ou distance à ±2&nbsp;% de 5K (5 000 m) · 10K (10 000 m) · Semi (21 097 m) · Marathon (42 195 m).
        </p>
      </header>

      {/* PB Cards */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Records personnels</h2>
          <span className="text-xs text-zinc-500">{pbs.length} distance(s) avec PB</span>
        </div>
        <PersonalRecords records={pbs} loading={pbsLoading} />
        {/* Sparklines per PB distance below cards */}
        {pbs.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {pbs.map((pb) => {
              const vals = sparklineByCanonical.get(pb.canonical) ?? [];
              const isSingle = vals.length <= 1;
              return (
                <div key={`spark-${pb.canonical}`} className="rounded-lg border bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{pb.distance}</span>
                    <span className="text-xs text-zinc-500">{vals.length} course(s)</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Sparkline values={vals} color={isSingle ? "#a1a1aa" : "#2563eb"} />
                    <span className="text-xs text-zinc-500">tendance temps</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Race list */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Liste des courses</h2>
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">{races.length} course(s) détectée(s)</span>
        </div>

        {loading ? (
          <div className="rounded-xl border bg-white p-8 text-center text-sm text-zinc-500">Chargement…</div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : races.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center">
            <div className="text-sm font-medium text-zinc-900">Aucune course détectée</div>
            <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
              Importe des activités ou ajuste le type à <code>race</code>. Les distances proches de 5K/10K/Semi/Marathon (±2 %) sont aussi considérées comme courses.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border bg-white shadow-sm overflow-hidden">
            {races.map((r) => {
              const canonical = getCanonicalDistance(r.distance);
              const label = canonical != null ? (CANONICAL_LABELS[canonical] ?? `${(r.distance / 1000).toFixed(1)}km`) : `${(r.distance / 1000).toFixed(1)} km`;
              const isPB = pbActivityIds.has(r.id);
              const pbForDist = canonical != null ? pbByCanonical.get(canonical) : undefined;
              const deltaSec = pbForDist && !isPB ? r.duration - pbForDist.bestTime : null;
              const delta = deltaSec != null ? deltaLabel(deltaSec) : null;
              const pace = r.distance > 0 ? r.duration / (r.distance / 1000) : null;
              const sparkVals = canonical != null ? (sparklineByCanonical.get(canonical) ?? []) : [];

              const expanded = expandedId === r.id;
              const detail = detailCache[r.id];
              const isDetailLoading = detailLoading === r.id;

              return (
                <li key={r.id} className="p-4 hover:bg-zinc-50">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">{label}</span>
                        {isPB && (
                          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">PB</span>
                        )}
                        {delta && (
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${delta.color}`}>Δ {delta.text} vs PB</span>
                        )}
                        <span className="text-sm font-semibold text-zinc-900 truncate">{r.name ?? `Course ${r.id.slice(0, 8)}`}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-600">
                        <span>{formatDateTime(r.date)}</span>
                        <span>{(r.distance / 1000).toFixed(2)} km</span>
                        <span>{formatDuration(r.duration)}</span>
                        {pace != null && <span>{formatPace(pace)}</span>}
                        {r.elevationGain != null && <span>D+ {Math.round(r.elevationGain as number)} m</span>}
                        {r.avgHR != null && <span>{r.avgHR} bpm</span>}
                      </div>
                      {/* sparkline inline for this distance trend */}
                      {sparkVals.length > 1 && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Progression {label}:</span>
                          <Sparkline values={sparkVals} />
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        href={`/api/activities/${r.id}`}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-white"
                      >
                        JSON
                      </a>
                      <button
                        type="button"
                        onClick={() => handleToggleDetail(r.id)}
                        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                        aria-expanded={expanded}
                      >
                        {expanded ? "Masquer" : "Détail splits"}
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-4 rounded-lg border bg-white p-3">
                      {isDetailLoading ? (
                        <div className="py-4 text-center text-sm text-zinc-500">Chargement des splits…</div>
                      ) : detailError[r.id] ? (
                        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{detailError[r.id]}</div>
                      ) : detail ? (
                        <>
                          {detail.laps && detail.laps.length > 0 ? (
                            <>
                              <div className="mb-2 text-xs font-semibold text-zinc-700">Splits au km ({detail.laps.length})</div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b text-left text-zinc-500">
                                      <th className="py-1 pr-2 font-medium">#</th>
                                      <th className="py-1 pr-2 font-medium">Distance</th>
                                      <th className="py-1 pr-2 font-medium">Durée</th>
                                      <th className="py-1 pr-2 font-medium">Allure</th>
                                      <th className="py-1 pr-2 font-medium">FC</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-100">
                                    {detail.laps.map((lap) => (
                                      <tr key={lap.idx} className="hover:bg-zinc-50">
                                        <td className="py-1 pr-2 font-medium">{lap.idx + 1}</td>
                                        <td className="py-1 pr-2">{(lap.distance / 1000).toFixed(2)} km</td>
                                        <td className="py-1 pr-2">{formatDuration(lap.duration)}</td>
                                        <td className="py-1 pr-2">{lap.avgPace != null ? formatPace(lap.avgPace) : "—"}</td>
                                        <td className="py-1 pr-2">{lap.avgHR != null ? `${lap.avgHR} bpm` : "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {/* pace per split sparkline */}
                              {detail.laps.length > 1 && (
                                <div className="mt-3">
                                  <div className="text-xs font-medium text-zinc-600">Allure par split</div>
                                  <ReactECharts
                                    option={
                                      {
                                        grid: { left: 40, right: 12, top: 8, bottom: 20 },
                                        xAxis: { type: "category", data: detail.laps.map((_, i) => `${i + 1}`), name: "km", axisLabel: { fontSize: 10 } },
                                        yAxis: {
                                          type: "value",
                                          inverse: true,
                                          name: "sec/km",
                                          axisLabel: { fontSize: 10, formatter: (v: number) => formatPace(v) },
                                          scale: true,
                                        },
                                        series: [
                                          {
                                            type: "line",
                                            data: detail.laps.map((l) => l.avgPace ?? (l.distance > 0 ? l.duration / (l.distance / 1000) : null)),
                                            smooth: true,
                                            showSymbol: true,
                                            lineStyle: { color: "#2563eb", width: 2 },
                                            areaStyle: { color: "#2563eb", opacity: 0.08 },
                                          } as any,
                                        ],
                                        tooltip: { trigger: "axis", formatter: (p: unknown) => {
                                          const arr = p as Array<{ data: number; axisValue: string }>;
                                          const v = arr?.[0]?.data;
                                          return `Km ${arr?.[0]?.axisValue}<br/>${v != null ? formatPace(v as number) : "—"}`;
                                        }},
                                        animation: false,
                                      } as EChartsOption
                                    }
                                    style={{ height: 160, width: "100%" }}
                                  />
                                  {/* Comparison vs PB if not PB itself */}
                                  {pbForDist && !isPB && (
                                    <div className="mt-2 text-xs text-zinc-600">
                                      Comparaison vs PB {pbForDist.distance} ({formatDuration(pbForDist.bestTime)}) :{" "}
                                      <span className={deltaSec != null && deltaSec > 0 ? "text-amber-700 font-medium" : "text-emerald-700 font-medium"}>
                                        {delta?.text}
                                      </span>{" "}
                                      — allure PB : {formatPace(pbForDist.bestTime / (pbForDist.canonical / 1000))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="py-4 text-center text-xs text-zinc-500">Pas de splits enregistrés pour cette activité. Allure moyenne : {pace != null ? formatPace(pace) : "—"}</div>
                          )}
                        </>
                      ) : (
                        <div className="py-4 text-center text-xs text-zinc-500">Aucun détail disponible. Réessaie ou vérifie l’API.</div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav className="mt-8 flex gap-3 text-sm">
        <a href="/" className="text-zinc-600 underline hover:text-zinc-900">← Dashboard</a>
        <a href="/compare" className="text-zinc-600 underline hover:text-zinc-900">Comparer</a>
        <a href="/map" className="text-zinc-600 underline hover:text-zinc-900">Carte</a>
      </nav>
    </main>
  );
}
