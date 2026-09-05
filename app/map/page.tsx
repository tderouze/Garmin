"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { MapView, type Trace, type TracePoint } from "@/components/MapView";
import { ElevationProfile } from "@/components/ElevationProfile";
import { findSharedSegments } from "@/lib/segments";

const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#65a30d",
  "#7c3aed",
  "#0e7490",
];

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
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function toGpx(traces: Trace[]): string {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Garmin Analysis" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  const body = traces
    .map(
      (t) =>
        `  <trk><name>${escapeXml(t.id)}</name><trkseg>\n` +
        t.points
          .map(
            (p) =>
              `    <trkpt lat="${p.lat}" lon="${p.lng}">${p.ele != null ? `<ele>${p.ele}</ele>` : ""}${p.time ? `<time>${new Date(p.time as string).toISOString()}</time>` : ""}</trkpt>`
          )
          .join("\n") +
        `\n  </trkseg></trk>`
    )
    .join("\n");
  return header + body + "\n</gpx>";
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
}

export default function MapPage() {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [tracesError, setTracesError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.8);
  const [hoverPoint, setHoverPoint] = useState<{ traceId: string; index: number } | null>(null);
  const [tolerance, setTolerance] = useState(15);

  // Fetch list
  useEffect(() => {
    let cancelled = false;
    async function fetchList() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/activities?type=running&limit=50");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ActivitySummary[];
        if (!cancelled) setActivities(Array.isArray(data) ? data : []);
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
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 10) return prev; // max 10
      return [...prev, id];
    });
  }, []);

  // Fetch trace details when selection changes
  useEffect(() => {
    if (selected.length === 0) {
      setTraces([]);
      setTracesError(null);
      return;
    }
    if (selected.length < 2) {
      // still fetch to show single trace on map but warn
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
              trackPoints: Array<{ lat: number; lng: number; ele?: number | null; time: string; hr?: number | null }>;
            };
            const points: TracePoint[] = (act.trackPoints ?? []).map((tp) => ({
              lat: tp.lat,
              lng: tp.lng,
              ele: tp.ele,
              time: tp.time,
              hr: tp.hr,
            }));
            const color = PALETTE[idx % PALETTE.length];
            return { id: act.id, color, points } as Trace;
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

  const shared = useMemo(() => {
    if (traces.length < 2) return [];
    const latLngTraces = traces.map((t) => t.points.map((p) => ({ lat: p.lat, lng: p.lng })));
    try {
      return findSharedSegments(latLngTraces, tolerance);
    } catch {
      return [];
    }
  }, [traces, tolerance]);

  const handleExport = useCallback(() => {
    if (!traces.length) return;
    const gpx = toGpx(traces);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `traces-${new Date().toISOString().slice(0, 10)}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [traces]);

  const handleHover = useCallback((traceId: string, index: number, _pt?: TracePoint) => {
    setHoverPoint({ traceId, index });
  }, []);
  // Stable callback for MapView — avoids inline closure thrashing MapView's [traces,opacity] effect (Task 5 leak fix)
  const mapOnHover = useCallback((traceId: string, index: number, _pt: TracePoint) => {
    setHoverPoint({ traceId, index });
  }, []);

  const selectedSet = new Set(selected);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Carte &amp; superposition</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Sélectionnez 2 à 10 activités de type course pour les superposer. Les segments partagés sont détectés avec une
          tolérance de {tolerance} m.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Left: list + controls */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Activités (course)</h2>
              <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white" data-testid="selection-count">
                {selected.length} / 10
              </span>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-zinc-500">Chargement…</div>
            ) : loadError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-500">Aucune activité de type course.</div>
            ) : (
              <ul className="max-h-[380px] divide-y divide-zinc-100 overflow-auto rounded-lg border">
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
                          <span>{new Date(a.date).toLocaleDateString("fr-FR")}</span>
                          <span>{formatDistance(a.distance)}</span>
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

            {selected.length > 0 && selected.length < 2 && (
              <p className="mt-3 text-xs text-amber-600">Sélectionnez au moins 2 activités pour comparer les traces.</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setSelected([])}
                className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                disabled={selected.length === 0}
              >
                Effacer
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={traces.length === 0}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
              >
                Exporter GPX
              </button>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Contrôles</h3>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-700">
                Opacité traces: {Math.round(opacity * 100)}%
              </span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full"
                aria-label="Opacité des traces"
              />
            </label>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-700">Tolérance segments partagés: {tolerance} m</span>
              <input
                type="range"
                min={5}
                max={50}
                step={5}
                value={tolerance}
                onChange={(e) => setTolerance(parseInt(e.target.value, 10))}
                className="w-full"
                aria-label="Tolérance segments partagés"
              />
            </label>
            {traces.length >= 2 && (
              <div className="mt-3 rounded-md bg-zinc-50 p-2 text-xs text-zinc-600">
                <div className="font-medium text-zinc-700">Segments partagés</div>
                <div>{shared.length === 0 ? "Aucun segment partagé détecté à cette tolérance." : `${shared.length} segment(s) partagé(s) — longueur max ${Math.round(Math.max(...shared.map((s) => s.lengthM)))} m`}</div>
                {shared.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {shared.slice(0, 3).map((s, i) => (
                      <li key={i}>
                        {s.traceA != null && s.traceB != null ? `Traces ${s.traceA + 1}↔${s.traceB + 1}: ` : ""}
                        {Math.round(s.lengthM)} m
                      </li>
                    ))}
                    {shared.length > 3 && <li>… et {shared.length - 3} autre(s)</li>}
                  </ul>
                )}
              </div>
            )}
          </div>

          <a href="/" className="text-sm text-zinc-600 underline hover:text-zinc-900">
            ← Retour dashboard
          </a>
        </div>

        {/* Right: map + elevation */}
        <div className="flex flex-col gap-4">
          {tracesError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{tracesError}</div>
          )}
          {tracesLoading ? (
            <div className="flex h-[500px] w-full items-center justify-center rounded-xl border bg-white text-sm text-zinc-500">
              Chargement des traces…
            </div>
          ) : (
            <MapView traces={traces} opacity={opacity} hoverPoint={hoverPoint} onHover={mapOnHover} />
          )}

          <ElevationProfile traces={traces} hoverPoint={hoverPoint} onHover={handleHover} />

          {traces.length > 0 && (
            <div className="rounded-xl border bg-white p-3 text-xs text-zinc-600">
              <div className="font-medium text-zinc-800">Légende</div>
              <div className="mt-1 flex flex-wrap gap-3">
                {traces.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full border border-white shadow" style={{ backgroundColor: t.color }} aria-hidden />
                    <span className="font-mono text-[11px]">{t.id.slice(0, 8)}</span>
                    <span>— {t.points.length} pts</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
