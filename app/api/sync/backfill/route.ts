import { NextRequest, NextResponse } from "next/server";
import { backfillBatch } from "@/lib/garmin/sync";
import { syncBackfillSchema } from "@/lib/validators";
import { isDbUnavailableError, isRateLimitError } from "@/lib/errors";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = syncBackfillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { userId, start, limit } = parsed.data;
    const result = await backfillBatch(userId, start, limit);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e ?? "Backfill failed");
    if (isDbUnavailableError(e)) {
      return NextResponse.json({ error: "Database unavailable — please retry", detail: msg.slice(0, 500) }, { status: 503, headers: { "Retry-After": "30" } });
    }
    if (isRateLimitError(e)) {
      return NextResponse.json({ error: "Garmin rate limited — retry after backoff", detail: msg.slice(0, 500) }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const status = msg.includes("not found") || msg.includes("not connected") ? 404 : 500;
    // Never leak decrypted tokens in error body
    const safeMsg = msg.includes("decrypt") ? "Failed to decrypt Garmin tokens" : msg;
    return NextResponse.json({ error: safeMsg }, { status });
  }
}
