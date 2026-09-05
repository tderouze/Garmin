import { describe, it, expect } from "vitest";
import { detectRaces, computePBs, getCanonicalDistance, CANONICAL_DISTANCES } from "@/lib/personalRecords";

describe("detectRaces", () => {
  it("detects 10K within 2%", () => {
    const acts = [{ type: "running", distance: 10050, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(1);
  });

  it("detects 5K exactly (also a race distance)", () => {
    const acts = [{ type: "running", distance: 5000, date: new Date() } as any];
    // 5K is also a race distance — so 5000 should be detected
    expect(detectRaces(acts as any).length).toBe(1);
  });

  it("detects semi within 2% (21097)", () => {
    const acts = [{ type: "running", distance: 21100, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(1);
  });

  it("detects marathon within 2% (42195)", () => {
    const acts = [{ type: "running", distance: 42200, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(1);
  });

  it("detects race type regardless of distance", () => {
    const acts = [{ type: "race", distance: 3000, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(1);
  });

  it("ignores non-race short runs not near canonical", () => {
    const acts = [{ type: "running", distance: 3000, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(0);
  });

  it("ignores 8K (not within 2% of any canonical)", () => {
    const acts = [{ type: "running", distance: 8000, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(0);
  });

  it("rejects just outside 2% for 10K", () => {
    // 10K * 1.021 = 10210 (>2%)
    const acts = [{ type: "running", distance: 10210, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(0);
  });
});

describe("getCanonicalDistance", () => {
  it("returns canonical within 2%", () => {
    expect(getCanonicalDistance(10050)).toBe(10000);
    expect(getCanonicalDistance(5000)).toBe(5000);
    expect(getCanonicalDistance(21000)).toBe(21097);
    expect(getCanonicalDistance(42195)).toBe(42195);
  });
  it("returns null outside 2%", () => {
    expect(getCanonicalDistance(8000)).toBeNull();
    expect(getCanonicalDistance(3000)).toBeNull();
  });
  it("exposes canonical distances", () => {
    expect(CANONICAL_DISTANCES).toEqual([5000, 10000, 21097, 42195]);
  });
});

describe("computePBs", () => {
  it("groups by canonical and keeps min duration", () => {
    const acts = [
      { id: "a1", type: "running", distance: 10000, duration: 2400, date: new Date("2024-01-01") } as any,
      { id: "a2", type: "running", distance: 10050, duration: 2300, date: new Date("2024-02-01") } as any,
      { id: "a3", type: "running", distance: 10020, duration: 2500, date: new Date("2024-03-01") } as any,
      { id: "b1", type: "running", distance: 5000, duration: 1100, date: new Date("2024-01-15") } as any,
      { id: "b2", type: "running", distance: 5050, duration: 1000, date: new Date("2024-02-15") } as any,
    ];
    const pbs = computePBs(acts as any);
    // should have 2 PBs: 5K and 10K
    expect(pbs.length).toBe(2);
    const pb10k = pbs.find((p) => p.canonical === 10000 || p.distance === "10K");
    const pb5k = pbs.find((p) => p.canonical === 5000 || p.distance === "5K");
    expect(pb10k).toBeDefined();
    expect(pb10k!.bestTime).toBe(2300);
    expect(pb10k!.activityId).toBe("a2");
    expect(pb5k).toBeDefined();
    expect(pb5k!.bestTime).toBe(1000);
    expect(pb5k!.activityId).toBe("b2");
  });

  it("handles semi and marathon", () => {
    const acts = [
      { id: "s1", type: "running", distance: 21097, duration: 5400, date: new Date("2024-04-01") } as any,
      { id: "m1", type: "running", distance: 42195, duration: 10800, date: new Date("2024-05-01") } as any,
    ];
    const pbs = computePBs(acts as any);
    expect(pbs.length).toBe(2);
  });

  it("returns empty for no races", () => {
    const acts = [{ id: "x", type: "running", distance: 3000, duration: 600, date: new Date() } as any];
    expect(computePBs(acts as any).length).toBe(0);
  });

  it("ignores race-type custom distance not near canonical for PB grouping", () => {
    // race type with arbitrary distance should be detected as race but not contribute to PB (no canonical)
    const acts = [{ id: "r1", type: "race", distance: 3000, duration: 600, date: new Date() } as any];
    expect(detectRaces(acts as any).length).toBe(1);
    expect(computePBs(acts as any).length).toBe(0);
  });
});
