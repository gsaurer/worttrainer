# Worttrainer

A small, self-hosted family spelling workshop. German and English words, spoken
dictation, paper answers, and parent-marked progress. Independent private
email/password accounts, a Node.js backend, and **real JSON storage on disk**.
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
`/api` to it. Choose **Create account**, enter your parent email, and choose a
password (12–128 characters). There is no setup token, invitation, default
password, or mock login. Registration is public wherever the app is reachable.
Every new account starts with an empty private collection; signing in to the
same account on another device syncs that account's words and progress.

Data is created in `data/store.json`, ignored by Git. Restarting the app preserves
all accounts, words, progress, and unexpired sessions. On another device, sign in
with the same parent credentials once the app is hosted at a reachable URL.
The development server is loopback-only by default.

The parent email is a case-insensitive sign-in identifier, not an email delivery
service: no verification messages, magic links, or email password resets are sent.
Email ownership is not verified. Forgotten passwords require the server
operator's interactive recovery command.

### Upgrading from the single-account version

Keep the existing data volume and deploy the updated application. On startup,
version-1 JSON is validated, backed up as **`store.json.v1.bak`** beside the
original file with restrictive permissions, and atomically migrated to version 2.
The original account retains its password, words, practice history, saved photo
rounds, and unexpired sessions. New registrations never receive those records.
The shared OCR counter is preserved. No account is made an installation admin.

An existing backup is never overwritten. A matching backup permits a migration
retry; a different backup stops startup so you can preserve both files before
moving the older backup. Unsupported or inconsistent data also stops startup
without replacing the original file. Protect and retain the migration backup
with your other backups; it contains the original private data and credentials.
Old application versions cannot read version 2: stop the app and restore a
compatible backup before rolling back, accepting loss of changes since that backup.

`SETUP_TOKEN` is no longer used and can be removed from `.env`. Existing emails
and passwords still work through **Sign in**. A retired setup link is harmless
and its secret fragment is removed from the browser URL.

### Upgrading an existing username account

Existing JSON files remain supported. On the next sign-in, enter the parent email
you want to use and the **existing password** through **Sign in**. Only after
the password is verified is the username replaced by that email. Words, practice
history, progress, and the password are preserved; that account's other sessions
are revoked. Other accounts are unaffected. Use an email not already registered.
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

Open **http://localhost:3000**, choose **Create account**, and register.
Compose defaults bind to host loopback and allow HTTP cookies **only for
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
4. Run `docker compose up --build -d`. Open the final URL and choose
   **Create account**, or **Sign in** for an existing account.
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
SQLite/PostgreSQL instead. The app loads all accounts' JSON into memory; each
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
`docker compose down -v` unless you intend to delete every account's data.

If a parent password is forgotten, stop the backend, back up the file, and use
the interactive recovery command. Select the target account by email (or old
username); it preserves all words and revokes **only that account's sessions**:

```sh
docker compose stop worttrainer
docker compose run --rm worttrainer node dist-server/server/reset-password.js
docker compose start worttrainer
```

For local development, stop `npm run dev` and run `npm run reset-password`.
Both commands read the new password privately from the terminal, not an argument
or environment variable. If needed, **Change password** in the app changes it
without stopping the server and signs that account's other devices out.

## Configuration

| Variable | Development default | Container / production |
| --- | --- | --- |
| `APP_ORIGIN` | `http://localhost:5173` | Required exact origin; used for CSRF checks |
| `PORT` | `3001` | `3000` |
| `HOST` | `127.0.0.1` | `0.0.0.0` inside container |
| `DATA_FILE` | `data/store.json` | `/app/data/store.json` |
| `COOKIE_SECURE` | `false` | `true`; Compose overrides to false only for its local HTTP default |
| `TRUST_PROXY` | `0` | Set `1` only behind exactly one trusted proxy |
| `OCR_AZURE_ENDPOINT` | Unset | Optional HTTPS resource root, e.g. `https://your-resource.cognitiveservices.azure.com` |
| `OCR_AZURE_KEY` | Unset | Server-only API key for a **Free/F0** Document Intelligence resource |
| `OCR_MONTHLY_LIMIT` | `450` | Integer 1–450; shared server-wide analyses per UTC calendar month |

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
   Duplicate words in the same account and language are rejected
   (case-insensitive); different accounts can practice the same word independently.
2. Open **Let's practice**, choose a language and category, and **Start round**.
   Each matching word appears once in a shuffled, numbered list of up to 100 words.
   If more than 100 words match, the round selects 100 at random; use category
   filters for a smaller round. The round is saved before dictation begins.
3. Tap **Listen** and write the answer on paper, numbered **1, 2, 3...**.
   Spelling stays concealed, including from the accessibility tree, throughout
   dictation. Tap **Written — next word** to save your position.
4. After the whole round is written, choose **Review the sheet manually** or
   upload one photo for recognition suggestions. Mark each answer, then
   **Confirm all results**. No results change progress until this confirmation.
   A failed/uncertain save can be retried without counting it twice.

**Pause and return to rounds** retains the numbered list and writing position.
Use **Continue round** on any signed-in device to resume. There is no timer, and
pausing never marks unanswered words incorrect. Checking each word immediately
is no longer a separate practice mode; all practice now uses saved rounds.

| Practice result | Category and consecutive-mistake count |
| --- | --- |
| Newly added word | New, 0 (adding is not a practice attempt) |
| Any correct answer | +, reset count to 0 |
| First consecutive incorrect answer | Keep current category, count 1 (including if currently +) |
| Second consecutive incorrect answer | −, count 2 |
| More incorrect answers while in − | Remain −, count stays at 2 |

The collection refreshes after mutations, on focus, and every 30 seconds while
visible; **Sync** refreshes manually. Rounds preserve the dictated word snapshots,
but confirmed answers use current server progress. Two devices' distinct rounds
apply in the order the server receives them. Deleting a word deletes its attempt
history and saved rounds containing it, including their round statistics.

### Round history and statistics

The practice notebook lists each saved round's identifier, language, word count,
start time, writing progress, and review time. **View results** shows the exact
ordered word list and parent-confirmed correct/incorrect result for each word.
Reopening a reviewed round never records another attempt.

Statistics show reviewed versus started rounds, correct and incorrect answers,
and accuracy: **correct answers / all reviewed answers**. Overall accuracy is
weighted by answer counts, not the average of round percentages. Pending rounds,
unmarked answers, and unconfirmed OCR suggestions do not count as successes or
failures. Without any reviewed answers, accuracy is shown as unavailable, not 0%.
Dates are shown in the viewing device's local time zone. History refreshes on
focus; **Refresh rounds** also reloads it explicitly.

Existing saved photo rounds are included automatically with no storage migration.
Older standalone practice attempts retain their progress and timestamps, but
cannot be reliably reconstructed into rounds and are excluded from these
round-based statistics. Statistics cover **currently saved rounds**, across both
languages. Removing a round removes it from statistics but does not undo recorded
word progress; deleting a word also removes rounds containing it. Both actions
show a confirmation explaining this effect.

### Check one photo at the end (optional)

All rounds support manual review without OCR configuration. To use one photo:

1. Start a numbered round. Each word is dictated without displaying its spelling.
   Write one answer per line, numbered **1, 2, 3...** in dictation order. A sheet
   supports 1–100 words; a short round is much easier to photograph/read.
2. Tap **Written — next word**. The server saves the ordered word snapshots,
   current position, start time, and writing-finished time. Pause and reopen
   **Round history** on either device to continue.
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
`last_practiced_at` record the **parent confirmation time**. Saved rounds
show their start, writing-finished, and review times; there are no separate child
identities or child-specific statistics. Historical per-word attempts still
retain their marking timestamps without fabricated round assignments. The word
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
only (1–450), **shared across all accounts on the server**, not 450 per account.
Round contents and recognized text remain private; authenticated users can see
the shared counter. Public signup means any registered account can consume this
shared allowance. Single-image inputs analyze only page 1. There is no automatic retry
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
  expire after seven days; at most 20 sessions are retained per account. Logout
  revokes that device's session; changing/recovering a password revokes only
  the relevant account's sessions.
- Each account owns its words, attempts, and photo rounds. The server determines
  ownership from the session, never a client-supplied account ID. Foreign word
  and round IDs are treated as missing. Separate registrations are not members
  of a shared family space; using the same account intentionally shares its data.
- Mutations require JSON content (or JPEG/PNG for the single photo route) and the exact allowed browser Origin. Login,
  signup, and password changes are rate-limited; expensive password hashing is
  concurrency-limited. There is no permissive CORS.
- No child identity, age, microphone recording, or analytics is collected.
  Optional photo mode processes handwriting only after an explicit parent upload.
  Only the parent's email is stored as the sign-in identifier; no
  email service is contacted.
- Photos are processed in memory, re-encoded as JPEG with metadata (including
  EXIF/GPS) stripped, and **never saved on the app's disk**. Recognized text,
  word snapshots, timestamps, and parent-confirmed results are stored in JSON.
  Backups therefore also contain recognized text. **Remove round** deletes that
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
- Deleting `data/store.json` **while the app is stopped** removes every account,
  collection, history, and session, and resets the shared OCR counter. Back it up
  first if needed. Existing migration/volume backups are separate copies and
  still contain private data until the operator removes them.

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

Tests exercise the real Express API and real temporary JSON files: public signup,
password authentication, cookies, session invalidation, CSRF, input validation,
all category transitions, concurrent answers, idempotent retries, fresh-store
restarts, deletion, corrupt-file protection, email normalization/validation, and
non-destructive storage/username upgrades, independent private accounts,
cross-account request isolation, and targeted password recovery. Photo tests cover saved ordering and
timestamps, atomic/idempotent batch review, free-budget reservations/restarts,
image validation/metadata removal, explicit numbering, recognition uncertainty,
and provider errors. Provider responses in tests are fixtures, not live Azure
recognition or an accuracy guarantee for children's handwriting. UI tests cover
concealed whole-round dictation, end-of-sheet review, explicit uploads, retry
behavior, weighted statistics, unmarked answers, language voices, and account forms.
No authentication/storage mocks are used by the running app.

For non-container production, run the compiled Node server with `NODE_ENV=production`,
`APP_ORIGIN` set, and a persistent `DATA_FILE`, after `npm run build`. It serves
`dist` plus `/api`. Static-only hosting is not sufficient anymore. CI also builds
the Docker image. Run the Node server as a single supervised process.
