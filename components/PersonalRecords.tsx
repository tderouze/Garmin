"use client";

import type { PersonalRecord } from "@/lib/personalRecords";
import { formatDuration, formatPace } from "@/lib/personalRecords";

function formatDateFr(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d as string);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric" });
}

function paceForRecord(r: PersonalRecord): string {
  const distM = r.canonical;
  const pace = r.bestTime / (distM / 1000);
  return formatPace(pace);
}

interface Props {
  records: PersonalRecord[];
  /** optional loading placeholder */
  loading?: boolean;
}

export function PersonalRecords({ records, loading }: Props) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border bg-white p-5 shadow-sm">
            <div className="h-4 w-16 rounded bg-zinc-200" />
            <div className="mt-3 h-6 w-24 rounded bg-zinc-200" />
            <div className="mt-2 h-3 w-20 rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white p-8 text-center">
        <div className="text-sm font-medium text-zinc-900">Aucun record personnel</div>
        <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
          Les PBs apparaissent dès que tu as une course détectée (type <code>race</code> ou distance à ±2&nbsp;% de 5K / 10K / Semi / Marathon).
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {records.map((r) => (
        <div key={r.canonical} className="rounded-xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="inline-flex rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-bold tracking-wide text-white">
              {r.distance}
            </span>
            <span className="text-xs text-zinc-500">{r.label}</span>
          </div>

          <div className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">{formatDuration(r.bestTime)}</div>

          <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-600">
            <span>{paceForRecord(r)}</span>
            <span aria-hidden>·</span>
            <span>{r.canonical / 1000} km</span>
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="text-xs font-medium text-zinc-700 truncate" title={(r.activity.name as string) ?? r.activityId}>
              {(r.activity.name as string) ?? `Activité ${r.activityId.slice(0, 8)}`}
            </div>
            <div className="mt-1 text-xs text-zinc-500">{formatDateFr(r.date)}</div>
            <a
              href={`/api/activities/${r.activityId}`}
              className="mt-2 inline-flex text-xs font-medium text-zinc-900 underline hover:text-zinc-700"
            >
              Voir l’activité →
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

// Also export a compact version for use in page header
export function PersonalRecordsCompact({ records }: { records: PersonalRecord[] }) {
  if (!records.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {records.map((r) => (
        <span
          key={r.canonical}
          className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-xs shadow-sm"
        >
          <span className="font-bold">{r.distance}</span>
          <span className="text-zinc-600">{formatDuration(r.bestTime)}</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{paceForRecord(r)}</span>
        </span>
      ))}
    </div>
  );
}
