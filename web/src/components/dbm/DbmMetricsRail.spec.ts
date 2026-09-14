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

import { raw } from "@/types/i18n";

import DbmMetricsRail from "./DbmMetricsRail.vue";

const ITEMS = [
  { key: "load", label: raw("Database load") },
  { key: "host", label: raw("Host") },
  { key: "activity", label: raw("Activity") },
];

const mountRail = (active = "load") =>
  mount(DbmMetricsRail, {
    props: { items: ITEMS, activeKey: active, ariaLabel: raw("Metrics sections") },
  });

describe("DbmMetricsRail", () => {
  it("renders one entry per section, in order", () => {
    const wrapper = mountRail();
    const labels = wrapper
      .findAll("[data-test^='dbm-metrics-rail-item-']")
      .map((el) => el.text().trim());
    expect(labels).toEqual(["Database load", "Host", "Activity"]);
  });

  it("emits select with the section key on click — it never navigates", () => {
    const wrapper = mountRail();
    wrapper.find("[data-test='dbm-metrics-rail-item-host']").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["host"]]);
  });

  it("marks the active section", () => {
    const wrapper = mountRail("activity");
    const active = wrapper.find("[data-test='dbm-metrics-rail-item-activity']");
    expect(active.attributes("data-state") ?? active.attributes("aria-selected")).toBeTruthy();
  });
});
