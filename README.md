# Garmin Analysis

Web app perso pour analyser tes activités Garmin — course à pied en priorité : superposition de traces sur carte, comparatif de performances et évaluation des courses (PBs).

> Stack : **Next.js 14 + TypeScript + Prisma + Postgres** · Cartes **MapLibre GL (OSM)** · Graphs **ECharts** · Parsing FIT/GPX · Sync via `garmin-connect@1.6.2`

## Fonctionnalités

- **Connexion Garmin** (`/settings`) : login/mdp → `POST /api/garmin/connect` (tokens `oauth1`/`oauth2` chiffrés AES-256-GCM via `lib/crypto.ts`, branchement réel `garmin-connect` dans `lib/garmin/client.ts:14`), puis sync
- **Import historique** : backfill paginé Garmin (`GarminConnect.getActivities` → `downloadFIT` via `lib/garmin/sync.ts:backfillBatch`, 100/batch, 500 ms, backoff 429, `SyncError`/`P2002` skip) + upload manuel FIT/GPX/TCX (`/import` drag & drop, déduplication sur `garminId` + fenêtre 5 min / 1%)
- **Liste & dashboard** (`/`) : filtres type/date/distance, stats volume
- **Carte** (`/map`) : sélection 2–10 activités, polylines colorées MapLibre, profil d'élévation ECharts synchro (hover carte ↔ profil), détection segments partagés (Turf.js), export GPX, réglages opacité/tolérance
- **Comparaison** (`/compare`) : période 7j/30j/90j/1an/tout ou sélection manuelle, graphs allure/FC/cadence/puissance/élévation (axe allure inversé, crosshair synchro), tableau récap, courbe progression + volume hebdo + VMA estimée, lissage & normalisation distance
- **Courses** (`/races`) : détection auto `type=race` ou distance ±2% de 5K/10K/semi/marathon, PBs par distance, delta vs PB, sparkline, détail splits (allure/FC par km, comparaison vs PB) — score de forme ACWR prévu
- **Transverse** : chiffrement tokens Garmin AES-256-GCM (`GARMIN_TOKEN_KEY`), cron quotidien Vercel, gestion 429/503/P2002, rate-limit IP, 45 tests Vitest + 10 e2e Playwright

## Stack

`next 14.2` · `prisma 5.22` · `postgres` (Supabase/Neon ou Docker/LXC Proxmox) · `garmin-connect@1.6.2` · `maplibre-gl` · `echarts` + `echarts-for-react` · `@turf/turf` · `fit-file-parser` · `gpx-parser-builder` · `zod` · `vitest` · `@playwright/test`

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

# 7. Connecter Garmin (première fois, sinon tu restes à 0 activités)
# Va sur http://localhost:3000/settings
# - Email local : ton email perso (ex: thi.derouze@gmail.com) — c'est le User.email en DB
# - Username + Password : ton compte connect.garmin.com
# - Clique "Se connecter à Garmin" → POST /api/garmin/connect (501 si MFA/locked, voir Dépannage)
# - Puis "Backfill 100" (clique plusieurs fois pour tout l'historique : 0→100→200…)
# - Alternative sans Garmin : importe des .FIT via http://localhost:3000/import
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

> **LXC Proxmox** (`192.168.1.41` / `db.derouze.ovh`) déjà supporté : mets `DATABASE_URL="postgresql://garmin:***@192.168.1.41:5432/garmin?schema=public"` (local) ou `db.derouze.ovh` (prod via port-forward/VPN) — voir `.env.example:1`. Le LXC doit avoir `listen_addresses='*'` + `pg_hba.conf` `host all all 192.168.1.0/24 scram-sha-256`.

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
| `/settings` | **Connecter Garmin** — form login/mdp + `Backfill 100` / `Sync incrémental` (tokens chiffrés, `lib/garmin/client.ts` + `garmin-connect`) |
| `/map` | Superposition traces MapLibre + `ElevationProfile` + `lib/segments.ts` |
| `/compare` | Comparatif ECharts (`CompareCharts`, `lib/calculations.ts`) |
| `/races` | PBs + liste courses (`lib/personalRecords.ts`, `PersonalRecords`) |
| `/import` | Drag & drop FIT/GPX/TCX → `POST /api/import` (fallback si Garmin casse) |

| API | Méthode | Notes |
|-----|---------|-------|
| `/api/garmin/connect` | POST `{email, username, password}` | `GarminConnect.login` (SSO Garmin, `garmin-connect@1.6.2`) → `exportToken {oauth1,oauth2}` → `encrypt` → `prisma.user.upsert` · `runtime nodejs` · 501 si MFA/locked |
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

- **Dashboard à 0 activités au premier lancement** : normal — va sur `/settings`, connecte Garmin puis `Backfill 100` (ou importe via `/import`)
- **`/api/garmin/connect` 501 `Not implemented`** : ancien stub — `git pull` (corrigé en `9a6e0f2`, maintenant `garmin-connect` réel)
- **MFA / 2FA Garmin** : `garmin-connect` ne gère pas le MFA → désactive temporairement le 2FA sur connect.garmin.com ou utilise un mot de passe d'app
- **Compte verrouillé** : vérifie sur connect.garmin.com, puis retente
- **Garmin SSO change** : lib non-officielle → fallback import manuel FIT
- **`.env` non chargé en tests** : `vitest.config.ts` fait `process.loadEnvFile()` ; sinon lance avec `GARMIN_TOKEN_KEY=… npx vitest run`
- **`P2002` unique `garminId`** : normal — import/sync concurrent → `skipped`, pas une erreur
- **`FIT corrompu / Invalid GPX`** → 400 (client), pas 500 ; voir `SyncError` table
- **Pas de GPS** → `hasGps=false`, carte masquée, métriques conservées
- **429 Garmin** → backoff 1s/2s/4s, `Retry-After` renvoyé

## Licence

Perso / usage privé. Libs Garmin non-officielles — casser peut suivre une MAJ côté Garmin (wrapper isolé pour fallback import manuel).
