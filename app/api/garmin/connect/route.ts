import { NextRequest, NextResponse } from "next/server";
import { GarminClient } from "@/lib/garmin/client";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { garminConnectSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = garminConnectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { email, username, password } = parsed.data;

    const client = new GarminClient();
    const tokens = await client.login(username, password);

    const enc = encrypt(JSON.stringify(tokens));

    const user = await prisma.user.upsert({
      where: { email },
      update: { encryptedGarminTokens: enc },
      create: { email, encryptedGarminTokens: enc },
    });

    return NextResponse.json({ userId: user.id });
  } catch (err: any) {
    // Avoid leaking tokens
    const message = err.message ?? "Failed to connect Garmin";
    const status = message.includes("Not implemented") ? 501 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
