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

import { readableCard } from "./approvalText";

describe("readableCard", () => {
  it("keeps a real name that equals the object's own id", () => {
    const card = {
      tool: "DeleteStream",
      targets: [{ type: "stream", id: "app_logs", name: "app_logs" }],
      args: { stream_name: "app_logs", stream_id: "app_logs" },
    };
    expect(readableCard(card)).toBe(card);
  });

  it("renames a target named after the tool or another object's id", () => {
    const create = readableCard({
      tool: "CreateDashboard",
      targets: [{ type: "dashboard", name: "CreateDashboard" }],
      args: { request_body: { title: "QA" } },
    });
    const panel = readableCard({
      tool: "AddPanel",
      targets: [{ type: "panel", id: "d1", name: "d1" }],
      args: { dashboard_id: "d1", request_body: { panel: { title: "Errors" } } },
    });
    expect(create.targets[0]).toEqual({ type: "dashboard", name: "QA" });
    expect(panel.targets[0]).toEqual({ type: "panel", name: "Errors" });
  });
});
