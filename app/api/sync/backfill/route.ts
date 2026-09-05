import { NextRequest, NextResponse } from "next/server";
import { backfillBatch } from "@/lib/garmin/sync";
import { syncBackfillSchema } from "@/lib/validators";

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
  } catch (e: any) {
    const msg = e?.message ?? "Backfill failed";
    const status = msg.includes("not found") || msg.includes("not connected") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
