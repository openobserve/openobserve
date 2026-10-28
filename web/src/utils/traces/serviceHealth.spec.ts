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
import { serviceHealthFromErrorRate, serviceNodeErrorRate } from "./serviceHealth";

describe("serviceHealthFromErrorRate", () => {
  it.each([
    [0, "healthy"],
    [0.99, "healthy"],
    [1, "degraded"],
    [1.01, "degraded"],
    [5, "degraded"],
    [5.5, "warning"],
    [10, "warning"],
    [11.43, "critical"],
  ])("maps an error rate of %s to %s", (rate, status) => {
    expect(serviceHealthFromErrorRate(rate)).toBe(status);
  });
});

describe("serviceNodeErrorRate", () => {
  it("uses the node's error_rate when it has one", () => {
    expect(serviceNodeErrorRate({ error_rate: 11.43, errors: 0, requests: 100 })).toBe(11.43);
  });

  it("keeps a reported error_rate of 0", () => {
    expect(serviceNodeErrorRate({ error_rate: 0, errors: 5, requests: 10 })).toBe(0);
  });

  it("computes errors over requests when error_rate is missing", () => {
    expect(serviceNodeErrorRate({ errors: 4, requests: 35 })).toBeCloseTo(11.43, 2);
  });

  it("computes errors over value for a Graph View chart node", () => {
    expect(serviceNodeErrorRate({ errors: 1, value: 2 })).toBe(50);
  });

  it("is 0 when the node has no requests", () => {
    expect(serviceNodeErrorRate({ errors: 3, requests: 0 })).toBe(0);
    expect(serviceNodeErrorRate({})).toBe(0);
  });
});
