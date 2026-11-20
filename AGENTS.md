# AGENTS.md

Guidance for AI agents and contributors working in this repository. Read this file, `README.md` and `docs/architecture.md` before changing anything.

## Project

**MetaFlow AI**: a multi-tenant SaaS for AI-assisted social media management. Users connect Facebook Pages and Instagram Professional (Business/Creator) accounts, generate content with AI, and publish it with manual approval or automatically.

**Current milestone: 4 — social accounts (Meta).** Built: health checks, the dashboard shell, registration/login/logout with server-managed sessions, workspaces with owner/staff roles, and the Facebook Page / Instagram connection (OAuth, encrypted tokens, list, check, disconnect). The Meta integration is tested against simulated Meta responses only; it has not run against the real platform (see `docs/meta-setup.md`). The owner approved a 10-day MVP plan (workspaces → Meta connection → AI Studio → content → calendar and scheduling → publishing → automation → analytics and team → billing and super-admin). Production deployment stays postponed until the owner approves launch.

## Ground rules

1. **Never rebuild from scratch, restructure wholesale, or delete working functionality** without explicit owner approval.
2. **Inspect before editing.** Read the existing implementation and follow its patterns.
3. **Small, focused, testable changes.** One concern per commit.
4. **No fake functionality.** Unbuilt modules get an honest empty-state page (what the module will do and which milestone delivers it) and a "Soon" label in the navigation. Never mock data, sample numbers, or forms and buttons that look like they work.
5. **Never claim something works without running it.** Report actual command output, including failures and skipped checks. Never claim a deployment works until the live URLs have been tested.
6. **Keep docs in sync.** Update `README.md`, `.env.example` and `docs/` in the same change as the code they describe.
7. If a requested change conflicts with these rules or the architecture, **explain the conflict first**.

## Hard restrictions

- **Database:** MongoDB with Mongoose 8 only. Never introduce Prisma, MySQL or PostgreSQL.
- **Not yet:** do not build AI generation, publishing or advanced automation until their milestone is approved.
- **Separate project:** `D:\Projects\SiteForge` is unrelated. Never modify it or merge code from it.
- **Dependencies:** add a package only when it is clearly needed, pin exact versions, and prefer what is already installed.
- **Git:** never commit `.env` files or credentials. Never push or deploy without the owner's instruction.

## Architecture

| Folder      | Owns                                                                         | Must never contain                                                          |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `frontend/` | UI, client-side state, calls to the backend via `src/services/api-client.ts` | DB access, Meta/AI credentials, any secret (every `VITE_*` value is public) |
| `backend/`  | Auth, sessions, authorization, DB, integrations, business logic              | UI code                                                                     |
| `shared/`   | Zod contracts, inferred types, constants                                     | Secrets, DB code, Node- or browser-only APIs                                |

`frontend` and `backend` never import each other; shared code goes into `shared/`.

## Backend conventions

- **Layers:** `routes/` → `controllers/` → `services/` → `repositories/` → `models/`. Controllers are thin HTTP adapters; business logic lives in services, which take dependencies as arguments and never import Express or Mongoose. Services use repository **interfaces** (`repositories/*-repositories.ts`); the Mongoose implementation is injected in `server.ts`, an in-memory one in tests (`test/support/`).
- **Records, not documents:** repositories return plain records. A user record has no password field; the hash is returned only by the credentials lookup used for login.
- **Authenticated routes:** add `requireAuth` to the route and read the caller from `res.locals.auth`. Never take a user ID from the request for authorization.
- **Validation:** every input goes through `parseRequest(req, { body, query, params })` with Zod schemas from `validators/` or `shared/`. Never read `req.body`/`req.query`/`req.params` directly.
- **Errors:** throw `AppError` with a code from `shared/src/api/errors.ts`. Add a new code to `shared` together with the code that emits it. The central error handler formats every error response.
- **Configuration:** read environment variables only in `config/env.ts`. Production must fail fast on missing or invalid config, and error messages name variables, never values.
- **Logging:** use the injected `Logger`; `console` is lint-banned. Never log bodies, query strings, cookies, tokens or connection strings.
- **Database:** use the connection in `config/database.ts`. Models declare their indexes; production indexes are applied manually with `pnpm --filter @metaflow/backend db:indexes --apply` (see `docs/architecture.md`, "Database"). Never call `syncIndexes()` or run destructive operations against production.
- **Tests and data:** never point tests at the application database. Auth tests use in-memory repositories; MongoDB suites run only with `MONGODB_TEST_URI` and refuse database names without `test`.
- **Tenant isolation:** every workspace-scoped operation starts with `workspaceService.requireAccess(userId, workspaceId, { role? })`, which answers `NOT_FOUND` to non-members and `PERMISSION_DENIED` to members without the role. Every query on workspace-owned data must be scoped by the workspace ID it returns. A workspace ID sent by the client is only a lookup key, never proof of access. Enforce roles in services, not only in routes or the UI.
- **External platforms:** all calls to Meta go through `integrations/meta/meta-client.ts`. Verify endpoints, fields and permissions against Meta's current documentation before changing them; never guess. Tests use a fake `MetaClient` or a mocked `fetch`, never the network.
- **Stored secrets:** social access tokens are encrypted with `utils/secret-box.ts` before they reach a repository, bound to their record with a context string. Never store, log or return one in plaintext, and never add a token field to an API response.
- **Async:** Express 5 forwards rejected promises to the error handler; do not add wrappers. `no-floating-promises` is an error.

## Frontend conventions

- **Stack:** React 19 single-page app built with Vite, routed with React Router (`react-router-dom`). No server rendering; Vercel serves static files.
- **Folders:** `pages/` (one component per route), `routes/` (route table, guards, navigation config), `components/ui` (shadcn/ui primitives), `components/layout`, `components/common`, feature folders such as `components/system-status`, `services/` (API calls), `hooks/`, `contexts/`, `lib/` (config, utilities), `assets/`.
- **Routes:** add a route to `routes/router.tsx`; signed-in pages go under `ProtectedRoute` + `DashboardLayout` and are code-split with `lazy`. New modules are listed once in `routes/navigation.ts`, which drives both the sidebar and the routes.
- **Auth:** `useAuth()` gives `state` (`loading | anonymous | authenticated | error`) and `login`, `register`, `logout`, `retry`. Guards (`ProtectedRoute`, `GuestRoute`) only control what the UI shows; the backend authorizes every request. Change UI state only after the server confirms (no optimistic sign-out). Forms validate with the shared Zod schemas and map server errors with `lib/form-errors.ts`.
- **API calls** go through `apiRequest()` in `services/api-client.ts` with a response schema from `shared`. It sends cookies, applies a timeout and validates responses. Never call `fetch` directly from components.
- **Environment:** only `VITE_*` variables reach the browser, and all of them are public. `vite.config.ts` validates `VITE_API_BASE_URL` at build time and refuses secret-looking `VITE_` names. Read them only in `lib/config.ts`.
- **Imports:** never import backend code (lint-enforced); use the `@metaflow/shared` entry point only.
- UI primitives live in `src/components/ui` (shadcn/ui, `new-york` style) and import `cn` from `@/lib/utils`. When adding shadcn components with the CLI, keep that import: recent CLI versions switch it to the separate `cn` npm package. Remove any `'use client'` lines the CLI adds; they mean nothing in Vite.
- Every page has exactly one `<h1>` and sets its tab title with `useDocumentTitle()`. Every data view handles loading, success, empty and error states.
- The design tokens are in `src/index.css`; use them (`bg-primary`, `text-muted-foreground`, `bg-success`, …) instead of raw colors.

## Security

- Credentialed CORS with an explicit origin allowlist; never `*`.
- Sessions: random 256-bit token in an `HttpOnly` cookie (`Secure` + `__Host-` in production, `SameSite` from config); only its SHA-256 hash is stored; sessions expire and can be revoked. Never put auth tokens in `localStorage` or expose them to JavaScript.
- Passwords: scrypt via `utils/password.ts` only. Never log, return or store a plain password; never return a hash.
- Keep auth errors generic where they could reveal accounts (`INVALID_CREDENTIALS`).
- State-changing endpoints are covered by the `Origin` check; new auth-like endpoints (password reset, etc.) need rate limits.
- Never trust frontend checks for permissions, plan limits or subscription status.

## Verification

Run before every commit, and report the real results:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build      # set VITE_API_BASE_URL for a production-like (cross-origin) frontend build
```

For behavior changes, also run the built apps (`pnpm start:backend`, `pnpm start:frontend`, which serves `frontend/dist` with `vite preview`) and check the affected flow in a browser, including a reload on a nested route.

## Git

- Branch `main`. Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Check `git status` and the staged file list before committing; `.env*` (except `.env.example`), `dist/`, `.next/` and keys must never appear.
- pnpm only: `package-lock.json` and `yarn.lock` are git-ignored because a stray one would make Vercel or Render use the wrong package manager.
