# Worttrainer

A private family spelling workshop: German and English word collections, spoken
word dictation, paper answers, and parent-marked progress synced to a parent account.
React + TypeScript + Vite, with Supabase Auth and PostgreSQL. No child profile,
handwriting upload, typed-answer checking, analytics, or sentence dictation.

## Start locally

Requires Node.js 22.12+ and npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open **http://localhost:5173** (or the URL Vite prints). Without a configured
Supabase connection, the app shows its real welcome interface with a clear
setup notice and disabled sign-in. This is a visual preview, not mock
authentication or simulated persistence. Follow the next section to use it.

## Connect real authentication and storage

1. Create a Supabase project in an account you control. Do not put database
   passwords or service-role/secret keys in the frontend, repository, or chat.
2. Run `supabase/migrations/202610220001_initial_words.sql` in the project's SQL
   Editor, or use the Supabase CLI (`supabase link --project-ref YOUR_REF`, then
   `supabase db push`). The migration creates tables, ownership policies, restricted
   grants, and the atomic practice function. Do not just create empty tables.
3. In `.env.local`, set `VITE_SUPABASE_URL` to the project URL and
   `VITE_SUPABASE_PUBLISHABLE_KEY` to its **publishable key** (or legacy **anon**
   key). These two values are public client configuration; database authorization
   is enforced by row-level security, not by hiding this key.
4. In Supabase **Authentication → URL Configuration**, allow
   `http://localhost:5173` and `http://127.0.0.1:5173` as redirect URLs. Set the Site
   URL to your actual production URL when deployed. Add the exact local origin
   if you use a different port. Avoid broad production redirect wildcards.
5. Enable the email provider and email signups. Keep email confirmations on.
   The default magic-link email template works. For reliable real-family use,
   configure custom SMTP; Supabase's built-in sender has recipient restrictions
   and tight rate limits. For a closed family installation, invite the parent's
   email first, then disable new signups in Supabase.
6. Restart the dev server after changing environment values. Enter the parent's
   email, request a link, and open the email link in **the same browser** where it
   was requested (PKCE). Sign in separately on each device with the same parent
   account to share its collection. Separate accounts have separate collections.

**Required external setup:** a Supabase project with the migration applied,
email delivery configured, allowed redirect URLs, and the two public environment
values. Until configured, real login and cross-device operation are unavailable.
This repository does not provision a hosted database or deploy a site automatically.

### Optional fully local backend

With Docker and the Supabase CLI installed, run `supabase start` in this directory,
then `supabase db reset` to apply the migration to the local stack. Use the local
API URL and anon key printed by `supabase status` for `.env.local`. The local
mail viewer is at `http://localhost:54324`. Do not use `db reset` against a
database with data you want to keep. A local-only backend is useful for development
but does **not** provide internet-accessible multi-device sync.

## Practice together

1. Add the **correct spelling** of a tricky word and choose Deutsch or English.
   Duplicate words in the same language are rejected (case-insensitive).
2. Open **Let's practice**, choose a language and category, and begin a shuffled
   round. Each matching word appears once. End early whenever you like.
3. Tap **Listen**. The word is concealed, including from the page's accessibility
   tree, until the parent explicitly reveals it. The child writes on paper.
4. Reveal for checking, then mark **Spelled correctly** or **Not quite yet**.
   Advance only after the server confirms the save. A failed/uncertain save can
   be retried with the same attempt ID without counting it twice.

| Practice result | Category and consecutive-mistake count |
| --- | --- |
| Newly added word | New, 0 (adding is not a practice attempt) |
| Any correct answer | +, reset count to 0 |
| First consecutive incorrect answer | Keep current category, count 1 (including if currently +) |
| Second consecutive incorrect answer | −, count 2 |
| More incorrect answers while in − | Remain −, count stays at 2 |

Words and outcomes live in PostgreSQL. The collection refreshes after mutations,
when the page regains focus, and every 30 seconds while visible; **Sync** refreshes
manually. An active practice round is a snapshot, but each mark applies atomically
to current server progress. Two devices' distinct answers are serialized by a row
lock, in the order the server receives them. Retrying an already-saved attempt
never reapplies it. A deleted word cannot receive more marks.

### Speech support

Uses the browser's Web Speech API, with a German or English voice selected to
match each word. Locally installed voices are preferred. Enable the corresponding
language speech packs in your device settings. If no matching voice is available,
the app reports it instead of falling back to the wrong language. Listen is a
deliberate tap for mobile compatibility; playback stops on reveal, navigation,
or hiding the page. Chrome, Edge, and Safari support varies by OS and installed
voices. Real-device listening is still necessary to check pronunciation and audio.
Some browser speech voices send text to the platform's online speech provider.

## Privacy and data lifecycle

Only a parent's auth email, entered words, language, categories, and practice
outcomes are stored. There are no child names, ages, photos, handwriting,
microphone recordings, or third-party analytics. Supabase Auth persists the login
session in browser storage; word/progress persistence is server-side. Use **Sign
out** on shared devices; it signs out this device, not all other devices.

Deleting a word deletes its attempt history. For complete account/data deletion,
delete the auth user in the Supabase dashboard; foreign keys cascade to all owned
data. The frontend intentionally cannot assign ownership or directly edit
progress. Read/delete policies isolate accounts; only the authorized
`record_practice` function can write outcomes. Browser speech providers and the
Google Fonts stylesheet have their own network/privacy behavior; system/Georgia
font fallbacks keep the app usable when fonts cannot load.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Tests cover concealed/revealed dictation, parent marking, idempotent client retries,
speech errors, email-link requests, setup state, and word validation. Database
tests execute the actual migration against an embedded PostgreSQL engine with
test-only auth scaffolding to exercise category transitions, grants, isolation,
and duplicate attempts. They do not replace checking the hosted project's
email delivery, redirect configuration, or installed device voices.

## Deployment

Build with `npm ci && npm run build`, then serve `dist` on any static HTTPS host
(for example Cloudflare Pages, Netlify, or Vercel; build command `npm run build`,
output `dist`). Set both `VITE_SUPABASE_*` variables in that host's build
environment before building. Allow the final origin in Supabase auth redirects.
The app uses a single root URL, so no client-route rewrite is required. Never
deploy the Vite development server as production hosting.

Smoke-check the deployed app with two different parent accounts (private lists),
then the same account on two devices (synced progress). Test German and English
Listen → Reveal → Mark on an actual phone, including a failed-save retry.
