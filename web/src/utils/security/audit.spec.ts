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
import { auditAction } from "./audit";

describe("auditAction", () => {
  it("names deletes, creates and changes", () => {
    expect(auditAction("DELETE", "o/streams/s")).toBe("deleted");
    expect(auditAction("POST", "v2/o/alerts")).toBe("created");
    expect(auditAction("PUT", "v2/o/alerts/2abc")).toBe("changed");
    expect(auditAction("PATCH", "v2/o/alerts/incidents/1/update")).toBe("changed");
  });

  it("tells turning a detection off from turning it on", () => {
    expect(auditAction("PATCH", "v2/o/alerts/2abc/enable", "value=false")).toBe("disabled");
    expect(auditAction("PATCH", "v2/o/alerts/2abc/enable", "folder=f&value=false")).toBe(
      "disabled",
    );
    expect(auditAction("PATCH", "v2/o/alerts/2abc/enable", "value=true")).toBe("enabled");
  });
});
