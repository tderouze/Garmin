import { NextRequest, NextResponse } from "next/server";
import { backfillBatch } from "@/lib/garmin/sync";
import { syncBackfillSchema } from "@/lib/validators";
import { isDbUnavailableError, isRateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }
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
