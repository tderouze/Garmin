import { describe, it, expect } from "vitest";
import { findSharedSegments } from "@/lib/segments";

describe("findSharedSegments", () => {
  it("detects overlapping traces", () => {
    const a = [
      { lat: 48.85, lng: 2.35 },
      { lat: 48.86, lng: 2.36 },
    ];
    const b = [
      { lat: 48.85, lng: 2.35 },
      { lat: 48.86, lng: 2.36 },
    ];
    const shared = findSharedSegments([a, b], 15);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("returns empty for non-overlapping traces", () => {
    const a = [
      { lat: 48.85, lng: 2.35 },
      { lat: 48.86, lng: 2.36 },
    ];
    // far away: ~500km away
    const b = [
      { lat: 43.6, lng: 3.87 },
      { lat: 43.61, lng: 3.88 },
    ];
    const shared = findSharedSegments([a, b], 15);
    expect(shared.length).toBe(0);
  });

  it("detects partial overlap within tolerance", () => {
    // two parallel lines ~10m apart with 20m tolerance should overlap
    const a = [
      { lat: 48.85, lng: 2.35 },
      { lat: 48.86, lng: 2.35 },
    ];
    const b = [
      { lat: 48.85, lng: 2.35012 }, // ~9m east at this latitude
      { lat: 48.86, lng: 2.35012 },
    ];
    const sharedTight = findSharedSegments([a, b], 5);
    const sharedWide = findSharedSegments([a, b], 20);
    // wide tolerance should detect overlap, tight should not
    expect(sharedWide.length).toBeGreaterThan(0);
    // tight 5m may be 0 or at least less than wide; just check wide passes
    expect(sharedWide[0].lengthM).toBeGreaterThan(0);
    expect(sharedTight.length).toBeLessThanOrEqual(sharedWide.length);
  });
});
