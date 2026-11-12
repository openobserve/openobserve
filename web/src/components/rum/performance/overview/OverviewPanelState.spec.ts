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
import { mount } from "@vue/test-utils";
import OverviewPanelState from "./OverviewPanelState.vue";

const mountState = (status: string, busy = false) =>
  mount(OverviewPanelState, {
    props: {
      status: status as never,
      busy,
      panelLabel: "Core Web Vitals",
      dataTest: "panel",
      lowCount: 38,
    },
    slots: { default: '<p data-test="content">ok</p>' },
    global: {
      mocks: { t: (k: string) => k },
      stubs: {
        OButton: { template: "<button><slot /></button>" },
        OEmptyState: {
          props: ["preset"],
          template:
            '<div :data-preset="preset"><slot name="title" /><slot name="description" /><slot name="actions" /></div>',
        },
        OSpinner: true,
      },
    },
  });

describe("OverviewPanelState", () => {
  it("renders the slot when ok", () => {
    const w = mountState("ok");
    expect(w.find('[data-test="content"]').exists()).toBe(true);
    expect(w.find('[data-test="panel-error"]').exists()).toBe(false);
  });

  it("renders an alert with Retry on error and emits retry", async () => {
    const w = mountState("error");
    expect(w.find('[data-test="panel-error"]').attributes("role")).toBe("alert");
    expect(w.find('[data-test="panel-error"] [data-preset]').attributes("data-preset")).toBe(
      "load-error",
    );
    await w.find('[data-test="panel-retry"]').trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
    expect(w.find('[data-test="content"]').exists()).toBe(false);
  });

  it("marks the panel busy while loading", () => {
    const w = mountState("loading");
    expect(w.find('[data-test="panel"]').attributes("aria-busy")).toBe("true");
    expect(w.find('[data-test="panel-loading"]').exists()).toBe(true);
  });

  it("shows the empty state without the slot", () => {
    const w = mountState("empty");
    expect(w.find('[data-test="panel-empty"]').text()).toContain(
      "rum.overviewPage.stateEmptyTitle",
    );
    expect(w.find('[data-test="content"]').exists()).toBe(false);
  });

  it("shows the low-data notice and still renders the slot", () => {
    const w = mountState("low");
    expect(w.find('[data-test="panel-low-data"]').exists()).toBe(true);
    expect(w.find('[data-test="content"]').exists()).toBe(true);
  });

  it("keeps the previous content on screen with a busy marker while it reloads", () => {
    const w = mountState("ok", true);
    expect(w.find('[data-test="content"]').exists()).toBe(true);
    expect(w.find('[data-test="panel-loading"]').exists()).toBe(false);
    expect(w.find('[data-test="panel-refreshing"]').exists()).toBe(true);
    expect(w.find('[data-test="panel"]').attributes("aria-busy")).toBe("true");
    expect(mountState("ok").find('[data-test="panel-refreshing"]').exists()).toBe(false);
  });

  it("shows a no-permission message without Retry when forbidden", () => {
    const w = mountState("forbidden");
    expect(w.find('[data-test="panel-forbidden"]').attributes("data-preset")).toBe("no-access");
    expect(w.find('[data-test="panel-retry"]').exists()).toBe(false);
  });

  it("names the panel as a region", () => {
    const root = mountState("ok").find('[data-test="panel"]');
    expect(root.attributes("role")).toBe("region");
    expect(root.attributes("aria-label")).toBe("Core Web Vitals");
  });

  it("renders nothing when hidden", () => {
    expect(mountState("hidden").find('[data-test="panel"]').exists()).toBe(false);
  });
});
