import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFIT, parseGPX, parseTCX } from "@/lib/fit/parser";
import { computeAvgPace } from "@/lib/fit/normalize";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const userId = (form.get("userId") as string) || (form.get("user_id") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded (field 'file' required)" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    // Validate user exists (optional but helps)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = (file.name || "").toLowerCase();

    let parsed: Awaited<ReturnType<typeof parseFIT>>;

    if (filename.endsWith(".gpx") || file.type.includes("gpx")) {
      const text = bytes.toString("utf8");
      parsed = parseGPX(text);
    } else if (filename.endsWith(".tcx") || file.type.includes("tcx")) {
      const text = bytes.toString("utf8");
      parsed = parseTCX(text);
    } else if (filename.endsWith(".fit") || filename.endsWith(".FIT")) {
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

    const avgPace = computeAvgPace(parsed.distance, parsed.duration);

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

    // Create trackPoints separately if needed handled via nested create above

    return NextResponse.json({ activityId: activity.id, activity }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Import failed" }, { status: 500 });
  }
}
