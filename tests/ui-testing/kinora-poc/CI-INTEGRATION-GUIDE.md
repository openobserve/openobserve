# Embedding Kinora in OpenObserve CI — A From-Scratch Guide

> **Who this is for:** someone who has never deployed Kinora and wants to wire it into
> OpenObserve's GitHub Actions so every CI run's Playwright results land in a shared
> dashboard automatically. Written to be read by a beginner. Plain language first,
> technical detail second.
>
> **Status:** the local POC is done (see [README.md](./README.md)). This guide is the
> *next* step: going from "works on my laptop" to "works in our CI, for the whole team."
>
> **How to use it:** read Parts 1–4 to understand the shape. Then, in a **fresh chat
> window**, share your infra repo and answer the decisions in Part 3 — the assistant
> there will turn the rest into exact commands/PRs for your environment. A copy-paste
> starter prompt is at the very bottom (Part 11).

---

## Part 1 — The big picture, in plain English

Think of your tests producing a **report card** every time CI runs.

- **Playwright's built-in HTML report** = one report card for one run. Great for "what
  happened just now," useless for "is this test getting flakier over the last month."
- **Kinora** = a filing cabinet that keeps every report card, stacks them over time, and
  adds a magnifying glass (the embedded *trace viewer*) so you can replay any failure.
- **TestDino** (what you pay $99/mo for) is the filing cabinet you use today.

"Embedding Kinora in CI" means two things working together:

1. **A Kinora server that is always on** — living somewhere permanent in your infra (NOT
   a laptop), with a web address the team and the CI runners can reach.
2. **A few lines added to your GitHub Actions workflow** — so at the end of every test
   run, CI ships the results (and traces) up to that server.

That's the whole idea. Everything below is detail on those two halves.

```
                         (1) always-on server                (2) CI uploads to it
   ┌─────────────┐        ┌───────────────────────────┐
   │  Your team  │ ─HTTP─▶ │  Kinora                   │ ◀─HTTPS+token─ ┌──────────────────┐
   │ (a browser) │        │  web(nginx) → server      │                │ GitHub Actions    │
   └─────────────┘        │      ↓            ↓        │                │ (Playwright run)  │
                          │   Postgres   trace storage │                └──────────────────┘
                          └───────────────────────────┘
```

---

## Part 2 — What you will need (the shopping list)

| # | Thing | Why | Notes |
|---|-------|-----|-------|
| 1 | A place to run the Kinora server | It must be always-on and reachable by CI + team | A VM, or your existing Kubernetes cluster |
| 2 | A PostgreSQL database | Kinora stores all run history here | Bundled container *or* a managed DB |
| 3 | Storage for traces/screenshots | Trace files can be large | A disk volume *or* S3-compatible bucket (recommended) |
| 4 | A URL + HTTPS | So browsers/CI connect securely | e.g. `https://kinora.yourcompany.com` |
| 5 | An API token | CI uses it to authenticate uploads | Created in the Kinora UI, stored as a GitHub secret |
| 6 | A small edit to `playwright.yml` | The actual "upload to Kinora" step | ~10 lines, added next to the existing TestDino step |
| 7 | (Optional) SMTP + SSO | Email alerts, single sign-on | Can add later |

Items 1–4 = **Part A** (stand up the server). Items 5–6 = **Part B** (wire CI).

---

## Part 3 — Decisions to make FIRST (bring the infra repo for these)

Do not write any YAML until these are decided. Each one changes the steps. **These are
exactly the questions to answer in the fresh window with your infra repo open.**

1. **Where does Kinora run?**
   - (a) Same Kubernetes cluster as OpenObserve (cleanest if you're already on k8s), or
   - (b) A small standalone VM running Docker Compose (fastest; this is what the POC used).
   - ⚠️ Upstream ships a **Docker Compose** stack, *not* a Helm chart. On k8s you'd adapt
     the same images into Deployments/Services yourself.

2. **Database: bundled or managed?**
   - Bundled Postgres container (simple, you own backups) vs your managed Postgres
     (RDS / Cloud SQL / etc. — better for production durability).

3. **Trace storage: local disk or S3?**
   - Local volume is simplest but ties data to one node. **Recommended: S3-compatible
     bucket** (you likely already run object storage for OpenObserve). Kinora supports
     `S3_*` env vars out of the box.

4. **URL + TLS.**
   - Pick a hostname (e.g. `kinora.internal.yourco.com`). Will it sit behind your
     existing ingress/load balancer, or a small Caddy/nginx with auto-TLS?

5. **Who can log in?**
   - Email+password now (works offline, no setup) vs Google/GitHub OAuth vs SSO/SAML
     (the latter is a paid/enterprise Kinora feature). Start simple.

6. **Retention.**
   - How long to keep runs + traces? Affects storage size.

7. **Do you keep TestDino in parallel?** (Strong yes during evaluation — see Part 8.)
   Remember Kinora does **not** replace TestDino's *manual test-case management*; only its
   automated run reporting.

---

## Part 4 — How OpenObserve's CI works today (so you know where to plug in)

Your `playwright.yml` already does this (simplified):

1. **Build** the binary + frontend once.
2. **Fan out** into many parallel e2e jobs (one per test folder: Alerts, Dashboards,
   Reports, Traces, …). Each job runs Playwright and uploads its results as a GitHub
   artifact called `blob-report-<folder>-attempt-N` (these are Playwright *blob* reports;
   **retention is only 1 day**).
3. **Merge job** ("Merge Reports and Upload to TestDino"): downloads all the blob
   artifacts, runs `npx playwright merge-reports` to produce a single
   `playwright-results/report.json`, then uploads that to TestDino.

👉 **The plug-in point is that merge job.** Because your results are produced across many
shards and combined in one place, the right tool is the **Kinora CLI** (`@kinora/cli
upload`) added right after `report.json` is created — *not* the per-test reporter (which,
in a sharded setup, would create many partial runs instead of one).

---

## Part 5 — PART A: Stand up the Kinora server (production)

Pick the option that matches Decision #1.

### Option 1 — Docker Compose on a VM (fastest)

This is the POC stack, hardened for production.

1. **Get the code & config**
   ```bash
   git clone https://github.com/Kinora-dev/kinora.git
   cd kinora/selfhost
   cp .env.example .env
   ```

2. **Edit `.env`** (the important ones):
   - `PUBLIC_URL=https://kinora.yourco.com`  ← the real public URL (drives links, cookies,
     trace URLs; **must be correct** — it's baked into the web build)
   - `WEB_PORT=8080`  ← internal port your TLS proxy forwards to
   - `AUTH_SECRET=$(openssl rand -hex 32)`
   - `POSTGRES_PASSWORD=<a real secret>`  (or point at managed DB — Decision #2)
   - `KINORA_CLOUD=false`  (keep billing off)
   - **S3 (recommended, Decision #3):** set `S3_ENDPOINT / S3_REGION / S3_BUCKET /
     S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY` to store traces in object storage.
   - **SMTP (optional):** set `SMTP_*` to enable email verification, invites, and email
     alerts.
   - **OAuth (optional):** `GOOGLE_*` / `GITHUB_*` for social login.

3. **Start it**
   ```bash
   docker compose up -d --build
   ```

4. **Put HTTPS in front.** The web container speaks plain HTTP on `WEB_PORT`. Front it
   with your ingress / nginx / Caddy / Traefik terminating TLS and forwarding to that
   port. Make sure the public hostname matches `PUBLIC_URL`.

5. **Apply the two fixes we learned in the POC** (details in Part 10):
   - Trace uploads need the artifacts dir writable by the server user (uid 1001).
   - Bump nginx `client_max_body_size` (default 100m) to ~500m for large CI traces.

6. **Backups.** Back up the Postgres volume/DB (and the trace volume if you did *not* use
   S3). Standard `pg_dump`.

### Option 2 — Kubernetes (cleanest if you already run k8s)

There's no official Helm chart, so you adapt the same three images:
- `packages/server/Dockerfile` → a **server** Deployment (+ a one-shot **migrate** Job
  that runs `node dist/scripts/migrate.mjs latest` before the server starts)
- `packages/web/Dockerfile` → a **web** Deployment (nginx) — bake `VITE_KINORA_SERVER_URL`
  = your public URL at build time; mount the self-host `nginx.conf`
- Postgres → a managed DB or a StatefulSet
- Use your existing **Ingress** for the hostname + TLS, and **S3** for `S3_*`.
- Same two POC fixes apply: the artifacts path must be writable by the container user;
  the nginx body-size limit must be raised.

> Bring your infra repo to the fresh window and the assistant will translate this into
> your actual manifests / Helm values / ingress conventions.

### Get the API token (needed for Part B)

Once the dashboard is up: sign in → **Settings → Workspace → API tokens → Create**. Copy
it now (shown once). This is your `KINORA_TOKEN`. The project is auto-created from the
slug you choose in the upload step (e.g. `openobserve-e2e`).

---

## Part 6 — PART B: Wire the CI (GitHub Actions)

### 6.1 Store the secrets

In the GitHub repo (or org) settings → **Secrets and variables → Actions**:
- `KINORA_TOKEN` = the token from Part 5
- `KINORA_URL` = `https://kinora.yourco.com` (can be a *variable* instead of a secret)

### 6.2 Add the upload step to the merge job

In the **"Merge Reports and Upload to TestDino"** job in `playwright.yml`, right *after*
the step that produces `playwright-results/report.json`, add:

```yaml
      - name: Upload results to Kinora
        if: always()                      # upload even when tests failed
        working-directory: tests/ui-testing
        run: >
          npx @kinora/cli upload playwright-results/report.json
          --project openobserve-e2e
        env:
          KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
          KINORA_URL: ${{ secrets.KINORA_URL }}
          # git + CI metadata (sha, branch, repo URL, run link) auto-detect from GITHUB_*
```

Notes:
- `if: always()` so failed runs still report (those are the interesting ones).
- Keep this **alongside** the existing TestDino upload — don't remove TestDino yet.
- On GitHub Actions, commit SHA, branch, repo URL, and the run link fill in automatically,
  so each Kinora run links back to its Actions run and each SHA links to its commit.

### 6.3 A note on traces

Traces upload when the merged report has trace files attached. Today your config uses
`trace: 'on-first-retry'`, so only retried/failed tests carry a trace — which is usually
what you want. If you want traces on *every* failure regardless of retries, switch to
`trace: 'retain-on-failure'` in `playwright.config.js`. (In the POC backfill, real traces
*did* upload from the merged blobs.)

### 6.4 (Alternative) the per-run reporter — usually NOT for you

`@kinora/reporter` added to `playwright.config.js` auto-uploads at the end of a run. This
is the simplest path **only for single-job test runs**. Your suite is **sharded across
many parallel jobs**, so the reporter would create one partial Kinora run per shard. Stick
with the CLI-in-the-merge-job approach (6.2).

---

## Part 7 — How to know it worked (definition of done)

1. Trigger a CI run (open a PR or push).
2. After the merge job, open `https://kinora.yourco.com` → a **new run** appears under the
   `openobserve-e2e` project, with the right SHA/branch and a link back to the Actions run.
3. Click a failed test → **View trace** opens the embedded viewer.
4. After several runs, the **per-test history** view shows flaky-rate / fail-rate and
   flags "newly flaky" tests.

If all four are true, it's embedded.

---

## Part 8 — Rollout plan (start → end)

- **Phase 0 — Decide hosting.** Answer Part 3 with the infra repo. *(fresh window)*
- **Phase 1 — Stand up Kinora (staging).** Part 5. Optionally seed history by backfilling
  a few recent runs (the POC's `real-backfill/backfill.sh` shows exactly how).
- **Phase 2 — Add the CI upload step on ONE branch**, running in parallel with TestDino.
  Verify Part 7. No risk: uploads never fail the build.
- **Phase 3 — Enable on `main` / merge queue.** Watch for a week; let flaky history build.
- **Phase 4 — Evaluate vs TestDino.** Decide what to keep. Remember the gap: Kinora does
  not do manual test-case management (your `the-scribe` flow). Keep TestDino for that, or
  find another home, before dropping it.
- **End state:** every CI run reports to a self-hosted Kinora the whole team can browse;
  TestDino kept only for what Kinora doesn't cover.

---

## Part 9 — Cost & licensing

- **Self-host is free, forever** for internal use. The deployable parts are FSL-1.1-MIT
  (fair-source; converts to MIT after 2 years; the only restriction is you can't resell it
  as a competing hosted service — irrelevant for internal CI). The reporter/CLI are MIT.
- **Sizing:** start small (2 vCPU / 2–4 GB RAM). Storage grows with retained traces — use
  S3 and a retention policy to keep it bounded.
- This replaces the **reporting** value of your $99/mo TestDino seat; it does not replace
  test-case management.

---

## Part 10 — Gotchas we already hit in the POC (don't relearn these)

1. **Trace upload 500 — `EACCES mkdir /app/.data/artifacts`.** The artifacts volume is
   root-owned but the server runs as uid 1001. Fix once:
   ```bash
   docker compose exec -u root server chown -R 1001:65533 /app/.data
   ```
   (Or use S3 storage and sidestep it. Worth reporting upstream.)
2. **`413 Request Entity Too Large` on big traces.** Raise nginx `client_max_body_size`
   from `100m` to `500m` in `selfhost/nginx.conf`, then `docker compose restart web`.
   (A single giant trace may still exceed it — that one trace is skipped, tests unaffected.)
3. **Port already in use.** The POC moved off `8080` to `8099` because something else held
   8080. Pick a free `WEB_PORT`. (Behind real TLS this is internal anyway.)
4. **GitHub artifact retention is 1 day.** You can only backfill the last ~24h of historic
   runs; older blob artifacts are already gone. (Going forward, the CI step fixes this.)
5. **Sharded runs → use the CLI in the merge job**, not the per-shard reporter (avoids
   duplicate/partial runs).
6. **One workspace per account.** "Separate org" = separate account/workspace. Tokens are
   workspace-scoped; the project is created from the upload slug.

---

## Part 11 — What to bring to the fresh window (+ starter prompt)

**Bring:**
- Your **infra repo** (how OpenObserve is deployed today — k8s manifests / Helm / Terraform / compose).
- Your answers to the **Part 3 decisions** (or say "help me decide").

**Paste this to start the new chat:**

```
I want to embed Kinora (self-hosted Playwright dashboard) into OpenObserve's GitHub
Actions CI. We finished a local POC — see the branch `poc/kinora-selfhost`, folder
tests/ui-testing/kinora-poc/ (read CI-INTEGRATION-GUIDE.md and README.md there first).

I'm new to deploying this, so treat me as a beginner and walk me through it end to end.

Here is our infra repo / how OpenObserve is hosted today: <share repo or paste details>.

Help me:
1. Decide where/how to host the Kinora server (the Part 3 decisions).
2. Produce the exact deployment config for our environment (Part 5).
3. Produce the exact playwright.yml edit to upload results to Kinora (Part 6),
   keeping TestDino in parallel.
4. Give me a verification checklist (Part 7) and a phased rollout (Part 8).
```

---

## Appendix — beginner glossary

- **Playwright** — the framework your e2e tests are written in.
- **Blob report** — Playwright's machine-readable result bundle per job; many get merged.
- **`merge-reports`** — Playwright command that combines blob reports into one report.json.
- **Reporter vs CLI** — *Reporter* uploads automatically at run end (best for single-job
  runs). *CLI* (`@kinora/cli upload`) uploads an existing report.json (best for your
  sharded → merged setup).
- **Artifact** — a file GitHub Actions saves from a run (your blob reports are artifacts).
- **trace.zip** — a recording of a test (DOM, network, console) the trace viewer replays.
- **Token (`KINORA_TOKEN`)** — the password CI uses to upload to your Kinora workspace.
- **`PUBLIC_URL`** — the public web address of your Kinora; baked into the build, so set it
  right before building.
- **S3-compatible storage** — object storage (AWS S3, MinIO, etc.) for trace files.
