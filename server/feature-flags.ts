import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { z } from 'zod'

const nameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'Use lowercase letters, digits and hyphens, starting with a letter.')
const accountSchema = z.uuid().transform(value => value.toLowerCase())
const flagSchema = z.object({
  all: z.boolean().default(false),
  accounts: z.array(accountSchema).max(1000).default([]),
}).strict()
const fileSchema = z.object({ flags: z.record(nameSchema, flagSchema) }).strict()
type Flags = z.infer<typeof fileSchema>['flags']

const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT'

async function readFlags(file: string, known?: string): Promise<{ flags: Flags; version: string } | null> {
  let version = 'missing'
  try {
    const info = await stat(file)
    version = `${info.mtimeMs}:${info.size}`
  } catch (error) { if (!missing(error)) throw error }
  if (version === known) return null
  if (version === 'missing') return { flags: {}, version }
  try { return { flags: fileSchema.parse(JSON.parse(await readFile(file, 'utf8'))).flags, version } }
  catch (error) {
    const reason = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.') || 'file'}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid feature flags in ${file}: ${reason}`)
  }
}

/** Operator-edited flags beside the data file; the app never writes it and picks up edits without a restart. */
export class FeatureFlags {
  private checkedAt = 0
  private pending: Promise<void> | null = null
  private failed: string | null = null

  private constructor(private file: string, private flags: Flags, private version: string) {}

  static async open(dataFile: string) {
    const file = join(dirname(dataFile), `${basename(dataFile, extname(dataFile))}.feature-flags.json`)
    const loaded = await readFlags(file)
    return new FeatureFlags(file, loaded!.flags, loaded!.version)
  }

  /** Reloads when the file changed, at most once a second; an invalid edit keeps the last valid flags. */
  refresh(now = Date.now()): Promise<void> {
    if (this.pending) return this.pending
    if (now - this.checkedAt < 1000) return Promise.resolve()
    this.checkedAt = now
    this.pending = this.reload().finally(() => { this.pending = null })
    return this.pending
  }

  private async reload() {
    try {
      const loaded = await readFlags(this.file, this.version)
      if (loaded) { this.flags = loaded.flags; this.version = loaded.version }
      this.failed = null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.failed !== message) { this.failed = message; console.error(`${message}. Keeping the previous flags.`) }
    }
  }

  enabled(name: string, accountId: string): boolean {
    const flag = this.flags[name]
    if (!flag) return false
    return flag.all || flag.accounts.includes(accountId)
  }

  forAccount(accountId: string): string[] {
    return Object.keys(this.flags).filter(name => this.enabled(name, accountId)).sort()
  }
}
