# Isolated pool screen

One public-repository standard-8 job compares forks7, threads7, threads7, forks7 on the same pinned source and76-file cohort. It runs only for the dedicated benchmark branch/path push. It does not modify or run the production PR workflow.

Each trial uses a fresh Vitest process and independent optimizer/report directories. It retains production project order, setup, isolation and full source coverage. Full-suite coverage thresholds are disabled symmetrically for this diagnostic subset; exact maps, denominators and positive covered locations must match in both directions and in baseline/candidate repeats. The first successful forks trial freezes the complete case names, projects, modes and states before either threads trial.

A successful screen requires all four trials, exact correctness, at least15% lower complete-process wall time in both paired directions, and no summed user/system CPU regression. Memory-regression assurance remains explicitly unverified even when this screen passes. RSS sums resident pages per process every0.5seconds and double-counts shared pages across forks; it is not comparable physical memory evidence across pool types. It and GNUtime maxRSS are retained only as diagnostics and never decide acceptance. Review the actual VM family in the setup log before accepting the screen.

The measured boundary includes stock V8 JSON coverage completion, but excludes installation, runner setup, artifact upload and production blob merge. It cannot establish full-suite runtime or billing savings. Negative or incomplete results stop without retries or dispatching a full suite.

The12-minute job includes setup and upload. Trial execution gets144seconds with6seconds reserved for termination/reaping inside the150-second trial bound; the driver has at most540seconds with20seconds reserved for final evidence. Late setup reduces that budget. Packaging rejects symlinks and excessive file counts/bytes, retaining bounded failure diagnostics if the full archive cannot be produced.

Offline checks:

```sh
python3 .github/ui-pool-proof/test-proof.py
python3 .github/ui-pool-proof/test-package-evidence.py
python3 .github/ui-pool-proof/config-smoke.py "$PWD"
actionlint -config-file /path/to/runner-labels.yaml .github/workflows/ui-pool-proof.yml
```

The config smoke requires installed dependencies and Node24.22.0; it resolves configs and enumerates files without executing tests. Process cleanup, reporter and artifact packaging reuse the reviewed trace-proof harness, with pool-specific acceptance and no coverage exceptions.
