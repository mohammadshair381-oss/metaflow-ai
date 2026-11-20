# Architecture

## System overview

```
 Browser
   │  HTTPS
   ▼
 Vercel ── frontend/ (React 19 single-page app, built by Vite, served as static files)
   │
   │  HTTPS, fetch with credentials: 'include'
   │  allowed only for origins listed in CORS_ORIGINS
   ▼
 Render ── backend/ (Express 5 API)
   │
   │  TLS, credentials held only by the backend
   ▼
 MongoDB Atlas
```

The frontend never talks to the database or to third-party APIs (Meta, AI providers) directly. Every privileged operation goes through the backend, which holds all secrets.

## Workspace packages

| Package              | Folder      | Responsibility                                                              | May import            |
| -------------------- | ----------- | --------------------------------------------------------------------------- | --------------------- |
| `@metaflow/shared`   | `shared/`   | API contracts as Zod schemas, inferred types, constants. No secrets, no I/O | `zod`                 |
| `@metaflow/backend`  | `backend/`  | HTTP API, auth, authorization, database, integrations                       | `shared`, server libs |
| `@metaflow/frontend` | `frontend/` | User interface; calls the backend through one API client                    | `shared`, UI libs     |

`frontend` and `backend` never import each other (the frontend's ESLint config enforces this). Anything both need goes into `shared`, imported through its single entry point.

`shared` is consumed as TypeScript source: Vite compiles it along with the frontend, and the backend's tsup build bundles it into `backend/dist/server.js`. No separate build step is needed.

## Frontend

A client-rendered React 19 single-page app. Vite builds it into static files in `frontend/dist/`, and Vercel serves them; there is no frontend server.

### Structure

```
index.html            HTML shell; loads src/main.tsx
src/main.tsx          mounts <App/>, loads fonts and styles
src/App.tsx           AuthProvider + RouterProvider
src/routes/           router.tsx (route table), protected-route.tsx, guest-route.tsx,
                      navigation.ts (modules: path, label, icon, description, milestone)
src/pages/            one component per route
src/components/       ui/ (shadcn/ui), layout/ (shells, nav), common/ (empty state, notices…),
                      system-status/, overview/
src/services/         api-client.ts (all HTTP), health.service.ts
src/contexts/         session state for the UI
src/hooks/            use-backend-status, use-document-title
src/lib/              config.ts (public env), utils.ts
```

### Routing

React Router (`createBrowserRouter`). Public routes (`/`, `/login`, `/register`) are in the main bundle. The signed-in area (`DashboardLayout`, `/dashboard` and the module pages) is code-split with route `lazy` functions, so the landing page doesn't download it.

Deep links and browser refreshes on nested paths work because the server answers every unknown path with `index.html`: Vite's dev and preview servers do this by default, and on Vercel the `rewrites` rule in `frontend/vercel.json` does it. Static files are served before rewrites apply, so assets are unaffected.

### Session state and route guards

`AuthProvider` (`contexts/`) restores the session on load with `GET /api/auth/me`. The browser sends the HTTP-only cookie automatically; JavaScript never sees the token. It exposes `state` plus `login`, `register`, `logout` and `retry`. The state is one of:

| State           | Meaning                                          | `ProtectedRoute`                             | `GuestRoute` (`/login`, `/register`)                                       |
| --------------- | ------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| `loading`       | Session check in flight                          | "Checking your session…"                     | "Loading…" (no flash of the form)                                          |
| `anonymous`     | `/me` answered 401                               | Redirects to `/login`, remembering the path  | Renders the form                                                           |
| `authenticated` | `/me`, login or registration succeeded           | Renders                                      | Redirects to the remembered path or `/dashboard`; never to an external URL |
| `error`         | Server unreachable: the session state is unknown | "Can't reach MetaFlow AI" with **Try again** | Renders the form with a warning                                            |

`error` is deliberately separate from `anonymous`, so an outage never looks like being signed out. The UI changes state only after the server confirms: a failed sign-out keeps the user signed in and says so. The guards only shape the UI; **the API authorizes every request on its own**.

Forms (`pages/login-page.tsx`, `pages/register-page.tsx`) validate with the same Zod schemas the API uses (`@metaflow/shared`) before sending. Server errors are mapped back onto fields (`VALIDATION_ERROR` details, `EMAIL_TAKEN`) or shown as one form-level message (`INVALID_CREDENTIALS`, `RATE_LIMITED`).

### API access

All HTTP goes through `apiRequest()` (`services/api-client.ts`), which:

- prefixes `VITE_API_BASE_URL`, or nothing for same-origin `/api`;
- sends `credentials: 'include'`, ready for cookie sessions;
- applies a timeout (15 s) and passes caller cancellations through;
- classifies failures as `network`, `timeout`, `http` (with the backend's error code and request ID) or `invalid_response`;
- validates every response against a Zod schema from `shared`.

| Environment           | `VITE_API_BASE_URL`        | Request path                                                 |
| --------------------- | -------------------------- | ------------------------------------------------------------ |
| `pnpm dev`            | empty                      | Same-origin `/api` → Vite proxy → `localhost:4000` (no CORS) |
| `pnpm start:frontend` | empty or a URL             | Same as dev, or cross-origin when set                        |
| Vercel                | `https://<render-service>` | Cross-origin to Render, credentialed CORS                    |

The dashboard's connection status comes from live calls to `/api/health` and `/api/health/ready`: **Connected** when both succeed and the API is ready, **Degraded** when the API answers but readiness fails, and **Unreachable** when liveness fails (down, CORS refusal, timeout or unrecognized response).

### Configuration safety

Only `VITE_*` variables are embedded in the bundle, and all of them are public. `vite.config.ts`:

- refuses to build if any `VITE_` variable name looks like a secret (`SECRET`, `PASSWORD`, `TOKEN`, `MONGODB`, `API_KEY`, …);
- requires `VITE_API_BASE_URL` on Vercel, accepts only an `http(s)` origin with no path, and requires `https` for production deployments.

`API_PROXY_TARGET` (dev proxy target) is read by the build tool only and never reaches the browser.

## Backend

### Layers

```
routes/        URL → controller mapping only
controllers/   HTTP adapter: parse input (validators/), call a service, set status/headers/cookies
services/      Business logic. No Express types. Throws AppError
repositories/  Data-access interfaces (auth-repositories.ts) and their Mongoose implementation
models/        Mongoose schemas and indexes (User, Session)
validators/    Zod request schemas and parseRequest()
middleware/    Cross-cutting HTTP concerns (auth, origin check, rate limits, errors, logging)
config/        Environment, database connection, CORS, session cookie, app info
utils/         Errors, logging, redaction, password hashing, session tokens, cookie parsing
scripts/       Operator commands (db:indexes)
```

`app.ts` builds the Express app from injected dependencies and has no side effects. `server.ts` loads configuration, connects to MongoDB, wires the Mongoose repositories, listens, and handles shutdown.

Services depend on **repository interfaces**, not on Mongoose. The server injects the MongoDB implementation; tests inject an in-memory one (`backend/test/support/`), so the suite needs no database. A separate suite (`auth-mongo.test.ts`) runs the MongoDB repositories against a real database when `MONGODB_TEST_URI` is set.

### Request pipeline

Order in `app.ts`:

1. `requestId`: accepts a safe `X-Request-Id` or generates one, and echoes it in the response.
2. `requestLogger`: one JSON line per request: method, path (never the query string), status, duration. Health checks log at `debug`.
3. `helmet`: security headers.
4. `cors`: explicit origin allowlist with credentials. Unlisted origins get no CORS headers.
5. `requireTrustedOrigin`: state-changing requests (POST/PUT/PATCH/DELETE) that carry an `Origin` header must come from `CORS_ORIGINS`, otherwise 403 `FORBIDDEN` (CSRF defence).
6. `express.json` with a 100 KB limit.
7. Routes under `/api`. Auth routes add `Cache-Control: no-store`, rate limits, and `requireAuth` where needed.
8. `notFoundHandler` → `NOT_FOUND`.
9. `errorHandler`: turns every error into the shared envelope.

### Error contract

Every non-2xx JSON response has this shape (`apiErrorResponseSchema` in `shared/`):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "2f1c…",
    "details": [
      { "path": "body.name", "message": "Too small: expected string to have >=2 characters" }
    ]
  }
}
```

| Code                         | HTTP | Raised by                                                                   |
| ---------------------------- | ---- | --------------------------------------------------------------------------- |
| `BAD_REQUEST`                | 400  | Malformed JSON body                                                         |
| `VALIDATION_ERROR`           | 400  | `parseRequest()` / Zod                                                      |
| `UNAUTHENTICATED`            | 401  | No valid session (missing, expired, revoked, or the user is not active)     |
| `INVALID_CREDENTIALS`        | 401  | Login with a wrong email or password (same message for both)                |
| `FORBIDDEN`                  | 403  | State-changing request from an origin not in `CORS_ORIGINS`                 |
| `PERMISSION_DENIED`          | 403  | Signed in, but the workspace role does not allow the action                 |
| `NOT_FOUND`                  | 404  | Unknown route                                                               |
| `EMAIL_TAKEN`                | 409  | Registration with an email that already has an account                      |
| `LIMIT_REACHED`              | 409  | A per-user limit would be exceeded (owned workspaces)                       |
| `PAYLOAD_TOO_LARGE`          | 413  | Body above the limit                                                        |
| `RATE_LIMITED`               | 429  | Too many register/login attempts                                            |
| `INTERNAL_ERROR`             | 500  | Anything unexpected; details are logged only                                |
| `INTEGRATION_ERROR`          | 502  | Meta refused or failed a request                                            |
| `INTEGRATION_NOT_CONFIGURED` | 503  | Connecting accounts without Meta settings on the server                     |
| `GENERATION_REFUSED`         | 422  | The AI model or its safety system declined to write the content             |
| `SERVICE_UNAVAILABLE`        | 503  | MongoDB unreachable (connection/selection errors), instead of a generic 500 |

Services throw `AppError`. Messages of unexpected errors and stack traces never reach clients.

### Health model

| Endpoint                | Purpose   | Touches DB | Status codes               |
| ----------------------- | --------- | ---------- | -------------------------- |
| `GET /api/health`       | Liveness  | No         | 200 while the process runs |
| `GET /api/health/ready` | Readiness | Yes (ping) | 200 ready · 503 not ready  |

Readiness reports the database as `up`, `down` or `not_configured` (no `MONGODB_URI`, development only). Render's health check uses **liveness**, so a database outage doesn't make Render restart a healthy process. Use readiness for monitoring and alerts.

### Configuration and secrets

- `config/env.ts` is the only place that reads `process.env`. It validates everything with Zod at startup and exits with a list of invalid variable **names** (never values).
- Production requires `MONGODB_URI` and `CORS_ORIGINS`, and CORS origins must be `https`.
- The logger masks keys such as `password`, `token`, `cookie`, `authorization`, `secret`, `apiKey` and `*uri`, and strips credentials from MongoDB connection strings in messages and stack traces.

## Database

- **Connection:** `config/database.ts` wraps Mongoose's default connection. The server starts listening first, then connects in the background with exponential backoff (1 s → 30 s). This keeps liveness available during an Atlas outage.
- **Fail fast:** `bufferCommands` is off, so queries fail immediately while disconnected instead of hanging.
- **Collections and indexes** (declared in `backend/src/models/`):

  | Collection              | Index                                                                        | Purpose                                                                  |
  | ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
  | `users`                 | `users_email_unique` (unique)                                                | One account per normalized email; makes duplicate registration race-safe |
  | `sessions`              | `sessions_token_hash_unique`                                                 | Session lookup by token hash                                             |
  | `sessions`              | `sessions_user_revoked`                                                      | "Sign out everywhere" (`userId` + `revokedAt`)                           |
  | `sessions`              | `sessions_expires_ttl` (TTL)                                                 | MongoDB deletes sessions once `expiresAt` has passed                     |
  | `workspace_memberships` | `memberships_workspace_user_unique`                                          | One membership per user and workspace; member lookups                    |
  | `workspace_memberships` | `memberships_user_role`                                                      | A user's workspaces and owned-workspace count                            |
  | `social_accounts`       | `social_accounts_workspace_platform_external_unique`                         | One connection per account and workspace; a workspace's accounts         |
  | `oauth_states`          | `oauth_states_hash_unique`                                                   | Lookup and single use of a pending authorization                         |
  | `oauth_states`          | `oauth_states_ttl` (TTL)                                                     | MongoDB deletes expired authorizations                                   |
  | `ai_generations`        | `ai_generations_workspace_recent`, `ai_generations_workspace_feature_recent` | A workspace's generation history, newest first, by feature               |
  | `ai_usage`              | `ai_usage_workspace_time`                                                    | A workspace's usage for a period                                         |
  | `posts`                 | `posts_workspace_recent`, `posts_workspace_status_recent`                    | A workspace's posts, newest first, by status                             |

- **Indexes are never built automatically in production** (`autoIndex` and `autoCreate` are on only outside production). The procedure:
  1. Declare indexes in the schema and review index changes in the pull request like a migration.
  2. Check what is missing, read-only: `pnpm --filter @metaflow/backend db:indexes` (uses `MONGODB_URI`; prints only the database name).
  3. Create the missing ones deliberately: `pnpm --filter @metaflow/backend db:indexes --apply`. It uses `Model.createIndexes()`, which only adds.
  4. Never run `syncIndexes()` against production: it **drops** indexes that are not in the schema.

  **Run step 3 against the production database before the first real sign-up.** Without the unique email index, two simultaneous registrations could create duplicate accounts.

## Authentication and sessions

Server-managed sessions in HTTP-only cookies. No JWTs, and nothing in `localStorage`.

**Endpoints** (`/api/auth`, all responses `Cache-Control: no-store`):

| Method & path      | Auth     | Result                                                                         |
| ------------------ | -------- | ------------------------------------------------------------------------------ |
| `POST /register`   | –        | 201 `{ user }` and a session cookie. 409 `EMAIL_TAKEN`, 400 `VALIDATION_ERROR` |
| `POST /login`      | –        | 200 `{ user }` and a new session cookie. 401 `INVALID_CREDENTIALS` (generic)   |
| `POST /logout`     | optional | 204; revokes the current session (if any) and clears the cookie. Idempotent    |
| `POST /logout-all` | required | 204; revokes **every** session of the signed-in user ("sign out everywhere")   |
| `GET /me`          | required | 200 `{ user }`, or 401 `UNAUTHENTICATED`                                       |

`user` is `{ id, name, email, status, emailVerified, createdAt }` (`authUserSchema` in `shared/`). Password data never appears in any response: repositories return user records without a hash field, except for the single credentials lookup inside the login service.

**Passwords**

- Node.js `scrypt` with N=2^15, r=8, p=3 (32 MiB per hash), one of the equivalent minimum settings in the OWASP Password Storage Cheat Sheet, with a 16-byte random salt and a 64-byte key. Stored as `scrypt$N$r$p$salt$key`, and each hash is verified with the parameters it records, so the settings can be raised later and hashes made earlier (p=1 during development) keep working.
- NFKC Unicode normalization; comparison with `timingSafeEqual`. Malformed or out-of-bounds stored hashes are rejected without throwing.
- Policy (shared by API and forms): 10–128 characters, not a known common password, at least 3 distinct characters. Length plus a blocklist, as in NIST SP 800-63B; no composition rules.

**Sessions**

- **Token:** 32 random bytes (`crypto.randomBytes`), base64url. Sent only in the cookie.
- **Storage:** the `sessions` collection stores only the SHA-256 hash of the token (the schema rejects anything that isn't a 64-character hex digest), plus `userId`, `expiresAt`, `revokedAt`, `revokedReason` (`logout`, `logout_all` or `replaced`) and `createdAt`.
- **Lifetime:** absolute, `SESSION_TTL_DAYS` (default 7). The cookie expires at the same moment. There is no idle timeout and no sliding renewal yet.
- **Validation** (every protected request): well-formed token → session found → not revoked → not expired → user exists and is `active`. Any failure is 401, and a stale cookie is cleared.
- **Revocation:** logout revokes the current session, logout-all revokes all of the user's sessions, and signing in from a browser that already holds a session **replaces** it (no session fixation). Revoked sessions stay until their TTL expiry, for audit.

**Cookie:** `HttpOnly`, `Path=/`, and `SameSite` from `SESSION_COOKIE_SAMESITE` (default `Lax`). In production it is also `Secure` and named `__Host-metaflow_session` (the browser then enforces Secure, Path=/ and no Domain). In development it is named `metaflow_session` and not Secure (plain-http localhost).

**Defences**

- **Account enumeration:** login answers "Incorrect email or password" for both unknown emails and wrong passwords, and an unknown email still runs a full scrypt check against a decoy hash, so timing matches. Suspended accounts get the same answer. Registration does reveal a taken email (409); there is no email system yet that could notify the owner instead. The rate limits bound how fast this can be probed.
- **Brute force:** per client IP, 30 register/login requests per 15 minutes. Per account from one IP, 10 **failed** logins per 15 minutes; per account from all IPs together, 50 failed logins per 15 minutes (successful logins count toward neither). A request already refused for its IP does not count toward the account-wide limit, so one IP cannot lock an account out, and locking it out takes failures from at least 5 IPs. Unknown emails are limited exactly like existing accounts (no database lookup). All limits answer 429 `RATE_LIMITED`. The counters are in memory: correct for one backend instance; several instances will need a shared store (Redis).
- **CSRF:** `SameSite` cookies plus the `Origin` check on every state-changing request.
- **Trust:** identity comes only from the server-side session (`res.locals.auth`). IDs in request bodies or headers are never used for authorization (tested: `logout-all` ignores a `userId` in the body).

**Not built yet:** email verification (the `emailVerifiedAt` field exists, with no flow), password reset and password change, a list of active sessions, account deletion.

## Workspaces and tenant isolation

A workspace is one business or brand. Everything a customer creates later (social accounts, posts, media, automations) belongs to exactly one workspace.

**Data:** `workspaces` (name, description, category, IANA `timezone`, `defaultLanguage`, `status`, `archivedAt`, `createdBy`) and `workspace_memberships` (`workspaceId`, `userId`, `role`). Access is decided only by memberships; `createdBy` is an audit field.

**Roles:** `owner` (edit the profile, archive; later billing, members and social accounts) and `staff` (use the workspace; no owner-only actions). Platform administration will be a separate concept on the user, never a workspace role.

**The gate:** `workspaceService.requireAccess(userId, workspaceId, { role? })` is the single entry point for workspace-scoped work, and later modules must call it before touching workspace data.

- The user ID always comes from the session; the workspace ID from the URL is only a lookup key.
- Not a member, unknown ID or archived workspace → 404 `NOT_FOUND` with one identical message, so IDs cannot be probed.
- Member without the required role → 403 `PERMISSION_DENIED`.
- IDs are validated as 24-hex strings before any lookup. Update bodies are strict: unknown fields such as `role`, `status` or another workspace's ID are rejected.

**Endpoints** (`/api/workspaces`, session required, `Cache-Control: no-store`):

| Method & path                | Who    | Result                                                                 |
| ---------------------------- | ------ | ---------------------------------------------------------------------- |
| `GET /`                      | user   | Active workspaces the caller belongs to, each with the caller's `role` |
| `POST /`                     | user   | 201; the caller becomes owner. 409 `LIMIT_REACHED` above 10 owned      |
| `GET /:workspaceId`          | member | The workspace                                                          |
| `PATCH /:workspaceId`        | owner  | Updates only the fields sent                                           |
| `POST /:workspaceId/archive` | owner  | 204. Body `{ confirmName }` must equal the workspace name              |
| `GET /:workspaceId/members`  | member | Members with name, email, role and join date                           |

**Archiving** hides the workspace from every member and makes it read-only; nothing is deleted. There is no restore or permanent delete yet.

**Frontend:** `WorkspaceProvider` (inside the dashboard layout) loads the list and tracks the active workspace; `WorkspaceGate` renders pages only once one is active and asks a user without any to create the first. The active workspace ID is remembered per user in `localStorage`; it is a display preference, not a credential.

**Not built yet:** logo upload (needs the media storage layer), brand voice (AI milestone), invitations and role changes (team milestone), plan-based workspace limits (billing milestone; the limit of 10 is a fixed safety cap until then).

## Social accounts (Meta)

Facebook Pages and Instagram professional accounts are connected to one workspace through Meta's Facebook Login. Setup and external requirements: [meta-setup.md](meta-setup.md).

**Status:** verified with simulated Meta responses and against the local database. Not yet run against the real Meta platform.

**Data:** `social_accounts` (workspace, platform, Meta's account ID, name, username, type, picture URL, status, issue, granted and missing permissions, encrypted token, `linkedPageId`, who connected it and when, last check) and `oauth_states` (hash of the `state` value, user, workspace, platform, expiry, `consumedAt`; deleted by a TTL index).

**Connection flow**

1. `POST /api/workspaces/:id/social-accounts/connect` (owner). The server creates a 256-bit random `state`, stores only its SHA-256 hash with the user, workspace and platform, valid 10 minutes, and returns Facebook's dialog URL. The browser navigates there.
2. Meta redirects the browser to `GET /api/social/meta/callback?code&state`.
3. The callback, in this order: consumes the state atomically (unknown, used or expired → stop); requires the session user to be the user who started it; re-checks that user is still the workspace owner; then exchanges the code, upgrades to a long-lived user token, reads granted permissions and the person's Pages.
4. It saves one record per Page (Facebook) or per Instagram account linked to a Page (Instagram), each with that Page's access token, encrypted. The user token is discarded.
5. It always answers with a redirect to `<web app>/accounts?meta=<result>&count=<n>`. The result is one of a fixed list; nothing from Meta or from the callback URL is echoed, and the destination comes from server configuration only.

**Protections**

| Risk                                    | Defence                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CSRF / connecting an attacker's account | `state` is unguessable, single-use and bound to the user's session                                                                              |
| State replay, code reuse                | The state is consumed before the code is exchanged; a second use is refused                                                                     |
| Cross-workspace access                  | The workspace comes from the stored state, never from the URL; every account query is scoped by workspace after `requireAccess`                 |
| Open redirect                           | The callback redirects only to the configured web app origin, path `/accounts`; the web app only follows `https://www.facebook.com`             |
| Token leakage                           | Tokens are encrypted at rest, excluded from queries by default, absent from every response type, and sent to Meta in the `Authorization` header |
| Duplicate connections                   | Unique index on workspace + platform + Meta account ID; reconnecting updates the same record                                                    |

**Token encryption:** AES-256-GCM (`utils/secret-box.ts`), stored as `v1.<keyId>.<iv>.<tag>.<ciphertext>`. The key ID allows rotation (`SOCIAL_TOKEN_ENCRYPTION_KEYS`: first key encrypts, all decrypt). Each value is bound to its record (workspace, platform, account ID) as additional authenticated data, so a ciphertext copied to another record does not decrypt. The schema rejects anything not in this format, so a plaintext token cannot be saved by mistake.

**Account health:** `status` is `connected` or `needs_reconnect`, with an `issue`: `token_invalid` (Meta error 190 or 102, or an unreadable stored token), `missing_permissions` (a required permission was not granted, or Meta error 10 / 200–299) or `insufficient_page_role` (no `CREATE_CONTENT` task on the Page). "Check connection" re-reads the account from Meta and updates this.

**Endpoints** (`/api/workspaces/:workspaceId/social-accounts`, session required):

| Method & path              | Who    | Result                                                                                                              |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `GET /`                    | member | `{ accounts, integration: { configured } }`                                                                         |
| `POST /connect`            | owner  | `{ authorizationUrl }`. 503 `INTEGRATION_NOT_CONFIGURED` without Meta settings. Limited to 20 per 15 minutes per IP |
| `GET /:accountId`          | member | The account                                                                                                         |
| `POST /:accountId/refresh` | member | The account after a check against Meta. 502 `INTEGRATION_ERROR` when Meta is unavailable                            |
| `DELETE /:accountId`       | owner  | 204. Deletes the connection and its token                                                                           |

**Decisions:** the same Page may be connected to several workspaces (agencies), each with its own record. Disconnecting deletes the record; it does not revoke the app on Facebook.

**Adding a platform later:** add a client under `integrations/`, a value to `SOCIAL_PLATFORMS`, and a branch in the social account service. Models, repositories, encryption, routes and the UI are platform-neutral.

## AI Studio

Captions, hashtags and content ideas for one workspace, written by one AI provider the server is configured with. Setup and external requirements: [ai-setup.md](ai-setup.md).

**Status:** verified with simulated provider responses (all three adapters) and against the local database. No real provider has been called yet.

**Layers**

| Part              | Where                                                                                                        | Job                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider adapters | `integrations/ai/anthropic-provider.ts` (official SDK), `openai-provider.ts`, `gemini-provider.ts` (`fetch`) | One request shape each; map every failure to one `AiErrorKind`; return parsed JSON and the token usage the provider reported                                                               |
| Model resolver    | `integrations/ai/ai-model-resolver.ts`                                                                       | Picks provider and model per feature and workspace. Today: one model from the environment for everything. Later: admin-managed providers and plan-based routing behind the same interface  |
| Retry policy      | `integrations/ai/ai-retry.ts`                                                                                | At most one retry, to the same model, only after a fast failure the provider marks as not processed. Never after a timeout. Refusals are final: never retried, never sent to another model |
| Prompts           | `services/ai-prompts.ts`                                                                                     | Business context and brand voice as quoted data, rules, the task, and a JSON schema in the subset all providers accept                                                                     |
| Output checks     | `services/ai-output.ts`                                                                                      | Lengths, counts, hashtag format, idea types and platforms. Invalid items are dropped; nothing usable left is a failure                                                                     |
| Service           | `services/ai-studio.service.ts`                                                                              | `requireAccess` first, then resolve the model, generate, check, record usage (also on failure), save the generation                                                                        |

**Data:** `ai_generations` (workspace, user, feature, the settings used, the output, provider, model, usage) and `ai_usage` (one entry per request, successful or not: provider, configured and serving model, status, failure kind, tokens, estimated cost, latency). Neither stores a prompt. Token counts and costs are null when unknown, and usage totals skip nulls instead of counting them as zero. The brand voice is a subdocument of the workspace (`workspaces.brandVoice`); "About the business" and the content language are the workspace's own `description` and `defaultLanguage`, shared with workspace settings.

**Endpoints** (`/api/workspaces/:workspaceId/ai`, session required):

| Method & path      | Who    | Result                                                                                                                        |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /status`      | member | `{ configured, provider, model, costEstimates }`; never the key                                                               |
| `POST /captions`   | member | 201 `{ generation }`. 503 `INTEGRATION_NOT_CONFIGURED`, 502 `INTEGRATION_ERROR`, 422 `GENERATION_REFUSED`, 429 `RATE_LIMITED` |
| `POST /hashtags`   | member | Same                                                                                                                          |
| `POST /ideas`      | member | Same                                                                                                                          |
| `GET /brand-voice` | member | `{ brandVoice }` with `configured`                                                                                            |
| `PUT /brand-voice` | owner  | Replaces it, including the shared description and language                                                                    |
| `GET /generations` | member | Newest first; `feature`, `before` (cursor), `limit` (max 50)                                                                  |
| `GET /usage`       | member | Totals for the current UTC month                                                                                              |

Request bodies are strict: a `provider`, `model`, `system` or `prompt` field is rejected with 400. Generation is limited to 30 requests per user per 10 minutes.

**Drafts** (`/api/workspaces/:workspaceId/posts`): `POST /` saves a draft (any member; `generationId` must belong to the same workspace), `GET /` lists posts newest first. This is the first part of the `posts` collection: status is always `draft` for now, and the content milestone adds editing, media, approval and scheduling to the same model.

## Cross-site cookies and custom domains

On default hosting domains, the frontend (`*.vercel.app`) and the API (`*.onrender.com`) are on **different sites**. A session cookie set by the API is then a **third-party cookie** from the frontend's point of view:

- It must be `SameSite=None; Secure` to be sent at all.
- **Safari blocks third-party cookies by default.** Brave blocks them too. Firefox isolates them per site, and its strict mode blocks them. Chrome allows them by default, but users can block them and Incognito blocks them.
- So **sign-in would silently fail for a large share of users**, especially on iPhone and Mac.

**Recommendation: use a custom domain before shipping authentication.**

| Part     | Domain               | Host   |
| -------- | -------------------- | ------ |
| Frontend | `app.yourdomain.com` | Vercel |
| Backend  | `api.yourdomain.com` | Render |

Both are then the **same site** (`yourdomain.com`). The session cookie is first-party, `SameSite=Lax` works in every browser, and CORS still restricts which origins may call the API. Both Vercel and Render support custom domains with automatic TLS.

Interim alternative (not implemented): add a Vercel rewrite from `/api/:path*` to the Render URL in `frontend/vercel.json` and leave `VITE_API_BASE_URL` empty, so the browser sees a single origin, as it does with the local dev proxy (the `VITE_API_BASE_URL` requirement in `vite.config.ts` would have to be relaxed for that). This adds a network hop and couples the API to Vercel's proxy limits, so it is a stopgap, not the target architecture.

**How this maps to configuration (authentication is built; the production setup is not decided yet):**

| Setup                                              | `SESSION_COOKIE_SAMESITE` | Works in                                                                      |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| Local development (Vite proxy or localhost ports)  | `lax` (default)           | All browsers: same site                                                       |
| Custom domain: `app.` and `api.` of one domain     | `lax` (default)           | All browsers: **recommended**                                                 |
| Default domains: `*.vercel.app` → `*.onrender.com` | `none`                    | Unreliable: works in Chrome; fails in Safari, Brave and Firefox's strict mode |

The backend refuses `none` outside production, because browsers reject `SameSite=None` without `Secure`. The health checks use no cookies, so they work on any setup.

## Background worker (later)

Publishing and scheduling will need a separate worker (BullMQ on Redis). It is not created or deployed until that milestone, and will reuse `shared/` and backend services instead of duplicating them.
