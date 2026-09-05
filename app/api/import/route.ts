import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFIT, parseGPX, parseTCX } from "@/lib/fit/parser";
import { computeAvgPace } from "@/lib/fit/normalize";
import { importFileSchema } from "@/lib/validators";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

function isClientParseError(message: string): boolean {
  return /invalid|missing <gpx>|no track points|empty fit|too small|not a fit/i.test(message);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const rawUserId = (form.get("userId") as string) || (form.get("user_id") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded (field 'file' required)" }, { status: 400 });
    }

    const parsedUser = importFileSchema.safeParse({ userId: rawUserId });
    if (!parsedUser.success) {
      return NextResponse.json({ error: parsedUser.error.issues[0]?.message ?? "userId is required" }, { status: 400 });
    }
    const userId = parsedUser.data.userId;

    // Validate user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    if (bytes.length > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File too large: ${bytes.length} bytes exceeds 20MB limit` }, { status: 413 });
    }

    const filename = (file.name || "").toLowerCase();

    let parsed: Awaited<ReturnType<typeof parseFIT>>;

    try {
      if (filename.endsWith(".gpx") || file.type.includes("gpx")) {
        const text = bytes.toString("utf8");
        parsed = parseGPX(text);
      } else if (filename.endsWith(".tcx") || file.type.includes("tcx")) {
        const text = bytes.toString("utf8");
        parsed = parseTCX(text);
      } else if (filename.endsWith(".fit")) {
        parsed = await parseFIT(bytes);
      } else {
        // Try to detect by content: XML vs binary
        const text = bytes.toString("utf8");
        if (text.trim().startsWith("<?xml") || text.includes("<gpx")) {
          parsed = parseGPX(text);
        } else if (text.includes("<TrainingCenterDatabase")) {
          parsed = parseTCX(text);
        } else {
          parsed = await parseFIT(bytes);
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? "Invalid file";
      if (isClientParseError(msg)) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      throw e;
    }

    const avgPace = computeAvgPace(parsed.distance, parsed.duration);

    // Dedup: check for existing activity with same user + nearby date + similar distance
    const dedupWindowMs = 5 * 60 * 1000; // 5 minutes
    const dateFrom = new Date(parsed.date.getTime() - dedupWindowMs);
    const dateTo = new Date(parsed.date.getTime() + dedupWindowMs);
    const tolerance = Math.max(50, Math.round(parsed.distance * 0.01)); // 1% or 50m
    const distLow = parsed.distance - tolerance;
    const distHigh = parsed.distance + tolerance;

    const existing = await prisma.activity.findFirst({
      where: {
        userId,
        date: { gte: dateFrom, lte: dateTo },
        distance: { gte: distLow, lte: distHigh },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Duplicate activity", activityId: existing.id, activity: existing },
        { status: 409 }
      );
    }

    const activity = await prisma.activity.create({
      data: {
        userId,
        type: parsed.type ?? "running",
        name: parsed.name ?? file.name ?? "Imported activity",
        date: parsed.date ?? new Date(),
        distance: parsed.distance,
        duration: parsed.duration,
        elevationGain: parsed.elevationGain,
        avgPace,
        avgHR: parsed.avgHR,
        maxHR: parsed.maxHR,
        avgCadence: parsed.avgCadence,
        avgPower: parsed.avgPower,
        calories: parsed.calories,
        hasGps: parsed.hasGps,
        trackPoints: parsed.trackPoints.length
          ? {
              create: parsed.trackPoints.map((p) => ({
                lat: p.lat,
                lng: p.lng,
                ele: p.ele,
                time: p.time,
                hr: p.hr,
                cadence: p.cadence,
                power: p.power,
                speed: p.speed,
              })),
            }
          : undefined,
        laps: parsed.laps.length
          ? {
              create: parsed.laps.map((l) => ({
                idx: l.idx,
                distance: l.distance,
                duration: l.duration,
                avgPace: l.avgPace ?? undefined,
                avgHR: l.avgHR ?? undefined,
              })),
            }
          : undefined,
      },
      include: { trackPoints: false },
    });

    return NextResponse.json({ activityId: activity.id, activity }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err ?? "Import failed");
    if (isClientParseError(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { isDbUnavailableError, isUniqueConstraintError } = await import("@/lib/errors");
    if (isDbUnavailableError(err)) {
      return NextResponse.json({ error: "Database unavailable — please retry", detail: msg.slice(0, 500) }, { status: 503, headers: { "Retry-After": "30" } });
    }
    if (isUniqueConstraintError(err) || msg.includes("409") || msg.toLowerCase().includes("duplicate")) {
      // Already handled above as 409, but catch race after dedup check
      return NextResponse.json({ error: "Duplicate activity" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
