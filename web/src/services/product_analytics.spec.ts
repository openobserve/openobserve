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

import { describe, it, expect, vi } from "vitest";
import { openobserveRum } from "@openobserve/browser-rum";
import analytics from "@/services/product_analytics";

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { addAction: vi.fn() },
}));

describe("product_analytics", () => {
  it("forwards track to the RUM SDK as a custom action", () => {
    analytics.track("dashboard_created", { source: "import" });
    expect(openobserveRum.addAction).toHaveBeenCalledWith("dashboard_created", {
      source: "import",
    });
  });

  it("forwards an event without properties", () => {
    analytics.track("alert_created");
    expect(openobserveRum.addAction).toHaveBeenCalledWith("alert_created", undefined);
  });
});
