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

import { contentHash, recordKey } from "./useInstallRecords";

describe("recordKey", () => {
  it("keeps one key per install", () => {
    expect(recordKey("kubernetes", "abc")).toBe("starter_pack.kubernetes.abc");
  });
});

describe("contentHash", () => {
  it("ignores key order at every depth", () => {
    expect(contentHash({ a: 1, b: { c: 2, d: [{ e: 3, f: 4 }] } })).toBe(
      contentHash({ b: { d: [{ f: 4, e: 3 }], c: 2 }, a: 1 }),
    );
  });

  it("orders keys by code unit whatever the locale would collate", () => {
    const hash = contentHash({ height: 1, chartType: 2, Zeta: 3 });
    expect(hash).toBe(contentHash({ Zeta: 3, chartType: 2, height: 1 }));
    expect(hash).toBe("23-702abbf4");
  });

  it("changes with the content", () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
