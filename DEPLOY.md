# Deploy SpatialBio Portal (Option 3)

The app has two parts:

| Part | Stack | Typical host |
|------|--------|--------------|
| **API** | R Plumber (Docker) | [Render](https://render.com) Web Service |
| **Frontend** | Vite static build | Render Static Site, Vercel, or Netlify |

Your friend opens the **frontend URL** in a browser. The frontend calls the **API URL** you configure at build time.

Repository: `https://github.com/Juju-codespec/Spatial-analysis-website`

---

## Recommended: Render (one blueprint)

### Prerequisites

- GitHub repo pushed (this project)
- [Render](https://render.com) account (free tier works; API may sleep when idle)
- Credit card may be required for **persistent disk** on the API (upload cache)

### Step 1 — Connect the blueprint

1. In Render: **New → Blueprint**
2. Connect **Juju-codespec/Spatial-analysis-website**
3. Render reads [`render.yaml`](render.yaml) and creates:
   - **spatial-portal-api** (Docker)
   - **spatial-portal** (static site)
4. Click **Apply**

### Step 2 — Configure the API

1. Open service **spatial-portal-api** → **Environment**
2. Set **`CORS_ORIGIN`** to your frontend origin (after Step 3), for example:
   ```text
   https://spatial-portal.onrender.com
   ```
   Multiple origins: comma-separated (same as local dev).
3. Optional: set **`API_KEY`** and share it with trusted users (frontend would need a header — not wired in UI by default).
4. Wait for deploy; test:
   ```bash
   curl -s https://YOUR-API.onrender.com/health
   ```

**Note:** First request to `vpd-ovarian` / `vpd-lung` can take several minutes while Bioconductor data downloads into `/app/data-cache` (persistent disk).

### Step 3 — Configure the frontend

1. Open service **spatial-portal** → **Environment**
2. Set **`VITE_API_URL`** to the API public URL **with no trailing slash**, e.g.:
   ```text
   https://spatial-portal-api.onrender.com
   ```
3. **Manual Deploy → Deploy latest commit** (static sites bake `VITE_*` at build time)

### Step 4 — Fix CORS if needed

If the browser shows network/CORS errors:

1. Confirm **`CORS_ORIGIN`** on the API exactly matches the frontend URL (scheme + host, no path).
2. Redeploy the API after changing env vars.

### Step 5 — Share with your friend

Send them the **static site URL**, e.g. `https://spatial-portal.onrender.com`.

They do **not** need to clone the repo or run `npm run dev`.

---

## Alternative: Vercel (frontend) + Render (API)

1. Deploy API on Render as above (Docker service only — skip static service in blueprint or delete it from `render.yaml` locally before apply).
2. [Vercel](https://vercel.com) → Import Git repo
3. **Root Directory:** `spatial-portal`
4. **Build command:** `npm run build`
5. **Output directory:** `dist`
6. **Environment variable:** `VITE_API_URL` = `https://YOUR-API.onrender.com`
7. Deploy; set API **`CORS_ORIGIN`** to your `https://*.vercel.app` URL.

[`spatial-portal/vercel.json`](spatial-portal/vercel.json) adds SPA routing for React Router.

---

## Local production smoke test

```bash
# Terminal 1 — API
cd spatial-portal-api
export CORS_ORIGIN=http://localhost:4173
Rscript R/main.R

# Terminal 2 — frontend built against local API
cd spatial-portal
echo 'VITE_API_URL=http://127.0.0.1:8000' > .env.production
npm run build
npm run preview
```

Open the URL printed by `vite preview` (usually http://localhost:4173).

---

## Docker API only (any cloud)

From `spatial-portal-api/`:

```bash
docker build -t spatial-portal-api .
docker run -p 8000:8000 \
  -e CORS_ORIGIN=https://YOUR-FRONTEND-ORIGIN \
  -v spatial-cache:/app/data-cache \
  spatial-portal-api
```

---

## Limitations on free hosting

- **Cold starts:** Render free web services spin down; first load may be slow.
- **Memory:** Very large cell uploads may need a paid plan.
- **VPD demos:** Require outbound network + disk; first ovarian/lung load is heavy.

---

## Give a collaborator code access (optional)

Deployment is separate from Git access. To let someone run locally or contribute:

**GitHub → Settings → Collaborators** (private repo) or share the public repo link.

Local run: see root [README.md](README.md) (`npm run install:local`, `npm run dev`).
