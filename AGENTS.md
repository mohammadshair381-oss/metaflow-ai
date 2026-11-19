# AGENTS.md

Guidance for AI agents and contributors working in this repository. Read this file, `README.md` and `docs/architecture.md` before changing anything.

## Project

**MetaFlow AI**: a multi-tenant SaaS for AI-assisted social media management. Users connect Facebook Pages and Instagram Professional (Business/Creator) accounts, generate content with AI, and publish it with manual approval or automatically.

**Current milestone: 1 — deployment foundation.** Only health checks and the dashboard shell exist. Do not start the next milestone until the owner has verified the live deployment and approved it.

## Ground rules

1. **Never rebuild from scratch, restructure wholesale, or delete working functionality** without explicit owner approval.
2. **Inspect before editing.** Read the existing implementation and follow its patterns.
3. **Small, focused, testable changes.** One concern per commit.
4. **No fake functionality.** Unbuilt modules are shown as disabled "Soon" entries, never as links to placeholder pages or with mock data.
5. **Never claim something works without running it.** Report actual command output, including failures and skipped checks. Never claim a deployment works until the live URLs have been tested.
6. **Keep docs in sync.** Update `README.md`, `.env.example` and `docs/` in the same change as the code they describe.
7. If a requested change conflicts with these rules or the architecture, **explain the conflict first**.

## Hard restrictions

- **Database:** MongoDB with Mongoose 8 only. Never introduce Prisma, MySQL or PostgreSQL.
- **Not yet:** do not build Meta OAuth, AI generation, publishing or advanced automation until their milestone is approved.
- **Separate project:** `D:\Projects\SiteForge` is unrelated. Never modify it or merge code from it.
- **Dependencies:** add a package only when it is clearly needed, pin exact versions, and prefer what is already installed.
- **Git:** never commit `.env` files or credentials. Never push or deploy without the owner's instruction.

## Architecture

| Folder      | Owns                                                                    | Must never contain                                            |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `frontend/` | UI, client-side state, calls to the backend via `src/lib/api-client.ts` | DB access, Meta/AI credentials, any non-`NEXT_PUBLIC_` secret |
| `backend/`  | Auth, sessions, authorization, DB, integrations, business logic         | UI code                                                       |
| `shared/`   | Zod contracts, inferred types, constants                                | Secrets, DB code, Node- or browser-only APIs                  |

`frontend` and `backend` never import each other; shared code goes into `shared/`.

## Backend conventions

- **Layers:** `routes/` → `controllers/` → `services/` → `models/`. Controllers are thin HTTP adapters; business logic lives in services, which take dependencies as arguments and never import Express.
- **Validation:** every input goes through `parseRequest(req, { body, query, params })` with Zod schemas from `validators/` or `shared/`. Never read `req.body`/`req.query`/`req.params` directly.
- **Errors:** throw `AppError` with a code from `shared/src/api/errors.ts`. Add a new code to `shared` together with the code that emits it. The central error handler formats every error response.
- **Configuration:** read environment variables only in `config/env.ts`. Production must fail fast on missing or invalid config, and error messages name variables, never values.
- **Logging:** use the injected `Logger`; `console` is lint-banned. Never log bodies, query strings, cookies, tokens or connection strings.
- **Database:** use the connection in `config/database.ts`. Models declare their indexes; production indexes are applied manually (see `docs/architecture.md`, "Database"). Never call `syncIndexes()` or run destructive operations against production.
- **Tenant isolation (from the workspace milestone on):** every query on workspace-owned data must be scoped by a workspace ID that the server resolved from the authenticated user's membership. A workspace ID sent by the client is only a lookup key, never proof of access. Enforce roles in services, not only in routes or the UI.
- **Async:** Express 5 forwards rejected promises to the error handler; do not add wrappers. `no-floating-promises` is an error.

## Frontend conventions

- All backend calls go through `apiRequest()` with a response schema from `shared`. It sends cookies, applies a timeout and validates responses.
- Only `NEXT_PUBLIC_*` variables may be used in the browser; they are public. The API base URL is validated at build time in `next.config.ts`.
- UI primitives live in `src/components/ui` (shadcn/ui, `new-york` style) and import `cn` from `@/lib/utils`. When adding shadcn components with the CLI, keep that import: recent CLI versions switch it to the separate `cn` npm package.
- Every data view handles loading, success, empty and error states.
- The design tokens are in `src/app/globals.css`; use them (`bg-primary`, `text-muted-foreground`, `bg-success`, …) instead of raw colors.

## Security

- Credentialed CORS with an explicit origin allowlist; never `*`.
- Sessions (next milestone): random token in an `HttpOnly`, `Secure`, `SameSite` cookie; only its SHA-256 hash is stored; sessions expire and can be revoked. Never put auth tokens in `localStorage`.
- Never trust frontend checks for permissions, plan limits or subscription status.
- Rate-limit authentication endpoints when they are added.

## Verification

Run before every commit, and report the real results:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build      # set NEXT_PUBLIC_API_BASE_URL for a production-like frontend build
```

For behavior changes, also run the built apps (`pnpm start:backend`, `pnpm start:frontend`) and check the affected flow in a browser.

## Git

- Branch `main`. Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Check `git status` and the staged file list before committing; `.env*` (except `.env.example`), `dist/`, `.next/` and keys must never appear.
