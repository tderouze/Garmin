# Garmin Analysis — Design Spec

**Date:** 2026-09-04
**Approche retenue:** A — Monolithe Next.js fullstack (avec découpage interne progressif)
**Stack:** Next.js 14+ (App Router, TypeScript) + Postgres (Prisma + Supabase/Neon) + MapLibre GL + ECharts/Recharts + garth/garminconnect (lib non-officielle)
**Usage:** Perso, 1 utilisateur, import historique massif + sync continu

---

## 1. Vision & Objectifs

Web app d'analyse approfondie des activités Garmin, focalisée course à pied :
- superposer N traces GPS sur une carte et mettre en évidence les segments communs ;
- comparer les performances sur une période ou sur tout l'historique (allure, FC, dénivelé, cadence, puissance, etc.) ;
- évaluer les dernières courses (records perso, progression, forme).

Critère de succès V1 : importer tout l'historique Garmin, sélectionner 2–10 courses, les superposer sur carte + voir un comparatif graphique chiffré + consulter ses PBs.

Hors scope V1 : multi-utilisateurs, social/sharing, prédiction ML, coaching automatique, mobile natif.

---

## 2. Architecture Globale

```
[Garmin Connect] --(garth/garminconnect, login/mdp + OAuth tokens)--> [Next.js API Routes]
                                                                       |  ├─ /api/auth/garmin
                                                                       |  ├─ /api/sync (backfill + incremental)
                                                                       |  ├─ /api/activities/* 
                                                                       |  ├─ /api/import (upload FIT/GPX/TCX)
                                                                       |  └─ /api/cron/sync (Vercel Cron)
                                                                       |  ├─ FIT parser (fit-file-parser) → normalisation
                                                                       |  └─ Prisma → Postgres (Supabase/Neon)
                                                                       └─> [Frontend Next.js]
                                                                            ├─ / (dashboard)
                                                                            ├─ /map (superposition)
                                                                            ├─ /compare (comparatif)
                                                                            ├─ /races (évaluation courses)
                                                                            └─ /import
[Blob Storage (Vercel Blob / S3)] <-- FIT/GPX bruts (optionnel, pour re-parse)
```

- **Monolithe** : un repo, un déploiement Vercel, une DB.
- **Auth** : NextAuth (ou Auth.js) pour la session locale ; tokens Garmin chiffrés AES-256 en DB (colonne `encryptedGarminTokens`), jamais loggés.
- **Parsing FIT** : côté serveur uniquement, via `fit-file-parser` ou équivalent Node. Fallback GPX/TCX via `gpx-parser-builder`.
- **Cartes** : MapLibre GL JS, tuiles OSM par défaut, option Mapbox.
- **Graphs** : ECharts (comparatifs riches) ou Recharts (plus simple) — choix final à l'implémentation.
- **Jobs** : Vercel Cron quotidien (`/api/cron/sync`) + déclenchement manuel. Backfill initial en batches de 100 activités avec pagination.
- **Extensibilité** : si calculs avancés l'exigent, extraction future d'un worker Python (FastAPI) sans changer le contrat API.

---

## 3. Modèle de Données (Prisma / Postgres)

```prisma
model User {
  id                    String     @id @default(cuid())
  email                 String     @unique
  encryptedGarminTokens String?    // AES chiffré
  activities            Activity[]
  personalRecords       PersonalRecord[]
  createdAt             DateTime   @default(now())
}

model Activity {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  garminId        String   @unique
  type            String   // running, trail_running, race, etc.
  name            String?
  date            DateTime
  distance        Float    // mètres
  duration        Int      // secondes
  elevationGain   Float?
  avgPace         Float?   // sec/km
  avgHR           Int?
  maxHR           Int?
  avgCadence      Float?
  avgPower        Float?
  calories        Int?
  tss             Float?
  fileUrl         String?  // blob storage
  hasGps          Boolean  @default(true)
  user            User     @relation(...)
  trackPoints     TrackPoint[]
  laps            Lap[]
  segmentEfforts  SegmentEffort[]
  @@index([userId, date])
  @@index([userId, type])
}

model TrackPoint {
  id         String   @id @default(cuid())
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  lat        Float
  lng        Float
  ele        Float?
  time       DateTime
  hr         Int?
  cadence    Int?
  power      Float?
  speed      Float?   // m/s
  @@index([activityId, time])
  // Alternative si volume très élevé : stocker en JSONB sur Activity.trackData
}

model Lap {
  id         String @id @default(cuid())
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  idx        Int
  distance   Float
  duration   Int
  avgPace    Float?
  avgHR      Int?
  avgCadence Float?
}

model Segment {
  id             String @id @default(cuid())
  name           String
  polyline       String // encoded polyline
  startLat       Float
  startLng       Float
  endLat         Float
  endLng         Float
  segmentEfforts SegmentEffort[]
}

model SegmentEffort {
  id         String   @id @default(cuid())
  segmentId  String
  segment    Segment  @relation(fields: [segmentId], references: [id])
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  duration   Int
  date       DateTime
  @@unique([segmentId, activityId])
}

model PersonalRecord {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  distance   String   // "5K" | "10K" | "semi" | "marathon" | "custom"
  bestTime   Int      // secondes
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id])
  date       DateTime
  @@unique([userId, distance])
}
```

- `TrackPoint` : table normalisée par défaut ; si >10M points, migrer vers `Activity.trackData JSONB` + index GIN.
- Segments : d'abord détection de tronçons partagés côté client (overlap polyline avec tolérance), puis persistance des segments nommés si l'utilisateur les sauvegarde.

---

## 4. Sync Garmin & Import Historique

### 4.1 Auth Garmin (lib non-officielle)
- Librairie `garth` (Python) portée/adaptée en Node ou appelée via micro-process ; alternative `garminconnect` (JS). Choix final : package JS `garmin-connect` si disponible, sinon wrapper Node autour de `garth`.
- Flux : utilisateur saisit login/mdp Garmin → serveur échange contre OAuth1 + OAuth2 tokens → tokens chiffrés stockés. Refresh auto à chaque sync.
- Sécurité : chiffrement AES-256-GCM avec clé en env var `GARMIN_TOKEN_KEY`.

### 4.2 Backfill initial
- Endpoint `POST /api/sync/backfill` : pagination `start=0, limit=100`, boucle jusqu'à épuisement ou date limite.
- Pour chaque activité : `GET /activity/:id/details` + téléchargement FIT (`/download/:id`) → parse → normalise → upsert (déduplication sur `garminId`).
- UI : barre de progression (X / total), logs d'erreurs par activité, bouton pause/reprise.

### 4.3 Sync incrémental
- `GET /api/cron/sync` (Vercel Cron quotidien + bouton manuel) : récupère activités depuis `lastSyncAt`.
- Rate-limit : délai 500ms entre requêtes, backoff exponentiel sur 429.

### 4.4 Import manuel
- Page `/import` : drag & drop FIT/GPX/TCX, parsing côté serveur, création d'Activity sans `garminId` ou avec mapping si export Garmin.
- Détection doublon : hash du fichier + comparaison date/distance.

---

## 5. Carte & Superposition de Traces

**Route :** `/map`

- **Liste filtrable** (sidebar) : type (course / trail / race), plage de dates, distance min/max, recherche par nom. Pagination + tri par date. Checkbox multi-sélection (2–10 activités, limite configurable).
- **Carte MapLibre** :
  - Une polyline par activité, couleur distincte (palette accessible), opacité/épaisseur réglables.
  - Hover sur trace → tooltip (allure instantanée, FC, élévation, temps écoulé).
  - Segments communs : calcul d'overlap (buffer ~15m, algorithm simplifié côté client avec Turf.js) → surlignage en pointillés + badge "segment partagé (1.2 km)".
  - Contrôles : toggle OSM / satellite, centrer, fitBounds auto, export PNG (canvas) / GPX (concaténation).
- **Profil d'élévation synchronisé** : mini-graph sous la carte (ECharts), hover carte ↔ hover profil (ligne verticale).
- **États** : pas de GPS → message + fallback sur métriques seules ; 1 seule activité → vue détail classique.

---

## 6. Comparaison de Performances

**Route :** `/compare`

- **Sélection** : mêmes filtres que `/map` + sélecteur de période (7j / 30j / 90j / 1an / tout) OU sélection manuelle N activités.
- **Graphs superposés (ECharts)** :
  - Allure (min/km) vs distance ou vs temps — axe inversé (plus bas = plus rapide).
  - FC, cadence, puissance, élévation — chacun en graph dédié ou onglets, avec toggle.
  - Synchronisation du crosshair entre graphs.
- **Tableau récap** : par activité — distance, durée, allure moy, FC moy/max, cadence, D+, calories, TSS. Tri et surlignage du meilleur.
- **Courbe de progression** : allure moyenne au km sur la période, VMA estimée (formule Léger), volume hebdo (km).
- **Filtres** : lissage (moyenne glissante), normalisation par distance.

---

## 7. Évaluation des Dernières Courses

**Route :** `/races`

- **Détection courses** : `type == race` OU distance canonique (±2% de 5K/10K/semi/marathon) + tag manuel "course" possible.
- **PBs** : carte par distance avec meilleur temps, date, activité liée, delta vs précédent PB.
- **Liste courses** : tri chrono inverse, badge PB/new record, delta vs PB actuel, score de forme (ratio charge aiguë/chronique simplifié si données FC disponibles).
- **Tendance** : sparkline des temps sur chaque distance, indicateur progression/régression.
- **Détail course** : splits au km, allure/FC par split, comparaison vs PB.

---

## 8. Data Flow & Flux Global

```
Garmin Connect → (garth) → FIT brut → parse → normalise (unités SI) → Postgres
                                                          ↓
Upload FIT/GPX ────────────────────────────────────────────┘
                                                          ↓
                                              API Next.js (Prisma)
                                                          ↓
                                              Frontend (MapLibre + ECharts)
```

- Normalisation : allure en sec/km, FC en bpm, élévation en m, puissance en watts.
- Calculs dérivés côté serveur à l'ingestion : `avgPace = duration/distance`, splits au km, `hasGps = trackPoints.length > 0`.

---

## 9. Gestion d'Erreurs

| Cas | Comportement |
|-----|--------------|
| Tokens Garmin expirés | Refresh auto ; si échec → notif UI "Reconnecte Garmin" + lien /settings |
| Rate-limit Garmin (429) | Backoff exponentiel (1s, 2s, 4s), max 3 retries, log |
| FIT corrompu / incomplet | Skip activité, log en DB (`syncErrors`), poursuite du batch, affichage en UI |
| Pas de GPS | `hasGps=false`, carte masquée, métriques affichées normalement |
| Activité sans FC/puissance | Graphs concernés masqués ou en état vide explicite |
| DB indisponible | API renvoie 503, UI affiche retry |
| Upload fichier invalide | Validation Zod côté API, message d'erreur précis |

---

## 10. Tests & Qualité

- **Unitaires** (Vitest) : parsing FIT/GPX, calculs (allure, splits, overlap segments), chiffrement tokens.
- **Intégration** : sync Garmin mocké (MSW), import fichier, CRUD activités.
- **E2E** (Playwright) : connexion Garmin (mock), backfill, superposition 3 traces sur /map, comparatif sur /compare, affichage PBs sur /races.
- **Lint/format** : ESLint + Prettier, type-check strict TS.

---

## 11. Sécurité & Confidentialité

- Tokens Garmin chiffrés AES-256-GCM, clé hors repo (env var).
- Pas de log des tokens/mdp, masquage en debug.
- Validation d'entrée (Zod) sur tous les endpoints.
- Rate-limit sur /api/sync et /api/import.

---

## 12. Déploiement & Environnements

- **Hébergement** : Vercel (frontend + API + Cron) + Supabase ou Neon (Postgres) + Vercel Blob ou S3 (FIT bruts).
- **Env vars** : `DATABASE_URL`, `GARMIN_TOKEN_KEY`, `NEXTAUTH_SECRET`, `MAPBOX_TOKEN` (optionnel), `CRON_SECRET`.
- **Migrations** : Prisma Migrate, exécutées au build.
- **Observabilité** : logs Vercel + table `syncErrors` pour erreurs métier.

---

## 13. Phasage V1 (interne à l'approche A)

1. **Phase 1 — Fondations** : setup Next.js + Prisma + auth + sync Garmin (backfill + cron) + import manuel + liste activités.
2. **Phase 2 — Carte** : /map avec superposition, profil élévation, segments communs.
3. **Phase 3 — Analyse** : /compare + /races (PBs, progression).

Chaque phase est livrable et testable indépendamment.

---

## 14. Risques & Mitigations

- **Fragilité lib non-officielle** : Garmin peut casser l'API → wrapper isolé (`lib/garmin/*`) + fallback import manuel + tests de contrat.
- **Volume de points GPS** : risque perf → pagination trackPoints, simplification polyline (Douglas-Peucker) pour la carte, JSONB si besoin.
- **Quota Vercel** : backfill lourd → batch côté serveur avec streaming, pas de timeout fonction (maxDuration configuré).

---

*Spec validée section par section le 2026-09-04. Prochaine étape : writing-plans.*
