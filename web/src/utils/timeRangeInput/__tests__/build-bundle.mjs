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

// Builds the parser with Vite for specs that must run outside jsdom.
// `chunks [check]` prints the browser chunks of the parse (or check-only) entry as JSON;
// `ssr <dir>` writes a node bundle of index.ts to <dir>.
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

async function chunks(entry) {
  const out = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2020",
      minify: "esbuild",
      rollupOptions: {
        input: here(entry),
        preserveEntrySignatures: "exports-only",
        output: {
          manualChunks: (id) =>
            id.includes("/node_modules/date-fns") ? "o2cs-date-fns" : undefined,
        },
      },
    },
  });
  const outputs = Array.isArray(out) ? out : [out];
  const list = outputs
    .flatMap((o) => o.output)
    .filter((c) => c.type === "chunk")
    .map((c) => ({
      fileName: c.fileName,
      name: c.name,
      isEntry: c.isEntry,
      size: c.code.length,
      gzip: gzipSync(c.code, { level: 9 }).length,
      modules: Object.keys(c.modules),
      imports: c.imports,
    }));
  process.stdout.write(JSON.stringify(list));
}

async function ssr(dir) {
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: here("../index.ts"),
      outDir: dir,
      emptyOutDir: true,
      target: "node20",
      minify: false,
      rollupOptions: {
        output: { format: "es", entryFileNames: "parser.mjs", inlineDynamicImports: true },
      },
    },
  });
}

const [mode, dir] = process.argv.slice(2);
if (mode === "chunks") await chunks(dir === "check" ? "./check-entry.ts" : "./bundle-entry.ts");
else if (mode === "ssr") await ssr(dir);
else throw new Error("usage: build-bundle.mjs chunks [check] | ssr <dir>");
