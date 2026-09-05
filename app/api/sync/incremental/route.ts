import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backfillBatch } from "@/lib/garmin/sync";
import { syncIncrementalSchema } from "@/lib/validators";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = syncIncrementalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { userId } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!user.encryptedGarminTokens) {
      return NextResponse.json({ error: "Garmin not connected for user" }, { status: 400 });
    }

    // Incremental: fetch latest activities since lastSyncAt.
    // Filter to only activities with date > lastSyncAt per spec.
    const limit = 20;
    const result = await backfillBatch(userId, 0, limit, {
      fromDate: user.lastSyncAt ?? null,
    });

    return NextResponse.json({
      ...result,
      lastSyncAt: new Date().toISOString(),
    });
  } catch (e: any) {
    const msg = e?.message ?? "Incremental sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
