# kinora-poc (runnable code)

POC code for evaluating **Kinora** as a self-hosted Playwright reporting dashboard.

- A self-contained, offline Playwright suite (`tests/`) + reporter wiring (`playwright.config.js`).
- A real-CI backfill tool (`real-backfill/`): download GitHub blob reports → merge → upload.

📄 **Docs live in** [`tests/ui-testing/MD_Files/agents-and-skills/Kinora/`](../MD_Files/agents-and-skills/Kinora/):
- `README.md` — index
- `EVALUATION.md` — should we adopt it (TestDino comparison, etc.)
- `POC-SUMMARY.md` — what was stood up, findings, gotchas, admin commands
- `CI-INTEGRATION-GUIDE.md` — how to embed Kinora in CI (next step)

## Quick run

```bash
cd tests/ui-testing/kinora-poc
npm install
# needs a running Kinora at KINORA_URL (see POC-SUMMARY.md) and a .env with KINORA_TOKEN
npm test
```
