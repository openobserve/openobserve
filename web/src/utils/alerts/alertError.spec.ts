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
import { plainAlertError, summarizeAlertError } from "./alertError";

const t = ((key: string, p?: Record<string, string>) =>
  key === "alerts.historyTable.errorFrom" ? `${p?.status} from ${p?.destination}` : key) as any;

const RAW =
  "error sending notification for alert:  Error sending notification for destination ux_demo_webhook err: sent error status: 405 Method Not Allowed, err: <!doctype html><html><body><h1>Example Domain</h1></body></html>;";

describe("alertError", () => {
  it("summarizes a webhook failure as status from destination", () => {
    expect(summarizeAlertError(RAW, t)).toBe("405 Method Not Allowed from ux_demo_webhook");
  });

  it("never returns HTML", () => {
    expect(plainAlertError(RAW)).not.toContain("<");
  });

  it("shows a dash for no error", () => {
    expect(summarizeAlertError(null, t)).toBe("—");
  });

  it("truncates a long plain message", () => {
    expect(String(summarizeAlertError("x".repeat(300), t)).length).toBeLessThanOrEqual(121);
  });
});
