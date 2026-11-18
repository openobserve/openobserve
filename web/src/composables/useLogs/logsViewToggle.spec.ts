//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { resolveUrlViewToggle } from "./logsViewToggle";

describe("resolveUrlViewToggle", () => {
  it.each(["logs", "visualize", "build", "drilldown"])("accepts %s", (value) => {
    expect(resolveUrlViewToggle(value, false)).toBe(value);
  });

  it("accepts patterns only when the feature is allowed", () => {
    expect(resolveUrlViewToggle("patterns", true)).toBe("patterns");
    expect(resolveUrlViewToggle("patterns", false)).toBe("logs");
  });

  it.each(["bogus", "", undefined, null, ["logs", "build"], 3])(
    "falls back to logs for %s",
    (value) => {
      expect(resolveUrlViewToggle(value, true)).toBe("logs");
    },
  );
});
