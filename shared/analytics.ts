import { z } from 'zod'

export const umamiSchema = z.object({
  scriptUrl: z.url().refine(value => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  }, 'Use an HTTPS script URL without credentials, query parameters or a fragment.'),
  websiteId: z.uuid(),
}).strict()

export const analyticsSchema = z.object({ umami: umamiSchema.nullable() }).strict()
export type UmamiConfiguration = z.infer<typeof umamiSchema>

export function umamiConfiguration(env: Record<string, string | undefined>): UmamiConfiguration | undefined {
  const scriptUrl = env.UMAMI_SCRIPT_URL?.trim()
  const websiteId = env.UMAMI_WEBSITE_ID?.trim()
  if (!scriptUrl && !websiteId) return undefined
  const parsed = umamiSchema.safeParse({ scriptUrl, websiteId })
  if (!parsed.success) throw new Error('Configure both UMAMI_SCRIPT_URL (an HTTPS script URL) and UMAMI_WEBSITE_ID (a website UUID), or leave both empty to disable analytics.')
  return parsed.data
}