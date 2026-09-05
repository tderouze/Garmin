"use client";

import { useEffect, useState, useCallback } from "react";
import { ActivityList, ActivityListItem } from "@/components/ActivityList";
import { ActivityFilters, FilterValues } from "@/components/ActivityFilters";

export default function DashboardPage() {
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterValues>({});

  const fetchActivities = useCallback(async (f: FilterValues) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (f.type) params.set("type", f.type);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      if (f.limit != null) params.set("limit", String(f.limit));
      const qs = params.toString();
      const res = await fetch(`/api/activities${qs ? `?${qs}` : ""}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Fetch failed: ${res.status}`);
      }
      const data = await res.json();
      setActivities(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities(filters);
  }, [fetchActivities, filters]);

  function handleFilterChange(f: FilterValues) {
    setFilters(f);
  }

  const totalDistance = activities.reduce((sum, a) => sum + (a.distance ?? 0), 0);
  const totalDuration = activities.reduce((sum, a) => sum + (a.duration ?? 0), 0);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Garmin Analysis</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Importe ton historique Garmin, superpose tes traces et compare tes performances.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-zinc-500">Activités</div>
          <div className="mt-1 text-2xl font-bold">{loading ? "—" : activities.length}</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-zinc-500">Distance totale</div>
          <div className="mt-1 text-2xl font-bold">
            {loading ? "—" : `${(totalDistance / 1000).toFixed(1)} km`}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-zinc-500">Durée totale</div>
          <div className="mt-1 text-2xl font-bold">
            {loading ? "—" : `${Math.floor(totalDuration / 3600)}h ${Math.floor((totalDuration % 3600) / 60)}m`}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <ActivityFilters onChange={handleFilterChange} initial={filters} />
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Erreur chargement : {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-zinc-500">
          Chargement…
        </div>
      ) : (
        <ActivityList activities={activities} />
      )}

      <nav className="mt-8 flex flex-wrap gap-3 text-sm">
        <a href="/map" className="rounded-md border bg-white px-4 py-2 font-medium hover:bg-zinc-50">
          Carte &amp; superposition
        </a>
        <a href="/compare" className="rounded-md border bg-white px-4 py-2 font-medium hover:bg-zinc-50">
          Comparer les perfs
        </a>
        <a href="/races" className="rounded-md border bg-white px-4 py-2 font-medium hover:bg-zinc-50">
          Courses &amp; PBs
        </a>
        <a href="/import" className="rounded-md border bg-white px-4 py-2 font-medium hover:bg-zinc-50">
          Importer FIT/GPX
        </a>
      </nav>
    </main>
  );
}
