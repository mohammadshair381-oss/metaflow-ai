# Deployment guide

MetaFlow AI deploys as two independent services from one GitHub repository:

| Part     | Host          | Source folder | Public URL (example)                 |
| -------- | ------------- | ------------- | ------------------------------------ |
| Frontend | Vercel        | `frontend/`   | `https://metaflow-web.vercel.app`    |
| Backend  | Render        | `backend/`    | `https://metaflow-api.onrender.com`  |
| Database | MongoDB Atlas | —             | private, reached only by the backend |

The background worker is **not** deployed yet; it arrives with the publishing milestone.

Follow the steps in order. Each one produces a value the next one needs.

1. [Push to GitHub](#1-push-the-repository-to-github)
2. [Create the MongoDB Atlas database](#2-mongodb-atlas)
3. [Deploy the backend on Render](#3-backend-on-render), then [allow Render in Atlas](#3b-allow-render-in-atlas-network-access)
4. [Deploy the frontend on Vercel](#4-frontend-on-vercel)
5. [Connect them with CORS](#5-connect-frontend-and-backend)
6. [Verify the live system](#6-verify-the-live-system)

Keep a note of these values as you go (never commit them):

| Value                     | Produced in | Used in                         | Secret? |
| ------------------------- | ----------- | ------------------------------- | ------- |
| GitHub repository URL     | 1           | Render, Vercel                  | no      |
| `MONGODB_URI`             | 2           | Render                          | **yes** |
| Render service URL        | 3           | Vercel (`VITE_API_BASE_URL`), 6 | no      |
| Render outbound IP ranges | 3           | Atlas (3b)                      | no      |
| Vercel production URL     | 4           | Render (`CORS_ORIGINS`), 6      | no      |

---

## 1. Push the repository to GitHub

The local repository is already initialized on branch `main` with its commits. It has no remote yet.

**Check before pushing** that no secrets are tracked:

```bash
git status                          # must be clean
git ls-files | grep -i "\.env"      # must list only .env.example
```

**Create the GitHub repository** at <https://github.com/new>:

- Name: e.g. `metaflow-ai`. Visibility: **Private** is recommended.
- Do **not** add a README, .gitignore or license (the repository already has them).

**Connect, check, then push** (replace `<your-username>` with your GitHub account or organization):

```bash
git remote add origin https://github.com/<your-username>/metaflow-ai.git
git ls-remote origin        # must print NOTHING: proves the GitHub repository is empty
git push -u origin main     # never add --force
```

If `git ls-remote origin` prints anything, **stop**: the GitHub repository already has history, and pushing over it would overwrite someone's work. Use a new, empty repository, or merge deliberately (below).

**Authentication.** Git for Windows includes Git Credential Manager: the first push opens a browser window to sign in to GitHub, and the credential is stored securely afterwards. If a GitHub credential is already stored, check that it belongs to the account that owns the repository. Alternatively, install the GitHub CLI (`winget install GitHub.cli`), run `gh auth login`, then push. Never paste a personal access token into the remote URL.

**If the push is rejected:**

| Message                                                  | Cause and safe fix                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rejected … (fetch first)` / `non-fast-forward`          | The GitHub repository is not empty (often a README added at creation). Do **not** force-push. If it is a brand-new repository, delete and recreate it empty. Otherwise: `git pull --no-rebase --allow-unrelated-histories origin main`, resolve any conflicts, commit, `git push -u origin main`.                                                                                                                                                       |
| `GH007: Your push would publish a private email address` | Your GitHub email privacy setting blocks the commit author email. Either allow it (GitHub → Settings → Emails → untick "Block command line pushes that expose my email"), or set your `…@users.noreply.github.com` address with `git config user.email` and re-author the unpushed commits: `git rebase --root --exec "git commit --amend --no-edit --reset-author"`. That rewrites local commits only, which is safe because nothing is on GitHub yet. |
| `Repository not found` / `403`                           | The stored credential belongs to a different GitHub account, or the URL is wrong. Check the URL, then sign in again through Git Credential Manager.                                                                                                                                                                                                                                                                                                     |

---

## 2. MongoDB Atlas

1. **Create a project and cluster** at <https://cloud.mongodb.com>. The free M0 tier is enough for now. Choose the cloud region **closest to your Render region** (the Blueprint uses Render's `oregon` region, so an AWS `us-west-2` cluster is a good match).
2. **Create a database user** (Security → Database Access):
   - Username: `metaflow-api`. Use **Autogenerate Secure Password** and store it in a password manager.
   - Privileges: _Specific privileges_ → `readWrite` on database `metaflow` only. Do not use `atlasAdmin`.
3. **Network access: leave it for now.** Render's addresses are allowed in [step 3b](#3b-allow-render-in-atlas-network-access), once the Render service exists. Do **not** add `0.0.0.0/0`. If Atlas's setup wizard offers to add your current IP address, that only lets your own computer in; accept or skip it as you prefer.
4. **Get the connection string**: Database → Connect → Drivers. Copy the `mongodb+srv://` string, insert the password (URL-encode characters such as `@ : / ? # %`), and put the database name before the query string:

   ```
   mongodb+srv://metaflow-api:<password>@<cluster-host>/metaflow?retryWrites=true&w=majority
   ```

   This is the `MONGODB_URI` secret. It goes only into Render, never into the repository or the frontend.

**Indexes:** the backend never builds indexes automatically in production (`autoIndex` is off). When models arrive, their indexes are applied with a reviewed, manual step; see [architecture.md → Database](architecture.md#database).

---

## 3. Backend on Render

### Option A — Blueprint (recommended)

The repository contains [`render.yaml`](../render.yaml).

1. In Render: **New → Blueprint**, connect GitHub, select the repository.
2. Render reads `render.yaml` and asks for the two secrets:
   - `MONGODB_URI`: the Atlas connection string from step 2.
   - `CORS_ORIGINS`: the Vercel production URL you will use, e.g. `https://metaflow-web.vercel.app`. Vercel URLs come from the project name, so choose the name now. You can change this value later (step 5).
3. Apply. The first build takes a few minutes.

### Option B — Manual web service

**New → Web Service**, select the repository, and set:

| Setting           | Value                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root Directory    | _(leave empty)_: the build needs `shared/` and the root lockfile, and Render hides files outside the root directory                                      |
| Runtime           | Node                                                                                                                                                     |
| Build Command     | `corepack enable && pnpm install --frozen-lockfile --filter @metaflow/backend... --prod=false && pnpm --filter @metaflow/backend build`                  |
| Start Command     | `node --enable-source-maps backend/dist/server.js`                                                                                                       |
| Health Check Path | `/api/health`                                                                                                                                            |
| Build Filters     | Included paths: `backend/**`, `shared/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.node-version`, `render.yaml` |

Environment variables:

| Key            | Value                                      |
| -------------- | ------------------------------------------ |
| `NODE_ENV`     | `production`                               |
| `TRUST_PROXY`  | `1`                                        |
| `LOG_LEVEL`    | `info`                                     |
| `MONGODB_URI`  | _(secret, from Atlas)_                     |
| `CORS_ORIGINS` | `https://<your-vercel-project>.vercel.app` |

Do not set `PORT`; Render provides it. Node 24 is selected by the repository's `.node-version` file.

### Notes

- **pnpm:** `corepack enable` activates the pnpm version pinned in `package.json` (`pnpm@10.34.9`). If corepack fails on Render, replace it with `npm install -g pnpm@10.34.9 &&`.
- **`--prod=false`** keeps build tools (tsup, TypeScript) installed even though `NODE_ENV=production`. pnpm 10.34 already does this, but the flag protects against other pnpm versions.
- **The service refuses to start** if `MONGODB_URI` or `CORS_ORIGINS` is missing or invalid in production. The deploy log lists which variable is wrong without printing its value.
- **Free plan:** the instance sleeps after 15 minutes without traffic and takes up to about a minute to wake. The frontend tells users when that is happening. A paid instance avoids it.

When the deploy is live, note the service URL (e.g. `https://metaflow-api.onrender.com`) and check it:

```bash
curl https://metaflow-api.onrender.com/api/health          # expect 200, "environment":"production"
curl -i https://metaflow-api.onrender.com/api/health/ready # expect 503, database "down" (until 3b)
```

A 503 from readiness at this point is **expected**: Atlas does not let Render in yet. The deploy still succeeds because Render's health check uses liveness (`/api/health`), and the backend keeps retrying the database in the background. The logs show `database.connect_failed` lines with growing retry intervals; that is normal until step 3b.

### 3b. Allow Render in Atlas network access

1. In Render, open the backend service → **Connect** (top right) → **Outbound** tab. Copy each IP range (CIDR notation, e.g. `203.0.113.0/24`). The ranges are shared by all Render services in the region.
2. In Atlas → Security → **Network Access** → **Add IP Address**, add each range, with a comment such as `Render oregon`.
3. Wait up to a minute. **No redeploy is needed**: the backend's retry loop connects on its own (retries back off to at most 30 seconds). Render's logs then show `database.connected`, and:

```bash
curl -i https://metaflow-api.onrender.com/api/health/ready # expect 200, database "up" with latencyMs
```

If it stays at 503 after two minutes, see Troubleshooting below.

---

## 4. Frontend on Vercel

The frontend is a static single-page app: Vercel builds it with Vite and serves `frontend/dist/`. No serverless functions are involved.

1. **Add New → Project**, import the GitHub repository.
2. **Root Directory:** `frontend`.
3. Keep **"Include files outside of the Root Directory in the Build Step"** enabled (the default). The frontend imports `shared/`.
4. Build settings are defined in [`frontend/vercel.json`](../frontend/vercel.json), so leave the dashboard overrides off:

   | Setting          | Value (from `vercel.json`)                                      |
   | ---------------- | --------------------------------------------------------------- |
   | Framework preset | Vite                                                            |
   | Install Command  | `pnpm install --frozen-lockfile --filter @metaflow/frontend...` |
   | Build Command    | `pnpm build` (type-check, then `vite build`)                    |
   | Output Directory | `dist`                                                          |

   `vercel.json` also adds the **SPA fallback** (every path is served `index.html`, so refreshing `/ai-studio` works), security headers, and long-term caching for the hashed files in `/assets/`.

5. **Environment variables** (Production and Preview):

   | Key                            | Value                                                                                                                                                       |
   | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `VITE_API_BASE_URL`            | The Render URL, e.g. `https://metaflow-api.onrender.com` (no `/api`, no trailing slash)                                                                     |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` _(optional: pins exactly pnpm 10.34.9. Without it Vercel picks pnpm 9 or 10 from the lockfile; both were tested with these install and build commands)_ |

   Never add secrets here: every `VITE_*` value ends up in the public JavaScript. The build refuses `VITE_` names that look like secrets.

6. Deploy.

The build **fails on purpose** if `VITE_API_BASE_URL` is missing, has a path, or is not `https` in production, so a misconfigured frontend never ships. `VITE_*` values are baked in at build time: after changing one, **redeploy**.

Node.js version: Vercel reads `engines.node` (`24.x`) from `frontend/package.json`. Confirm under Project Settings → Build and Deployment.

---

## 5. Connect frontend and backend

The backend only answers browsers whose origin is listed in `CORS_ORIGINS`.

1. Copy the exact Vercel production URL (e.g. `https://metaflow-web.vercel.app`).
2. In Render → backend service → Environment, set `CORS_ORIGINS` to that value. Separate several origins with commas. No trailing slash.
3. Save; Render redeploys automatically.

**Preview deployments** have their own URLs (`https://metaflow-web-git-<branch>-<team>.vercel.app`) and are **not** allowed by default. That is deliberate. Add a specific preview origin temporarily if you need to test one against the production API.

**Custom domains (recommended before sign-in ships):** see [architecture.md → Cross-site cookies](architecture.md#cross-site-cookies-and-custom-domains). With `app.yourdomain.com` and `api.yourdomain.com`, set `CORS_ORIGINS=https://app.yourdomain.com` and `VITE_API_BASE_URL=https://api.yourdomain.com`, then redeploy the frontend.

---

## 6. Verify the live system

Deployment counts as working only after **every** check below passes against the real production URLs.

```bash
API=https://metaflow-api.onrender.com
WEB=https://metaflow-web.vercel.app

# 1. Liveness: expect 200 and "environment":"production"
curl -s "$API/api/health"

# 2. Readiness: expect 200 and "database":{"status":"up",...}
curl -si "$API/api/health/ready"

# 3. CORS for the frontend origin: expect both headers
curl -s -D - -o /dev/null -H "Origin: $WEB" "$API/api/health" | grep -i access-control-allow

# 4. CORS for any other origin: expect no access-control headers
curl -s -D - -o /dev/null -H "Origin: https://example.com" "$API/api/health" | grep -i access-control-allow
```

5. Open `$WEB/dashboard` in a browser. The **Backend connection** panel must show **Connected**, with "Responding in … ms" and "MongoDB connected".
6. In the browser developer tools (Network tab), the requests to `/api/health` and `/api/health/ready` must succeed with no CORS errors in the Console.
7. **Deep links:** open `$WEB/ai-studio` directly and press reload. The AI Studio page must load, not a Vercel 404. Also check that `$WEB/no-such-page` shows the app's "Page not found".
8. On a phone (or the browser's device toolbar), open the menu button on the dashboard: the navigation drawer must open and navigate.
9. In Render → Logs, there must be no `database.connect_failed` entries after startup.

### Troubleshooting

| Symptom                                                               | Likely cause                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Panel shows **Unreachable**, console shows a CORS error               | `CORS_ORIGINS` does not exactly match the Vercel URL (scheme, host, no trailing slash)                             |
| Panel shows **Unreachable**, no CORS error                            | Wrong `VITE_API_BASE_URL` (redeploy after fixing), or the Render service is down                                   |
| Panel shows "Still waiting…" for up to a minute                       | Free Render instance waking from sleep; expected                                                                   |
| Panel shows **Degraded** / readiness `down`                           | Atlas unreachable: wrong `MONGODB_URI`, password not URL-encoded, or Render ranges missing in Atlas Network Access |
| Render deploy fails with "Invalid environment configuration"          | The log names the missing or invalid variable                                                                      |
| Vercel build fails mentioning `VITE_API_BASE_URL`                     | Variable missing, has a path such as `/api`, or uses `http` in production                                          |
| Vercel build fails with "Refusing to expose secret-looking variables" | A `VITE_` variable name looks like a secret; move that value to the backend                                        |
| Refreshing a page such as `/calendar` gives a Vercel 404              | `vercel.json` was not picked up: check that Root Directory is `frontend`                                           |

### Rolling back

Both platforms keep previous deployments. Render: service → Events → choose an earlier deploy → **Rollback**. Vercel: Deployments → choose an earlier deployment → **Promote to Production** (or **Instant Rollback**).
