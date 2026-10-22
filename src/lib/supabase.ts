import { createClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function validConfig() {
  if (!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_')) return false
  if (key.startsWith('sb_secret_')) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  } catch {
    return false
  }
}

export const supabase = validConfig() && url && key
  ? createClient<Database>(url, key, {
      auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
    })
  : null
