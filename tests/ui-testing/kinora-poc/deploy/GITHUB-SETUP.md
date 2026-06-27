# GitHub configuration for the Kinora CI upload

The CI step is already in `.github/workflows/playwright.yml` (job **"Merge Reports
and Upload to TestDino"**, step **"Upload results to Kinora"**). It is **gated OFF by
default** and runs `continue-on-error: true`, so until you do the two things below it
is completely inert and can never affect a build.

## What you need to configure

Settings → **Secrets and variables → Actions**:

| Kind | Name | Value | Notes |
|------|------|-------|-------|
| **Variable** | `UPLOAD_TO_KINORA` | `true` | The on/off switch. Absent/anything-else = off. Set this **last**, after the server is up and the two below are set. |
| **Variable** | `KINORA_URL` | `https://kinora.internal.example.com` | The public dashboard URL. A variable (not a secret) — it isn't sensitive. |
| **Secret** | `KINORA_TOKEN` | *(from the Kinora UI)* | API token. Created in the dashboard: **Settings → Workspace → API tokens → Create**. Shown once — copy it immediately. |

> Org-level vs repo-level: either works. Repo-level is simplest to start.

## How the step behaves

- Runs in the **merge job**, right after `playwright-results/report.json` is produced.
- `if: always() && env.UPLOAD_TO_KINORA == 'true'` → uploads on **every** run (pass *and*
  fail), because Kinora's value is flaky/fail history over time. (TestDino, by contrast,
  only uploads on failure.)
- Skips automatically when there's no report, or the report has 0 tests (optimized reruns).
- Uploads to project slug **`openobserve-e2e`** (auto-created on first upload).
- Git + CI metadata (SHA, branch, repo URL, run link) auto-detect from `GITHUB_*`.

## Turn-on order (zero-risk)

1. Stand up the server (see `README.md`) and confirm the dashboard loads.
2. Create the `KINORA_TOKEN` secret and `KINORA_URL` variable.
3. Set `UPLOAD_TO_KINORA=true` **on one branch first** (or repo-wide) and open/push a PR.
4. Verify a run appears in the dashboard (see `README.md` → "Definition of done").
5. Leave TestDino untouched the whole time — they run in parallel.

## To turn it off

Delete or set `UPLOAD_TO_KINORA` to anything other than `true`. No code change needed.
