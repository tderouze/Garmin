import { describe, it, expect } from "vitest";
import { shouldImport } from "@/lib/garmin/sync";

describe("shouldImport", () => {
  it("skips if garminId exists", () => {
    expect(shouldImport("123", new Set(["123"]))).toBe(false);
    expect(shouldImport("456", new Set(["123"]))).toBe(true);
  });

  it("returns true for empty set", () => {
    expect(shouldImport("789", new Set())).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(shouldImport("abc", new Set(["ABC"]))).toBe(true);
  });
});
