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
import i18n from "@/locales";
import { generateAlertSummary } from "./alertSummaryGenerator";

const t = (key: string, named?: Record<string, unknown>): string =>
  (i18n.global.t as any)(key, named);

const formData = (over: Record<string, any> = {}) => ({
  name: "my_alert",
  stream_name: "default",
  stream_type: "logs",
  is_real_time: "false",
  destinations: [],
  trigger_condition: { period: 10, frequency: 10, frequency_type: "minutes", silence: 10 },
  query_condition: { type: "custom" },
  ...over,
});

describe("generateAlertSummary — notification line", () => {
  // An alert with no destination is a valid configuration, so the line states
  // the fact; it is not a warning about something the user must go fix.
  it("states that nothing is notified, without warning framing", () => {
    const html = generateAlertSummary(formData(), []);

    expect(html).toContain(t("alerts.summary.noDestination"));
    expect(html).toContain(t("alerts.summary.notifiesNobody"));
    expect(html).not.toContain("⚠️");
    expect(html).not.toContain(t("alerts.summary.notSetupYet"));
  });

  it("names the destinations when there are some", () => {
    const html = generateAlertSummary(formData({ destinations: ["slack", "email"] }), []);

    expect(html).toContain("slack, email");
    expect(html).not.toContain(t("alerts.summary.notifiesNobody"));
  });
});
