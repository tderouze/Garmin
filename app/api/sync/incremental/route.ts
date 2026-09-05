import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backfillBatch } from "@/lib/garmin/sync";
import { syncIncrementalSchema } from "@/lib/validators";
import { isDbUnavailableError, isRateLimitError } from "@/lib/errors";

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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e ?? "Incremental sync failed");
    if (isDbUnavailableError(e)) {
      return NextResponse.json({ error: "Database unavailable — please retry", detail: msg.slice(0, 500) }, { status: 503, headers: { "Retry-After": "30" } });
    }
    if (isRateLimitError(e)) {
      return NextResponse.json({ error: "Garmin rate limited — retry after backoff", detail: msg.slice(0, 500) }, { status: 429, headers: { "Retry-After": "60" } });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
