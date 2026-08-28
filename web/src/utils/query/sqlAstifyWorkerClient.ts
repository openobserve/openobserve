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

// One persistent worker for every astifyOffThread caller in the app — spinning
// one up per call would add startup overhead on the hot editor-diagnostics path.
// Requests resolve in the order the worker receives them: a fast query queued
// behind a pathologically nested one still waits for that one to finish before
// its own result comes back. That only delays a diagnostic squiggle; it never
// blocks the main thread, which is the actual bug this exists to avoid.

export interface AstifyError extends Error {
  location?: { start?: { line?: number; column?: number; offset?: number } };
  expected?: unknown[];
  found?: string | null;
}

interface SerializedAstifyError {
  message?: string;
  location?: AstifyError["location"];
  expected?: unknown[];
  found?: string | null;
  name?: string;
}

// The worker can only postMessage plain, structured-clonable data — not an
// Error instance — so rebuild one here. Callers (sqlDiagnostics.ts and
// friends) read .location/.expected/.found off the caught value exactly as
// they did off whatever parser.astify() used to throw synchronously, and
// anything that checks `instanceof Error` (logging, error reporting) still
// works, unlike a bare rejected plain object.
const toAstifyError = (serialized: SerializedAstifyError): AstifyError => {
  const err = new Error(serialized.message ?? "SQL parse error") as AstifyError;
  if (serialized.name) err.name = serialized.name;
  err.location = serialized.location;
  err.expected = serialized.expected;
  err.found = serialized.found;
  return err;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (ast: unknown) => void; reject: (err: AstifyError) => void }
>();

const getWorker = (): Worker => {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/sqlParserWorker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (
    event: MessageEvent<{ id: number; ok: boolean; ast?: unknown; error?: SerializedAstifyError }>,
  ) => {
    const { id, ok, ast, error } = event.data;
    const settled = pending.get(id);
    if (!settled) return;
    pending.delete(id);
    if (ok) settled.resolve(ast);
    else settled.reject(toAstifyError(error ?? {}));
  };
  return worker;
};

export const astifyOffThread = (sql: string): Promise<unknown> => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, sql });
  });
};
