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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import i18n from "@/locales";

import DbmAppSourceLegend from "./DbmAppSourceLegend.vue";
import DbmAppSourceMarker from "./DbmAppSourceMarker.vue";
import DbmLoadCell from "./DbmLoadCell.vue";

const global = { plugins: [i18n] };

describe("DbmAppSourceMarker", () => {
  it("is a quiet glyph with an accessible name and a plain-language tooltip", () => {
    const wrapper = mount(DbmAppSourceMarker, { global });
    const marker = wrapper.get('[data-test="dbm-app-source-marker"]');
    expect(marker.attributes("role")).toBe("img");
    expect(marker.attributes("aria-label")).toBe("Measured from your application's traces");
    expect(wrapper.text()).toBe("");
    const tooltip = wrapper.findComponent({ name: "OTooltip" });
    expect(tooltip.props("content")).toContain(
      "adding your apps' view to what your database reports",
    );
    expect(tooltip.props("content")).not.toMatch(/instrumented|didn't|client-observed/i);
  });

  it("has no tooltip opt-out prop", () => {
    expect(Object.keys(DbmAppSourceMarker.props ?? {})).not.toContain("withTooltip");
  });
});

describe("DbmAppSourceLegend", () => {
  it("explains the glyph in positive, plain words", () => {
    const wrapper = mount(DbmAppSourceLegend, { global });
    const text = wrapper.get('[data-test="dbm-app-source-legend"]').text();
    expect(text).toBe("From your app's traces");
    expect(text).not.toMatch(/client-observed|instrumented|didn't|isn't/i);
  });

  it("stays on one line and keeps the full sentence in its tooltip", () => {
    const wrapper = mount(DbmAppSourceLegend, { global });
    const text = wrapper.get('[data-test="dbm-app-source-legend-text"]');
    expect(text.classes()).toContain("truncate");
    const tooltip = wrapper.findComponent({ name: "OTooltip" });
    expect(tooltip.props("content")).toBe(
      "Measured from your application's traces, adding your apps' view to what your database reports.",
    );
  });

  it("takes a view's own wording", () => {
    const wrapper = mount(DbmAppSourceLegend, {
      props: { label: i18n.global.t("dbm.detail.serverMetrics.clientSubtitle") },
      global,
    });
    expect(wrapper.text()).toContain("completed in this window");
    expect(wrapper.findComponent({ name: "OTooltip" }).props("content")).toContain(
      "completed in this window",
    );
  });
});

describe("DbmLoadCell with an app-sourced duration", () => {
  it("shows the marker instead of the client-observed label", () => {
    const wrapper = mount(DbmLoadCell, {
      props: { totalTimeNs: 2e9, share: 0.3, source: "client", qualifierKey: "clientObserved" },
      global,
    });
    expect(wrapper.find('[data-test="dbm-app-source-marker"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dbm-overlap-qualifier"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/client-observed/i);
  });

  it("keeps the text qualifier for the database's own figure", () => {
    const wrapper = mount(DbmLoadCell, {
      props: { totalTimeNs: 2e9, share: 0, source: "server", qualifierKey: "serverWait" },
      global,
    });
    expect(wrapper.get('[data-test="dbm-overlap-qualifier"]').text()).toBe("wait time");
    expect(wrapper.find('[data-test="dbm-app-source-marker"]').exists()).toBe(false);
  });
});
