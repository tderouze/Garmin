export default function Home() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-bold tracking-tight">Garmin Analysis</h1>
      <p className="mt-2 text-zinc-600">
        Importe ton historique Garmin, superpose tes traces et compare tes
        performances.
      </p>
      <div className="mt-8 rounded-xl border bg-white p-6 shadow-sm">
        <p className="text-sm text-zinc-500">
          Dashboard — les dernières activités apparaîtront ici après le premier
          sync.
        </p>
      </div>
    </main>
  );
}
