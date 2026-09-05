import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computePBs } from "@/lib/personalRecords";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? undefined;

  try {
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;

    // Fetch activities needed for PB computation. Keep query light: only fields used by computePBs.
    const activities = await prisma.activity.findMany({
      where,
      orderBy: { date: "desc" },
      take: 500,
      select: {
        id: true,
        type: true,
        distance: true,
        duration: true,
        date: true,
        name: true,
        avgPace: true,
        avgHR: true,
      },
    });

    const pbs = computePBs(activities as unknown as Parameters<typeof computePBs>[0]);

    // Return PBs with serialised date ISO for client consumption
    const serialised = pbs.map((pb) => ({
      ...pb,
      date: pb.date.toISOString(),
    }));

    return NextResponse.json(serialised);
  } catch (e: unknown) {
    // If DB unreachable (e.g. no DATABASE_URL in dev/CI), return empty list rather than 500 to keep UI usable
    const msg = e instanceof Error ? e.message : String(e);
    // Log server-side for observability; don't expose tokens
    console.error("[personal-records] fetch failed:", msg);
    // Gracefully degrade: try to return empty instead of 503 during local dev without DB
    // If the error is clearly a DB connection issue, return empty; otherwise 500
    if (msg.includes("DATABASE_URL") || msg.includes("Can't reach") || msg.includes("connect")) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: "Failed to compute personal records", detail: msg }, { status: 500 });
  }
}
