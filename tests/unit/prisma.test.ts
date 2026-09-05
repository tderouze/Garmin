import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";

describe("prisma singleton", () => {
  it("exports a PrismaClient", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.activity.findMany).toBe("function");
  });
});
