# Worttrainer

A small, self-hosted family spelling workshop. German and English words, spoken
dictation, paper answers, and parent-marked progress. One shared parent
username/password account, a Node.js backend, and **real JSON storage on disk**.
No cloud service, email provider, child profiles, or database provisioning needed.

React + TypeScript + Vite for the interface, Express for the same-origin API.
The container serves both. Short-sentence dictation is intentionally a later step.

## Start locally

Requires Node.js **22.12+** and npm. Docker is not required for local development.

```powershell
npm ci
npm run dev
```

Open **http://localhost:5173**. The API runs on `127.0.0.1:3001`; Vite proxies
`/api` to it. On the first run, the API prints a **private setup link** in the
terminal. Open that link to choose the shared parent username and password
(12–128 characters). The one-time setup code expires after 15 minutes; restart
the API to renew it. There is no default password, open signup, or mock login.

Data is created in `data/store.json`, ignored by Git. Restarting the app preserves
the account, words, progress, and unexpired sessions. On another device, sign in
with the same parent credentials once the app is hosted at a reachable URL.
The development server is loopback-only by default.

## Deploy as a container (including on Proxmox)

Run Docker/Compose inside a Linux VM in your Proxmox cluster. A single application
container and persistent volume are all that is needed; no Supabase or other
external backend is used.

For a local container preview:

```sh
docker compose up --build -d
docker compose logs worttrainer
```

Open the setup link from the logs at **http://localhost:3000** and create the
account. Compose defaults bind to host loopback and allow HTTP cookies **only for
this local preview**.

For a real installation:

1. Copy `.env.example` to `.env`, set `APP_ORIGIN` to the final HTTPS origin
   (for example `https://words.example.com`, no trailing slash), and leave
   `COOKIE_SECURE=true`.
2. Put an HTTPS reverse proxy in front of port 3000. If the proxy is on another
   machine/container, change the Compose port binding appropriately and firewall
   it so only the proxy can reach the backend. Do not publicly expose the backend
   directly.
3. `TRUST_PROXY=1` trusts exactly one proxy hop for rate-limiting client IPs. Use
   it only when direct access is restricted to that trusted proxy. Otherwise leave
   it `0`; authentication limits then apply to the connecting address.
4. Run `docker compose up --build -d`. Obtain the first-run setup link with
   `docker compose logs worttrainer`, then create the account in your browser.
5. Keep the `worttrainer-data` volume mounted at `/app/data`. The container runs
   as the unprivileged `node` user (UID/GID 1000); bind mounts must be writable by
   that user. The included named volume gets the correct ownership automatically.

For an explicitly trusted LAN-only HTTP installation, use its exact
`http://host:port` as `APP_ORIGIN`, set `COOKIE_SECURE=false`, and bind the port to
the appropriate LAN interface. HTTP does not encrypt passwords or sessions;
HTTPS is strongly recommended even on the LAN.

### Important JSON storage boundary

**Run exactly one backend process / one container replica per data volume.**
Writes are serialized within that process, flushed to a temporary file in the
same directory, and atomically renamed before success is returned. Distinct
device answers cannot overwrite each other; retry IDs are persisted and never
counted twice. Bad or unsupported stored JSON causes startup to fail explicitly,
not silently reset the collection.

This is appropriate for a small family app, not active-active cluster replicas.
Use a local filesystem with atomic rename support, not a shared network filesystem.
In Proxmox, move/restore the app **with its volume**, rather than running replicas
against the same file. Multiple replicas or a much larger collection should use
SQLite/PostgreSQL instead. The app loads the family's JSON into memory; each
mutation rewrites that file. A container's writable layer is **not** the data backup.

### Back up and restore

Use Proxmox/volume backups, or stop the app briefly and copy its JSON file:

```sh
docker compose stop worttrainer
mkdir -p backups
docker compose cp worttrainer:/app/data/store.json ./backups/store.json
docker compose start worttrainer
```

Protect backups: they contain password hashes, private words, and hashed session
identifiers. Restore with the app stopped, correct ownership, and the same volume
path, then restart. Keep a copy before upgrades or manual recovery. Do not run
`docker compose down -v` unless you intend to delete the family's data.

If the parent password is forgotten, stop the backend, back up the file, and use
the interactive recovery command; it preserves words and revokes all sessions:

```sh
docker compose stop worttrainer
docker compose run --rm worttrainer node dist-server/server/reset-password.js
docker compose start worttrainer
```

For local development, stop `npm run dev` and run `npm run reset-password`.
Both commands read the new password privately from the terminal, not an argument
or environment variable. If needed, **Change password** in the app changes it
without stopping the server and signs other devices out.

## Configuration

| Variable | Development default | Container / production |
| --- | --- | --- |
| `APP_ORIGIN` | `http://localhost:5173` | Required exact origin; used for CSRF checks and setup link |
| `PORT` | `3001` | `3000` |
| `HOST` | `127.0.0.1` | `0.0.0.0` inside container |
| `DATA_FILE` | `data/store.json` | `/app/data/store.json` |
| `COOKIE_SECURE` | `false` | `true`; Compose overrides to false only for its local HTTP default |
| `TRUST_PROXY` | `0` | Set `1` only behind exactly one trusted proxy |

Compose reads `.env`. Plain `npm run dev` uses the defaults, or environment
variables exported in your shell; no environment file is required. Never put
passwords in `.env`. The secure first-run browser form sets them.

## Practice together

1. Add the **correct spelling** of a tricky word and choose Deutsch or English.
   Duplicate words in the same language are rejected (case-insensitive).
2. Open **Let's practice**, choose a language and category, and begin a shuffled
   round. Each matching word appears once. End early whenever you like.
3. Tap **Listen**. The word is concealed, including from the accessibility tree,
   until the parent explicitly reveals it. The child writes on paper.
4. Reveal for checking, then mark **Spelled correctly** or **Not quite yet**.
   Advance after the server confirms the save. A failed/uncertain save can be
   retried without counting it twice.

| Practice result | Category and consecutive-mistake count |
| --- | --- |
| Newly added word | New, 0 (adding is not a practice attempt) |
| Any correct answer | +, reset count to 0 |
| First consecutive incorrect answer | Keep current category, count 1 (including if currently +) |
| Second consecutive incorrect answer | −, count 2 |
| More incorrect answers while in − | Remain −, count stays at 2 |

The collection refreshes after mutations, on focus, and every 30 seconds while
visible; **Sync** refreshes manually. Practice rounds are snapshots, but each mark
uses current server progress. Two devices' distinct answers apply in the order
the server receives them. Deleting a word deletes its attempt history.

## Authentication and privacy

- Passwords use Node's asynchronous **scrypt** (N=131072, r=8, p=1), random salts,
  and timing-safe comparison. They are never stored in plaintext. Use a password
  manager or a memorable, unique family passphrase.
- Sessions are random 256-bit tokens in `HttpOnly`, `SameSite=Strict` cookies
  (`Secure` over HTTPS). Only their SHA-256 hashes are stored on disk. Sessions
  expire after seven days; at most 20 sessions are retained. Logout revokes that
  device's session; changing/recovering the password revokes other sessions.
- Mutations require JSON content and the exact allowed browser Origin. Login,
  setup, and password changes are rate-limited; expensive password hashing is
  concurrency-limited. No permissive CORS or public account registration.
- No child identity, age, handwriting, photo, microphone recording, or analytics
  is collected. No email address is needed. The single parent account owns the
  family's one shared collection.
- Deleting `data/store.json` **while the app is stopped** removes the account,
  words, history, and sessions; back it up first if needed. The next start
  generates a fresh private setup link.

Speech uses the browser's Web Speech API. German and English voices must be
installed/enabled on each device. Locally installed voices are preferred; some
platform voices send text to an online speech provider. If the language voice is
missing, the app reports it instead of choosing the wrong language. Playback
stops on reveal, navigation, or hiding the page. Check actual audio/pronunciation
on your target phone; browser/OS speech support varies.

The interface loads Google Fonts; local font fallbacks work if blocked. There
are no application analytics or third-party authentication services.

## Checks and production build

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Tests exercise the real Express API and real temporary JSON files: initial setup,
password authentication, cookies, session invalidation, CSRF, input validation,
all category transitions, concurrent answers, idempotent retries, fresh-store
restarts, deletion, and corrupt-file protection. UI tests cover concealed
dictation, parent marking, retry behavior, language voices, and account forms.
No authentication/storage mocks are used by the running app.

For non-container production, run the compiled Node server with `NODE_ENV=production`,
`APP_ORIGIN` set, and a persistent `DATA_FILE`, after `npm run build`. It serves
`dist` plus `/api`. Static-only hosting is not sufficient anymore. CI also builds
the Docker image. Run the Node server as a single supervised process.
