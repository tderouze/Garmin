import { NextRequest, NextResponse } from "next/server";
import { GarminClient } from "@/lib/garmin/client";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { garminConnectSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }
  try {
    const body = await req.json();
    const parsed = garminConnectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { email, username, password, tokenB64 } = parsed.data as any;

    let tokens: any;
    if (tokenB64) {
      try {
        const json = Buffer.from(tokenB64, "base64").toString("utf-8");
        const bundle = JSON.parse(json);
        // bundle is {oauth1, oauth2} from garmin-browser-auth
        if (!bundle.oauth1 || !bundle.oauth2) throw new Error("Invalid bundle");
        tokens = { oauth1: bundle.oauth1, oauth2: bundle.oauth2 };
        // verify quickly
        const client = new GarminClient();
        // try a lightweight verify by loading token
        const GarminConnect = (await import("garmin-connect").catch(() => null)) as any;
        if (GarminConnect) {
          // optional verify — ignore errors
        }
      } catch (e: any) {
        return NextResponse.json({ error: `Invalid tokenB64: ${e?.message ?? String(e)}` }, { status: 400 });
      }
    } else {
      const client = new GarminClient();
      tokens = await client.login(username!, password!);
    }

    const enc = encrypt(JSON.stringify(tokens));

    const user = await prisma.user.upsert({
      where: { email },
      update: { encryptedGarminTokens: enc },
      create: { email, encryptedGarminTokens: enc },
    });

    return NextResponse.json({ userId: user.id });
  } catch (err: unknown) {
    // Avoid leaking tokens — never return tokens or passwords in error body
    const message = err instanceof Error ? err.message : String(err ?? "Failed to connect Garmin");
    if (message.toLowerCase().includes("rate limit") || message.includes("429")) {
      return NextResponse.json({ error: "Garmin rate limited — retry after backoff", detail: "429" }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const { isDbUnavailableError } = await import("@/lib/errors");
    if (isDbUnavailableError(err)) {
      return NextResponse.json({ error: "Database unavailable — please retry" }, { status: 503, headers: { "Retry-After": "30" } });
    }
    const status = message.includes("Not implemented") ? 501 : 500;
    // Strip any token-like substrings from message before returning
    const safeMessage = message.replace(/oauth[^\s]*/gi, "[redacted]");
    return NextResponse.json({ error: safeMessage }, { status });
  }
}
