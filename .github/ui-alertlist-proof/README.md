# Isolated AlertList proof

This scratch branch validates a frozen test-fixture optimization. It does not change production tests or establish the full UI suite's 180-second target. The only workflow trigger is a push to `bench/ui-alertlist-proof-20261028` that changes this directory or its workflow. There is no PR or manual trigger, no paid runner, and no automatic retry.

The job uses one public `ubuntu-latest` runner, read-only repository permission, Node `24.22.0`, npm `11.19.1`, and one `npm ci`. Checkout credentials are not persisted. The pinned baseline is commit `3960df0f12760f4e8628a5a9104fef65048ff369`, with web tree `d51379f81d6f4521be4ae1bfe69fc6c5dba4a17d`. Both source guards and a complete tracked-web SHA256 inventory protect the common source/configuration snapshot.

Frozen input SHA256 values:

- `AlertList.baseline.spec.ts`: `82bfaec613aae3405ad9ea3575c7672be224c2aef47e6fb33ad5342ca774ae63`
- `AlertList.candidate.spec.ts`: `dcf2857d8fa0b23f7d3c7d6351cc5bc5b828f779328e1dcd6f95c62a53b36284`

The runner first verifies TypeScript AST equivalence of all 115 declarations and 237 `expect` calls. It applies the candidate for full `npm run format:check` and targeted ESLint, then restores the baseline before the four sequential trials: baseline normal, candidate normal, baseline seed 1729, candidate seed 1729. Only `web/src/components/alerts/AlertList.spec.ts` is swapped. A `finally` block restores its original bytes and verifies the inventory even when a trial fails or receives a termination signal.

Each trial uses isolated forks with one worker, real covered shard blob output, and a real Vitest coverage merge. It inherits production coverage include/exclude, jsdom setup, and dependency optimization. Only the focused proof's temporary config disables threshold enforcement so one test file can produce full-source coverage reports; the production config and both CI threshold gates are untouched. The optimizer cache is cleared only inside the runner-owned temporary directory before every trial, making the pairing cold on both sides. The npm download-cache result and pretrial optimizer-cache state are recorded separately.

Admission requires 117 matching case identities/dispositions, all passing, zero unhandled errors, exact per-source summary objects and covered statement/function/branch locations, successful commands, and restored source. Matching baseline/candidate failures are diagnostic evidence only; they cannot pass the job. Missing reports, source drift, timeout, format/lint failure, and coverage differences fail explicitly. Artifact upload does not override that failure.

The job has a 30-minute cap. Its budget clock starts before the shallow checkout, which has a four-minute cap. A separate fetch retrieves only the exact pinned baseline at depth one, bounded to 90 seconds plus 10 seconds for termination; no full history or assumed ancestor depth is needed. The proof receives at most 22 minutes, including format/lint, and less if checkout/setup/install consumed the reserved evidence-collection window. It reserves 15 seconds internally for cleanup. Individual caps are format 180 seconds, ESLint 60 seconds, tests 240 seconds, and merge 90 seconds; these are upper limits, not guaranteed allocations. Expired budgets prevent new subprocesses. Timeout cleanup targets only runner-owned process groups, excluding already terminated zombies, and reaps their leader. There are no retries. Repository-dependent restoration, packaging and upload require a successful checkout; checkout failures remain failed with their ordinary GitHub logs.

Evidence includes exact commands and launch limits, source/runtime hashes, CPU and memory metadata, GNU time resource observations, logs and per-case progress, test inventories, actual blobs and coverage reports, comparisons, and restoration status. Packaging allows at most 5,000 files, 512 MiB raw, and 256 MiB compressed, rejects symlinks, and emits a manifest with SHA256 values. A packaging limit fails the job and retains the diagnostic manifest rather than uploading a partial archive. Artifacts expire after one day. GNU time RSS is a process-family high-water observation, not an aggregate memory cap.

From a prepared checkout with the exact runtime, the standalone command is:

```sh
python3 .github/ui-alertlist-proof/run-proof.py \
  --web web --output /tmp/alertlist-proof-new-output \
  --baseline .github/ui-alertlist-proof/AlertList.baseline.spec.ts \
  --candidate .github/ui-alertlist-proof/AlertList.candidate.spec.ts \
  --seed 1729 --test-timeout 240 --merge-timeout 90 --overall-timeout 1320
```

The output directory must not already exist. Lightweight infrastructure checks are `python3 -B .github/ui-alertlist-proof/test-proof.py`, `python3 -B .github/ui-alertlist-proof/test-package-evidence.py`, `node --check .github/ui-alertlist-proof/verify-bodies.mjs`, and `actionlint .github/workflows/ui-alertlist-proof.yml`. Full runtime proof remains pending remote execution after independent review. Neither the sum of these diagnostic runs nor free-runner timings represent production UI wall time or the performance of a standard8 runner.
