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
import { auditKind } from "./auditKind";

describe("auditKind", () => {
  it("files each action under what it acted on", () => {
    expect(auditKind("fleet.audit.setDesired")).toBe("rollout");
    expect(auditKind("fleet.audit.autoRollback")).toBe("rollout");
    expect(auditKind("fleet.audit.publishedVersion")).toBe("configuration");
    expect(auditKind("fleet.audit.movedCollectors")).toBe("collector");
    expect(auditKind("fleet.audit.updatedFleetSettings")).toBe("fleet");
    expect(auditKind("fleet.audit.updatedSettings")).toBe("settings");
    expect(auditKind("fleet.audit.revokedToken")).toBe("token");
  });

  it("keeps an action it does not know under other, with or without the key prefix", () => {
    expect(auditKind("fleet.audit.someFutureAction")).toBe("other");
    expect(auditKind("createdToken")).toBe("token");
  });
});
