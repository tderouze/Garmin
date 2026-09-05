import { describe, it, expect } from "vitest";
import { weeklyVolume, estimateVMA } from "@/lib/calculations";

describe("weeklyVolume", () => {
  it("sums distance per week (ISO Monday bucket)", () => {
    const acts = [
      { date: new Date("2024-01-01"), distance: 10000 },
      { date: new Date("2024-01-03"), distance: 5000 },
    ];
    const weeks = weeklyVolume(acts as any);
    expect(weeks.length).toBe(1);
    expect(weeks[0].distance).toBe(15000);
    expect(weeks[0].week).toBe("2024-01-01"); // Monday
  });

  it("groups across weeks correctly", () => {
    const acts = [
      { date: new Date("2024-01-01T10:00:00Z"), distance: 5000 },
      { date: new Date("2024-01-08T10:00:00Z"), distance: 8000 },
    ];
    const weeks = weeklyVolume(acts as any);
    expect(weeks.length).toBe(2);
    // sorted ascending
    expect(weeks[0].week).toBe("2024-01-01");
    expect(weeks[1].week).toBe("2024-01-08");
  });

  it("handles string dates and Sunday belongs to previous Monday", () => {
    // Sunday 2024-01-07 should bucket to Monday 2024-01-01
    const acts = [{ date: "2024-01-07T12:00:00.000Z", distance: 7000 } as unknown as { date: Date; distance: number }];
    const weeks = weeklyVolume(acts as any);
    expect(weeks.length).toBe(1);
    expect(weeks[0].week).toBe("2024-01-01");
  });

  it("returns empty for no activities", () => {
    expect(weeklyVolume([] as any)).toEqual([]);
  });

  it("sums multiple activities same week with different times", () => {
    const acts = [
      { date: new Date("2024-06-10T06:00:00Z"), distance: 10000 }, // Mon
      { date: new Date("2024-06-12T18:00:00Z"), distance: 5000 }, // Wed same week
      { date: new Date("2024-06-15T08:00:00Z"), distance: 21097 }, // Sat same week
    ];
    const w = weeklyVolume(acts as any);
    expect(w[0].distance).toBe(36097);
  });
});

describe("estimateVMA", () => {
  it("returns null for empty", () => {
    expect(estimateVMA([])).toBeNull();
  });

  it("estimates VMA from best avg speed (km/h)", () => {
    // 10km in 40min => 15 km/h
    const acts = [{ distance: 10000, duration: 2400 }];
    const vma = estimateVMA(acts as any);
    expect(vma).not.toBeNull();
    expect(vma!).toBeCloseTo(15, 1);
  });

  it("ignores very short activities (<1500m) for VMA", () => {
    const acts = [{ distance: 800, duration: 180 }];
    expect(estimateVMA(acts as any)).toBeNull();
  });

  it("picks best speed among multiple activities", () => {
    const acts = [
      { distance: 5000, duration: 1500 }, // 12 km/h
      { distance: 10000, duration: 2400 }, // 15 km/h best
      { distance: 21097, duration: 5400 }, // ~14.06 km/h
    ];
    const vma = estimateVMA(acts as any);
    expect(vma).toBeCloseTo(15, 1);
  });

  it("handles null/undefined input gracefully", () => {
    expect(estimateVMA(null as any)).toBeNull();
    expect(estimateVMA(undefined as any)).toBeNull();
  });
});
