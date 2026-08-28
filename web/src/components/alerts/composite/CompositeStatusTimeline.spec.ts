// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CompositeStatusTimeline from "./CompositeStatusTimeline.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";

vi.mock("@/services/alerts", () => ({
  default: { getCompositeTimeline: vi.fn() },
}));

const response = {
  from: 1_000_000_000_000_000,
  to: 1_000_001_000_000_000,
  children: [
    {
      alert_id: "child-1",
      slot: 0,
      name: "High error rate",
      accessible: true,
      current_level: "critical",
      level_since: 1_000_000_500_000_000,
      transitions: [{ from_level: "ok", to_level: "critical", at: 1_000_000_500_000_000 }],
    },
    {
      alert_id: "child-2",
      slot: 1,
      name: "High latency",
      accessible: true,
      current_level: "ok",
      level_since: null,
      transitions: [],
    },
  ],
  result: {
    alert_id: "composite-1",
    slot: null,
    name: "Checkout degraded",
    accessible: true,
    current_level: "critical",
    level_since: 1_000_000_500_000_000,
    transitions: [{ from_level: "ok", to_level: "critical", at: 1_000_000_500_000_000 }],
  },
};

const mountTimeline = () =>
  mount(CompositeStatusTimeline, {
    props: { alertId: "composite-1" },
    global: { plugins: [i18n, store] },
  });

describe("CompositeStatusTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(alertsService.getCompositeTimeline).mockResolvedValue({ data: response });
  });

  it("fetches the timeline for the alert and renders a lane per child plus the result", async () => {
    const wrapper = mountTimeline();
    await flushPromises();

    expect(alertsService.getCompositeTimeline).toHaveBeenCalled();
    const args = vi.mocked(alertsService.getCompositeTimeline).mock.calls[0];
    expect(args[0]).toBe("default");
    expect(args[1]).toBe("composite-1");
    expect(args[2]).toBeLessThan(args[3]);

    expect(wrapper.text()).toContain("High error rate");
    expect(wrapper.text()).toContain("High latency");
    expect(wrapper.text()).toContain("Result");
  });

  it("re-fetches when the window changes", async () => {
    const wrapper = mountTimeline();
    await flushPromises();
    vi.mocked(alertsService.getCompositeTimeline).mockClear();

    await wrapper.find('[data-test="alerts-composite-timeline-window-1h"]').trigger("click");
    await flushPromises();

    expect(alertsService.getCompositeTimeline).toHaveBeenCalled();
  });
});
