# Development Workflow

Worttrainer is in active development, not release-hardening mode. Optimize for
short iterations and the user's hands-on feedback.

## During Development

- Reuse one long-running `npm run dev` instance for this worktree. The user-facing
  URL is `http://localhost:5182`; its internal API is `http://127.0.0.1:3002`.
- Use Vite hot reload and the existing API watcher. Do not rebuild production,
  recreate containers, change ports, or register/seed new accounts for each edit.
- Keep the same persistent `data/store.json` and adjacent `data/store.accounts/`
  across restarts. Never reset or replace existing development data. Honor an
  explicit `DATA_FILE` override and preserve both the index and account files.
- Before starting anything, check whether this worktree's instance is already
  running. Reuse it; restart only the affected process when necessary. Do not
  stop servers belonging to another worktree or unrelated application.
- Do not run the full test suite, repository-wide lint, production build, or a
  desktop/mobile browser matrix after every change. Use the cheapest useful
  check for the touched behavior, or let the user validate it in the running app.
- Tests may temporarily lag behind development. Record known failures and any
  unverified behavior honestly; do not claim checks passed when they were skipped.
- Keep checks proportional to risk. Authentication, ownership, persistence, and
  destructive changes still warrant a focused check before relying on them.
- Isolated test containers or temporary stores are fine when a test needs them;
  they must not replace the user's long-lived development instance or data.

## Before Pushing

- Fix outstanding tests, including known pre-existing failures, and update tests
  for the completed behavior.
- Run `npm test`, `npm run lint`, and `npm run build`; resolve all failures before
  pushing. Smoke-test the changed user workflow in the shared development instance.
- Review the exact diff and exclude secrets and runtime data. Do not commit or
  push unless the user has explicitly requested it.

See README.md for setup and CONTEXT.md for domain terminology.