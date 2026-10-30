# Trace fixture sample proof

This single branch-scoped job compares the pinned untouched original with the reviewed trace fixture cleanup, in original/candidate/candidate/original order on one VM. It does not change production CI.

The measured boundary is each fresh covered Vitest process, including setup, execution and stock V8 JSON coverage completion. Install, job setup, upload and the production blob/merge pipeline are excluded from sample times. Two files limit concurrent execution despite retaining seven production workers. Neither a sample improvement nor CPU reduction proves full-suite duration or billed cost.

`sample.json` pins both source trees, the two spec blobs and all 369 case identities/dispositions (366 passed, three skipped). Every trial inherits the original Node/jsdom projects and setup, isolation and full coverage scope; only selected files, fresh caches, reporters and focused threshold enforcement differ symmetrically. No coverage normalization occurs.

Acceptance requires matching source maps, denominators and covered locations, except the explicitly accepted `CodeQueryEditor.vue:494` branch 15 arm 1 diagnostic unknown-route fallback. Both original repeats and both candidate repeats must independently preserve covered locations. Raw counter differences remain in the evidence. Negative counters, missing cases, changed dispositions, unhandled errors and unexpected runtime/setup choices fail closed.

`sampledImprovementEligible` requires both paired wall-time reductions and no paired CPU increase, after correctness passes. `performanceAcceptance` stays false until the actual VM family is checked in the run's Set up job log. A configured runner label does not establish the VM family. Full-suite runtime and billing remain unverified.

The 12-minute job performs one locked install. Trials have a 480-second combined budget, 120-second individual cap and process-group termination/reaping with cleanup reserve. The driver restores candidate sources in `finally`; the always-run workflow step also restores the two pinned files after interruption. Evidence packaging rejects symlinks/special files, caps count/raw/archive sizes and keeps bounded diagnostics if full packaging fails. Artifacts expire after three days.

Local guards, without executing product tests:

```sh
python3 .github/ui-trace-fixture-proof/test-proof.py
python3 .github/ui-trace-fixture-proof/test-package-evidence.py
python3 .github/ui-trace-fixture-proof/config-smoke.py "$PWD"
node --check .github/ui-trace-fixture-proof/reporter.mjs
```

The config smoke requires Node 24.22.0 and installed locked web dependencies. It initializes and closes Vitest/Vite, validates both project configs and file-serving boundaries, and never collects or executes test cases. Restoration guards use an isolated temporary synthetic Git repository; the working checkout is never staged or committed.
