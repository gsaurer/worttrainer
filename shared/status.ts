import { z } from 'zod'

export const buildInfoSchema = z.object({
  version: z.string().min(1),
  buildId: z.string().regex(/^[a-f0-9]{64}$/),
  commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).nullable(),
  dirty: z.boolean().nullable(),
  builtAt: z.iso.datetime(),
})

export type BuildInfo = z.infer<typeof buildInfoSchema>

export const serviceStatusSchema = z.object({
  status: z.literal('ok'),
  backend: buildInfoSchema,
  frontend: buildInfoSchema,
  startedAt: z.iso.datetime(),
  uptimeSeconds: z.number().int().nonnegative(),
})

export type ServiceStatus = z.infer<typeof serviceStatusSchema>