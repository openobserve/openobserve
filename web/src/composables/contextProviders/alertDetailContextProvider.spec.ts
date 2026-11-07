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

import { contextChipFor } from "@/composables/assistant/context/contextChips";
import type { TranslateFn } from "@/types/i18n";
import { createAlertDetailContextProvider } from "./alertDetailContextProvider";

const store = { state: { selectedOrganization: { identifier: "default" } } };

const alert = {
  name: "checkout_errors",
  stream_name: "app_logs",
  stream_type: "logs",
  is_real_time: false,
  query_condition: { type: "sql", sql: "SELECT count(*) FROM app_logs WHERE level='error'" },
  trigger_condition: { operator: ">=", threshold: 3, period: 10 },
};

describe("createAlertDetailContextProvider", () => {
  it("names the alert, its stream, condition and state", () => {
    const context = createAlertDetailContextProvider(
      () => ({ alertId: "a1", alert, state: "firing" }),
      store,
    ).getContext() as Record<string, unknown>;

    expect(context).toMatchObject({
      currentPage: "Alerts",
      alertId: "a1",
      alertName: "checkout_errors",
      selectedStreams: ["app_logs"],
      streamType: "logs",
      alertState: "firing",
      isRealTime: false,
      organization_identifier: "default",
      alertCondition: "SELECT count(*) FROM app_logs WHERE level='error' · >= 3 · 10 min window",
    });
  });

  it("labels the page's alert by its name, not its id", () => {
    const context = createAlertDetailContextProvider(
      () => ({ alertId: "a1", alert, state: "ok" }),
      store,
    ).getContext();

    const t = ((key: string, params?: unknown) =>
      `${key}:${JSON.stringify(params)}`) as unknown as TranslateFn;
    const chip = contextChipFor("alertId", context.alertId, context, t);
    expect(String(chip?.label)).toContain("checkout_errors");
  });

  it("carries only the id while the alert loads", () => {
    const context = createAlertDetailContextProvider(
      () => ({ alertId: "a1", alert: null, state: "" }),
      store,
    ).getContext();

    expect(context.alertId).toBe("a1");
    expect(context.alertName).toBeUndefined();
    expect(context.selectedStreams).toBeUndefined();
    expect(context.alertState).toBeUndefined();
  });

  it("reads a PromQL condition and a list-shaped alert", () => {
    const context = createAlertDetailContextProvider(
      () => ({
        alertId: "a2",
        alert: {
          name: "cpu_high",
          stream_name: "cpu",
          stream_type: "metrics",
          condition: { type: "promql", promql: "avg(cpu) > 0.9" },
        },
        state: "disabled",
      }),
      store,
    ).getContext();

    expect(context.alertCondition).toBe("avg(cpu) > 0.9");
    expect(context.streamType).toBe("metrics");
    expect(context.alertState).toBe("disabled");
  });
});
