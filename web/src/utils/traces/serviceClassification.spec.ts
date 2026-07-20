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

import { describe, it, expect } from "vitest";
import { classifyEntity } from "./serviceClassification";
import cases from "./__fixtures__/classification_cases.json";

describe("classifyEntity — shared vector (kept in sync with Rust classify_entity)", () => {
  it("matches every case in the shared classification vector", () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases as any[]) {
      const got = classifyEntity(c.is_real_service, c.infer_type);
      expect(
        got,
        `case '${c.note}' (is_real=${c.is_real_service}, infer=${JSON.stringify(
          c.infer_type,
        )}) expected ${c.expected} got ${got}`,
      ).toBe(c.expected);
    }
  });
});

describe("classifyEntity — explicit branches", () => {
  it("real service wins over any inferred type (collision)", () => {
    expect(classifyEntity(true, "external")).toBe("service");
    expect(classifyEntity(true, "rpc")).toBe("service");
    expect(classifyEntity(true, "weird")).toBe("service");
  });

  it("keeps rpc as a dependency (never dropped)", () => {
    expect(classifyEntity(false, "rpc")).toBe("rpc");
  });

  it("maps database → datastore", () => {
    expect(classifyEntity(false, "database")).toBe("datastore");
  });

  it("unknown non-empty type defaults to external, not service", () => {
    expect(classifyEntity(false, "cache")).toBe("external");
    expect(classifyEntity(false, "http")).toBe("external");
  });

  it("null/undefined/empty inferred type is a service", () => {
    expect(classifyEntity(false, null)).toBe("service");
    expect(classifyEntity(false, undefined)).toBe("service");
    expect(classifyEntity(false, "")).toBe("service");
    expect(classifyEntity(false, "   ")).toBe("service");
  });
});
