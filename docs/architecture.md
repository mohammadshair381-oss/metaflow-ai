# Architecture

## System overview

```
 Browser
   │  HTTPS
   ▼
 Vercel ── frontend/ (Next.js 15, React 19)
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

`frontend` and `backend` never import each other. Anything both need goes into `shared`.

`shared` is consumed as TypeScript source: Next.js compiles it via `transpilePackages`, and the backend's tsup build bundles it into `backend/dist/server.js`. No separate build step is needed.

## Backend

### Layers

```
routes/        URL → controller mapping only
controllers/   HTTP adapter: parse input (validators/), call a service, set status/headers
services/      Business logic. No Express types. Unit-testable with fakes
models/        Mongoose schemas and indexes (none yet; first models arrive with authentication)
validators/    Zod request schemas and parseRequest()
middleware/    Cross-cutting HTTP concerns
config/        Environment, database connection, CORS, app info
utils/         Errors, logging, redaction
```

`app.ts` builds the Express app from injected dependencies and has no side effects. `server.ts` loads configuration, connects to MongoDB, listens, and handles shutdown.

### Request pipeline

Order in `app.ts`:

1. `requestId`: accepts a safe `X-Request-Id` or generates one, and echoes it in the response.
2. `requestLogger`: one JSON line per request: method, path (never the query string), status, duration. Health checks log at `debug`.
3. `helmet`: security headers.
4. `cors`: explicit origin allowlist with credentials. Unlisted origins get no CORS headers.
5. `express.json` with a 100 KB limit.
6. Routes under `/api`.
7. `notFoundHandler` → `NOT_FOUND`.
8. `errorHandler`: turns every error into the shared envelope.

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

| Code                | HTTP | Raised by                                    |
| ------------------- | ---- | -------------------------------------------- |
| `BAD_REQUEST`       | 400  | Malformed JSON body                          |
| `VALIDATION_ERROR`  | 400  | `parseRequest()` / Zod                       |
| `NOT_FOUND`         | 404  | Unknown route                                |
| `PAYLOAD_TOO_LARGE` | 413  | Body above the limit                         |
| `INTERNAL_ERROR`    | 500  | Anything unexpected; details are logged only |

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
- **Indexes are never built automatically in production** (`autoIndex` and `autoCreate` are on only outside production). Procedure once models exist:
  1. Declare indexes in the schema (unique and compound indexes included).
  2. Review index changes in the pull request like a migration.
  3. Apply them deliberately with a one-off script that calls `Model.createIndexes()` for the changed models, run against production by an operator, ideally at low traffic.
  4. Never run `syncIndexes()` against production unreviewed: it **drops** indexes that are not in the schema.

  The script will be added together with the first models.

## Authentication and sessions (planned design)

Not implemented in this milestone. This is the agreed design for the next one.

- **Server-managed sessions**, not JWTs in browser storage.
- **Token:** 32 random bytes from `crypto.randomBytes`, base64url-encoded, sent to the browser once in a cookie.
- **Storage:** MongoDB `sessions` collection stores only the **SHA-256 hash** of the token, with `userId`, `createdAt`, `lastSeenAt` and `expiresAt`. A unique index on the hash; a TTL index on `expiresAt` removes expired sessions.
- **Lifetime:** idle timeout plus an absolute maximum lifetime. The token is rotated on login.
- **Revocation:** logout deletes the session. A password change deletes all of the user's sessions.
- **Cookie:** `HttpOnly`, `Secure` in production, `Path=/`, `SameSite=Lax` once same-site domains are in place (see below). Use the `__Host-` prefix when the cookie is host-only.
- **CORS:** explicit origins with `credentials: true`; never a wildcard.
- **CSRF:** `SameSite` plus an `Origin` header check against `CORS_ORIGINS` for every state-changing method.
- **Passwords:** a slow, salted hash (scrypt or Argon2id) and rate-limited login, without revealing whether an email exists.

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

Interim alternative (not implemented): proxy `/api/*` through Next.js rewrites on the Vercel domain, so the browser sees a single origin. This adds a network hop and couples the API to Vercel's proxy limits, so it is a stopgap, not the target architecture.

The health checks in this milestone use no cookies, so they work on the default domains today.

## Background worker (later)

Publishing and scheduling will need a separate worker (BullMQ on Redis). It is not created or deployed until that milestone, and will reuse `shared/` and backend services instead of duplicating them.
