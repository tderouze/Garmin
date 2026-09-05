import { describe, it, expect } from "vitest";
import { computeAvgPace, splitByKm, msToKmh } from "@/lib/fit/normalize";

describe("normalize", () => {
  it("computes avg pace sec/km", () => {
    expect(computeAvgPace(10000, 3000)).toBe(300); // 5:00/km
  });

  it("returns null for zero distance or duration", () => {
    expect(computeAvgPace(0, 3000)).toBeNull();
    expect(computeAvgPace(10000, 0)).toBeNull();
  });

  it("converts m/s to km/h", () => {
    expect(msToKmh(1)).toBeCloseTo(3.6);
    expect(msToKmh(5)).toBeCloseTo(18);
  });

  it("splits track into km laps", () => {
    const points = Array.from({ length: 5 }, (_, i) => ({
      distance: (i + 1) * 1000,
      time: (i + 1) * 300,
      lat: 0,
      lng: 0,
      ele: 0,
    }));
    const laps = splitByKm(points as any);
    expect(laps.length).toBe(5);
    expect(laps[0].distance).toBe(1000);
    expect(laps[0].duration).toBe(300);
  });

  it("handles partial km correctly", () => {
    const points = [
      { distance: 400, time: 120, lat: 0, lng: 0 },
      { distance: 900, time: 270, lat: 0, lng: 0 },
      { distance: 1400, time: 420, lat: 0, lng: 0 },
      { distance: 2400, time: 720, lat: 0, lng: 0 },
    ];
    const laps = splitByKm(points as any);
    // first lap at 1400m (~1000m threshold crossed), second at 2400m
    expect(laps.length).toBe(2);
  });
});
