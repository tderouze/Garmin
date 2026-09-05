/** @type {import('next').NextConfig} */
const nextConfig = {
  // Spec section 12: backfill can be long-running — per-route maxDuration is set
  // via `export const maxDuration = 60` in each sync/cron route and vercel.json.
  // No global maxDuration needed here; keep config minimal.
};

export default nextConfig;
