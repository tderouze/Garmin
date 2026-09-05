import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activitiesQuerySchema } from "@/lib/validators";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = {
    type: searchParams.get("type") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  };

  const parsed = activitiesQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { type, from, to, limit, offset } = parsed.data;

  const where: any = {};
  if (type) where.type = type;
  if (from || to) {
    where.date = {};
    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid 'from' date" }, { status: 400 });
      }
      where.date.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid 'to' date" }, { status: 400 });
      }
      where.date.lte = d;
    }
  }

  // TODO(auth): NextAuth deferred for V1 (single-user/perso). When auth is added,
  // replace userId query-param fallback with session.user.id and remove open query access.
  // For V1 we require userId or fall back to the single/first user — never return all users open-access.
  let userId = searchParams.get("userId");
  if (!userId) {
    try {
      const firstUser = await prisma.user.findFirst({ select: { id: true } });
      if (firstUser) userId = firstUser.id;
      // If no user exists yet, where remains unfiltered but will return empty set.
    } catch {
      // If DB unreachable, leave userId null — handler will 503 below
    }
  }
  if (userId) where.userId = userId;

  const take = limit ?? 50;
  const skip = offset ?? 0;

  try {
    const activities = await prisma.activity.findMany({
      where,
      orderBy: { date: "desc" },
      take,
      skip,
    });
    return NextResponse.json(activities);
  } catch (e: unknown) {
    const { isDbUnavailableError } = await import("@/lib/errors");
    if (isDbUnavailableError(e)) {
      return NextResponse.json(
        { error: "Service temporarily unavailable — database unreachable. Please retry." },
        { status: 503, headers: { "Retry-After": "30" } }
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
