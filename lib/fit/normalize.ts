export function computeAvgPace(distanceM: number, durationS: number): number | null {
  if (!distanceM || !durationS) return null;
  if (distanceM <= 0 || durationS <= 0) return null;
  return durationS / (distanceM / 1000);
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}

export function splitByKm(
  points: { distance: number; time: number; lat: number; lng: number; ele?: number }[]
): { distance: number; duration: number }[] {
  const laps: { distance: number; duration: number }[] = [];
  let lastDist = 0;
  let lastTime = 0;
  for (const p of points) {
    if (p.distance - lastDist >= 1000) {
      laps.push({ distance: p.distance - lastDist, duration: p.time - lastTime });
      lastDist = p.distance;
      lastTime = p.time;
    }
  }
  return laps;
}
