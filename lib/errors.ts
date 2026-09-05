/**
 * Centralised error helpers for spec section 9 (Gestion d'Erreurs)
 * - DB indisponible → 503
 * - Garmin rate-limit 429 → backoff (handled in lib/garmin/sync.ts)
 * - P2002 unique constraint → dedup (handled in sync.ts)
 * - SyncError → persisted in DB, not thrown to client
 */

export function isDbUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const code = (err as { code?: string })?.code ?? "";
  // Prisma codes for DB unreachable
  if (code === "P1001" || code === "P1002" || code === "P1008" || code === "P1017") return true;
  const lower = msg.toLowerCase();
  return (
    lower.includes("can't reach database") ||
    lower.includes("cant reach database") ||
    lower.includes("connect etimedout") ||
    lower.includes("connect econnrefused") ||
    (lower.includes("database_url") && lower.includes("not found")) ||
    lower.includes("08006") ||
    (lower.includes("connection") && lower.includes("refused")) ||
    lower.includes("getaddrinfo") ||
    lower.includes("enotfound") ||
    (lower.includes("prisma") && lower.includes("can't reach"))
  );
}

export function dbUnavailableResponse(detail?: string) {
  // Lazy import to keep lib usable in non-Next contexts (tests) without bundling next/server
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextResponse } = require("next/server") as typeof import("next/server");
  return NextResponse.json(
    { error: "Service temporarily unavailable — database unreachable. Please retry.", detail: detail?.slice(0, 500) },
    { status: 503, headers: { "Retry-After": "30" } }
  );
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes("429") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many requests");
}

export function isUniqueConstraintError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "P2002") return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes("P2002") || msg.includes("Unique constraint");
}
