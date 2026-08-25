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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import { raw } from "@/types/i18n";

import DbmHistoryPanel from "./DbmHistoryPanel.vue";

// The dashboard engine drags the whole panel pipeline in; the ladder this file
// pins is which of the three states renders, not what the engine draws. Mocked
// at the module the component lazily imports AND stubbed by name below, so the
// async loader resolves without pulling the real renderer's dependency tree in.
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: { name: "PanelSchemaRenderer", template: "<div data-stub='panel' />" },
}));

const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(DbmHistoryPanel, {
    props: {
      title: raw("Latency"),
      emptyLabel: raw("No series in this window"),
      loading: false,
      hasSeries: true,
      panelSchema: { id: "dbm-query-latency" },
      selectedTimeObj: { start_time: new Date(0), end_time: new Date(1) },
      injectedPromqlData: {
        data: [[]],
        metadata: { queries: [{ startTime: 0, endTime: 1, timeRangeGap: { seconds: 0 } }] },
        resultMetaData: [[]],
      },
      panelDataTest: "dbm-detail-latency-panel",
      ...props,
    },
    global: {
      stubs: {
        OSkeleton: { name: "OSkeleton", template: "<div data-stub='skeleton' />" },
        PanelSchemaRenderer: { name: "PanelSchemaRenderer", template: "<div data-stub='panel' />" },
      },
    },
  });

describe("DbmHistoryPanel", () => {
  it("renders the card and its heading", () => {
    const wrapper = mountPanel();

    expect(wrapper.element.tagName).toBe("SECTION");
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining([
        "card-container",
        "border-border-default",
        "rounded-surface",
        "flex",
        "flex-col",
        "border",
        "p-3",
      ]),
    );
    expect(wrapper.get("h3").text()).toBe("Latency");
  });

  /**
   * Three states, one at a time — the ladder the two cards share. A skeleton
   * while the read is in flight, a stated absence when it came back empty, and
   * the panel otherwise.
   */
  it("shows the skeleton while the read is in flight", () => {
    const wrapper = mountPanel({ loading: true });

    expect(wrapper.find("[data-stub='skeleton']").exists()).toBe(true);
    expect(wrapper.find("[data-stub='panel']").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No series in this window");
  });

  /**
   * An empty window says so, rather than drawing an axis with no line on it.
   * A bare axis reads as "flat", which is a claim about the data; "no series"
   * says the honest thing — nothing was tracked in this window.
   */
  it("states the absence when the read returned no points", () => {
    const wrapper = mountPanel({ hasSeries: false });

    expect(wrapper.text()).toContain("No series in this window");
    expect(wrapper.find("[data-stub='panel']").exists()).toBe(false);
    expect(wrapper.find("[data-stub='skeleton']").exists()).toBe(false);
  });

  /** Loading wins over emptiness: an unanswered read has not claimed anything yet. */
  it("prefers the skeleton over the empty state while loading", () => {
    const wrapper = mountPanel({ loading: true, hasSeries: false });
    expect(wrapper.find("[data-stub='skeleton']").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("No series in this window");
  });

  it("renders the panel once there is a series to draw", async () => {
    const wrapper = mountPanel();
    // The dashboard engine is loaded lazily, so the panel arrives a tick late.
    await flushPromises();

    expect(wrapper.find("[data-stub='panel']").exists()).toBe(true);
    expect(wrapper.find("[data-stub='skeleton']").exists()).toBe(false);
  });

  /**
   * All three states stand at the SAME height. The two cards sit side by side,
   * so a shorter skeleton or empty line would make the row jump as each half
   * resolves — and the reader's eye is on the chart, not the layout.
   */
  it("holds one height across all three states", async () => {
    expect(mountPanel({ loading: true }).get("[data-stub='skeleton']").classes()).toContain("h-55");
    expect(mountPanel({ hasSeries: false }).get(".flex.items-center").classes()).toContain("h-55");

    const drawn = mountPanel();
    await flushPromises();
    expect(drawn.get("[data-stub='panel']").element.parentElement?.className).toContain("h-55");
  });

  /** Each card names its own panel, so the caller's `data-test` must reach it. */
  it("names the rendered panel for the caller", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.get("[data-stub='panel']").attributes("data-test")).toBe(
      "dbm-detail-latency-panel",
    );
  });

  /** The card's own `data-test` lands on the section, not on the panel inside it. */
  it("passes the card's data-test through to the section", () => {
    const wrapper = mountPanel({ "data-test": "dbm-detail-volume-chart" });
    expect(wrapper.attributes("data-test")).toBe("dbm-detail-volume-chart");
  });
});
