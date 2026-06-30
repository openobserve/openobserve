// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Uploads the build's JS sourcemaps to OpenObserve so RUM error stacktraces can
// be de-minified. Runs after `vite build` for cloud builds (alpha1 / prod).
//
// The OpenObserve RUM backend matches a sourcemap to an incoming error by the
// triple (service, env, version). Those MUST be identical to the values the RUM
// SDK tags events with at runtime (see web/src/main.ts). `version` is the build
// env var VITE_SOURCEMAP_VERSION, shared by both sides so they always agree.
//
// Backend limits (src/service/sourcemaps/mod.rs, src/config/src/config.rs):
//   - each extracted .map file must be <= 5 MB  (SOURCEMAP_FILE_MAX_SIZE)
//   - total request body must be <= 50 MB        (10 * SOURCEMAP_FILE_MAX_SIZE)
// Vite emits the original source inline (`sourcesContent`), which blows the main
// app map past 5 MB. We strip `sourcesContent` before zipping: stack translation
// (file:line:col + function name) only needs the mappings, not the inline source.
//
// Auth: an OpenObserve service account — HTTP Basic with email:token.
//
// Required env (real env vars in CI, or .env.<mode>[.local] for manual builds):
//   O2_SOURCEMAP_ENDPOINT   base URL of the O2 API, e.g. https://alpha1.dev.zinclabs.dev
//   O2_SOURCEMAP_ORG        organization identifier (must match RUM org)
//   O2_SOURCEMAP_SA_EMAIL   service account email
//   O2_SOURCEMAP_SA_TOKEN   service account token
//   VITE_SOURCEMAP_SERVICE  service name  (shared with the client RUM init)
//   VITE_SOURCEMAP_ENV      environment   (shared with the client RUM init)
//   VITE_SOURCEMAP_VERSION  build version (shared with the client RUM init)
// The VITE_SOURCEMAP_{SERVICE,ENV,VERSION} trio is the single source of truth
// for the match key; web/src/main.ts reads the same three for the RUM SDK.
//
// Optional env:
//   O2_SOURCEMAP_UPLOAD=false   force-skip the upload even if creds are present
//   O2_SOURCEMAP_KEEP_LOCAL=true keep the .map files in dist/ after upload
//                               (default: delete them, since maps are 'hidden'
//                                and must not be served publicly)

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const distDir = path.resolve(webRoot, "dist");

// 5 MB per extracted file, 50 MB per request — keep a margin under the request cap.
const PER_FILE_MAX = 5 * 1024 * 1024;
const REQUEST_BODY_MAX = 45 * 1024 * 1024;

const mode = process.argv[2] || process.env.NODE_ENV || "";

// Load env files in Vite's precedence (most specific first). dotenv never
// overrides keys already present, so real env vars (CI secrets) always win and
// earlier-loaded files beat later ones.
function loadEnv() {
  const files = [
    mode && `.env.${mode}.local`,
    ".env.local",
    mode && `.env.${mode}`,
    ".env",
  ].filter(Boolean);
  for (const f of files) {
    const p = path.resolve(webRoot, f);
    if (fs.existsSync(p)) dotenv.config({ path: p });
  }
}

function readConfig() {
  // service/env/version share ONE source of truth with the client RUM init
  // (web/src/main.ts reads the same VITE_SOURCEMAP_* vars), so events and
  // sourcemaps always carry an identical service+env+version triple. The
  // O2_SOURCEMAP_* fallbacks exist for upload-only overrides.
  return {
    endpoint: process.env.O2_SOURCEMAP_ENDPOINT,
    org: process.env.O2_SOURCEMAP_ORG,
    email: process.env.O2_SOURCEMAP_SA_EMAIL,
    token: process.env.O2_SOURCEMAP_SA_TOKEN,
    service: process.env.VITE_SOURCEMAP_SERVICE || process.env.O2_SOURCEMAP_SERVICE,
    env: process.env.VITE_SOURCEMAP_ENV || process.env.O2_SOURCEMAP_ENV,
    version: process.env.VITE_SOURCEMAP_VERSION || process.env.O2_SOURCEMAP_VERSION,
    keepLocal: process.env.O2_SOURCEMAP_KEEP_LOCAL === "true",
  };
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".js.map")) out.push(p);
  }
  return out;
}

// Returns the map JSON with `sourcesContent` removed, or null if it can't be
// parsed or is still over the per-file cap after stripping.
function stripSourcesContent(file) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.warn(`  ! skipping ${path.basename(file)} — not valid JSON: ${e.message}`);
    return null;
  }
  delete json.sourcesContent;
  const buf = Buffer.from(JSON.stringify(json));
  if (buf.length > PER_FILE_MAX) {
    console.warn(
      `  ! skipping ${path.basename(file)} — ${(buf.length / 1048576).toFixed(1)}MB exceeds the 5MB per-file limit even after stripping sourcesContent`,
    );
    return null;
  }
  return buf;
}

// Group files into batches whose zipped size stays under the request cap. We
// estimate with uncompressed size (zip only shrinks it) so batches are safe.
function batchBySize(entries) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const e of entries) {
    if (size + e.buf.length > REQUEST_BODY_MAX && current.length) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(e);
    size += e.buf.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function zipBatch(entries) {
  const zip = new JSZip();
  // Store by basename (already ends in .js.map). The backend pairs/keys files by
  // basename too, so flattening nested dirs is safe; hashed names avoid clashes.
  for (const e of entries) zip.file(path.basename(e.file), e.buf);
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

function buildMultipart(fields, zipBuf) {
  const boundary = "----o2sourcemaps" + crypto.randomBytes(12).toString("hex");
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value == null) continue;
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sourcemaps.zip"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
  );
  parts.push(zipBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

function post(cfg, zipBuf) {
  const { body, boundary } = buildMultipart(
    { service: cfg.service, env: cfg.env, version: cfg.version },
    zipBuf,
  );
  const base = cfg.endpoint.replace(/\/+$/, "");
  const url = new URL(`${base}/api/${cfg.org}/sourcemaps`);
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const transport = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  loadEnv();
  const cfg = readConfig();

  if (process.env.O2_SOURCEMAP_UPLOAD === "false") {
    console.log("[sourcemaps] upload disabled (O2_SOURCEMAP_UPLOAD=false) — skipping.");
    return;
  }

  const envNames = {
    endpoint: "O2_SOURCEMAP_ENDPOINT",
    org: "O2_SOURCEMAP_ORG",
    email: "O2_SOURCEMAP_SA_EMAIL",
    token: "O2_SOURCEMAP_SA_TOKEN",
    service: "VITE_SOURCEMAP_SERVICE",
    env: "VITE_SOURCEMAP_ENV",
    version: "VITE_SOURCEMAP_VERSION",
  };
  const missing = Object.keys(envNames).filter((k) => !cfg[k]);
  if (missing.length) {
    console.warn(
      `[sourcemaps] skipping upload — missing config: ${missing.map((k) => envNames[k]).join(", ")}`,
    );
    console.warn("[sourcemaps] build artifact is fine; set the vars above to enable upload.");
    return;
  }

  const files = walk(distDir);
  if (!files.length) {
    console.warn(`[sourcemaps] no .js.map files found under ${distDir} — did the build run with sourcemaps enabled?`);
    return;
  }

  console.log(
    `[sourcemaps] preparing ${files.length} maps for ${cfg.service}/${cfg.env}@${cfg.version} -> ${cfg.endpoint}/api/${cfg.org}/sourcemaps`,
  );

  const entries = [];
  for (const file of files) {
    const buf = stripSourcesContent(file);
    if (buf) entries.push({ file, buf });
  }
  if (!entries.length) {
    console.warn("[sourcemaps] no uploadable maps after processing — skipping.");
    return;
  }

  const batches = batchBySize(entries);
  console.log(`[sourcemaps] uploading in ${batches.length} batch(es)...`);

  for (let i = 0; i < batches.length; i++) {
    const zipBuf = await zipBatch(batches[i]);
    console.log(
      `[sourcemaps] batch ${i + 1}/${batches.length}: ${batches[i].length} files, ${(zipBuf.length / 1048576).toFixed(2)}MB zipped`,
    );
    await post(cfg, zipBuf);
  }

  console.log(`[sourcemaps] uploaded ${entries.length} maps successfully.`);

  if (cfg.keepLocal) {
    console.log("[sourcemaps] O2_SOURCEMAP_KEEP_LOCAL=true — keeping .map files in dist/.");
  } else {
    for (const file of files) {
      try {
        fs.rmSync(file);
      } catch (e) {
        console.warn(`  ! could not delete ${file}: ${e.message}`);
      }
    }
    console.log(`[sourcemaps] deleted ${files.length} local .map files (hidden sourcemaps must not ship).`);
  }
}

main().catch((err) => {
  console.error(`[sourcemaps] upload failed: ${err.message}`);
  process.exit(1);
});
