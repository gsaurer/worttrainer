import { randomBytes } from 'node:crypto'

export function setupConfiguration(env: NodeJS.ProcessEnv, now = Date.now()) {
  const configured = env.SETUP_TOKEN?.trim()
  if (configured) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(configured)) {
      throw new Error('SETUP_TOKEN must be a private random value with 32–128 letters, digits, underscores, or hyphens.')
    }
    return { setupToken: configured, setupExpiresAt: null }
  }
  return { setupToken: randomBytes(32).toString('base64url'), setupExpiresAt: now + 15 * 60 * 1000 }
}
