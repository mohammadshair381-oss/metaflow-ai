# MetaFlow AI

AI-powered social media automation SaaS. Businesses, creators and agencies will connect Facebook Pages and Instagram Professional accounts, generate content with AI, and schedule or auto-publish it.

> **Status: Milestone 1 — deployment foundation.**
> The repository has a deployable frontend and backend that talk to each other, with health and readiness checks. No product features (sign-in, workspaces, Meta connection, AI, publishing) are built yet. They come in later milestones, after this foundation is deployed and approved.

## Architecture

```
Browser ──► Vercel: frontend/ (Next.js) ──HTTPS + credentialed CORS──► Render: backend/ (Express) ──► MongoDB Atlas
```

One repository, three pnpm workspace packages:

```
metaflow-ai/
├── frontend/          Next.js 15 web app (deployed to Vercel)
│   ├── src/app/           routes: (dashboard)/ holds the signed-in area
│   ├── src/components/    ui/ (shadcn), layout/, system-status/, overview/
│   ├── src/lib/           API client, public config
│   └── vercel.json        filtered install for Vercel
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

| Area     | Technology                                                             |
| -------- | ---------------------------------------------------------------------- |
| Frontend | Next.js 15.5, React 19, TypeScript (strict), Tailwind CSS 4, shadcn/ui |
| Backend  | Node.js 24, Express 5, TypeScript (strict), Mongoose 8, Zod 4, helmet  |
| Database | MongoDB (Atlas in production)                                          |
| Tooling  | pnpm 10 workspaces, ESLint 9, Prettier, Vitest, tsup                   |
| Hosting  | Vercel (frontend), Render (backend)                                    |

## Getting started

### Prerequisites

- **Node.js 24.x** (see `.node-version`)
- **pnpm 10.34.9**: `corepack enable`, or `npm install -g pnpm@10.34.9` if corepack lacks permission

### Run locally

```bash
pnpm install
pnpm dev            # backend on http://localhost:4000, frontend on http://localhost:3000
```

Open <http://localhost:3000>. The **Backend connection** panel should show _Connected_.

No env files are needed for local development. Without `MONGODB_URI`, readiness reports the database as _not configured_. To use a database or change defaults, copy the relevant section of [`.env.example`](.env.example) into `backend/.env` or `frontend/.env.local` (both git-ignored).

### Scripts

Run from the repository root:

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Backend (watch mode) and frontend dev servers together |
| `pnpm dev:backend`  | Backend only                                           |
| `pnpm dev:frontend` | Frontend only                                          |
| `pnpm build`        | Production builds of every package                     |
| `pnpm typecheck`    | TypeScript in every package                            |
| `pnpm lint`         | ESLint in every package                                |
| `pnpm test`         | Vitest in every package                                |
| `pnpm format`       | Prettier, write changes                                |
| `pnpm verify`       | format check + typecheck + lint + test + build         |

## API

| Method | Path                | Description                                                                                    |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/health`       | Liveness. 200 while the process runs, regardless of the database                               |
| GET    | `/api/health/ready` | Readiness. 200 when MongoDB answers (or is not configured in development), 503 when it is down |

Response shapes are defined once in [`shared/src/api`](shared/src/api) and validated by both sides.

## Environment variables

| Variable                   | Where    | Required                 | Purpose                                         |
| -------------------------- | -------- | ------------------------ | ----------------------------------------------- |
| `NODE_ENV`                 | backend  | production: `production` | Runtime mode                                    |
| `PORT`                     | backend  | no (Render sets it)      | Listen port, default 4000                       |
| `MONGODB_URI`              | backend  | **yes in production**    | MongoDB connection string (secret)              |
| `CORS_ORIGINS`             | backend  | **yes in production**    | Exact frontend origins allowed to call the API  |
| `TRUST_PROXY`              | backend  | Render: `1`              | Proxy hops to trust                             |
| `LOG_LEVEL`                | backend  | no                       | `debug` / `info` / `warn` / `error`             |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | **yes on Vercel**        | Backend origin, embedded at build time (public) |

Full documentation: [`.env.example`](.env.example).

## Testing

```bash
pnpm test
```

- `shared`: contract schemas.
- `backend`: env validation, health and readiness, CORS, error envelope, request validation, logging and redaction, and the MongoDB utility against an unreachable server.
- `frontend`: API client (success, HTTP errors, network failures, timeouts, contract mismatches, cancellation) and status logic.

The live-database tests run only when `MONGODB_TEST_URI` points at a **disposable** database:

```bash
MONGODB_TEST_URI="mongodb+srv://…/metaflow-test" pnpm --filter @metaflow/backend test
```

## Deployment

Step-by-step instructions for GitHub, MongoDB Atlas, Render and Vercel, plus the live verification checklist: **[docs/deployment.md](docs/deployment.md)**.

Short version: backend on Render via `render.yaml`; frontend on Vercel with Root Directory `frontend` and `NEXT_PUBLIC_API_BASE_URL`; then set the backend's `CORS_ORIGINS` to the Vercel URL.

## Security

- Secrets live only in backend environment variables (Render). The frontend bundle contains only the public API URL.
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
