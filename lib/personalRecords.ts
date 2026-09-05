/**
 * Detection courses & Personal Records
 * - detectRaces: type == "race" OR distance within 2% of canonical
 * - computePBs: grouping by canonical distance, keeping min duration
 */

export const CANONICAL_DISTANCES = [5000, 10000, 21097, 42195] as const;
export type CanonicalDistance = (typeof CANONICAL_DISTANCES)[number];

export const CANONICAL_LABELS: Record<number, string> = {
  5000: "5K",
  10000: "10K",
  21097: "Semi",
  42195: "Marathon",
};

export const CANONICAL_LABELS_LONG: Record<number, string> = {
  5000: "5 km",
  10000: "10 km",
  21097: "Semi-marathon",
  42195: "Marathon",
};

export interface RaceActivity {
  id: string;
  type: string;
  distance: number;
  duration: number;
  date: Date | string;
  name?: string | null;
  avgPace?: number | null;
  avgHR?: number | null;
  laps?: Array<{ idx: number; distance: number; duration: number; avgPace?: number | null; avgHR?: number | null }>;
  trackPoints?: Array<{ lat: number; lng: number; ele?: number | null; time: Date | string; hr?: number | null; speed?: number | null }>;
  // allow extra fields
  [key: string]: unknown;
}

export interface PersonalRecord {
  distance: string; // "5K" | "10K" | "Semi" | "Marathon"
  canonical: CanonicalDistance;
  label: string; // long label
  bestTime: number; // seconds
  activityId: string;
  date: Date;
  activity: RaceActivity;
}

/**
 * Return nearest canonical distance within 2% tolerance, else null.
 * If multiple match (should be at most one due to spacing), pick smallest relative diff.
 */
export function getCanonicalDistance(distance: number): CanonicalDistance | null {
  if (typeof distance !== "number" || !isFinite(distance) || distance <= 0) return null;
  let best: CanonicalDistance | null = null;
  let bestDiff = Infinity;
  for (const d of CANONICAL_DISTANCES) {
    const diff = Math.abs(distance - d) / d;
    if (diff <= 0.02) {
      if (diff < bestDiff) {
        bestDiff = diff;
        best = d as CanonicalDistance;
      }
    }
  }
  return best;
}

/**
 * Detect race activities:
 * - type === "race" (case-insensitive) -> always a race
 * - OR distance within 2% of a canonical distance
 */
export function detectRaces<T extends { type: string; distance: number }>(activities: T[]): T[] {
  if (!activities || !Array.isArray(activities)) return [];
  return activities.filter((a) => {
    if (!a || typeof a.distance !== "number" || !isFinite(a.distance)) return false;
    const t = typeof a.type === "string" ? a.type.toLowerCase() : "";
    if (t === "race") return true;
    return getCanonicalDistance(a.distance) !== null;
  });
}

/**
 * Compute PBs: group races by canonical distance, keep minimal duration.
 * Activities that are race-type but not near a canonical are ignored for PBs
 * (no canonical to group on).
 */
export function computePBs<T extends RaceActivity>(activities: T[]): PersonalRecord[] {
  if (!activities || !Array.isArray(activities) || activities.length === 0) return [];
  const races = detectRaces(activities as unknown as { type: string; distance: number }[]) as unknown as T[];
  const byCanonical = new Map<CanonicalDistance, T>();

  for (const act of races) {
    const canonical = getCanonicalDistance(act.distance);
    if (canonical == null) continue; // race-type arbitrary distances contribute no PB
    if (typeof act.duration !== "number" || !isFinite(act.duration) || act.duration <= 0) continue;
    const existing = byCanonical.get(canonical);
    if (!existing || act.duration < (existing.duration as number)) {
      byCanonical.set(canonical, act);
    } else if (act.duration === (existing.duration as number)) {
      // tie-breaker: earlier date wins
      const dNew = act.date instanceof Date ? act.date : new Date(act.date as string);
      const dOld = existing.date instanceof Date ? existing.date : new Date(existing.date as string);
      if (!isNaN(dNew.getTime()) && !isNaN(dOld.getTime()) && dNew < dOld) {
        byCanonical.set(canonical, act);
      }
    }
  }

  const result: PersonalRecord[] = [];
  for (const [canonical, act] of byCanonical.entries()) {
    const labelShort = CANONICAL_LABELS[canonical] ?? String(canonical);
    const labelLong = CANONICAL_LABELS_LONG[canonical] ?? String(canonical);
    const rawDate = act.date;
    const date = rawDate instanceof Date ? rawDate : new Date(rawDate as string);
    result.push({
      distance: labelShort,
      canonical,
      label: labelLong,
      bestTime: act.duration,
      activityId: act.id,
      date: isNaN(date.getTime()) ? new Date() : date,
      activity: act,
    });
  }

  // sort by canonical ascending (5K -> Marathon)
  result.sort((a, b) => a.canonical - b.canonical);
  return result;
}

// helpers for display
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return "—";
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, "0")} /km`;
}

export function formatDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d as string);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric" });
}
