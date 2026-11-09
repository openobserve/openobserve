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

import { describe, expect, it, vi } from "vitest";

const schemas = vi.hoisted(() => ({ columns: {} as Record<string, string[]> }));
vi.mock("./packMatchData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./packMatchData")>()),
  readSchemaColumns: async (_org: string, _type: string, name: string) =>
    schemas.columns[name] ?? [],
}));

import {
  findRawNginxLogs,
  isNginxLine,
  looksLikeNginx,
  plainTextColumn,
  RAW_LOG_SCAN_LIMIT,
} from "./rawLogs";

const ACCESS =
  '203.0.113.7 - - [09/Nov/2026:10:01:02 +0000] "GET /cart HTTP/1.1" 200 512 "-" "curl/8.0"';
const ERROR =
  '2026/11/09 10:01:02 [error] 31#31: *7 open() "/srv/favicon.ico" failed (2: No such file)';
const APP = "user 42 signed in from the mobile app";

describe("rawLogs", () => {
  it("reads a stream as plain text only when the message is its one own column", () => {
    expect(plainTextColumn(["_timestamp", "message"])).toBe("message");
    expect(plainTextColumn(["_timestamp", "_all", "log"])).toBe("log");
    expect(plainTextColumn(["_timestamp", "message", "status"])).toBeNull();
    expect(plainTextColumn(["_timestamp", "request"])).toBeNull();
  });

  it("recognises Nginx access and error lines and nothing else", () => {
    expect(isNginxLine(ACCESS)).toBe(true);
    expect(isNginxLine(ERROR)).toBe(true);
    expect(isNginxLine(APP)).toBe(false);
  });

  it("needs most samples to read as Nginx", () => {
    expect(looksLikeNginx([ACCESS, APP])).toBe(true);
    expect(looksLikeNginx([ACCESS, APP, APP])).toBe(false);
    expect(looksLikeNginx([])).toBe(false);
  });

  it("names plain-text Nginx streams and skips parsed or non-Nginx ones", async () => {
    schemas.columns = {
      edge: ["_timestamp", "message"],
      parsed: ["_timestamp", "message", "status", "path"],
      app: ["_timestamp", "message"],
    };
    const samples: Record<string, string[]> = {
      edge: [ACCESS, ERROR],
      parsed: [ACCESS],
      app: [APP],
    };
    const readValues = vi.fn(async (stream: string, fields: string[]) => ({
      [fields[0]]: samples[stream],
    }));
    const found = await findRawNginxLogs(
      "org",
      new Map([
        ["edge", 3],
        ["parsed", 2],
        ["app", 1],
      ]),
      readValues,
    );
    expect(found).toEqual([{ stream: "edge", column: "message" }]);
    expect(readValues).not.toHaveBeenCalledWith("parsed", expect.anything());
  });

  it("checks only the most recently written streams", async () => {
    schemas.columns = {};
    const logs = new Map(
      Array.from({ length: RAW_LOG_SCAN_LIMIT + 5 }, (_, i) => [`s${i}`, i] as [string, number]),
    );
    for (const name of logs.keys()) schemas.columns[name] = ["_timestamp", "message"];
    const readValues = vi.fn(async () => ({}));
    await findRawNginxLogs("org", logs, readValues);
    expect(readValues).toHaveBeenCalledTimes(RAW_LOG_SCAN_LIMIT);
    expect(readValues).not.toHaveBeenCalledWith("s0", expect.anything());
  });
});
