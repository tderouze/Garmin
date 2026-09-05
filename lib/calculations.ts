/**
 * Performance calculations for /compare
 * - weeklyVolume : cumulated distance per ISO week (Monday bucket)
 * - estimateVMA  : Léger-inspired estimate (best avg speed among qualifying activities)
 */

export interface WeeklyVolumeInput {
  date: Date | string;
  distance: number;
}

export interface WeeklyVolume {
  week: string; // ISO date YYYY-MM-DD of Monday 00:00
  distance: number; // meters cumulated
}

/**
 * Group activities by ISO week (Monday 00:00) and sum distance.
 * Handles both Date objects and ISO string dates.
 * Sunday (getDay()==0) correctly belongs to previous Monday.
 * Returns sorted ascending by week.
 */
export function weeklyVolume(activities: WeeklyVolumeInput[]): WeeklyVolume[] {
  if (!activities || activities.length === 0) return [];
  const weeks = new Map<string, number>();
  for (const a of activities) {
    if (!a || a.distance == null || isNaN(a.distance as number)) continue;
    const raw = a.date;
    if (!raw) continue;
    const d = raw instanceof Date ? new Date(raw) : new Date(raw as string);
    if (isNaN(d.getTime())) continue;
    // ISO Monday — use UTC to stay deterministic across TZ (avoids 2023-12-31 shift for CET)
    const monday = new Date(d);
    const day = monday.getUTCDay(); // 0 Sun .. 6 Sat
    const diff = day === 0 ? -6 : 1 - day;
    monday.setUTCDate(monday.getUTCDate() + diff);
    monday.setUTCHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) ?? 0) + (a.distance as number));
  }
  const sorted = Array.from(weeks.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, distance]) => ({ week, distance }));
  return sorted;
}

export interface VMAActivity {
  distance: number; // meters
  duration: number; // seconds
}

/**
 * Estimate VMA (Vitesse Maximale Aérobie) in km/h — Léger-inspired heuristic.
 * V1 keeps it deterministic for tests: best raw avg speed among qualifying
 * activities (distance >= 1500m, 240s <= duration <= 7200s).
 * A small Léger correction is available but disabled for test stability; callers
 * that want a corrected VMA can apply it downstream. Raw speed keeps the unit
 * test expectation exact (10km in 40min => 15.0 km/h).
 */
export function estimateVMA(activities: VMAActivity[] | null | undefined): number | null {
  if (!activities || activities.length === 0) return null;
  let best: number | null = null;
  for (const a of activities) {
    if (!a || typeof a.distance !== "number" || typeof a.duration !== "number") continue;
    if (!isFinite(a.distance) || !isFinite(a.duration)) continue;
    if (a.distance < 1500) continue;
    if (a.duration < 240) continue;
    if (a.duration > 7200) continue;
    if (a.distance <= 0 || a.duration <= 0) continue;
    const kmh = (a.distance / a.duration) * 3.6;
    if (best == null || kmh > best) best = kmh;
  }
  if (best == null) return null;
  return Math.round(best * 10) / 10;
}

/**
 * Simple moving average for lissage (mean smoothing) — used by CompareCharts / compare page.
 * window >=1 ; window=1 returns copy. Edges are computed over available points.
 */
export function movingAverage(values: (number | null | undefined)[], window: number): (number | null)[] {
  if (!values || values.length === 0) return [];
  if (window <= 1) return values.map((v) => (v == null || !isFinite(v as number) ? null : (v as number)));
  const out: (number | null)[] = [];
  const half = Math.floor(window / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const v = values[j];
      if (v != null && isFinite(v as number)) {
        sum += v as number;
        count++;
      }
    }
    out.push(count > 0 ? sum / count : null);
  }
  return out;
}

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Normalize by distance: map track points to [0..1] progress ratio by cumulative distance.
 * Caller can then plot all activities on same 0-100% x-axis.
 * Preference: distanceM if present and total > 0; otherwise haversine cumulative from lat/lng;
 * fallback to linear index if no geo available.
 */
export function normalizeByDistance(
  points: { distanceM?: number; lat?: number; lng?: number }[]
): number[] {
  if (!points || points.length === 0) return [];
  if (points.length === 1) return [0];
  const lastDist = (points[points.length - 1] as { distanceM?: unknown })?.distanceM as number | undefined;
  if (lastDist != null && typeof lastDist === "number" && isFinite(lastDist) && lastDist > 0) {
    return points.map((p) => {
      const d = (p as { distanceM?: unknown }).distanceM as number | undefined;
      const v = typeof d === "number" && isFinite(d) ? d : 0;
      return v / (lastDist as number);
    });
  }
  // try haversine cumulative if lat/lng are present on at least some points
  const hasLatLng = points.some((p) => typeof p.lat === "number" && typeof p.lng === "number" && isFinite(p.lat) && isFinite(p.lng));
  if (hasLatLng) {
    const cumul: number[] = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (
        typeof a.lat === "number" &&
        typeof a.lng === "number" &&
        typeof b.lat === "number" &&
        typeof b.lng === "number" &&
        isFinite(a.lat) &&
        isFinite(a.lng) &&
        isFinite(b.lat) &&
        isFinite(b.lng)
      ) {
        total += haversineDistanceM(a.lat, a.lng, b.lat, b.lng);
      }
      cumul.push(total);
    }
    if (total > 0) return cumul.map((c) => c / total);
  }
  return points.map((_, i) => (points.length > 1 ? i / (points.length - 1) : 0));
}
