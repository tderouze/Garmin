import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDbUnavailableError } from "@/lib/errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params?.id;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const activity = await prisma.activity.findUnique({
      where: { id },
      include: {
        trackPoints: { orderBy: { time: "asc" } },
        laps: { orderBy: { idx: "asc" } },
      },
    });

    if (!activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    return NextResponse.json(activity);
  } catch (e: unknown) {
    if (isDbUnavailableError(e)) {
      return NextResponse.json(
        { error: "Service temporarily unavailable — database unreachable. Please retry." },
        { status: 503, headers: { "Retry-After": "30" } }
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
