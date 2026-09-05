"use client";

export interface ActivityListItem {
  id: string;
  garminId?: string | null;
  type: string;
  name?: string | null;
  date: string | Date;
  distance: number;
  duration: number;
  avgPace?: number | null;
  avgHR?: number | null;
  elevationGain?: number | null;
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function formatDuration(s: number): string {
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
  return date.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityList({
  activities,
  selected,
  onToggle,
}: {
  activities: ActivityListItem[];
  selected?: string[];
  onToggle?: (id: string) => void;
}) {
  if (!activities || activities.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center text-sm text-zinc-500">
        Aucune activité pour ces filtres.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border bg-white shadow-sm">
      {activities.map((a) => (
        <li key={a.id} className="flex items-center gap-4 p-4 hover:bg-zinc-50">
          {onToggle && (
            <input
              type="checkbox"
              checked={selected?.includes(a.id) ?? false}
              onChange={() => onToggle(a.id)}
              className="h-4 w-4 rounded border-zinc-300"
              aria-label={`Sélectionner ${a.name ?? a.id}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex rounded bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
                {a.type}
              </span>
              <span className="truncate text-sm font-semibold text-zinc-900">
                {a.name ?? `Activité ${a.garminId ?? a.id.slice(0, 8)}`}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-600">
              <span>{formatDate(a.date)}</span>
              <span>{formatDistance(a.distance)}</span>
              <span>{formatDuration(a.duration)}</span>
              {a.elevationGain != null && <span>D+ {Math.round(a.elevationGain)} m</span>}
            </div>
          </div>
          <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
            <span className="text-sm font-medium text-zinc-900">{formatPace(a.avgPace)}</span>
            {a.avgHR != null && <span className="text-xs text-zinc-500">{a.avgHR} bpm</span>}
          </div>
          <a
            href={`/api/activities/${a.id}`}
            className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Détail
          </a>
        </li>
      ))}
    </ul>
  );
}
