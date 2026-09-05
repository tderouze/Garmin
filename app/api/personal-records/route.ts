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
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[personal-records] fetch failed:", msg);
    const { isDbUnavailableError } = await import("@/lib/errors");
    if (isDbUnavailableError(e)) {
      // Spec section 9: DB indisponible → 503 with Retry-After
      // For build/CI without DATABASE_URL, keep graceful empty to not break static generation
      if (msg.includes("DATABASE_URL")) return NextResponse.json([]);
      return NextResponse.json(
        { error: "Service temporarily unavailable — database unreachable. Please retry." },
        { status: 503, headers: { "Retry-After": "30" } }
      );
    }
    return NextResponse.json({ error: "Failed to compute personal records", detail: msg.slice(0, 500) }, { status: 500 });
  }
}
