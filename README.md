# Garmin Analysis

Web app perso pour analyser tes activités Garmin — course à pied en priorité : superposition de traces sur carte, comparatif de performances et évaluation des courses (PBs).

> Stack : **Next.js 14 + TypeScript + Prisma + Postgres** · Cartes **MapLibre GL (OSM)** · Graphs **ECharts** · Parsing FIT/GPX · Sync via lib non-officielle Garmin

## Fonctionnalités

- **Import historique** : backfill paginé Garmin (lib `garth/garminconnect` via `lib/garmin/*`) + upload manuel FIT/GPX/TCX (`/import` drag & drop, déduplication sur `garminId` + fenêtre 5 min / 1%)
- **Liste & dashboard** (`/`) : filtres type/date/distance, stats volume
- **Carte** (`/map`) : sélection 2–10 activités, polylines colorées MapLibre, profil d'élévation ECharts synchro (hover carte ↔ profil), détection segments partagés (Turf.js), export GPX, réglages opacité/tolérance
- **Comparaison** (`/compare`) : période 7j/30j/90j/1an/tout ou sélection manuelle, graphs allure/FC/cadence/puissance/élévation (axe allure inversé, crosshair synchro), tableau récap, courbe progression + volume hebdo + VMA estimée, lissage & normalisation distance
- **Courses** (`/races`) : détection auto `type=race` ou distance ±2% de 5K/10K/semi/marathon, PBs par distance, delta vs PB, sparkline, détail splits (allure/FC par km, comparaison vs PB) — score de forme ACWR prévu
- **Transverse** : chiffrement tokens Garmin AES-256-GCM (`GARMIN_TOKEN_KEY`), cron quotidien Vercel, gestion 429/503/P2002, rate-limit IP, 45 tests Vitest + 10 e2e Playwright

## Stack

`next 14.2` · `prisma 5.22` · `postgres` (Supabase/Neon ou Docker) · `maplibre-gl` · `echarts` + `echarts-for-react` · `@turf/turf` · `fit-file-parser` · `gpx-parser-builder` · `zod` · `vitest` · `@playwright/test`

## Prérequis

- Node 18+ / 20+ et npm
- Postgres : soit cloud (Supabase/Neon gratuit), soit local via Docker
- Un compte Garmin (login/mdp pour le sync)

## Démarrage rapide (local)

```bash
# 1. Cloner
git clone https://github.com/tderouze/Garmin.git
cd Garmin

# 2. Dépendances
npm install

# 3. Env
cp .env.example .env
# Édite .env (voir section Env ci-dessous) puis :
# génère une clé AES 32 bytes :
#   Windows: openssl rand -hex 32  (Git Bash) ou dans Node: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   mets le résultat dans GARMIN_TOKEN_KEY (64 hex chars)

# 4. Base de données
# Option A — Postgres local via Docker :
docker run --name garmin-postgres -e POSTGRES_USER=garmin -e POSTGRES_PASSWORD=garmin -e POSTGRES_DB=garmin -p 5432:5432 -d postgres:16
# puis dans .env : DATABASE_URL="postgresql://garmin:garmin@localhost:5432/garmin?schema=public"

# 5. Prisma
npm run prisma:generate
npx prisma migrate dev --name init   # crée les tables
# (optionnel) npx prisma db seed

# 6. Lancer
npm run dev
# ouvre http://localhost:3000
```

Autres commandes :

```bash
npm run build        # build prod + vérif types
npm start            # serveur prod (après build)
npm test             # vitest run (45 tests)
npm run test:watch   # vitest watch
npx tsc --noEmit     # type-check seul
npx playwright test          # e2e (nécessite `npm run build` + serveur)
npx playwright test --list   # liste 10 tests (map/compare/races)
```

## Env (.env)

Copie `.env.example` → `.env` :

```
DATABASE_URL="postgresql://USER:PASS@HOST:5432/garmin?schema=public"
GARMIN_TOKEN_KEY="64_hex_chars__32_bytes__generee_avec_openssl_rand_-hex_32"
NEXTAUTH_SECRET="random_secret_32+_chars"
NEXTAUTH_URL="http://localhost:3000"
CRON_SECRET="random_cron_secret"
MAPBOX_TOKEN=""  # optionnel — MapLibre + tuiles OSM par défaut
```

- `GARMIN_TOKEN_KEY` doit faire exactement **64 hex chars** (sinon `lib/crypto.ts` throw).
- `CRON_SECRET` protège `GET /api/cron/sync` (header `Authorization: Bearer …` ou `x-cron-secret`).
- En prod Vercel, renseigne les mêmes vars dans **Settings → Environment Variables**.

## Base de données

Schéma : `prisma/schema.prisma` — 8 modèles (`User`, `Activity`, `TrackPoint`, `Lap`, `Segment`, `SegmentEffort`, `PersonalRecord`, `SyncError`) + indexes `[userId, date]`, `[userId, type]`, unique `garminId`.

Migrations :

```bash
npx prisma migrate dev --name <nom>   # dev (crée + applique)
npx prisma migrate deploy             # prod (applique seulement)
npx prisma studio                     # UI pour inspecter la DB
```

Prisma Client singleton : `lib/prisma.ts`.

## Pages & API

| Page | Description |
|------|-------------|
| `/` | Dashboard — stats, `ActivityList` + `ActivityFilters` |
| `/map` | Superposition traces MapLibre + `ElevationProfile` + `lib/segments.ts` |
| `/compare` | Comparatif ECharts (`CompareCharts`, `lib/calculations.ts`) |
| `/races` | PBs + liste courses (`lib/personalRecords.ts`, `PersonalRecords`) |
| `/import` | Drag & drop FIT/GPX/TCX → `POST /api/import` |

| API | Méthode | Notes |
|-----|---------|-------|
| `/api/garmin/connect` | POST `{email, username, password}` | `GarminClient.login` → `encrypt` → `prisma.user.upsert` |
| `/api/sync/backfill` | POST `{userId, start, limit}` | `backfillBatch` paginé 100, 500 ms entre FIT, backoff 429, `SyncError` + `P2002` skip |
| `/api/sync/incremental` | POST `{userId}` | depuis `lastSyncAt` (`fromDate`) |
| `/api/cron/sync` | GET | Vercel Cron `0 6 * * *`, `CRON_SECRET`, `maxDuration 60` |
| `/api/activities` | GET `?type&from&to&limit&offset&userId` | filtres + `isDbUnavailableError` → 503 |
| `/api/activities/[id]` | GET | détail + `trackPoints`/`laps` |
| `/api/import` | POST multipart `file+userId` | FIT/GPX/TCX, 20 MB max, 400/409/413/429/503 |
| `/api/personal-records` | GET `?userId` | `computePBs` (503 en prod si DB down) |

Libs isolées : `lib/garmin/*` (wrapper Garmin), `lib/fit/*` (parsing/normalisation `computeAvgPace`/`splitByKm`), `lib/crypto.ts` (AES-GCM), `lib/ratelimit.ts` (10 req/60s/IP), `lib/errors.ts` (503/429 taxonomy).

## Déploiement Vercel

1. Push sur GitHub (`tderouze/Garmin`), importe le repo dans Vercel
2. Renseigne les env vars (DATABASE_URL Neon/Supabase, GARMIN_TOKEN_KEY, etc.)
3. `vercel.json` configure déjà :
   ```json
   { "crons": [{ "path": "/api/cron/sync", "schedule": "0 6 * * *" }],
     "functions": { "app/api/sync/backfill/**": { "maxDuration": 60 } } }
   ```
4. Vercel exécute `prisma generate` au build ; applique les migrations (`migrate deploy`) si besoin

## Dépannage

- **`.env` non chargé en tests** : `vitest.config.ts` fait `process.loadEnvFile()` ; sinon lance avec `GARMIN_TOKEN_KEY=… npx vitest run`
- **`P2002` unique `garminId`** : normal — import/sync concurrent → `skipped`, pas une erreur
- **`FIT corrompu / Invalid GPX`** → 400 (client), pas 500 ; voir `SyncError` table
- **Pas de GPS** → `hasGps=false`, carte masquée, métriques conservées
- **429 Garmin** → backoff 1s/2s/4s, `Retry-After` renvoyé

## Licence

Perso / usage privé. Libs Garmin non-officielles — casser peut suivre une MAJ côté Garmin (wrapper isolé pour fallback import manuel).
