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
import { flushPromises, mount } from "@vue/test-utils";
import SegmentPanel from "./SegmentPanel.vue";

const row = (label: string) => ({
  label,
  views: 50,
  inp: 100e6,
  lcp: null,
  share: 10,
  filter: "f",
});

const mountPanel = (
  segments: Record<string, ReturnType<typeof row>[]> = {
    browser: [row("A")],
    device: [row("B")],
    country: [row("C")],
  },
  difference: Record<string, unknown> | null = null,
) =>
  mount(SegmentPanel, {
    props: {
      segments,
      difference,
      sessionsLink: () => ({ name: "Sessions" }),
    },
    attachTo: document.body,
    global: {
      stubs: {
        RouterLink: true,
        OSegmentedBar: true,
        OTabs: { template: "<div><slot /></div>" },
        OTab: { props: ["name", "label"], template: '<button role="tab">{{ label }}</button>' },
        OTabPanels: { template: "<div><slot /></div>" },
        OTabPanel: { template: "<div><slot /></div>" },
      },
    },
  });

const press = async (w: ReturnType<typeof mountPanel>, key: string) => {
  await w.find('[role="tab"]').trigger("keydown", { key });
};

const activeTab = (w: ReturnType<typeof mountPanel>) =>
  (w.vm as unknown as { active: string }).active;

describe("SegmentPanel biggest difference", () => {
  it("names the dimension before the value", () => {
    const w = mount(SegmentPanel, {
      props: {
        segments: { connection: [row("3g")] },
        difference: {
          dim: "connection",
          label: "3g",
          filter: "f",
          views: 40,
          inp: 3.6e8,
          ratio: 1.5,
        },
        sessionsLink: () => ({ name: "Sessions" }),
      },
      global: {
        stubs: {
          RouterLink: true,
          OSegmentedBar: true,
          OTabs: true,
          OTab: true,
          OTabPanels: true,
          OTabPanel: true,
        },
      },
    });
    expect(w.find('[data-test="rum-overview-difference-title"]').text()).toBe("Connection: 3g");
  });
});

describe("SegmentPanel tabs", () => {
  it("opens the tab the callout names, and a later click by the user still wins", async () => {
    const segs = { browser: [row("A")], device: [row("iPhone")], country: [row("C")] };
    const diff = { dim: "device", label: "iPhone", filter: "f", views: 50, inp: 4e8, ratio: 2 };
    const w = mountPanel(segs, diff);
    await flushPromises();
    expect(activeTab(w)).toBe("device");
    (w.vm as unknown as { active: string }).active = "country";
    await w.setProps({ segments: { ...segs } });
    expect(activeTab(w)).toBe("country");
    await w.setProps({ difference: { ...diff, dim: "browser", label: "A" } });
    expect(activeTab(w)).toBe("browser");
    w.unmount();
  });

  it("orders OS after device and connection last, only for dimensions with data", () => {
    const w = mountPanel({
      connection: [row("4g")],
      country: [row("C")],
      os: [row("Mac OS X")],
      browser: [row("A")],
    });
    expect(w.findAll('[role="tab"]').map((t) => t.text())).toEqual([
      "Browser",
      "OS",
      "Country",
      "Connection",
    ]);
    w.unmount();
  });
});

describe("SegmentPanel keyboard model", () => {
  it("selects the last tab on End and the first on Home", async () => {
    const w = mountPanel();
    await press(w, "End");
    expect(activeTab(w)).toBe("country");
    await press(w, "Home");
    expect(activeTab(w)).toBe("browser");
    w.unmount();
  });

  it("wraps with the arrow keys", async () => {
    const w = mountPanel();
    await press(w, "ArrowLeft");
    expect(activeTab(w)).toBe("country");
    await press(w, "ArrowRight");
    expect(activeTab(w)).toBe("browser");
    w.unmount();
  });
});
