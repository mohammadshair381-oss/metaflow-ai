# MetaFlow AI

AI-powered social media automation SaaS. Businesses, creators and agencies will connect Facebook Pages and Instagram Professional accounts, generate content with AI, and schedule or auto-publish it.

> **Status: Milestone 1 — deployment foundation.**
> The repository has a deployable frontend and backend that talk to each other, with health and readiness checks. No product features (sign-in, workspaces, Meta connection, AI, publishing) are built yet. They come in later milestones, after this foundation is deployed and approved.

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

Open <http://localhost:3000/dashboard>. The **Backend connection** panel should show _Connected_.

No env files are needed for local development:

- The frontend calls `/api` on its own origin and the Vite dev server proxies it to `http://localhost:4000`, so no CORS is involved locally.
- Without `MONGODB_URI`, readiness reports the database as _not configured_.

To use a database or change defaults, copy the relevant section of [`.env.example`](.env.example) into `backend/.env` or `frontend/.env.local` (both git-ignored). To test the production-style cross-origin setup locally, set `VITE_API_BASE_URL=http://localhost:4000` in `frontend/.env.local`.

### Routes

| Path                                                                                                                        | Page                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/`                                                                                                                         | Public landing page                                                           |
| `/login`, `/register`                                                                                                       | Explain that accounts arrive next milestone (no fake forms)                   |
| `/dashboard`                                                                                                                | Live backend connection status and build progress                             |
| `/accounts`, `/ai-studio`, `/calendar`, `/posts`, `/automations`, `/analytics`, `/brands`, `/team`, `/billing`, `/settings` | Honest empty states: what each module will do and which milestone delivers it |

Signed-in routes sit behind a `ProtectedRoute` guard. Until sign-in exists they run in clearly labelled **preview mode** and store no data.

### Scripts

Run from the repository root:

| Command               | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`            | Backend (watch mode) and frontend dev servers together                      |
| `pnpm dev:backend`    | Backend only                                                                |
| `pnpm dev:frontend`   | Frontend only                                                               |
| `pnpm build`          | Production builds of every package                                          |
| `pnpm start:backend`  | Run the built backend (`backend/dist`)                                      |
| `pnpm start:frontend` | Serve the built frontend (`frontend/dist`) on port 3000 with `vite preview` |
| `pnpm typecheck`      | TypeScript in every package                                                 |
| `pnpm lint`           | ESLint in every package                                                     |
| `pnpm test`           | Vitest in every package                                                     |
| `pnpm format`         | Prettier, write changes                                                     |
| `pnpm verify`         | format check + typecheck + lint + test + build                              |

## API

| Method | Path                | Description                                                                                    |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/health`       | Liveness. 200 while the process runs, regardless of the database                               |
| GET    | `/api/health/ready` | Readiness. 200 when MongoDB answers (or is not configured in development), 503 when it is down |

Response shapes are defined once in [`shared/src/api`](shared/src/api) and validated by both sides.

## Environment variables

| Variable            | Where    | Required                 | Purpose                                                                                   |
| ------------------- | -------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`          | backend  | production: `production` | Runtime mode                                                                              |
| `PORT`              | backend  | no (Render sets it)      | Listen port, default 4000                                                                 |
| `MONGODB_URI`       | backend  | **yes in production**    | MongoDB connection string (secret)                                                        |
| `CORS_ORIGINS`      | backend  | **yes in production**    | Exact frontend origins allowed to call the API                                            |
| `TRUST_PROXY`       | backend  | Render: `1`              | Proxy hops to trust                                                                       |
| `LOG_LEVEL`         | backend  | no                       | `debug` / `info` / `warn` / `error`                                                       |
| `VITE_API_BASE_URL` | frontend | **yes on Vercel**        | Backend origin, embedded at build time (public). Leave empty locally to use the dev proxy |

Full documentation: [`.env.example`](.env.example).

## Testing

```bash
pnpm test
```

- `shared`: contract schemas.
- `backend`: env validation, health and readiness, CORS, error envelope, request validation, logging and redaction, and the MongoDB utility against an unreachable server.
- `frontend`: API client (success, HTTP errors, network failures, timeouts, contract mismatches, cancellation); every route, including one-`<h1>` checks; protected and guest route guards in each session state; and the status panel rendering Connected, Degraded and Unreachable from mocked HTTP responses (Testing Library + jsdom).

The live-database tests run only when `MONGODB_TEST_URI` points at a **disposable** database:

```bash
MONGODB_TEST_URI="mongodb+srv://…/metaflow-test" pnpm --filter @metaflow/backend test
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
- Before sign-in ships, put both apps on one custom domain: cookies across `vercel.app` and `onrender.com` are third-party and unreliable. See [docs/architecture.md](docs/architecture.md#cross-site-cookies-and-custom-domains).

## Roadmap

1. **Deployment foundation** ← current
2. Accounts, sign-in and server-managed sessions
3. Workspaces, membership and role-based authorization
4. Facebook and Instagram connection (Meta OAuth)
5. AI infrastructure and brand profiles
6. AI Studio and content management
7. Scheduling, approvals and publishing (background worker)
8. Automation, analytics, billing and administration
