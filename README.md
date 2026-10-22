# Worttrainer

A small, self-hosted family spelling workshop. German and English words, spoken
dictation, paper answers, and parent-marked progress. One shared parent
email/password account, a Node.js backend, and **real JSON storage on disk**.
No cloud service, email provider, child profiles, or database provisioning needed
for normal practice. Optional end-of-round photo reading uses Azure's Free/F0
handwriting recognition service and requires separate configuration.

React + TypeScript + Vite for the interface, Express for the same-origin API.
The container serves both. Short-sentence dictation is intentionally a later step.

## Start locally

Requires Node.js **22.12+** and npm. Docker is not required for local development.

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Copy the example only if `.env` does not already exist. Put local configuration,
including optional Azure credentials, in **`.env` beside `package.json`**.
The file is ignored by Git and excluded from Docker builds. The example leaves
deployment-specific overrides commented, so copying it preserves local defaults.
Restart the API after editing `.env` to load the new values.

Open **http://localhost:5173**. The API runs on `127.0.0.1:3001`; Vite proxies
`/api` to it. On the first run, the API prints a **private setup link** in the
terminal. Open that link to enter the shared parent email and choose a password
(12–128 characters). The one-time setup code expires after 15 minutes; restart
the API to renew it. Alternatively, configure your own first-install secret as
described below. There is no default password, open signup, or mock login.

### Set the first-install secret in `.env`

For a public self-hosted deployment, the initial secret prevents an unrelated
visitor from claiming your family account before you do. You can keep that
protection without copying an expiring link from container logs:

1. Generate a private random token on your machine, for example with
   `openssl rand -hex 32`. It must contain 32–128 letters, digits, `_`, or `-`.
   Do not use a sample value or a memorable password.
2. Add `SETUP_TOKEN=YOUR_GENERATED_VALUE` to the ignored root `.env`.
3. Recreate the container with `docker compose up -d --build` (or restart the
   local Node server) to load the configuration.
4. Open your app's normal URL. Paste that value into **One-time setup code**,
   then choose your parent email and password. No `#setup=` link is required.
5. Once the account exists, setup is permanently closed while that data is
   retained, even if `SETUP_TOKEN` is still configured. Remove it from `.env`
   and recreate/restart the server after successful setup.

A configured `SETUP_TOKEN` stays the same across restarts and has no clock
expiry **until the first parent account is created**. It is not the account
password and cannot reset, replace, or log in to an existing account.
Do not expose it in client variables, source control, screenshots, or chat.
Without this optional setting, the generated 15-minute setup links still work.
The configured token is not printed in startup logs or returned by the API.

Data is created in `data/store.json`, ignored by Git. Restarting the app preserves
the account, words, progress, and unexpired sessions. On another device, sign in
with the same parent credentials once the app is hosted at a reachable URL.
The development server is loopback-only by default.

The parent email is a case-insensitive sign-in identifier, not an email delivery
service: no verification messages, magic links, or email password resets are sent.

### Upgrading an existing username account

Existing JSON files remain supported. On the next sign-in, enter the parent email
you want to use and the **existing password** in the email-upgrade form. Only after
the password is verified is the username replaced by that email. Words, practice
history, progress, and the password are preserved; other sessions are revoked.
Afterward, sign in on every device with that email and the same password.
Do not delete the data file or create a fresh account to make this change.

## Deploy as a container (including on Proxmox)

Run Docker/Compose inside a Linux VM in your Proxmox cluster. A single application
container and persistent volume are all that is needed; no Supabase or external
authentication/database backend is used. Optional OCR calls Azure.

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
   (for example `https://words.example.com`, no trailing slash), and explicitly set
   `COOKIE_SECURE=true`. Keep an existing `.env` rather than overwriting its keys.
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
| `SETUP_TOKEN` | Unset: generated 15-minute setup link | Optional private random first-install token (32–128 letters/digits/`_`/`-`); valid only until account creation |
| `OCR_AZURE_ENDPOINT` | Unset | Optional HTTPS resource root, e.g. `https://your-resource.cognitiveservices.azure.com` |
| `OCR_AZURE_KEY` | Unset | Server-only API key for a **Free/F0** Document Intelligence resource |
| `OCR_MONTHLY_LIMIT` | `450` | Integer 1–450; reserved single-photo analyses per UTC calendar month |

`npm run dev`, `npm run dev:api`, `npm start`, and `npm run reset-password`
automatically load the root **`.env`** using Node's built-in environment-file
support. Docker Compose also reads that file. It is optional: if absent, the app
uses its documented defaults. Existing shell/container environment variables
override values in `.env`; remove a stale exported value if a file change seems
to have no effect. After changing `.env`, restart the API (or recreate the Compose
container) to load the new values. Source-code watching does not reload this file.

No dotenv dependency or client-side credential configuration is needed.
Never put the parent account password in `.env`; the secure browser form sets it.

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

### Check one photo at the end

Choose the language/category as usual, then **One photo at the end**:

1. Start a numbered round. Each word is dictated without displaying its spelling.
   Write one answer per line, numbered **1, 2, 3...** in dictation order. A sheet
   supports 1–100 words; a short round is much easier to photograph/read.
2. Tap **Written — next word**. The server saves the ordered word snapshots,
   current position, start time, and writing-finished time. Pause and reopen
   **Saved photo rounds** on either device to continue.
3. At the end, photograph the entire numbered sheet clearly, upright, flat,
   without shadows, names, faces, or other personal information. Upload one
   **JPEG or PNG, up to 4 MiB and 24 megapixels**. HEIC, PDFs, and multi-page
   images are not supported. Reduce camera resolution or export JPEG if needed.
4. **Send photo to Azure for reading** explicitly shares the normalized image
   with your configured Azure resource. Selecting a photo alone does not send it.
   The interface shows expected spelling, recognized spelling, confidence,
   and editable parent results. Recognition does not receive the expected word
   list as a correction prompt.
5. Check **every** result against the actual paper/photo, correct suggested
   results as needed, then **Confirm all results**. All attempts and category
   changes save in one atomic transaction. Retrying the same confirmation,
   including after a restart, never counts an answer twice.

No recognition result changes progress automatically. Missing/duplicate numbers,
unmatched lines, missing confidence, and confidence below 80% require manual
marking. Answers are matched **only by explicit number**, never shifted into
place by list order. Spelling comparison is case-sensitive, preserves accents
and umlauts, and normalizes Unicode composition and outer whitespace only.
OCR can inadvertently read a misspelled word as its correct spelling: confidence
is **not** proof of spelling correctness. Parent review is always necessary.
**Review the sheet manually** remains available without credentials, if Azure
fails, or once a free quota is exhausted.

Writing-position timestamps indicate when **Written** was tapped, not when the
pencil physically touched paper. Each practice attempt and the word's
`last_practiced_at` record the **parent confirmation time**. Saved photo rounds
show their start, writing-finished, and review times; there are no separate child
identities or child-specific statistics. Original per-word practice continues
to record marking timestamps without creating a photo-round record. The word
collection shows the last-practiced **date and time** in the viewing device's
local time zone.

### Configure free handwriting recognition (optional)

An Azure account/subscription and a **Document Intelligence resource explicitly
created on the Free/F0 pricing tier** are required. Choose a suitable data region.
The currently advertised F0 allowance is
[500 pages per month](https://azure.microsoft.com/en-us/pricing/details/document-intelligence/);
Read supports [English and German handwriting](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/ocr?view=doc-intel-4.0.0).
Free-tier availability and terms can change. This is not an unlimited service
and is not a paid trial dependency.

- In Azure, create Document Intelligence with **Free F0**, not Standard S0.
  Verify the tier in the resource's pricing settings before copying its endpoint
  and a key from **Keys and Endpoint**. Do not create paid supporting services.
- Put the endpoint and key in the ignored **`.env` beside `package.json`**.
  Start with `Copy-Item .env.example .env` only if that file does not already exist,
  then edit these entries locally:

  ```dotenv
  OCR_AZURE_ENDPOINT=https://your-resource.cognitiveservices.azure.com
  OCR_AZURE_KEY=your-free-f0-resource-key
  OCR_MONTHLY_LIMIT=450
  ```

- For local development, run `npm run dev`; no PowerShell environment exports
  are needed. Restart the API after editing `.env`. For Compose, recreate the
  container with `docker compose up -d` after editing the file.
- Do not paste the key into chat, commit it, use a `VITE_` variable, or put it in
  client code. Never configure an S0/paid resource. The app does not provision
  resources, upgrade tiers, retry with a paid provider, or use paid OCR add-ons.

**The key-only API cannot verify Azure's resource pricing SKU.** You must confirm
the resource is F0 in Azure; an in-app request counter cannot make an accidentally
configured paid resource free. Dedicate the resource to this app so other callers
do not consume its allowance. There are no Azure credentials included in this
repository and no working external recognition until these are configured.

The app reserves one analysis **before** each provider submission, persisted in
the same JSON file. Failed/uncertain requests and explicit re-uploads still count.
The default hard ceiling is **450 per UTC calendar month**, adjustable downward
only (1–450). Single-image inputs analyze only page 1. There is no automatic retry
of analysis submissions. Azure throttling/quota errors are shown explicitly; use
manual review instead. The local budget is an additional guard, not a measurement
of Azure's billing period or other clients' usage. Keep the data volume intact:
restoring an older backup or deleting it also rolls back that local counter.

## Authentication and privacy

- Passwords use Node's asynchronous **scrypt** (N=131072, r=8, p=1), random salts,
  and timing-safe comparison. They are never stored in plaintext. Use a password
  manager or a memorable, unique family passphrase.
- Sessions are random 256-bit tokens in `HttpOnly`, `SameSite=Strict` cookies
  (`Secure` over HTTPS). Only their SHA-256 hashes are stored on disk. Sessions
  expire after seven days; at most 20 sessions are retained. Logout revokes that
  device's session; changing/recovering the password revokes other sessions.
- First account creation requires either the optional configured `SETUP_TOKEN`
  or a fresh generated setup link. There is no unauthenticated "claim first
  account" bypass. Configured tokens are validated at startup, never stored in
  the family's JSON, and cannot reopen setup once the account has been created.
- Mutations require JSON content (or JPEG/PNG for the single photo route) and the exact allowed browser Origin. Login,
  setup, and password changes are rate-limited; expensive password hashing is
  concurrency-limited. No permissive CORS or public account registration.
- No child identity, age, microphone recording, or analytics is collected.
  Optional photo mode processes handwriting only after an explicit parent upload.
  Only the parent's email is stored as the sign-in identifier; no
  email service is contacted. The single parent account owns the family's one
  shared collection.
- Photos are processed in memory, re-encoded as JPEG with metadata (including
  EXIF/GPS) stripped, and **never saved on the app's disk**. Recognized text,
  word snapshots, timestamps, and parent-confirmed results are stored in JSON.
  Backups therefore also contain recognized text. **Remove sheet** deletes that
  round's snapshots/recognition, retaining recorded practice progress/attempts.
  Deleting a word also deletes all saved sheets containing it and that word's
  attempts. Other words' progress is not undone.
- Azure processes the photo in the configured resource region. According to
  [Microsoft's retention policy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/document-intelligence/data-privacy-security),
  input and results are temporarily stored for up to 24 hours after processing.
  The app also requests early deletion after retrieving a result or encountering
  a polling failure. Cleanup failures are logged without image content or keys;
  Azure's retention policy still applies. No provider training/privacy promises
  beyond those published terms are assumed.
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
restarts, deletion, corrupt-file protection, email normalization/validation, and
non-destructive username-to-email upgrades. Photo tests cover saved ordering and
timestamps, atomic/idempotent batch review, free-budget reservations/restarts,
image validation/metadata removal, explicit numbering, recognition uncertainty,
and provider errors. Provider responses in tests are fixtures, not live Azure
recognition or an accuracy guarantee for children's handwriting. UI tests cover
concealed dictation, end-of-sheet review, explicit uploads, retry behavior,
language voices, and account forms.
No authentication/storage mocks are used by the running app.

For non-container production, run the compiled Node server with `NODE_ENV=production`,
`APP_ORIGIN` set, and a persistent `DATA_FILE`, after `npm run build`. It serves
`dist` plus `/api`. Static-only hosting is not sufficient anymore. CI also builds
the Docker image. Run the Node server as a single supervised process.
