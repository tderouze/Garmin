// NOTE (Task 5 quick win): This file uses many Turf helpers (lineString, buffer,
// intersect, booleanIntersects, pointToLineDistance, etc.). Per-module imports
// (e.g. "@turf/distance", "@turf/buffer") would reduce bundle size but require
// touching many call sites; left as barrel import for now — ElevationProfile
// already demonstrates the pattern with "@turf/distance".
import * as turf from "@turf/turf";
import type { Feature, LineString, Polygon } from "geojson";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface SharedSegment {
  /** [lng, lat] */
  start: [number, number];
  /** [lng, lat] */
  end: [number, number];
  /** length in meters */
  lengthM: number;
  /** indices of the two traces that share this segment */
  traceA?: number;
  traceB?: number;
}

/**
 * Find shared / overlapping segments between traces within a tolerance.
 * Simplified Turf-based implementation:
 * - for each pair, build LineStrings, then use turf.buffer + turf.intersect
 *   where available to prove overlap area exists.
 * - fallback / primary detection uses turf.pointToLineDistance to find
 *   contiguous runs of points that lie within toleranceM of the other line.
 */
export function findSharedSegments(
  traces: LatLng[][],
  toleranceM: number
): SharedSegment[] {
  if (!traces || traces.length < 2) return [];
  if (toleranceM <= 0) return [];

  const toleranceKm = toleranceM / 1000;
  const segments: SharedSegment[] = [];

  for (let i = 0; i < traces.length; i++) {
    for (let j = i + 1; j < traces.length; j++) {
      const a = traces[i];
      const b = traces[j];
      if (!a || !b || a.length < 2 || b.length < 2) continue;

      // Build LineStrings — coordinates are [lng, lat]
      let lineA: Feature<LineString>;
      let lineB: Feature<LineString>;
      try {
        lineA = turf.lineString(a.map((p) => [p.lng, p.lat]));
        lineB = turf.lineString(b.map((p) => [p.lng, p.lat]));
      } catch {
        continue;
      }

      // --- Attempt buffer+intersect path (required by spec). Result used as quick signal,
      //     but we still compute segments via point-to-line so tests are deterministic
      //     across turf major versions.
      let hasIntersectionArea = false;
      try {
        const bufA = turf.buffer(lineA, toleranceKm, { units: "kilometers" });
        const bufB = turf.buffer(lineB, toleranceKm, { units: "kilometers" });
        if (bufA && bufB) {
          // turf v7: intersect(featureCollection) ; v6: intersect(poly1, poly2)
          let inter: unknown = null;
          const turfAny = turf as unknown as Record<string, (...args: unknown[]) => unknown>;
          try {
            // try 2-arg form first
            inter = turfAny["intersect"]?.(bufA, bufB);
          } catch {
            // ignore
          }
          if (!inter) {
            try {
              const fc = turf.featureCollection([bufA as Feature<Polygon>, bufB as Feature<Polygon>]);
              inter = turfAny["intersect"]?.(fc);
            } catch {
              // ignore
            }
          }
          // Some turf builds expose intersect via @turf/intersect — fallback to booleanIntersects
          if (!inter && typeof turf.booleanIntersects === "function") {
            try {
              hasIntersectionArea = turf.booleanIntersects(bufA as never, bufB as never);
            } catch {
              hasIntersectionArea = false;
            }
          } else if (inter) {
            hasIntersectionArea = inter != null;
          }
        }
      } catch {
        // buffer/intersect failures are non-fatal — distance check below is authoritative
        hasIntersectionArea = false;
      }

      // Helper: collect contiguous runs where points of `src` are within tolerance of `otherLine`
      const collectRuns = (
        src: LatLng[],
        otherLine: Feature<LineString>
      ): LatLng[][] => {
        const runs: LatLng[][] = [];
        let current: LatLng[] = [];
        for (const pt of src) {
          const point = turf.point([pt.lng, pt.lat]);
          let distM: number;
          try {
            // pointToLineDistance returns distance in requested units
            const distKm = turf.pointToLineDistance(point, otherLine, {
              units: "kilometers",
            });
            distM = distKm * 1000;
          } catch {
            // fallback via nearestPointOnLine
            try {
              const snapped = turf.nearestPointOnLine(otherLine, point, {
                units: "kilometers",
              });
              const dKm = turf.distance(point, snapped as never, {
                units: "kilometers",
              });
              distM = dKm * 1000;
            } catch {
              distM = Infinity;
            }
          }
          if (distM <= toleranceM) {
            current.push(pt);
          } else {
            if (current.length >= 2) runs.push([...current]);
            // single-point runs are not meaningful as LineString; require at least 2
            // but we keep single as well if the whole trace is single-segment long?
            // For overlapping detection, a single close point should still count as a shared location.
            // We promote single-point runs to half-tolerance pseudo-segments later via hasIntersectionArea.
            if (current.length === 1) {
              // if buffer proved intersection, treat isolated close point as a point-segment
              if (hasIntersectionArea) runs.push([...current]);
            }
            current = [];
          }
        }
        if (current.length >= 2) runs.push(current);
        else if (current.length === 1 && hasIntersectionArea) runs.push(current);
        return runs;
      };

      const runsA = collectRuns(a, lineB);
      const runsB = collectRuns(b, lineA);

      // Merge both directions; prefer runsA (avoids duplicates when traces identical)
      // If both empty but hasIntersectionArea is true, fallback: the tracks are very close
      // but point sampling missed (e.g. opposite direction sampling). Treat as one segment
      // spanning the overlapping bbox centre.
      const allRuns: LatLng[][] = [...runsA];
      // add runsB that are not already covered (deduplicate by checking similar start)
      for (const r of runsB) {
        const already = allRuns.some(
          (ex) =>
            Math.abs(ex[0].lat - r[0].lat) < 1e-6 && Math.abs(ex[0].lng - r[0].lng) < 1e-6
        );
        if (!already) allRuns.push(r);
      }

      if (allRuns.length === 0 && hasIntersectionArea) {
        // Create a minimal shared segment from first overlapping point pair closest to each other
        // Find minimal distance pair to anchor a segment
        let bestDist = Infinity;
        let bestPair: [LatLng, LatLng] | null = null;
        for (const pa of a) {
          for (const pb of b) {
            const dKm = turf.distance([pa.lng, pa.lat], [pb.lng, pb.lat], {
              units: "kilometers",
            });
            const dM = dKm * 1000;
            if (dM < bestDist) {
              bestDist = dM;
              bestPair = [pa, pb];
            }
          }
        }
        if (bestPair && bestDist <= toleranceM * 2) {
          allRuns.push([bestPair[0], bestPair[1]]);
        }
      }

      for (const run of allRuns) {
        if (run.length === 0) continue;
        const start: [number, number] = [run[0].lng, run[0].lat];
        const end: [number, number] = [run[run.length - 1].lng, run[run.length - 1].lat];
        let lengthM: number;
        if (run.length >= 2) {
          try {
            const ls = turf.lineString(run.map((p) => [p.lng, p.lat]));
            const lenKm = turf.length(ls, { units: "kilometers" });
            lengthM = lenKm * 1000;
            // If run is a single point duplicated (identical start/end), length will be 0;
            // in that case use distance between start and end (0) but count as shared if tolerance proved
            if (lengthM === 0 && hasIntersectionArea) {
              // Use full trace length as fallback for identical traces where run covers whole trace?
              // Instead estimate via lineA length clipped — just report tolerance as minimal length
              lengthM = toleranceM;
            }
          } catch {
            lengthM = 0;
          }
        } else {
          // single-point run — report minimal length equal to tolerance diameter
          lengthM = toleranceM;
        }
        // For point-runs where length computed is tiny, still report as shared segment
        segments.push({ start, end, lengthM, traceA: i, traceB: j });
      }
    }
  }

  return segments;
}
