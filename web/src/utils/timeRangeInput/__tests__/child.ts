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

import { spawnSync } from "node:child_process";

export interface ChildRun<T> {
  value: T;
  ms: number;
}

/** Runs ESM `code` in a fresh node process; a stall past `timeoutMs` kills it and fails the caller. */
export function runChild<T>(
  code: string,
  env: Record<string, string> = {},
  timeoutMs = 60_000,
): ChildRun<T> {
  const started = Date.now();
  const res = spawnSync("node", ["--input-type=module", "-e", code], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 256 << 20,
  });
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(`child failed (${res.status} ${res.signal}): ${res.stderr.slice(0, 2000)}`);
  return { value: JSON.parse(res.stdout), ms: Date.now() - started };
}
