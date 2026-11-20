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

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BUILDER = join(__dirname, "./build-bundle.mjs");
const WEB = join(__dirname, "../../../..");

export interface ChunkInfo {
  fileName: string;
  name: string;
  isEntry: boolean;
  size: number;
  gzip: number;
  modules: string[];
  imports: string[];
}

export function browserChunks(entry: "parse" | "check" = "parse"): ChunkInfo[] {
  const args = entry === "check" ? [BUILDER, "chunks", "check"] : [BUILDER, "chunks"];
  return JSON.parse(
    execFileSync("node", args, { cwd: WEB, encoding: "utf8", maxBuffer: 64 << 20 }),
  );
}

let built: string | undefined;

/** Path of a node ESM bundle of index.ts, built once per test file. */
export function nodeBundle(): string {
  if (!built) {
    const dir = mkdtempSync(join(tmpdir(), "time-range-parser-"));
    execFileSync("node", [BUILDER, "ssr", dir], { cwd: WEB, stdio: "ignore" });
    built = join(dir, "parser.mjs");
  }
  return built;
}
