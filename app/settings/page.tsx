"use client";

import { useEffect, useState } from "react";

interface SyncResult {
  imported?: number;
  skipped?: number;
  errors?: number;
  total?: number;
}

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // Try to load existing user from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("garmin_userId");
    const savedEmail = localStorage.getItem("garmin_email");
    if (saved) setUserId(saved);
    if (savedEmail) setEmail(savedEmail);
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Connexion à Garmin…");
    setError(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/garmin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const id = body.userId as string;
      setUserId(id);
      localStorage.setItem("garmin_userId", id);
      localStorage.setItem("garmin_email", email);
      setStatus(`Connecté — userId ${id.slice(0, 8)}… Tokens chiffrés en DB.`);
      setPassword("");
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStatus(null);
    }
  }

  async function handleBackfill() {
    if (!userId) {
      setError("Connecte-toi d'abord à Garmin");
      return;
    }
    setSyncing(true);
    setError(null);
    setStatus("Backfill en cours (100 par batch, 500ms entre requêtes)…");
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, start: 0, limit: 100 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      setSyncResult(body);
      setStatus(`Backfill terminé — ${body.imported ?? 0} importées, ${body.skipped ?? 0} ignorées, ${body.errors ?? 0} erreurs`);
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStatus(null);
    } finally {
      setSyncing(false);
    }
  }

  async function handleIncremental() {
    if (!userId) {
      setError("Connecte-toi d'abord");
      return;
    }
    setSyncing(true);
    setError(null);
    setStatus("Sync incrémental depuis lastSyncAt…");
    try {
      const res = await fetch("/api/sync/incremental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      setSyncResult(body);
      setStatus(`Sync incrémental — ${body.imported ?? 0} nouvelles`);
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStatus(null);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Paramètres Garmin</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Connecte ton compte Garmin Connect (login/mdp). Les tokens sont chiffrés AES-256-GCM en DB et jamais loggés.
      </p>

      <form onSubmit={handleConnect} className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium">Email local (identifiant dans l'app)</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="thi.derouze@gmail.com"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-zinc-500">Utilisé comme `User.email` en DB — pas forcément ton email Garmin</p>
        </div>
        <div>
          <label className="text-sm font-medium">Username Garmin</label>
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ton.email@garmin.com"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Mot de passe Garmin</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-zinc-500">Si MFA activé, désactive-le ou utilise un mot de passe d'application</p>
        </div>
        <button type="submit" className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-black">
          Se connecter à Garmin
        </button>
      </form>

      {userId && (
        <div className="mt-6 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Synchronisation</h2>
          <p className="mt-1 text-xs text-zinc-500">userId: {userId}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={handleBackfill}
              disabled={syncing}
              className="rounded-md border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              {syncing ? "Sync…" : "Backfill 100 (historique)"}
            </button>
            <button
              onClick={handleIncremental}
              disabled={syncing}
              className="rounded-md border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              Sync incrémental
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Backfill : paginé 100/batch, déduplication sur garminId, backoff 429. Clique plusieurs fois pour tout l'historique (start 0 → 100 → 200…).
          </p>
          {syncResult && (
            <pre className="mt-3 overflow-auto rounded bg-zinc-50 p-3 text-xs">{JSON.stringify(syncResult, null, 2)}</pre>
          )}
        </div>
      )}

      {status && <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{status}</div>}
      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">Erreur : {error}</div>}

      <div className="mt-6 flex gap-3 text-sm">
        <a href="/" className="rounded-md border bg-white px-4 py-2 hover:bg-zinc-50">← Dashboard</a>
        <a href="/import" className="rounded-md border bg-white px-4 py-2 hover:bg-zinc-50">Import manuel FIT/GPX</a>
      </div>

      <div className="mt-6 rounded-md bg-amber-50 p-4 text-xs text-amber-800">
        <strong>Note :</strong> la lib Garmin est non-officielle. Si Garmin change son SSO, le login peut casser — utilise alors
        l'import manuel via connect.garmin.com → Exporter FIT.
      </div>
    </main>
  );
}
