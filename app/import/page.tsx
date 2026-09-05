"use client";

import { useCallback, useState } from "react";

type ImportResult = {
  activityId: string;
  activity?: { id: string; name?: string | null; distance: number; duration: number };
};

type RecentItem = {
  id: string;
  name: string;
  status: "success" | "error" | "duplicate";
  detail: string;
};

export default function ImportPage() {
  const [userId, setUserId] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ImportResult | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!userId.trim()) {
        setError("userId requis — renseigne ton identifiant utilisateur.");
        return;
      }
      setUploading(true);
      setError(null);
      setSuccess(null);
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("userId", userId.trim());
        const res = await fetch("/api/import", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After") ?? "60";
          throw new Error(`Trop de requêtes — réessaie dans ${retryAfter}s.`);
        }
        if (res.status === 409) {
          const id = body.activityId ?? body.activity?.id ?? "—";
          setRecent((r) => [{ id: String(Date.now()), name: file.name, status: "duplicate" as const, detail: `Doublon détecté (id ${id})` }, ...r].slice(0, 10));
          throw new Error(body.error ?? "Activité déjà importée (doublon).");
        }
        if (!res.ok) {
          throw new Error(body.error ?? `Import échoué (${res.status})`);
        }
        const result: ImportResult = { activityId: body.activityId, activity: body.activity };
        setSuccess(result);
        setRecent((r) => [{ id: String(Date.now()), name: file.name, status: "success" as const, detail: `Importé — ${body.activity?.name ?? file.name} (${result.activityId})` }, ...r].slice(0, 10));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        // Also push error to recent if not duplicate (duplicate already pushed)
        if (!msg.toLowerCase().includes("doublon") && !msg.toLowerCase().includes("duplicate")) {
          setRecent((r) => [{ id: String(Date.now()), name: file.name, status: "error" as const, detail: msg }, ...r].slice(0, 10));
        }
      } finally {
        setUploading(false);
      }
    },
    [userId]
  );

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    // reset input so same file can be re-selected
    e.target.value = "";
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Importer FIT / GPX / TCX</h1>
        <p className="mt-2 text-sm text-zinc-600">Glisse un fichier ou utilise le sélecteur. Formats supportés : .fit, .gpx, .tcx (max 20 MB).</p>
        <a href="/" className="mt-3 inline-block text-sm font-medium text-zinc-700 underline underline-offset-4">← Retour dashboard</a>
      </header>

      <div className="mb-6 rounded-xl border bg-white p-4 shadow-sm">
        <label htmlFor="userId" className="block text-sm font-medium text-zinc-700">userId</label>
        <input
          id="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="cuid de l'utilisateur (requis)"
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
        />
        <p className="mt-1 text-xs text-zinc-500">Pour V1 perso l&apos;auth est différée — indique le userId cible (ou crée un user via /api/garmin/connect).</p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed bg-white p-10 text-center shadow-sm transition ${dragOver ? "border-zinc-900 bg-zinc-50" : "border-zinc-300"} ${uploading ? "opacity-60 pointer-events-none" : ""}`}
      >
        <p className="text-sm font-medium text-zinc-700">{uploading ? "Import en cours…" : dragOver ? "Dépose le fichier ici" : "Glisse un fichier FIT / GPX / TCX ici"}</p>
        <p className="mt-2 text-xs text-zinc-500">ou</p>
        <label className="mt-3 inline-flex cursor-pointer rounded-md border bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
          Choisir un fichier
          <input type="file" accept=".fit,.gpx,.tcx,application/octet-stream,application/gpx+xml,application/xml,text/xml" className="hidden" onChange={onFileInput} disabled={uploading} />
        </label>
        {uploading && <div className="mx-auto mt-4 h-1 w-full max-w-xs overflow-hidden rounded bg-zinc-200"><div className="h-full w-1/2 animate-pulse bg-zinc-900" /></div>}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Import réussi — activité <span className="font-mono font-semibold">{success.activityId}</span>
          {success.activity?.name ? ` — ${success.activity.name}` : ""} —{" "}
          <a href={`/api/activities/${success.activityId}`} className="underline underline-offset-4">voir détail</a>
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-900">Imports récents (session)</h2>
          <ul className="mt-3 divide-y divide-zinc-200 rounded-xl border bg-white shadow-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
                <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium text-white ${r.status === "success" ? "bg-green-600" : r.status === "duplicate" ? "bg-amber-600" : "bg-red-600"}`}>{r.status}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{r.name}</span>
                <span className="max-w-[50%] truncate text-xs text-zinc-600">{r.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="mt-8 flex gap-3 text-sm">
        <a href="/" className="rounded-md border bg-white px-4 py-2 font-medium hover:bg-zinc-50">Dashboard</a>
        <a href="/map" className="rounded-md border bg-white px-4 py-2 font-medium hover:bg-zinc-50">Carte</a>
      </nav>
    </main>
  );
}
