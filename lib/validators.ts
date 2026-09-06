import { z } from 'zod';

export const garminConnectSchema = z
  .object({
    email: z.string().email(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    tokenB64: z.string().min(10).optional(),
  })
  .refine((d) => (d.username && d.password) || d.tokenB64, {
    message: "Provide either username+password or tokenB64",
  });

export const garminTokenSchema = z.object({
  email: z.string().email(),
  tokenB64: z.string().min(10),
});

export const syncBackfillSchema = z.object({
  userId: z.string().cuid(),
  start: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20).default(10),
});

export const syncIncrementalSchema = z.object({
  userId: z.string().cuid(),
});

export const activitiesQuerySchema = z.object({
  type: z.string().optional(),
  from: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), { message: "Invalid 'from' date" }),
  to: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), { message: "Invalid 'to' date" }),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const importFileSchema = z.object({
  userId: z.string().cuid(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const activityFilterSchema = z.object({
  type: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  distanceMin: z.coerce.number().min(0).optional(),
  distanceMax: z.coerce.number().min(0).optional(),
});
