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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openobserveRum } from "@openobserve/browser-rum";
import { DATA_AGE_SAMPLE_MS, useIncidentViewSummary } from "./useIncidentViewSummary";

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { addAction: vi.fn(), getInitConfiguration: vi.fn() },
}));

const OPENED_AT = Date.UTC(2026, 9, 14, 12, 0, 0);
const incident = (id = "inc-1") => ({
  id,
  severity: "P2",
  // Opened an hour before the view, in microseconds like the API.
  created_at: (OPENED_AT - 3_600_000) * 1000,
});

const summaries = () =>
  vi
    .mocked(openobserveRum.addAction)
    .mock.calls.filter(([name]) => name === "incident_view_summary")
    .map(([, props]) => props as Record<string, unknown>);

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("useIncidentViewSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(OPENED_AT);
    vi.mocked(openobserveRum.addAction).mockClear();
    vi.mocked(openobserveRum.getInitConfiguration).mockReturnValue({ applicationId: "app" } as any);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires one summary per view carrying only the first action", () => {
    const view = useIncidentViewSummary();
    view.start(incident());
    vi.advanceTimersByTime(2_000);
    view.recordAction("ack");
    vi.advanceTimersByTime(3_000);
    view.recordAction("resolve");
    view.end();
    view.end();

    expect(summaries()).toHaveLength(1);
    expect(summaries()[0]).toMatchObject({
      incident_id: "inc-1",
      severity: "P2",
      incident_age_s: 3600,
      view_ms: 5_000,
      first_action: "ack",
      first_action_ms: 2_000,
    });
    expect(typeof summaries()[0].view_id).toBe("string");
  });

  it("reports no action when the viewer only looked", () => {
    const view = useIncidentViewSummary();
    view.start(incident());
    view.end();

    expect(summaries()[0]).toMatchObject({ first_action: "none", first_action_ms: null });
  });

  it("samples the age of the shown data every few seconds while visible", () => {
    const view = useIncidentViewSummary();
    view.start(incident());
    vi.advanceTimersByTime(DATA_AGE_SAMPLE_MS * 3);
    view.start(incident());
    vi.advanceTimersByTime(DATA_AGE_SAMPLE_MS);
    view.end();

    expect(summaries()).toHaveLength(1);
    expect(summaries()[0].data_age_max_s).toBe(15);
  });

  it("ends the view when the tab goes hidden", () => {
    const view = useIncidentViewSummary();
    view.start(incident());
    setVisibility("hidden");
    view.end();

    expect(summaries()).toHaveLength(1);
  });

  it("starts a new view when the tab comes back with the drawer still open", () => {
    const view = useIncidentViewSummary();
    view.start(incident());
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    setVisibility("visible");
    vi.advanceTimersByTime(1_000);
    view.recordAction("resolve");
    view.end();

    const [before, after] = summaries();
    expect(summaries()).toHaveLength(2);
    expect(before.first_action).toBe("none");
    expect(after).toMatchObject({ first_action: "resolve", first_action_ms: 1_000 });
    expect(after.view_id).not.toBe(before.view_id);
    expect(after.data_age_max_s).toBe(61);
  });

  it("does not resume after the drawer closed", () => {
    const view = useIncidentViewSummary();
    view.start(incident());
    view.end();
    setVisibility("hidden");
    setVisibility("visible");
    view.end();

    expect(summaries()).toHaveLength(1);
  });

  it("opening another incident closes the previous view under a new view id", () => {
    const view = useIncidentViewSummary();
    view.start(incident("inc-1"));
    view.start(incident("inc-2"));
    view.end();

    const [first, second] = summaries();
    expect(first.incident_id).toBe("inc-1");
    expect(second.incident_id).toBe("inc-2");
    expect(first.view_id).not.toBe(second.view_id);
  });

  it("sends nothing when RUM is not initialised", () => {
    vi.mocked(openobserveRum.getInitConfiguration).mockReturnValue(undefined);
    const view = useIncidentViewSummary();
    view.start(incident());
    view.recordAction("comment");
    view.end();

    expect(openobserveRum.addAction).not.toHaveBeenCalled();
  });
});
