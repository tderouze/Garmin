import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { GarminClient } from "./client";
import { parseFIT } from "@/lib/fit/parser";
import { computeAvgPace } from "@/lib/fit/normalize";

export function shouldImport(garminId: string, existing: Set<string>): boolean {
  return !existing.has(garminId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGarminId(raw: any): string | null {
  const id = raw?.activityId ?? raw?.activity_id ?? raw?.id ?? raw?.garminId ?? raw?.garminID;
  return id != null ? String(id) : null;
}

function toDate(raw: any, fallback: Date): Date {
  const candidates = [raw?.startTimeLocal, raw?.startTimeGMT, raw?.beginTimestamp, raw?.startTime, raw?.date];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return fallback;
}

export async function backfillBatch(
  userId: string,
  start: number,
  limit: number
): Promise<{ imported: number; skipped: number; errors: number; total: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");
  if (!user.encryptedGarminTokens) throw new Error("Garmin not connected for user");

  let tokens: any;
  try {
    tokens = JSON.parse(decrypt(user.encryptedGarminTokens));
  } catch {
    throw new Error("Failed to decrypt Garmin tokens");
  }

  const client = new GarminClient();

  // Fetch activities with 429 retry
  let activities: any[] = [];
  let retries = 0;
  while (true) {
    try {
      activities = await client.fetchActivities(tokens, start, limit);
      break;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if ((msg.includes("429") || msg.includes("rate")) && retries < 3) {
        retries++;
        await sleep(1000 * Math.pow(2, retries));
        continue;
      }
      await prisma.syncError.create({
        data: { userId, message: `fetchActivities failed: ${msg}` },
      });
      throw e;
    }
  }

  const existingRows = await prisma.activity.findMany({
    where: { userId, garminId: { not: null } },
    select: { garminId: true },
  });
  const existingSet = new Set(existingRows.map((r) => r.garminId as string));

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const raw of activities) {
    const garminId = extractGarminId(raw);
    if (!garminId) {
      skipped++;
      continue;
    }
    if (!shouldImport(garminId, existingSet)) {
      skipped++;
      continue;
    }

    // Rate-limit 500ms between downloads
    await sleep(500);

    try {
      let parsed: any = null;
      let buffer: Buffer | null = null;

      // Attempt to download FIT — 429 backoff inside
      let dlRetries = 0;
      while (true) {
        try {
          buffer = await client.downloadFIT(tokens, garminId);
          break;
        } catch (dlErr: any) {
          const dlMsg = dlErr?.message ?? String(dlErr);
          if ((dlMsg.includes("429") || dlMsg.includes("rate")) && dlRetries < 2) {
            dlRetries++;
            await sleep(2000 * dlRetries);
            continue;
          }
          throw dlErr;
        }
      }

      if (buffer && buffer.length > 0) {
        try {
          parsed = await parseFIT(buffer);
        } catch {
          // FIT parse failed — fallback to Garmin metadata; not fatal
          parsed = null;
        }
      }

      const date = toDate(raw, parsed?.date ?? new Date());
      const distance: number = parsed?.distance ?? raw?.distance ?? raw?.totalDistance ?? 0;
      const duration: number =
        parsed?.duration ??
        (typeof raw?.duration === "number" ? Math.round(raw.duration) : undefined) ??
        (typeof raw?.elapsedDuration === "number" ? Math.round(raw.elapsedDuration) : undefined) ??
        (typeof raw?.movingDuration === "number" ? Math.round(raw.movingDuration) : undefined) ??
        0;
      const elevationGain: number | null =
        parsed?.elevationGain ?? raw?.elevationGain ?? raw?.totalElevationGain ?? null;
      const avgHR: number | null = parsed?.avgHR ?? raw?.averageHR ?? raw?.avgHR ?? null;
      const maxHR: number | null = parsed?.maxHR ?? raw?.maxHR ?? null;
      const avgCadence: number | null = parsed?.avgCadence ?? raw?.averageBikingCadence ?? raw?.avgCadence ?? null;
      const avgPower: number | null = parsed?.avgPower ?? raw?.avgPower ?? null;
      const calories: number | null = raw?.calories ?? parsed?.calories ?? null;
      const type: string =
        parsed?.type ?? raw?.activityType?.typeKey ?? raw?.type ?? raw?.activityType ?? "running";
      const name: string | null = parsed?.name ?? raw?.activityName ?? raw?.name ?? null;
      const hasGps: boolean = parsed?.hasGps ?? (raw?.hasGps ?? true);

      const avgPace = computeAvgPace(distance, duration);

      const trackPoints = (parsed?.trackPoints ?? []) as Array<{
        lat: number;
        lng: number;
        ele?: number;
        time: Date;
        hr?: number;
        cadence?: number;
        power?: number;
        speed?: number;
      }>;

      const laps = (parsed?.laps ?? []) as Array<{
        idx: number;
        distance: number;
        duration: number;
        avgHR?: number;
        avgPace?: number;
      }>;

      // Create Activity + nested TrackPoints/Laps
      await prisma.activity.create({
        data: {
          userId,
          garminId,
          type: String(type),
          name,
          date,
          distance: Number(distance) || 0,
          duration: Number(duration) || 0,
          elevationGain: elevationGain != null ? Number(elevationGain) : null,
          avgPace: avgPace ?? null,
          avgHR: avgHR != null ? Math.round(Number(avgHR)) : null,
          maxHR: maxHR != null ? Math.round(Number(maxHR)) : null,
          avgCadence: avgCadence != null ? Number(avgCadence) : null,
          avgPower: avgPower != null ? Number(avgPower) : null,
          calories: calories != null ? Math.round(Number(calories)) : null,
          hasGps: Boolean(hasGps),
          trackPoints:
            trackPoints.length > 0
              ? {
                  create: trackPoints.map((p) => ({
                    lat: p.lat,
                    lng: p.lng,
                    ele: p.ele ?? null,
                    time: p.time,
                    hr: p.hr ?? null,
                    cadence: p.cadence ?? null,
                    power: p.power ?? null,
                    speed: p.speed ?? null,
                  })),
                }
              : undefined,
          laps:
            laps.length > 0
              ? {
                  create: laps.map((l) => ({
                    idx: l.idx,
                    distance: l.distance,
                    duration: l.duration,
                    avgPace: l.avgPace ?? null,
                    avgHR: l.avgHR ?? null,
                  })),
                }
              : undefined,
        },
      });

      existingSet.add(garminId);
      imported++;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      // Handle 429 backoff caught above already; generic error: record SyncError and continue
      if (msg.includes("429")) {
        await sleep(1500);
      }
      try {
        await prisma.syncError.create({
          data: { userId, garminId, message: msg.slice(0, 2000) },
        });
      } catch {
        // ignore SyncError write failure
      }
      errors++;
      continue;
    }
  }

  // Update lastSyncAt regardless of partial success
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastSyncAt: new Date() } });
  } catch {
    // ignore
  }

  return { imported, skipped, errors, total: activities.length };
}
