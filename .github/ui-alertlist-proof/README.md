# Isolated UI worker-count proof

This branch runs the original PLAN.md Phase 0 worker screen on one `ubicloud-standard-8` VM. It does not change production settings. The existing workflow path and branch remain unchanged; old AlertList snapshots and its AST helper are historical, unused inputs.

The pinned source is tested merge `743990d3839a4fa8de4f3fcf31b8d7ca3f00c282`, with web tree `337d85bc38dec7e0e17afea5108d96d4b4a2c0c0`. One locked install uses Node 24.22.0 and npm 11.19.1. `sample.json` freezes the existing 40-file UI sample plus ConfigPanel, AlertList, Schema, TraceDetailsSidebar, four Node specs and 28 measured medium-cost jsdom files: 76 files (72 jsdom, 4 Node), 3,772 cases (3,768 passed, four existing skips). Its per-file case digests come from run 40860745861 on the identical source. All cases run; no fixture replacement, test filtering within a file or case shuffle is applied. AlertList and ConfigPanel have known pre-existing shuffle failures.

The initial 48-file cohort was tail-dominated: saved round 2 file-phase sum 402.40s versus 7 × longest 90.10s = 630.72s. The additional 28 are the smallest 20–32-file extension reaching sum/(7×longest)≥1.25 in both saved runs: round 1: 594.05 / 471.63 = 1.260; round 2: 920.36 / 630.72 = 1.459. Candidates have round 2 total file phases of 10–30s and test execution of 2–20s, ranked by the smaller round 1/round 2 phase cost. Exact additions and figures are in sample.json. This queue-density heuristic reduces tail domination but does not predict actual scaling.

Four fresh processes run with **7, 6, 6, 7** fork workers. Each uses a fresh optimizer cache and the production default heap policy (the old single-file probe's 8 GiB override is removed), unchanged real projects/setup/isolation and full production source coverage scope. Only focused-run thresholds are disabled symmetrically. Each producer creates a real Vitest blob; a separate stock merge writes complete JSON summary and maps. Seven is Vitest's expected run-mode default on eight available CPUs; six tests reduced contention, not increased parallelism.

The proof rejects missing/reordered trials, changed source/runtime/inventory, wrong resolved workers/projects/isolation, unexpected cases or dispositions, unhandled errors, failed commands, differing source maps/counters or changed covered-location sets. Both six-worker trials and the repeated seven-worker baseline must match the first seven-worker trial. Coverage variability in the repeated baseline fails the proof and is retained for diagnosis. OS page cache is not flushed; the paired order limits but cannot eliminate order effects. Passing equivalence does not automatically promote six workers or establish a speedup.

Evidence includes full case records, producer/merge commands and wall times, `/usr/bin/time -v` CPU/RSS, module phase diagnostics, last-module/coverage-callback timestamps, blob bytes, CPU models, available parallelism, actual heap limit/NODE_OPTIONS and resolved root/project worker options. Callback intervals include reporting/scheduling and are not a pure coverage CPU measurement. File phase sums overlap across workers; import timers nest within phases. Inspect the actual job setup **VM Family** log before assigning prices: a CPU model or configured runner label alone is insufficient family evidence. Review cold paired results and repeated baseline variability, not one favorable timing. The sample cannot prove a whole-suite optimum or under-three-minute result.

The job has a 28-minute cap. Its clock starts before checkout; proof work ends by minute 24, with a maximum 1,320-second script allocation and a 15-second internal cleanup reserve. Producer/merge caps are 240/90 seconds, constrained by the remaining overall budget. Checkout, fetch, install, source verification, packaging and upload are separately bounded. Timeouts terminate only owned process groups, produce an explicit incomplete result and fail without retries. No source restoration is needed because no source is substituted; final inventory and git checks must still pass.

Capture preserves bounded diagnostics first, independently of the full archive traversal. The full archive has 1 GiB raw / 256 MiB compressed caps; fallback has 32 MiB total / 4 MiB per-file / 128-file caps. Overflow remains an explicit failed package with available diagnostics uploaded. Symlink, special-file and traversal protections remain enforced. An incomplete proof or archive is never reported as accepted.

The push trigger is limited to `bench/ui-alertlist-proof-20261028` and this proof directory/workflow. Production unit/database push triggers accept only main; production e2e/API workflows have no branch-push trigger; release accepts version tags. With no PR for this branch, pushing this scoped proof does not schedule those suites. Read-only repository permission, public-repository guard and `persist-credentials: false` remain in place.

Set `ACTIONLINT_CONFIG` to an external actionlint configuration that recognizes the existing `ubicloud-standard-8` custom runner label.

Run lightweight guards locally (no dependency install or Vitest execution):

```sh
python3 .github/ui-alertlist-proof/test-proof.py
python3 .github/ui-alertlist-proof/test-package-evidence.py
actionlint -config-file "$ACTIONLINT_CONFIG" .github/workflows/ui-alertlist-proof.yml
```

The orchestrator independently reviews the frozen package before its one authorized measurement run. No retry, production configuration change or new benchmark framework is implied.
