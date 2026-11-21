# MetaFlow AI

AI-powered social media automation SaaS. Businesses, creators and agencies will connect Facebook Pages and Instagram Professional accounts, generate content with AI, and schedule or auto-publish it.

> **Status: Milestone 6 — Content management and media library (built and tested locally; not deployed).**
> Users can register and sign in, manage workspaces, connect Facebook Pages and Instagram professional accounts, use AI Studio to write captions, hashtags and content ideas in their brand voice, upload photos and videos to a media library, and write posts with media and destination accounts that the workspace owner approves. Nothing is published yet: scheduling and publishing are the next milestone. The Meta and AI integrations are tested against simulated responses; running them for real needs a Meta app ([docs/meta-setup.md](docs/meta-setup.md)) and an AI provider key ([docs/ai-setup.md](docs/ai-setup.md)). Production deployment is postponed.

## Architecture

```
Browser ──► Vercel: frontend/ (React SPA, static) ──HTTPS + credentialed CORS──► Render: backend/ (Express) ──► MongoDB Atlas
```

One repository, three pnpm workspace packages:

```
metaflow-ai/
├── frontend/          React 19 + Vite single-page app (deployed to Vercel)
│   ├── index.html         app entry; src/main.tsx mounts React
│   ├── src/pages/         one component per route
│   ├── src/routes/        route table, protected/guest guards, navigation config
│   ├── src/components/    ui/ (shadcn), layout/, common/, system-status/, overview/
│   ├── src/services/      API client and endpoint calls
│   ├── src/contexts/      session state (sign-in not built yet)
│   ├── src/hooks/  lib/  assets/  test/
│   ├── vite.config.ts     dev server, /api proxy, build-time env validation, tests
│   └── vercel.json        install, build, SPA fallback and headers for Vercel
├── backend/           Express 5 API (deployed to Render)
│   ├── src/config/        env validation, database, CORS
│   ├── src/routes/  controllers/  services/  validators/  middleware/  utils/
│   └── test/              Vitest + supertest
├── shared/            Zod API contracts, types, constants (no secrets, no I/O)
├── docs/              architecture.md, deployment.md
├── render.yaml        Render Blueprint for the backend
├── .env.example       every environment variable, documented
└── AGENTS.md          rules for contributors and AI agents
```

See [docs/architecture.md](docs/architecture.md) for layers, the error contract, the health model, the database policy and the planned session design.

## Tech stack

| Area     | Technology                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, React Router 7, TypeScript (strict), Tailwind CSS 4, shadcn/ui, Lucide, Zod |
| Backend  | Node.js 24, Express 5, TypeScript (strict), Mongoose 8, Zod 4, helmet                         |
| Database | MongoDB (Atlas in production)                                                                 |
| Tooling  | pnpm 10 workspaces, ESLint 9, Prettier, Vitest, Testing Library, tsup                         |
| Hosting  | Vercel (frontend, static), Render (backend)                                                   |

## Getting started

### Prerequisites

- **Node.js 24.x** (see `.node-version`)
- **pnpm 10.34.9**: `corepack enable`, or `npm install -g pnpm@10.34.9` if corepack lacks permission

### Run locally

```bash
pnpm install
pnpm dev            # backend on http://localhost:4000, frontend on http://localhost:3000
```

Open <http://localhost:3000>, create an account, and you land on the dashboard. The **Backend connection** panel should show _Connected_.

- The frontend calls `/api` on its own origin and the Vite dev server proxies it to `http://localhost:4000`, so no CORS is involved locally and the session cookie is first-party.
- **Sign-in needs a database.** Set `MONGODB_URI` in `backend/.env` (see `.env.example`). Without it the app runs, readiness reports the database as _not configured_, and registration/login answer 503.
- In development the backend creates collections and indexes automatically **in whatever database `MONGODB_URI` names**. Point local development at its own database (for example `/metaflow_dev`), not the one production will use.

To use a database or change defaults, copy the relevant section of [`.env.example`](.env.example) into `backend/.env` or `frontend/.env.local` (both git-ignored). To test the production-style cross-origin setup locally, set `VITE_API_BASE_URL=http://localhost:4000` in `frontend/.env.local`.

### Routes

| Path                                                           | Page                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/`                                                            | Public landing page                                                                  |
| `/login`, `/register`                                          | Sign-in and registration forms                                                       |
| `/dashboard`                                                   | Active workspace overview, backend connection status and build progress              |
| `/workspaces/new`                                              | Create another workspace                                                             |
| `/settings`                                                    | Workspace settings: business profile, logo, members, archive (owner only)            |
| `/accounts`                                                    | Social Accounts: connect, check and disconnect Facebook Pages and Instagram accounts |
| `/ai-studio`                                                   | AI Studio: captions, hashtags, content ideas, brand voice and generation history     |
| `/posts`                                                       | Posts: search, filter by status and platform, duplicate, delete                      |
| `/posts/new`, `/posts/:postId`                                 | Post editor: content, media, platforms and accounts, platform check, approval        |
| `/media`                                                       | Media Library: upload, search, edit alt text, delete unused files                    |
| `/calendar`, `/automations`, `/analytics`, `/team`, `/billing` | Honest empty states: what each module will do and which milestone delivers it        |

Signed-in routes sit behind `ProtectedRoute`: visitors are sent to `/login` and returned to the page they wanted after signing in. The session survives reloads (it is restored from the HTTP-only cookie). A signed-in user without a workspace is asked to create one first.

### Scripts

Run from the repository root:

| Command                                      | What it does                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                                   | Backend (watch mode) and frontend dev servers together                      |
| `pnpm dev:backend`                           | Backend only                                                                |
| `pnpm dev:frontend`                          | Frontend only                                                               |
| `pnpm build`                                 | Production builds of every package                                          |
| `pnpm start:backend`                         | Run the built backend (`backend/dist`)                                      |
| `pnpm start:frontend`                        | Serve the built frontend (`frontend/dist`) on port 3000 with `vite preview` |
| `pnpm typecheck`                             | TypeScript in every package                                                 |
| `pnpm lint`                                  | ESLint in every package                                                     |
| `pnpm test`                                  | Vitest in every package                                                     |
| `pnpm format`                                | Prettier, write changes                                                     |
| `pnpm verify`                                | format check + typecheck + lint + test + build                              |
| `pnpm --filter @metaflow/backend db:indexes` | List missing MongoDB indexes (read-only); add `--apply` to create them      |

## API

| Method | Path                   | Description                                                                                    |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/health`          | Liveness. 200 while the process runs, regardless of the database                               |
| GET    | `/api/health/ready`    | Readiness. 200 when MongoDB answers (or is not configured in development), 503 when it is down |
| POST   | `/api/auth/register`   | Create an account and sign in (201, session cookie). 409 if the email is taken                 |
| POST   | `/api/auth/login`      | Sign in (200, new session cookie). 401 with a generic message for wrong email or password      |
| POST   | `/api/auth/logout`     | Revoke the current session and clear the cookie (204)                                          |
| POST   | `/api/auth/logout-all` | Revoke every session of the signed-in user (204)                                               |
| GET    | `/api/auth/me`         | The signed-in user (200) or 401                                                                |

Response shapes are defined once in [`shared/src/api`](shared/src/api) and validated by both sides. Details, security measures and limitations: [docs/architecture.md → Authentication](docs/architecture.md#authentication-and-sessions).

## Environment variables

| Variable                  | Where    | Required                 | Purpose                                                                                             |
| ------------------------- | -------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | backend  | production: `production` | Runtime mode                                                                                        |
| `PORT`                    | backend  | no (Render sets it)      | Listen port, default 4000                                                                           |
| `MONGODB_URI`             | backend  | **yes in production**    | MongoDB connection string (secret)                                                                  |
| `CORS_ORIGINS`            | backend  | **yes in production**    | Exact frontend origins allowed to call the API                                                      |
| `TRUST_PROXY`             | backend  | Render: `1`              | Proxy hops to trust                                                                                 |
| `LOG_LEVEL`               | backend  | no                       | `debug` / `info` / `warn` / `error`                                                                 |
| `SESSION_TTL_DAYS`        | backend  | no (default 7)           | Session lifetime in days (1–90)                                                                     |
| `SESSION_COOKIE_SAMESITE` | backend  | no (default `lax`)       | `lax` / `strict` / `none` (`none` only in production, for a cross-site setup)                       |
| `MEDIA_LOCAL_DIR`         | backend  | to enable uploads        | Directory for uploaded media (absolute in production; default `backend/.data/media` in development) |
| `MEDIA_STORAGE_DRIVER`    | backend  | no (default `local`)     | Media storage adapter; only `local` exists today                                                    |
| `MEDIA_MAX_IMAGE_MB`      | backend  | no (default 10)          | Largest accepted image                                                                              |
| `MEDIA_MAX_VIDEO_MB`      | backend  | no (default 100)         | Largest accepted video                                                                              |
| `VITE_API_BASE_URL`       | frontend | **yes on Vercel**        | Backend origin, embedded at build time (public). Leave empty locally to use the dev proxy           |

Full documentation: [`.env.example`](.env.example).

## Testing

```bash
pnpm test
```

- `shared`: contract schemas, including email normalization and the password policy.
- `backend`: env validation, health and readiness, CORS, error envelope, request validation, logging and redaction, and the MongoDB utility against an unreachable server. Authentication over HTTP: registration (success, duplicate email, invalid email, weak password), login (success, wrong password, unknown email, suspended account, session replacement), logout and sign-out-everywhere, expired and revoked sessions, unauthorized requests, cookie attributes in development and production, no password data in any response, the Origin check, both rate limits, and a 503 when MongoDB is down. Password hashing, session tokens, cookie parsing, model schemas/indexes and the index plan.
- Content management (backend): upload sniffing for every format and for disguised SVG/HTML, extension and claimed-type mismatches, empty, oversized, malformed and multi-file uploads, temporary-file cleanup, storage-key and path-escape checks, safe file headers and byte ranges, media in use (posts, logo), staff/owner permissions, every post workflow transition (including revision-checked races between edits, submissions, withdrawals and decisions, and readiness re-checks at approval), the post repository contract (in-memory, and MongoDB when `MONGODB_TEST_URI` is set), tenant isolation on every media and post route, and archived workspaces.
- `frontend`: API client; every route, including one-`<h1>` checks; route guards in each session state; the status panel; and the real auth flow with only `fetch` mocked: session restoration, retry after an outage, sign-in, registration (client- and server-side validation), sign-out, and a failed sign-out that keeps the user signed in.

Auth tests use **in-memory repositories**, so they need no database and never touch real data. The MongoDB suites (`database.test.ts` live part, `auth-mongo.test.ts`) run only when `MONGODB_TEST_URI` points at a **disposable** database whose name contains `test`; anything else is refused:

```bash
MONGODB_TEST_URI="mongodb+srv://…/metaflow_test" pnpm --filter @metaflow/backend test
```

## Deployment

Step-by-step instructions for GitHub, MongoDB Atlas, Render and Vercel, plus the live verification checklist: **[docs/deployment.md](docs/deployment.md)**.

Short version: backend on Render via `render.yaml`; frontend on Vercel with Root Directory `frontend`, framework Vite and `VITE_API_BASE_URL` (everything else comes from `frontend/vercel.json`); then set the backend's `CORS_ORIGINS` to the Vercel URL.

## Security

- Secrets live only in backend environment variables (Render). The frontend bundle contains only the public API URL, and the build refuses `VITE_` variables whose names look like secrets.
- `.env` files, keys and credentials are git-ignored; only `.env.example` is tracked.
- CORS allows explicit origins only, with credentials; no wildcard.
- Request bodies are size-limited and validated with Zod; malformed JSON gets a clean 400.
- Logs never contain request bodies, query strings, cookies or connection-string credentials.
- Passwords: scrypt (32 MiB, per-user salt). Sessions: random 256-bit tokens in `HttpOnly` cookies (`Secure` and `__Host-` in production); only SHA-256 hashes are stored; sessions expire and can be revoked.
- Login gives one generic error for unknown emails and wrong passwords, with matching timing; auth endpoints are rate-limited per IP and per account; state-changing requests from unlisted origins are refused (CSRF).
- Workspaces are isolated: the API resolves access from the signed-in user's membership on every request, answers 404 for workspaces the user does not belong to, and limits editing and archiving to the owner.
- Social access tokens are encrypted at rest (AES-256-GCM), never returned by the API and never logged. Connecting uses Meta's OAuth with a single-use, 10-minute `state` bound to the user and workspace.
- Uploaded media is identified by its content (signatures), never by its name or the browser's type; SVG and HTML are refused. Files are stored under random server-generated keys outside anything served statically, and served only through the API after a membership check, with `nosniff`, a sandboxing CSP and the detected content type.
- AI provider keys stay on the server; the provider and model come from server configuration only. Prompts are never stored or logged, every AI reply is validated before use, and generation is rate-limited per user.
- Before deploying sign-in, put both apps on one custom domain: cookies across `vercel.app` and `onrender.com` are third-party and unreliable. See [docs/architecture.md](docs/architecture.md#cross-site-cookies-and-custom-domains).

## Roadmap

1. Deployment foundation (built; production deployment postponed)
2. Accounts, sign-in and server-managed sessions (built)
3. Workspaces, membership and owner/staff roles (built; team invitations come with milestone 8)
4. Facebook and Instagram connection (Meta OAuth) (built; needs a Meta app to run for real)
5. AI Studio: providers, brand voice, captions, hashtags and ideas (built; needs an AI provider key to run for real)
6. **Content management: post editor, media library and approvals** ← current (built; local storage only)
7. Scheduling, approvals and publishing (background worker)
8. Automation, analytics, billing and administration
