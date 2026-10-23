# Worttrainer

A small, self-hosted family spelling workshop. Configurable practice languages, spoken
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

Data is created in `data/store.json` and `data/store.accounts/`, ignored by Git.
The main file holds login information, sessions, and the shared OCR counter.
Each account has one separate JSON file containing all its practice data.
Restarting the app preserves all accounts, words, progress, and unexpired sessions. On another device, sign in
with the same parent credentials once the app is hosted at a reachable URL.
The development server is loopback-only by default.

The parent email is a case-insensitive sign-in identifier, not an email delivery
service: no verification messages, magic links, or email password resets are sent.
Email ownership is not verified. Forgotten passwords require the server
operator's interactive recovery command.

### Upgrading existing storage

Keep the existing data volume and deploy the updated application. On startup,
version-2 combined JSON is validated and backed up exactly as **`store.json.v2.bak`**
with restrictive permissions. The app writes each account's complete practice file
before atomically replacing the main file with the version-3 login index.
Account IDs, credentials, language settings, words, attempts, saved rounds,
recognized text, unexpired sessions, and the shared OCR counter are preserved.

Version-1 single-account storage first receives an exact **`store.json.v1.bak`**
and a version-2 ownership upgrade, then the same split-file migration. The original
account keeps its private records; new registrations never receive them. No account
is made an installation admin.

Existing backups are never overwritten. A matching backup and matching staged
account files permit retry after an interrupted migration. Conflicting backups,
conflicting account files, unsupported data, or missing/corrupt referenced account
files stop startup instead of resetting data or replacing the conflicting files.
Protect migration backups: they still contain the old combined private data and
credentials. Older application versions cannot read the version-3 index. Stop the
app and restore a compatible backup before rollback, accepting loss of newer changes.

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
Do not delete the data files or create a fresh account to make this change.

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
SQLite/PostgreSQL instead. The app loads the index and all referenced account
files into memory. Practice changes rewrite only the affected account file;
login/session/password and shared-quota changes rewrite only the main index.
Registration writes the new practice file first, then publishes its identity in
the index. A failed index write can leave an unreferenced file, but cannot expose
an incomplete account. Unreferenced files are never automatically adopted or deleted.
A container's writable layer is **not** the data backup.

### Storage layout

With the default `DATA_FILE=data/store.json`:

```text
data/
  store.json
  store.accounts/
    <account-uuid>.json
```

`store.json` uses storage version 3. It contains account UUIDs, parent email (or
legacy username), password hashes/salts, hashed sessions, and the installation-wide
OCR counter. It contains no word collection, language settings, attempts, or rounds.

Each `<account-uuid>.json` is a complete, independently copyable practice document
with `format: "worttrainer-account-data"` and `schemaVersion: 1`. It contains
`accountId`, `websiteLanguage`, `languagePreferences`, `words`, `attempts`, and `photoRounds`, including
word progress, timestamps, ordered snapshots, recognized text, and confirmed results.
There are no credentials, sessions, parent email, or other accounts in this file.
Statistics can be derived from its rounds. The name uses the server-owned UUID,
never an email or a client-supplied path. Files are private (0600) and the account
directory is private (0700) on Unix.

For a custom `DATA_FILE`, the account directory is beside it, named after its
filename without the extension plus `.accounts` (for example,
`/private/family.json` uses `/private/family.accounts/`). Keep both on the same
persistent data volume. Do not change `DATA_FILE` without moving its matching
account directory too.

### Back up and restore

Use Proxmox/volume backups, or stop the app briefly and copy the **whole data
directory**, including the index, account files, and migration backups:

```sh
docker compose stop worttrainer
mkdir -p backups
docker compose cp worttrainer:/app/data/. ./backups/
docker compose start worttrainer
```

Protect backups: they contain password hashes, private words, and hashed session
identifiers. Restore with the app stopped, correct ownership, and the same volume
path, then restart. Restore the index and its account directory from the same
snapshot; mixing versions can lose progress or stop startup. Backing up only
`store.json` is no longer sufficient. Keep a copy before upgrades or manual recovery. Do not run
`docker compose down -v` unless you intend to delete every account's data.

If a parent password is forgotten, stop the backend, back up the data directory, and use
the interactive recovery command. Select the target account by email (or old
username); it preserves all words and revokes **only that account's sessions**:

```sh
docker compose stop worttrainer
docker compose run --rm worttrainer node dist-server/server/reset-password.js
docker compose start worttrainer
```

For local development, stop `npm run dev` and run `npm run reset-password`.
Both commands read the new password privately from the terminal, not an argument
or environment variable. **Change password** under **Settings → Account**
changes it without stopping the server and signs
that account's other devices out.

## Export your data for analysis

When signed in, open **Settings → Your data** and choose **Export my data (JSON)**. This downloads
a UTF-8 file named `worttrainer-YYYY-MM-DD.json` for use in other analysis tools.
The authenticated `GET /api/export` endpoint serves the same account-scoped data.

The export has `format: "worttrainer-account-export"`, `schemaVersion: 3`, and a
UTC `exportedAt` timestamp. It includes the account identifier and parent email
(or legacy username), all currently stored words and category progress, individual
attempts with their timestamps, complete and unfinished rounds with ordered word
snapshots, recognized text, parent-confirmed results, and round summary statistics.
`languagePreferences` contains the enabled language codes and `defaultLanguage`.
Schema version 2 added practice-language preferences; version 3 adds
`websiteLanguage` (`de` or `en`). Existing analysis tools should accept the new
version. Keys, category codes, language codes, and timestamps are not translated.
Disabled-language records are included.
Join `attempts.wordId` to `words.id`, and round word `attemptId` to `attempts.id`.
Dates inside the data are ISO timestamps in UTC; displayed app dates use local time.
Historical individual answers are included even when they have no associated round.

Only the signed-in account is exported. Passwords/hashes, salts, session tokens,
API keys, other accounts, and the installation-wide OCR counter are excluded.
Original uploaded photos are not stored and therefore cannot be exported.
Deleted records cannot be recovered through this export. Protect the downloaded
file: it contains private words, email, and any recognized handwriting.
This is an analysis format, **not** a server backup or a supported import/restore
format; continue backing up the data volume for recovery.

An operator can also copy just `data/store.accounts/<account-uuid>.json` while
the app is stopped for that account's raw practice data. This is the backend
practice document, not the download's enriched analysis format: it uses
`photoRounds` rather than `rounds`, has no parent email or derived statistics,
and uses its own schema version. The existing authenticated export button/API
still provides the familiar analysis download. Neither format is a supported
import or a replacement for a complete server backup.

## Configuration

| Variable | Development default | Container / production |
| --- | --- | --- |
| `APP_ORIGIN` | `http://localhost:5173` | Required exact origin; used for CSRF checks |
| `PORT` | `3001` | `3000` |
| `HOST` | `127.0.0.1` | `0.0.0.0` inside container |
| `DATA_FILE` | `data/store.json` (login index; account files beside it) | `/app/data/store.json` and `/app/data/store.accounts/` |
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

1. On **Home**, enter the **correct spelling**, choose an enabled language,
   then press **Add word** or Enter. The field clears and stays focused for
   the next word; the selected language is kept.
   Existing words are flagged as you type (case-insensitive, ignoring edge
   spaces), and adding is disabled for that language. The server also rejects
   duplicates, including simultaneous additions from another device. Different
   languages and accounts can keep the same spelling independently.
2. Under **Start a challenge** on the home page, press **10 words**, **15 words**,
   or **20 words**.
   All three buttons stay visible and start a numbered round with one press.
   Use **Change words** for optional language/category filters. Sizes are
   maximums: if only eight words match, every choice uses those eight, without
   repeats. A short note shows this limit. Resuming a saved round keeps its
   original words and length, including older 25-word rounds.
3. Tap **Listen** and write the answer on paper, numbered **1, 2, 3...**.
   Spelling stays concealed, including from the accessibility tree, throughout
   dictation. Tap **Next word** to save your position, or **Check answers** after
   the last word.
4. After the whole round is written, choose **Review the sheet manually** or
   upload one photo for recognition suggestions. Mark each answer, then
   **Confirm all results**. No results change progress until this confirmation.
   A failed/uncertain save can be retried without counting it twice.

**Pause** retains the numbered list and writing position.
Use **Continue round** on any signed-in device to resume. There is no timer, and
pausing never marks unanswered words incorrect. Checking each word immediately
is no longer a separate practice mode; all practice now uses saved rounds.

**Collection** is a separate overview: total words, practiced/unpracticed counts,
and language/category totals. Spellings are not listed by default. Use
**Search words** to find a spelling, inspect its progress, or delete it with
confirmation. Searches show up to 20 matches; refine the query to find others.

### Website language

The website is available in German and English. Before signing in, it starts in
German for a German browser, otherwise English; use the **Website language**
selector to switch. Creating an account saves that choice. After signing in,
choose **Settings → Website language → Save language** (German:
**Einstellungen → Sprache der Website → Sprache speichern**).
This preference is saved in your private account file and restored at sign-in.
Other visible devices sync on focus or within 30 seconds. Existing accounts
without this preference keep the original English interface.

Website language is independent of practice languages: switching the interface
does not translate your words, change categories or results, or select a different
dictation voice. Dates display in the website language and device time zone;
exports retain ISO UTC timestamps. Unknown technical error details remain visible
as returned by the server or device.

### Choose your practice languages

Open **Settings → Languages**, enable languages from the built-in catalogue, choose a
**Default language**, and **Save languages**. These preferences belong to your
parent account and sync across devices, including on focus and the normal
30-second refresh. They are not server `.env` settings.

Deutsch and English remain enabled initially for new and existing accounts.
There are 26 language choices, including French, Spanish, Italian, Portuguese,
Dutch, Danish, Swedish, Norwegian Bokmål, Finnish, Polish, Czech, Slovak,
Hungarian, Romanian, Ukrainian, Russian, Turkish, Greek, Arabic, Hebrew, Hindi,
Chinese, Japanese, and Korean. Dictation still needs an installed matching voice.

Word entry and new rounds use enabled languages only. Their initial selection
uses your account default; an explicitly selected enabled language stays selected
while that screen remains open. At least one language must stay enabled, and the
default must be enabled. Disabling the current default selects another remaining
language in the settings form.

Disabling a language does **not** delete words, attempts, or rounds. They remain
in overview/search/export, and existing rounds can still be resumed and reviewed.
Re-enable the language to add words or create new rounds. Older data files without
language preferences retain their original data and use Deutsch/English defaults.

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
   uses up to 20 words; older saved rounds of up to 100 words still work.
2. Tap **Next word**, then **Check answers** after the last word.
   The server saves the ordered word snapshots,
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
Check [Azure's supported handwriting languages](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/ocr?view=doc-intel-4.0.0)
for the language you enable. A practice-language choice does not guarantee Azure
handwriting support or accuracy; manual review remains available for every language.
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
the main login index, not in an account's practice file. Failed/uncertain requests and explicit re-uploads still count.
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
- Removing only the login index does **not** remove account practice files.
  Startup refuses a missing index when the matching account directory is nonempty;
  restore a consistent backup instead of recreating accounts. To intentionally
  wipe an installation while stopped, the operator must remove the index **and**
  its account directory. Existing migration/volume backups are separate copies
  and still contain private data until the operator removes them.

Speech uses the browser's Web Speech API. A voice for each practice language must
be installed/enabled on each device. Locally installed voices are preferred; some
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
cross-account request isolation, and targeted password recovery. Storage tests cover
one-file-per-account isolation, write scope/failures, migration backups/retries,
missing/mismatched files, and restart/export fidelity. Photo tests cover saved ordering and
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
