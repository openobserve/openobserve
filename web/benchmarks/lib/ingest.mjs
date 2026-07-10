import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, BACKEND_URL, AUTH, ORG } from "../config.mjs";
import { log } from "./util.mjs";

// One-shot ingestion of the standard e2e dataset so the benchmarked routes
// render real, recent data. Mirrors the Playwright global-setup: POST the
// records to /api/<org>/<stream>/_json with Basic auth. The dataset has no
// _timestamp, so OpenObserve stamps ingest-time (now) — data lands in the
// default "last 15 min" window. Runs ONCE against the shared backend, not
// per-commit. Enable with `node run.mjs --ingest`.
export async function ingestData({ stream = "e2e_automate" } = {}) {
  const dataPath = path.join(REPO_ROOT, "tests", "test-data", "logs_data.json");
  if (!fs.existsSync(dataPath)) {
    log(`⚠ dataset not found at ${dataPath} — skipping ingestion`);
    return { skipped: true };
  }
  if (!AUTH.email || !AUTH.password) {
    log("⚠ no credentials — skipping ingestion");
    return { skipped: true };
  }

  const body = fs.readFileSync(dataPath); // send raw bytes (already JSON array)
  const auth = Buffer.from(`${AUTH.email}:${AUTH.password}`).toString("base64");
  const url = `${BACKEND_URL}/api/${ORG}/${stream}/_json`;

  log(`ingesting ${(body.length / 1e6).toFixed(1)}MB → ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    log(`⚠ ingestion failed (${res.status}): ${text.slice(0, 300)}`);
    return { ok: false, status: res.status };
  }
  log(`ingestion OK (${res.status}): ${text.slice(0, 200)}`);
  return { ok: true, status: res.status, stream };
}
