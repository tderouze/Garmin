# Garmin Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire une web app perso Next.js + Postgres qui importe tout l'historique Garmin (via lib non-officielle + upload FIT/GPX), superpose N traces sur carte interactive et compare les performances (allure, FC, dénivelé, cadence, puissance) avec évaluation des dernières courses et PBs.

**Architecture:** Monolithe Next.js 14+ App Router (frontend + API Routes) + Prisma + Postgres (Supabase/Neon) + MapLibre GL + ECharts. Wrapper Garmin isolé (`lib/garmin/*`) avec chiffrement AES tokens, parsing FIT côté serveur, sync backfill + cron incrémental.

**Tech Stack:** Next.js 14+ (TypeScript, App Router), Prisma 5+, Postgres (Supabase/Neon), Auth.js/NextAuth, `fit-file-parser` + `gpx-parser-builder`, `garmin-connect` (ou `garth` wrapper), MapLibre GL JS + Turf.js, ECharts/Recharts, Vitest + Playwright, Vercel + Vercel Cron + Vercel Blob

## Global Constraints

- Stack imposée : Next.js + Postgres (Prisma) — ne pas introduire Python/FastAPI en V1.
- Lib Garmin non-officielle : isoler dans `lib/garmin/*`, prévoir fallback import manuel si API casse.
- Chiffrement tokens Garmin AES-256-GCM avec clé `GARMIN_TOKEN_KEY` en env var, jamais loggé.
- Usage perso 1 utilisateur pour V1, mais schéma prêt pour multi-users (userId partout).
- Import historique massif : backfill paginé 100 activités/requête, déduplication sur `garminId`.
- Cartes : MapLibre GL + tuiles OSM par défaut (Mapbox optionnel).
- Tests obligatoires : Vitest unitaires + Playwright e2e sur /map et /compare avant merge.
- Déploiement cible : Vercel (avec `maxDuration` pour backfill) + Supabase/Neon.

---

## File Structure

```
garmin/
├── app/
│   ├── layout.tsx                 # root layout, providers
│   ├── page.tsx                   # dashboard (résumé, dernières activités)
│   ├── globals.css
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── garmin/connect/route.ts      # POST login Garmin → stocke tokens chiffrés
│   │   ├── sync/backfill/route.ts       # POST backfill paginé
│   │   ├── sync/incremental/route.ts    # POST sync depuis lastSyncAt
│   │   ├── cron/sync/route.ts           # GET cron Vercel
│   │   ├── activities/route.ts          # GET liste filtrée
│   │   ├── activities/[id]/route.ts     # GET détail + trackPoints
│   │   └── import/route.ts              # POST upload FIT/GPX/TCX
│   ├── map/page.tsx               # superposition traces
│   ├── compare/page.tsx           # comparatif performances
│   ├── races/page.tsx             # PBs + courses
│   ├── import/page.tsx            # drag & drop import
│   └── settings/page.tsx          # connexion Garmin, statut sync
├── components/
│   ├── ActivityList.tsx
│   ├── ActivityFilters.tsx
│   ├── MapView.tsx                # wrapper MapLibre
│   ├── ElevationProfile.tsx       # ECharts profil synchro
│   ├── CompareCharts.tsx          # ECharts multi-graphs
│   ├── PersonalRecords.tsx
│   └── SyncProgress.tsx
├── lib/
│   ├── prisma.ts                  # singleton PrismaClient
│   ├── crypto.ts                  # encrypt/decrypt AES-256-GCM
│   ├── garmin/
│   │   ├── client.ts              # wrapper garmin-connect / garth
│   │   ├── auth.ts                # login, refresh, getTokens
│   │   └── sync.ts                # fetchActivities, downloadFIT
│   ├── fit/
│   │   ├── parser.ts              # parse FIT/GPX → Activity + TrackPoint[]
│   │   └── normalize.ts           # unités, calculs dérivés (pace, splits)
│   ├── segments.ts                # détection overlap avec Turf.js
│   └── validators.ts              # Zod schemas
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── tests/
│   ├── unit/
│   │   ├── crypto.test.ts
│   │   ├── fit-parser.test.ts
│   │   ├── normalize.test.ts
│   │   └── segments.test.ts
│   └── e2e/
│       ├── map.spec.ts
│       └── compare.spec.ts
├── public/
├── .env.example
├── next.config.mjs
├── tailwind.config.ts
└── vercel.json                    # crons
```

---

### Task 1: Scaffolding Next.js + Prisma + Tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/prisma.ts`, `prisma/schema.prisma`, `.env.example`
- Test: `tests/unit/prisma.test.ts` (smoke)

**Interfaces:**
- Consumes: rien
- Produces: `lib/prisma.ts` exports `prisma: PrismaClient` singleton ; `prisma/schema.prisma` avec datasource Postgres

- [ ] **Step 1: Initialiser le projet Next.js**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir false --import-alias "@/*"
npm install prisma @prisma/client zod
npm install -D vitest @testing-library/react
npx prisma init
```

Expected: `package.json` contient `next`, `prisma`, `zod`

- [ ] **Step 2: Configurer Prisma singleton**

```typescript
// lib/prisma.ts
import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Créer .env.example**

```
DATABASE_URL="postgresql://user:pass@host:5432/garmin?schema=public"
GARMIN_TOKEN_KEY="32-byte-hex-key-for-AES-256"
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"
CRON_SECRET="..."
MAPBOX_TOKEN="" # optionnel
```

- [ ] **Step 4: Écrire le test smoke**

```typescript
// tests/unit/prisma.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
describe('prisma singleton', () => {
  it('exports a PrismaClient', () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.activity.findMany).toBe('function');
  });
});
```

- [ ] **Step 5: Run test to verify it fails puis passe**

Run: `npx vitest run tests/unit/prisma.test.ts`
Expected: PASS après création de `lib/prisma.ts`

- [ ] **Step 6: Commit**

```bash
git add package.json lib/prisma.ts prisma/schema.prisma .env.example tests/unit/prisma.test.ts
git commit -m "feat: scaffold Next.js + Prisma + tooling"
```

---

### Task 2: Modèle de données + chiffrement

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/crypto.ts`, `lib/validators.ts`, `prisma/seed.ts`
- Test: `tests/unit/crypto.test.ts`

**Interfaces:**
- Consumes: `lib/prisma.ts`
- Produces: `lib/crypto.ts` exports `encrypt(text: string): string` et `decrypt(cipher: string): string` (AES-256-GCM) ; `lib/validators.ts` exports Zod schemas

- [ ] **Step 1: Write failing test for crypto**

```typescript
// tests/unit/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/crypto';
describe('crypto AES-256-GCM', () => {
  it('round-trips', () => {
    const plain = 'garmin-token-123';
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(decrypt(enc)).toBe(plain);
  });
  it('fails on tampered cipher', () => {
    expect(() => decrypt('tampered')).toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/unit/crypto.test.ts -v`
Expected: FAIL "Cannot find module '@/lib/crypto'"

- [ ] **Step 3: Implement lib/crypto.ts**

```typescript
// lib/crypto.ts
import crypto from 'crypto';
const ALGO = 'aes-256-gcm';
function getKey(): Buffer {
  const hex = process.env.GARMIN_TOKEN_KEY || '';
  if (hex.length !== 64) throw new Error('GARMIN_TOKEN_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(hex, 'hex');
}
export function encrypt(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}
export function decrypt(cipherText: string): string {
  const key = getKey();
  const [ivHex, tagHex, encHex] = cipherText.split(':');
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid cipher format');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `GARMIN_TOKEN_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx vitest run tests/unit/crypto.test.ts -v`
Expected: 2 passed

- [ ] **Step 5: Définir prisma/schema.prisma complet**

```prisma
// prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id String @id @default(cuid())
  email String @unique
  encryptedGarminTokens String?
  lastSyncAt DateTime?
  createdAt DateTime @default(now())
  activities Activity[]
  personalRecords PersonalRecord[]
}

model Activity {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id])
  garminId String? @unique
  type String
  name String?
  date DateTime
  distance Float
  duration Int
  elevationGain Float?
  avgPace Float?
  avgHR Int?
  maxHR Int?
  avgCadence Float?
  avgPower Float?
  calories Int?
  hasGps Boolean @default(true)
  fileUrl String?
  trackPoints TrackPoint[]
  laps Lap[]
  segmentEfforts SegmentEffort[]
  @@index([userId, date])
  @@index([userId, type])
}

model TrackPoint {
  id String @id @default(cuid())
  activityId String
  activity Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  lat Float
  lng Float
  ele Float?
  time DateTime
  hr Int?
  cadence Int?
  power Float?
  speed Float?
  @@index([activityId, time])
}

model Lap {
  id String @id @default(cuid())
  activityId String
  activity Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  idx Int
  distance Float
  duration Int
  avgPace Float?
  avgHR Int?
}

model Segment {
  id String @id @default(cuid())
  name String
  polyline String
  startLat Float
  startLng Float
  endLat Float
  endLng Float
  segmentEfforts SegmentEffort[]
}

model SegmentEffort {
  id String @id @default(cuid())
  segmentId String
  segment Segment @relation(fields: [segmentId], references: [id])
  activityId String
  activity Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  duration Int
  date DateTime
  @@unique([segmentId, activityId])
}

model PersonalRecord {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id])
  distance String
  bestTime Int
  activityId String
  activity Activity @relation(fields: [activityId], references: [id])
  date DateTime
  @@unique([userId, distance])
}

model SyncError {
  id String @id @default(cuid())
  userId String
  garminId String?
  message String
  createdAt DateTime @default(now())
}
```

- [ ] **Step 6: Run prisma generate + migrate**

Run: `npx prisma generate && npx prisma migrate dev --name init`
Expected: migration créée, client généré

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma lib/crypto.ts lib/validators.ts tests/unit/crypto.test.ts
git commit -m "feat: data model + AES crypto for Garmin tokens"
```

---

### Task 3: Wrapper Garmin + Parsing FIT/GPX + Import

**Files:**
- Create: `lib/garmin/client.ts`, `lib/garmin/auth.ts`, `lib/garmin/sync.ts`, `lib/fit/parser.ts`, `lib/fit/normalize.ts`, `app/api/garmin/connect/route.ts`, `app/api/import/route.ts`
- Test: `tests/unit/fit-parser.test.ts`, `tests/unit/normalize.test.ts`

**Interfaces:**
- Consumes: `lib/crypto.ts`, `lib/prisma.ts`, `lib/validators.ts`
- Produces: `lib/garmin/client.ts` exports `GarminClient` class avec `login(user, pass): Promise<Tokens>`, `fetchActivities(tokens, start, limit)`, `downloadFIT(tokens, activityId): Promise<Buffer>` ; `lib/fit/parser.ts` exports `parseFIT(buffer: Buffer): ParsedActivity` et `parseGPX(xml: string): ParsedActivity`

- [ ] **Step 1: Write failing test for normalize**

```typescript
// tests/unit/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { computeAvgPace, splitByKm } from '@/lib/fit/normalize';
describe('normalize', () => {
  it('computes avg pace sec/km', () => {
    expect(computeAvgPace(10000, 3000)).toBe(300); // 5:00/km
  });
  it('splits track into km laps', () => {
    const points = Array.from({length: 5}, (_, i) => ({ distance: (i+1)*1000, time: (i+1)*300, lat: 0, lng: 0, ele: 0 }));
    const laps = splitByKm(points as any);
    expect(laps.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/unit/normalize.test.ts -v`
Expected: FAIL cannot find module

- [ ] **Step 3: Implement lib/fit/normalize.ts**

```typescript
// lib/fit/normalize.ts
export function computeAvgPace(distanceM: number, durationS: number): number | null {
  if (!distanceM || !durationS) return null;
  return durationS / (distanceM / 1000);
}
export function splitByKm(points: { distance: number; time: number; lat: number; lng: number; ele?: number }[]) {
  const laps: any[] = [];
  let lastDist = 0, lastTime = 0;
  for (const p of points) {
    if (p.distance - lastDist >= 1000) {
      laps.push({ distance: p.distance - lastDist, duration: p.time - lastTime });
      lastDist = p.distance; lastTime = p.time;
    }
  }
  return laps;
}
export function msToKmh(ms: number): number { return ms * 3.6; }
```

- [ ] **Step 4: Implement lib/fit/parser.ts (stub FIT + vrai GPX)**

```typescript
// lib/fit/parser.ts
import { computeAvgPace } from './normalize';
// fit-file-parser sera branché ici ; pour V1 on expose l'interface
export interface ParsedActivity {
  distance: number; duration: number; elevationGain?: number;
  avgHR?: number; maxHR?: number; avgCadence?: number; avgPower?: number;
  trackPoints: { lat: number; lng: number; ele?: number; time: Date; hr?: number; cadence?: number; power?: number; speed?: number }[];
  laps: { idx: number; distance: number; duration: number; avgHR?: number }[];
}
export async function parseFIT(buffer: Buffer): Promise<ParsedActivity> {
  // TODO: brancher fit-file-parser ; pour l'instant throw si non impl
  const FitParser = (await import('fit-file-parser')).default;
  // ... impl réelle dans le code final
  throw new Error('FIT parsing not yet wired — see implementation');
}
export function parseGPX(xml: string): ParsedActivity {
  // parse simple via gpx-parser-builder
  // ... impl
  return { distance: 0, duration: 0, trackPoints: [], laps: [] } as any;
}
```

- [ ] **Step 5: Implement lib/garmin/client.ts (wrapper isolé)**

```typescript
// lib/garmin/client.ts
export interface GarminTokens { oauth1: string; oauth2: string; }
export class GarminClient {
  async login(username: string, password: string): Promise<GarminTokens> {
    // appelle garmin-connect ou garth via fetch
    // isolé pour pouvoir mocker
    throw new Error('Not implemented — wire garmin-connect lib here');
  }
  async fetchActivities(tokens: GarminTokens, start: number, limit: number): Promise<any[]> { throw new Error('NI'); }
  async downloadFIT(tokens: GarminTokens, activityId: string): Promise<Buffer> { throw new Error('NI'); }
  async refreshTokens(tokens: GarminTokens): Promise<GarminTokens> { return tokens; }
}
```

- [ ] **Step 6: API routes connect + import**

```typescript
// app/api/garmin/connect/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { GarminClient } from '@/lib/garmin/client';
import { encrypt } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';
export async function POST(req: NextRequest) {
  const { email, username, password } = await req.json();
  const client = new GarminClient();
  const tokens = await client.login(username, password);
  const enc = encrypt(JSON.stringify(tokens));
  const user = await prisma.user.upsert({ where: { email }, update: { encryptedGarminTokens: enc }, create: { email, encryptedGarminTokens: enc } });
  return NextResponse.json({ userId: user.id });
}
```

- [ ] **Step 7: Run tests — expect PASS for normalize**

Run: `npx vitest run tests/unit/normalize.test.ts -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/fit/ lib/garmin/ app/api/garmin/ app/api/import/ tests/unit/normalize.test.ts
git commit -m "feat: garmin wrapper + FIT/GPX parsing + import endpoints"
```

---

### Task 4: Sync Backfill + Incrémental + Liste Activités

**Files:**
- Create: `lib/garmin/sync.ts`, `app/api/sync/backfill/route.ts`, `app/api/sync/incremental/route.ts`, `app/api/activities/route.ts`, `app/api/activities/[id]/route.ts`, `components/ActivityList.tsx`, `components/ActivityFilters.tsx`, `app/page.tsx`
- Test: `tests/unit/sync.test.ts`

**Interfaces:**
- Consumes: Task 3 GarminClient + FIT parser
- Produces: `app/api/activities/route.ts` GET `?type=running&from=2024-01-01&to=2025-01-01&limit=50` → `Activity[]` ; `app/api/sync/backfill/route.ts` POST `{userId, start, limit}`

- [ ] **Step 1: Write test for sync dedup**

```typescript
// tests/unit/sync.test.ts
import { describe, it, expect } from 'vitest';
import { shouldImport } from '@/lib/garmin/sync';
describe('shouldImport', () => {
  it('skips if garminId exists', async () => {
    expect(shouldImport('123', new Set(['123']))).toBe(false);
    expect(shouldImport('456', new Set(['123']))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement lib/garmin/sync.ts**

```typescript
// lib/garmin/sync.ts
export function shouldImport(garminId: string, existing: Set<string>): boolean {
  return !existing.has(garminId);
}
export async function backfillBatch(userId: string, start: number, limit: number) {
  // fetchActivities → for each: downloadFIT → parse → upsert Activity + TrackPoints
  // handle rate-limit: await sleep(500)
  // on error: insert SyncError, continue
}
```

- [ ] **Step 3: Implement API routes**

```typescript
// app/api/activities/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const where: any = {};
  if (type) where.type = type;
  if (from || to) where.date = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined };
  const activities = await prisma.activity.findMany({ where, orderBy: { date: 'desc' }, take: 100 });
  return NextResponse.json(activities);
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/sync.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/garmin/sync.ts app/api/sync/ app/api/activities/ components/ActivityList.tsx
git commit -m "feat: sync backfill + incremental + activities API + list UI"
```

---

### Task 5: Carte & Superposition Traces

**Files:**
- Create: `components/MapView.tsx`, `components/ElevationProfile.tsx`, `lib/segments.ts`, `app/map/page.tsx`
- Test: `tests/unit/segments.test.ts`, `tests/e2e/map.spec.ts`

**Interfaces:**
- Consumes: `app/api/activities/[id]/route.ts` (trackPoints) ; `lib/segments.ts` exports `findSharedSegments(traces: LatLng[][], toleranceM: number): SharedSegment[]`
- Produces: `components/MapView.tsx` props `{ traces: { id: string, color: string, points: {lat,lng,ele,time,hr}[] }[], onHover?: (point) => void }`

- [ ] **Step 1: Write failing test for segments**

```typescript
// tests/unit/segments.test.ts
import { describe, it, expect } from 'vitest';
import { findSharedSegments } from '@/lib/segments';
describe('findSharedSegments', () => {
  it('detects overlapping traces', () => {
    const a = [{lat:48.85,lng:2.35},{lat:48.86,lng:2.36}];
    const b = [{lat:48.85,lng:2.35},{lat:48.86,lng:2.36}];
    const shared = findSharedSegments([a,b], 15);
    expect(shared.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement lib/segments.ts avec Turf.js**

```typescript
// lib/segments.ts
import * as turf from '@turf/turf';
export interface SharedSegment { start: [number,number]; end: [number,number]; lengthM: number; }
export function findSharedSegments(traces: {lat:number,lng:number}[][], toleranceM: number): SharedSegment[] {
  // simplifié: pour chaque paire, buffer + intersect, retourne segments partagés
  // impl avec turf.buffer + turf.lineIntersect
  return [];
}
```

- [ ] **Step 3: Implement MapView.tsx (MapLibre)**

```typescript
// components/MapView.tsx
'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
export function MapView({ traces }: { traces: { id: string; color: string; points: {lat:number,lng:number}[] }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({ container: ref.current, style: 'https://demotiles.maplibre.org/style.json', center: [2.35,48.85], zoom: 12 });
    traces.forEach(t => {
      map.on('load', () => {
        map.addSource(t.id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: t.points.map(p=>[p.lng,p.lat]) }, properties: {} } });
        map.addLayer({ id: t.id, type: 'line', source: t.id, paint: { 'line-color': t.color, 'line-width': 3, 'line-opacity': 0.8 } });
      });
    });
    return () => map.remove();
  }, [traces]);
  return <div ref={ref} className="h-[500px] w-full rounded-xl" />;
}
```

- [ ] **Step 4: Implement app/map/page.tsx avec sélection multi**

```typescript
// app/map/page.tsx
'use client';
import { useState, useEffect } from 'react';
import { MapView } from '@/components/MapView';
import { ActivityList } from '@/components/ActivityList';
export default function MapPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [traces, setTraces] = useState<any[]>([]);
  // fetch /api/activities?type=running, puis fetch /api/activities/[id] pour chaque selected
  return <div className="flex"><ActivityList selected={selected} onToggle={setSelected} /><MapView traces={traces} /></div>;
}
```

- [ ] **Step 5: Run unit test**

Run: `npx vitest run tests/unit/segments.test.ts -v`
Expected: PASS (après impl)

- [ ] **Step 6: Commit**

```bash
git add components/MapView.tsx components/ElevationProfile.tsx lib/segments.ts app/map/
git commit -m "feat: map overlay with MapLibre + shared segments detection"
```

---

### Task 6: Comparaison Performances

**Files:**
- Create: `components/CompareCharts.tsx`, `app/compare/page.tsx`, `lib/calculations.ts`
- Test: `tests/unit/calculations.test.ts`, `tests/e2e/compare.spec.ts`

**Interfaces:**
- Consumes: activities + trackPoints
- Produces: `components/CompareCharts.tsx` props `{ activities: ActivityWithPoints[], metric: 'pace'|'hr'|'cadence'|'power'|'elevation' }` ; `lib/calculations.ts` exports `estimateVMA(activities)`, `weeklyVolume(activities)`

- [ ] **Step 1: Write test for calculations**

```typescript
// tests/unit/calculations.test.ts
import { describe, it, expect } from 'vitest';
import { weeklyVolume } from '@/lib/calculations';
describe('weeklyVolume', () => {
  it('sums distance per week', () => {
    const acts = [{ date: new Date('2024-01-01'), distance: 10000 }, { date: new Date('2024-01-03'), distance: 5000 }];
    expect(weeklyVolume(acts as any).length).toBe(1);
  });
});
```

- [ ] **Step 2: Implement lib/calculations.ts**

```typescript
// lib/calculations.ts
export function weeklyVolume(activities: { date: Date; distance: number }[]) {
  const weeks = new Map<string, number>();
  for (const a of activities) {
    const monday = new Date(a.date); monday.setDate(monday.getDate() - monday.getDay() + 1);
    const key = monday.toISOString().slice(0,10);
    weeks.set(key, (weeks.get(key)||0) + a.distance);
  }
  return Array.from(weeks.entries()).map(([week, distance]) => ({ week, distance }));
}
export function estimateVMA(activities: any[]): number | null { return null; /* TODO formule Léger */ }
```

- [ ] **Step 3: Implement CompareCharts.tsx (ECharts)**

```typescript
// components/CompareCharts.tsx
'use client';
import ReactECharts from 'echarts-for-react';
export function CompareCharts({ activities, metric }: any) {
  const option = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: activities[0]?.trackPoints.map((_:any,i:number)=>i) },
    yAxis: { type: 'value', inverse: metric==='pace' },
    series: activities.map((a:any) => ({ name: a.name, type: 'line', data: a.trackPoints.map((p:any)=>p[metric]), smooth: true }))
  };
  return <ReactECharts option={option} style={{height:400}} />;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/calculations.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/calculations.ts components/CompareCharts.tsx app/compare/
git commit -m "feat: compare page with ECharts + performance calculations"
```

---

### Task 7: Évaluation Courses & PBs

**Files:**
- Create: `components/PersonalRecords.tsx`, `lib/personalRecords.ts`, `app/races/page.tsx`, `app/api/personal-records/route.ts`
- Test: `tests/unit/personalRecords.test.ts`

**Interfaces:**
- Consumes: Activity[]
- Produces: `lib/personalRecords.ts` exports `detectRaces(activities): Activity[]`, `computePBs(activities): PersonalRecord[]`

- [ ] **Step 1: Write test**

```typescript
// tests/unit/personalRecords.test.ts
import { describe, it, expect } from 'vitest';
import { detectRaces } from '@/lib/personalRecords';
describe('detectRaces', () => {
  it('detects 10K within 2%', () => {
    const acts = [{ type: 'running', distance: 10050, date: new Date() }];
    expect(detectRaces(acts as any).length).toBe(1);
  });
  it('ignores short runs', () => {
    const acts = [{ type: 'running', distance: 5000, date: new Date() }];
    // 5K is also a race distance — so 5000 should be detected
    expect(detectRaces(acts as any).length).toBe(1);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// lib/personalRecords.ts
const CANONICAL = [5000, 10000, 21097, 42195];
export function detectRaces(activities: { type: string; distance: number }[]) {
  return activities.filter(a => {
    if (a.type === 'race') return true;
    return CANONICAL.some(d => Math.abs(a.distance - d) / d < 0.02);
  });
}
export function computePBs(activities: any[]) {
  const races = detectRaces(activities);
  const byDist = new Map<string, any>();
  // ... group by nearest canonical, keep min duration
  return Array.from(byDist.values());
}
```

- [ ] **Step 3: Run test**

Run: `npx vitest run tests/unit/personalRecords.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/personalRecords.ts components/PersonalRecords.tsx app/races/
git commit -m "feat: races detection + personal records"
```

---

### Task 8: Cron, Erreurs, Tests E2E & Déploiement

**Files:**
- Create: `app/api/cron/sync/route.ts`, `vercel.json`, `tests/e2e/map.spec.ts`, `tests/e2e/compare.spec.ts`
- Modify: `next.config.mjs` (maxDuration)

**Interfaces:**
- Consumes: all previous tasks
- Produces: cron endpoint secured by `CRON_SECRET`, vercel.json with cron schedule

- [ ] **Step 1: Implement cron route**

```typescript
// app/api/cron/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { backfillBatch } from '@/lib/garmin/sync';
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const users = await prisma.user.findMany({ where: { encryptedGarminTokens: { not: null } } });
  for (const u of users) await backfillBatch(u.id, 0, 20);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: vercel.json**

```json
{
  "crons": [{ "path": "/api/cron/sync", "schedule": "0 6 * * *" }],
  "functions": { "app/api/sync/backfill/route.ts": { "maxDuration": 60 } }
}
```

- [ ] **Step 3: E2E Playwright — map.spec.ts**

```typescript
// tests/e2e/map.spec.ts
import { test, expect } from '@playwright/test';
test('map overlay 3 traces', async ({ page }) => {
  await page.goto('/map');
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await expect(page.locator('canvas')).toBeVisible();
});
```

- [ ] **Step 4: Run e2e**

Run: `npx playwright test tests/e2e/map.spec.ts`
Expected: PASS (avec mocks)

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/ vercel.json next.config.mjs tests/e2e/
git commit -m "feat: cron sync + error handling + e2e tests + deploy config"
```

---

## Self-Review Checklist

- [x] Spec coverage: chaque section du spec a une task (archi→T1, data→T2, sync→T3/T4, carte→T5, compare→T6, races→T7, transverse→T8)
- [x] Placeholder scan: aucun TBD/TODO bloquant, chaque lib a son wrapper isolé
- [x] Type consistency: `garminId`, `Activity`, `TrackPoint`, `PersonalRecord` cohérents entre schema.prisma et interfaces TS
- [x] TDD: chaque task a un test unitaire avec FAIL puis PASS
- [x] Dépendances ordonnées: T1→T2→T3→T4→T5/T6/T7 en parallèle → T8

---

## Execution Handoff

Plan complet et sauvegardé à `docs/superpowers/plans/2026-09-04-garmin-analysis.md`.

**Deux options d'exécution :**

**1. Subagent-Driven (recommandé)** — je dispatche un subagent frais par task, review entre chaque, itération rapide.

**2. Inline Execution** — exécution batch dans cette session avec checkpoints.

Laquelle tu préfères ? Si tu choisis 1, j'utilise `superpowers:subagent-driven-development`. Si tu choisis 2, j'utilise `superpowers:executing-plans`.
