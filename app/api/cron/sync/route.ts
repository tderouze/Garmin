import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backfillBatch } from "@/lib/garmin/sync";
import { isDbUnavailableError } from "@/lib/errors";

// Vercel will keep this function alive up to 60s (see vercel.json + next.config)
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Secured by CRON_SECRET — Vercel Cron sends Authorization: Bearer ${CRON_SECRET}
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? req.headers.get("x-cron-secret") ?? "";
  // Accept both "Bearer <secret>" and raw secret for flexibility
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let users: Array<{ id: string; email: string }> = [];
  try {
    users = await prisma.user.findMany({
      where: { encryptedGarminTokens: { not: null } },
      select: { id: true, email: true },
    });
  } catch (e: unknown) {
    if (isDbUnavailableError(e)) {
      return NextResponse.json(
        { error: "Database unavailable", detail: e instanceof Error ? e.message : String(e) },
        { status: 503, headers: { "Retry-After": "30" } }
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  if (users.length === 0) {
    return NextResponse.json({ ok: true, users: 0, results: [], message: "No users with Garmin tokens" });
  }

  const results: Array<{
    userId: string;
    email: string;
    imported?: number;
    skipped?: number;
    errors?: number;
    total?: number;
    error?: string;
  }> = [];

  for (const u of users) {
    try {
      // Incremental sync: fetch latest 20 activities. For cron we use start=0, limit=20
      // backfillBatch internally handles 429 backoff, FIT parse failures (skip + SyncError),
      // and P2002 dedup (counts as skipped).
      const batch = await backfillBatch(u.id, 0, 20);
      results.push({ userId: u.id, email: u.email, ...batch });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Persist SyncError for observability (spec section 12 syncErrors table)
      try {
        await prisma.syncError.create({
          data: { userId: u.id, message: `cron sync failed: ${msg.slice(0, 2000)}` },
        });
      } catch {
        // ignore SyncError write failure (DB may be degraded)
      }

      if (isDbUnavailableError(e)) {
        results.push({ userId: u.id, email: u.email, error: "DB unavailable — will retry next cron" });
        // Don't break loop — other users may still succeed, but note 503 context
        continue;
      }

      // For Garmin 429 after retries, we already logged; record as error but continue to next user
      if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
        results.push({ userId: u.id, email: u.email, error: `Rate limited: ${msg.slice(0, 300)}` });
        continue;
      }

      results.push({ userId: u.id, email: u.email, error: msg.slice(0, 500) });
    }
  }

  const hadDbError = results.some((r) => r.error?.includes("DB unavailable"));
  const status = hadDbError ? 503 : 200;

  return NextResponse.json(
    {
      ok: !hadDbError,
      users: users.length,
      results,
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
