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
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  INTERNAL_STREAM_NAMES,
  isInternalStreamName,
  isUserDataStream,
  userDataStreams,
} from "./internalStreams";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const selfReportingDir = join(repoRoot, "src/config/src/meta/self_reporting");

// Every `const NAME: &str = "value";` in the Rust sources the list refers to.
const rustStringConsts = (): Map<string, string> => {
  const files = readdirSync(selfReportingDir)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => join(selfReportingDir, f));
  files.push(join(repoRoot, "src/core/src/self_reporting/cloud_events.rs"));
  const consts = new Map<string, string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/const\s+([A-Z_]+)\s*:\s*&str\s*=\s*"([^"]*)"/g)) {
      consts.set(m[1], m[2]);
    }
  }
  return consts;
};

const rustInternalNames = (): string[] => {
  const source = readFileSync(join(selfReportingDir, "usage.rs"), "utf8");
  const start = source.indexOf("pub const INTERNAL_STREAM_NAMES");
  const open = source.indexOf("= [", start) + 2;
  const close = source.indexOf("];", open);
  const consts = rustStringConsts();
  return source
    .slice(open + 1, close)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (item.startsWith('"')) return item.slice(1, -1);
      const ident = item.split("::").pop() ?? item;
      const value = consts.get(ident);
      if (value === undefined) throw new Error(`unresolved Rust const ${ident}`);
      return value;
    });
};

describe("internalStreams", () => {
  it("lists exactly the names in the Rust INTERNAL_STREAM_NAMES const", () => {
    expect([...INTERNAL_STREAM_NAMES].sort()).toEqual(rustInternalNames().sort());
  });

  it("includes the cloud_events stream named in cloud_events.rs", () => {
    expect(rustStringConsts().get("CLOUD_EVENT_STREAM")).toBe("cloud_events");
    expect(INTERNAL_STREAM_NAMES).toContain("cloud_events");
  });

  it("treats the _o2_ prefix as internal and a lookalike user name as user data", () => {
    expect(isInternalStreamName("_o2_dbm_server")).toBe(true);
    expect(isInternalStreamName("o2_app")).toBe(false);
    expect(isInternalStreamName("errors_app")).toBe(false);
  });

  it("counts only logs, metrics and traces, RUM streams included", () => {
    expect(isUserDataStream("default", "logs")).toBe(true);
    expect(isUserDataStream("up", "metrics")).toBe(true);
    expect(isUserDataStream("default", "traces")).toBe(true);
    expect(isUserDataStream("_rumdata", "logs")).toBe(true);
    expect(isUserDataStream("_rumlog", "logs")).toBe(true);
    expect(isUserDataStream("_sessionreplay", "logs")).toBe(true);
    expect(isUserDataStream("default", "metadata")).toBe(false);
    expect(isUserDataStream("default", "index")).toBe(false);
    expect(isUserDataStream("default", "enrichment_tables")).toBe(false);
  });

  it("never counts an internal name, whatever its type", () => {
    for (const name of INTERNAL_STREAM_NAMES) {
      expect(isUserDataStream(name, "logs")).toBe(false);
    }
  });

  it("filters a stream list down to user data rows", () => {
    const rows = [
      { name: "usage", stream_type: "logs" },
      { name: "default", stream_type: "logs" },
      { name: "_o2_db_stats", stream_type: "logs" },
      { name: "default", stream_type: "metadata" },
      { name: "cpu", stream_type: "metrics" },
    ];
    expect(userDataStreams(rows).map((r) => r.name)).toEqual(["default", "cpu"]);
    expect(userDataStreams(undefined)).toEqual([]);
  });
});
