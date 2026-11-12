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
import { TRACE_ERRORED_SQL, traceStatus } from "./llmTraceOutcome";

describe("traceStatus", () => {
  it("is error when any span errored, else ok", () => {
    expect(traceStatus(1)).toBe("error");
    expect(traceStatus("3")).toBe("error");
    expect(traceStatus(0)).toBe("ok");
    expect(traceStatus(undefined)).toBe("ok");
  });

  it("reads only the span status", () => {
    expect(TRACE_ERRORED_SQL).toBe("max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END)");
  });
});
