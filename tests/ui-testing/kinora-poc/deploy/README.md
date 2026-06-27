# Kinora self-host — deploy (AKS) + CI wiring

This folder is the **deployable** half of the Kinora evaluation: Kubernetes manifests to
run the Kinora dashboard on our cluster, plus the GitHub config to upload every CI run to
it. The runnable POC (sample suite, backfill tool) is in the parent `kinora-poc/` folder;
the background/business-case docs are local-only under
`tests/ui-testing/MD_Files/agents-and-skills/Kinora/` (gitignored).

```
deploy/
├── README.md            ← you are here
├── GITHUB-SETUP.md      ← the 3 GitHub secrets/variables to set
└── k8s/                 ← starter manifests (everything infra-specific is TODO(infra))
    ├── kustomization.yaml
    ├── namespace.yaml
    ├── configmap-env.yaml
    ├── secret.example.yaml   (template — never apply real secrets from here)
    ├── web-nginx-config.yaml
    ├── postgres.yaml         (OPTION A: in-cluster; delete if managed DB)
    ├── migrate-job.yaml
    ├── server.yaml
    ├── web.yaml
    └── ingress.yaml
```

> **Status:** the manifests are valid YAML and `kubectl kustomize` composes them, but they
> are a **reviewed starting point, not turnkey** — they will not run until the
> `# TODO(infra):` placeholders are filled (images, hostname/TLS, storage class, S3, DB).
> Decisions chosen so far: **AKS cluster · S3 traces + managed Postgres · keep TestDino in
> parallel.** (Postgres OPTION A in-cluster is included as the cheaper alternative.)

---

## The two halves

**Half A — the server** (this folder's `k8s/`). Four components: `web` (nginx) → `server`
(Node) → `postgres`, plus a one-shot `migrate` Job and an `S3` bucket for traces.

**Half B — the CI upload** (already in `.github/workflows/playwright.yml`). A gated,
fail-safe step in the merge job. See `GITHUB-SETUP.md`.

---

## Before you apply: build & push the images

Kinora publishes **no images** — `web`, `server`, and `migrate` build from source. Build
them from the Kinora repo and push to our registry (ACR):

```bash
# server image (also used by the migrate Job)
docker build -f packages/server/Dockerfile -t IMAGE_REGISTRY/kinora-server:TAG .
docker push IMAGE_REGISTRY/kinora-server:TAG

# web image — PUBLIC_URL is BAKED IN at build time, so pass it as a build-arg
docker build -f packages/web/Dockerfile \
  --build-arg VITE_KINORA_SERVER_URL=https://kinora.internal.example.com \
  -t IMAGE_REGISTRY/kinora-web:TAG .
docker push IMAGE_REGISTRY/kinora-web:TAG
```

> ⚠️ Because the public URL is compiled into the web bundle, **rebuild the web image if the
> hostname ever changes.** Keep `VITE_KINORA_SERVER_URL` == Ingress host == `BASE_URL`.

Then replace `IMAGE_REGISTRY/kinora-server:TAG` and `IMAGE_REGISTRY/kinora-web:TAG` in the
manifests (or via a kustomize `images:` override).

---

## Fill in the placeholders (`# TODO(infra):`)

| Where | What to set |
|-------|-------------|
| `configmap-env.yaml` | `BASE_URL`/`WEB_ORIGIN` (public URL); `POSTGRES_HOST` (managed FQDN or in-cluster `postgres`); `S3_ENDPOINT/REGION/BUCKET` |
| `secret.example.yaml` → **real Secret** | `AUTH_SECRET` (`openssl rand -hex 32`), `POSTGRES_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — created via our secrets convention, not committed |
| `postgres.yaml` | storage class + size — **or delete the file** if using managed Azure DB |
| `ingress.yaml` | `ingressClassName`, host, TLS secret/issuer, body-size annotation flavor |
| `migrate-job.yaml`, `server.yaml`, `web.yaml` | the `image:` refs |

---

## Apply (order matters — migrate must finish before server)

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap-env.yaml -f k8s/web-nginx-config.yaml

# real secret (NOT secret.example.yaml) — e.g.:
kubectl -n kinora create secret generic kinora-secrets \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=POSTGRES_PASSWORD='...' \
  --from-literal=S3_ACCESS_KEY_ID='...' \
  --from-literal=S3_SECRET_ACCESS_KEY='...'

kubectl apply -f k8s/postgres.yaml        # OPTION A only — skip if managed DB
kubectl apply -f k8s/migrate-job.yaml
kubectl -n kinora wait --for=condition=complete job/kinora-migrate --timeout=300s

kubectl apply -f k8s/server.yaml -f k8s/web.yaml -f k8s/ingress.yaml
```

(Or once images/placeholders are set: `kubectl apply -k k8s/`, then run the migrate Job +
wait before the server settles — the server's init-container also waits for Postgres.)

---

## Get the API token (for CI)

Open the dashboard → **Settings → Workspace → API tokens → Create**. Copy it (shown once).
That's `KINORA_TOKEN` in `GITHUB-SETUP.md`.

---

## Retention (keeps Postgres + S3 bounded)

At ~5M test executions/month the DB grows ~5–10 GB/month. Deleting old runs cascades to
their tests + artifacts (FK `ON DELETE CASCADE`), so a nightly prune is enough:

```sql
DELETE FROM run WHERE created_at < now() - interval '90 days';
```

Run it as a `CronJob` (or managed-DB scheduled job) and add a matching **S3 lifecycle rule**
to expire trace objects on the same window. 90 days ≈ 15–30 GB steady state.

---

## Definition of done

1. Dashboard loads at the public URL over HTTPS.
2. With `UPLOAD_TO_KINORA=true` + the secret/var set, a CI run appears under project
   `openobserve-e2e` with the right branch/commit and a link back to the Actions run.
3. Click a failed test → its trace replays in the embedded viewer.
4. After several runs, the per-test view shows flaky-rate / fail-rate trends.

---

## Gotchas already known

- **Large traces → HTTP 413.** Handled by `client_max_body_size 500m` in
  `web-nginx-config.yaml` **and** the Ingress `proxy-body-size` annotation. Keep both.
- **Local-disk trace storage has a uid-1001 permission bug.** We avoid it entirely by using
  **S3** for traces (the chosen path).
