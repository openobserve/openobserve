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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createStore } from "vuex";
import FlameGraphView from "@/components/common/FlameGraphView.vue";
import { paletteIndexFor } from "@/components/common/flameGraphPackage";
import i18n from "@/locales";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
const breakpoint = vi.hoisted(() => ({ lgUp: true }));
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({
    lgUp: {
      get value() {
        return breakpoint.lgUp;
      },
    },
  }),
}));

const ChartRendererStub = {
  name: "ChartRenderer",
  props: ["data"],
  emits: ["click"],
  template: '<div class="chart-renderer-stub"></div>',
};

/** Right-clicks the plot. jsdom gives the plot no size, so (10, 10) lands on the first row's first frame. */
const rightClick = async (
  wrapper: { get: (selector: string) => { element: Element } },
  clientX = 10,
  clientY = 10,
) => {
  wrapper
    .get('[data-test="flame-graph-plot"]')
    .element.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }),
    );
  await nextTick();
};

enableAutoUnmount(afterEach);

describe("FlameGraphView frame menu", () => {
  it("positions the menu from the pointer relative to the root", async () => {
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    await nextTick();

    const root = wrapper.element as HTMLElement;
    viGetBoundingClientRect(root, { left: 40, top: 80 });
    // The plot starts 10 px left of and above the pointer, so the pointer sits on the root frame.
    const plot = wrapper.get('[data-test="flame-graph-plot"]').element as HTMLElement;
    plot.getBoundingClientRect = () =>
      ({ left: 120, top: 190, width: 1000, height: 100 }) as DOMRect;

    await rightClick(wrapper, 140, 200);

    const menu = wrapper.get('[data-test="flame-graph-frame-menu"]');
    expect(menu.attributes("style")).toContain("left: 100px");
    expect(menu.attributes("style")).toContain("top: 120px");
  });

  it("opens the menu above and to the left of the pointer when it would be cut off", async () => {
    const host = document.createElement("div");
    // jsdom does not expand the overflow shorthand, so set the axis the browser reports.
    host.style.overflowY = "auto";
    document.body.appendChild(host);
    const wrapper = mount(FlameGraphView, {
      attachTo: host,
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    // A 300 × 300 visible box with the graph at its corner, and a 160 × 200 menu.
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.test === "flame-graph-frame-menu") {
          return rect(parseFloat(this.style.left), parseFloat(this.style.top), 160, 320);
        }
        return rect(0, 0, 300, 300);
      });

    // On the root frame near the right edge: the menu is too wide and too tall to open down and right.
    await rightClick(wrapper, 250, 10);
    await flushPromises();

    const style = wrapper.get('[data-test="flame-graph-frame-menu"]').attributes("style");
    expect(style).toContain("left: 90px");
    expect(style).toContain("top: 0px");
    spy.mockRestore();
    host.remove();
  });

  it("hides the hover tooltip while open and closes on any click outside it, the graph included", async () => {
    // The chart instance that ChartRenderer exposes; the menu turns its tooltip off without new options.
    const chartInstance = { setOption: vi.fn(), dispatchAction: vi.fn() };
    const wrapper = mount(FlameGraphView, {
      attachTo: document.body,
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: { ...ChartRendererStub, setup: () => ({ chart: chartInstance }) },
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    const chart = wrapper.findComponent({ name: "ChartRenderer" });
    const options = chart.props("data");
    const tooltipShown = () => chartInstance.setOption.mock.lastCall?.[0]?.tooltip?.show ?? true;
    const openMenu = () => rightClick(wrapper);

    expect(tooltipShown()).toBe(true);
    expect((options as { options: { tooltip: { show?: boolean } } }).options.tooltip.show).not.toBe(
      false,
    );
    // Drawn on the body, so the scroll box around the graph cannot cut it off.
    expect(
      (chart.props("data") as { options: { tooltip: { appendToBody: boolean } } }).options.tooltip
        .appendToBody,
    ).toBe(true);
    // The tooltip goes at once, with no delay or fade, so it never sits on top of the menu.
    expect(
      (chart.props("data") as { options: { tooltip: { hideDelay: number } } }).options.tooltip
        .hideDelay,
    ).toBe(0);
    expect(
      (chart.props("data") as { options: { tooltip: { transitionDuration: number } } }).options
        .tooltip.transitionDuration,
    ).toBe(0);
    await openMenu();
    expect(chartInstance.dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
    expect(tooltipShown()).toBe(false);
    // The frame blocks are not rebuilt for the menu.
    expect(chart.props("data")).toBe(options);

    // A click inside the menu keeps it open; a click on the graph closes it.
    wrapper
      .get('[data-test="flame-graph-frame-menu"]')
      .element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(wrapper.find('[data-test="flame-graph-frame-menu"]').exists()).toBe(true);
    chart.element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(wrapper.find('[data-test="flame-graph-frame-menu"]').exists()).toBe(false);
    expect(tooltipShown()).toBe(true);

    await openMenu();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(wrapper.find('[data-test="flame-graph-frame-menu"]').exists()).toBe(false);
  });
});

describe("FlameGraphView focus", () => {
  it("zooms into a clicked frame, tells the page, and null after a reset", async () => {
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "main", self: 0, total: 4, children: [{ name: "child", self: 4, total: 4 }] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
          OTruncatedText: { template: "<span><slot /></span>" },
        },
      },
    });
    await flushPromises();
    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root/0", name: "child", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    await nextTick();

    // A click on the root bar zooms back out.
    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
    });
    await nextTick();

    expect(wrapper.emitted("focus")).toEqual([["root/0"], [null]]);
  });
});

describe("FlameGraphView copy feedback", () => {
  it("confirms Copy function name with a toast", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    await rightClick(wrapper);

    await wrapper.get('[data-test="flame-graph-copy-name"]').trigger("click");
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("main");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Copied to clipboard" }),
    );
  });

  it("still copies on plain HTTP, where the Clipboard API is missing", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.assign(document, { execCommand });
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    await rightClick(wrapper);

    await wrapper.get('[data-test="flame-graph-copy-name"]').trigger("click");
    await flushPromises();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: "success", message: "Copied to clipboard" }),
    );
  });
});

describe("FlameGraphView search action", () => {
  it("asks the page to search for the clicked frame's function", async () => {
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    await rightClick(wrapper);

    await wrapper.get('[data-test="flame-graph-search-function"]').trigger("click");
    expect(wrapper.emitted("search")).toEqual([["main"]]);

    await rightClick(wrapper);
    await wrapper.get('[data-test="flame-graph-sandwich"]').trigger("click");
    expect(wrapper.emitted("sandwich")).toEqual([["main"]]);

    await rightClick(wrapper);
    await wrapper.get('[data-test="flame-graph-details"]').trigger("click");
    expect(wrapper.emitted("details")).toEqual([["main"]]);
  });
});

describe("FlameGraphView profile actions", () => {
  it("hides the callers/callees and details actions when the page cannot open them", async () => {
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
        hideProfileActions: true,
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    await rightClick(wrapper);
    expect(wrapper.find('[data-test="flame-graph-search-function"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="flame-graph-sandwich"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="flame-graph-details"]').exists()).toBe(false);
  });
});

describe("FlameGraphView grouped frames", () => {
  const mountGraph = (root: object) =>
    mount(FlameGraphView, {
      props: { root, unitLabel: "ns", summaryLabel: "total", summaryValue: "1" },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
  const blocksOf = (wrapper: ReturnType<typeof mountGraph>) =>
    (
      wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: { series: { data: { block: Record<string, unknown> }[] }[] };
      }
    ).options.series[0].data.map((datum) => datum.block);

  it("labels the flip switch Root at bottom and draws the root last when it is on", async () => {
    const wrapper = mountGraph({
      name: "total",
      total: 10,
      children: [{ name: "main", total: 10, children: [] }],
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("Root at bottom");
    expect(wrapper.find('[data-test="flame-graph-align-left"]').exists()).toBe(true);

    (wrapper.vm as unknown as { rootAtBottom: boolean }).rootAtBottom = true;
    await nextTick();
    const depthOf = (name: string) => blocksOf(wrapper).find((block) => block.name === name)?.depth;
    expect(depthOf("total")).toBe(1);
    expect(depthOf("main")).toBe(0);
  });

  it("starts with the root at the bottom when asked, as the callers graph does", async () => {
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "F", total: 10, children: [{ name: "caller", total: 10 }] },
        unitLabel: "ns",
        summaryLabel: "Callers",
        summaryValue: "10",
        initialRootAtBottom: true,
      },
      global: {
        plugins: [i18n],
        stubs: { ChartRenderer: ChartRendererStub, OSwitch: true, OTooltip: true },
      },
    });
    await flushPromises();
    await nextTick();
    const depthOf = (name: string) => blocksOf(wrapper).find((block) => block.name === name)?.depth;
    expect(depthOf("F")).toBe(1);
    expect(depthOf("caller")).toBe(0);
  });

  it("shows each frame's share of the view and of its caller in the tooltip", async () => {
    const wrapper = mountGraph({
      name: "total",
      total: 200,
      children: [
        {
          name: "main.worker",
          total: 100,
          children: [{ name: "main.hashOrder", total: 25, self: 25 }],
        },
        { name: "runtime.gc", total: 100 },
      ],
    });
    await flushPromises();
    await nextTick();

    const options = (
      wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: { tooltip: { formatter: (params: unknown) => string } };
      }
    ).options;
    const tooltipFor = (name: string) =>
      options.tooltip.formatter({
        data: { block: blocksOf(wrapper).find((b) => b.name === name) },
      });

    const leaf = tooltipFor("main.hashOrder");
    expect(leaf).toContain("Share of caller");
    expect(leaf).toContain("25.00%"); // 25 of the caller's 100
    expect(leaf).toContain("12.50%"); // 25 of the view's 200
    expect(tooltipFor("total")).not.toContain("Share of caller");
  });

  it("draws other as a grouped frame and folds thin frames into one sliver", async () => {
    const tiny = Array.from({ length: 10 }, (_, index) => ({ name: `tiny-${index}`, total: 1 }));
    const wrapper = mountGraph({
      name: "total",
      total: 10000,
      children: [
        { name: "main", total: 9940, children: [] },
        { name: "other", total: 50 },
        ...tiny,
      ],
    });
    await flushPromises();
    await nextTick();

    const blocks = blocksOf(wrapper);
    const other = blocks.find((block) => block.name === "other");
    expect(other?.grouped).toBe(true);
    expect(other?.hint).toContain("grouped");
    const sliver = blocks.find((block) => block.name === "10 small frames");
    expect(sliver).toMatchObject({ grouped: true, total: 10 });
    expect(blocks.some((block) => String(block.name).startsWith("tiny-"))).toBe(false);

    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: other },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    await nextTick();
    expect(wrapper.find('[data-test="flame-graph-frame-menu"]').exists()).toBe(false);
  });
  it("colours a diff tree by the change in each frame's share and shows both sides in the tooltip", async () => {
    const wrapper = mount(FlameGraphView, {
      props: {
        root: {
          name: "total",
          total: 200,
          before_total: 100,
          children: [
            { name: "json", total: 120, before_total: 20 },
            { name: "http", total: 80, before_total: 80 },
          ],
        },
        unitLabel: "ns",
        summaryLabel: "v1.5.0",
        summaryValue: "200",
        diffBaselineTotal: 100,
        diffLabels: { baseline: "v1.4.0", comparison: "v1.5.0" },
      },
      global: {
        plugins: [i18n],
        stubs: { ChartRenderer: ChartRendererStub, OSwitch: true, OTooltip: true },
      },
    });
    await flushPromises();
    await nextTick();

    const blocks = blocksOf(wrapper);
    const json = blocks.find((block) => block.name === "json")!;
    const http = blocks.find((block) => block.name === "http")!;
    // Shares of each side's own total: json 20% to 60%, http 80% to 40%.
    expect(json).toMatchObject({ beforeShare: 0.2, afterShare: 0.6 });
    expect(http).toMatchObject({ beforeShare: 0.8, afterShare: 0.4 });
    const options = (
      wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: { tooltip: { formatter: (params: unknown) => string } };
      }
    ).options;
    const tip = options.tooltip.formatter({ data: { block: json } });
    // Both sides' time and share, so neither has to be worked out from the other.
    expect(tip).toMatch(/v1\.4\.0<\/span>\s*<span[^>]*>20<\/span>\s*<span[^>]*>20\.00%/);
    expect(tip).toMatch(/v1\.5\.0<\/span>\s*<span[^>]*>120<\/span>\s*<span[^>]*>60\.00%/);
    expect(tip).toContain("+40.00 pt");
    expect(tip).not.toContain("Self");
  });

  it("colours the first side's own graph by the same change as the diff graph", async () => {
    // Side by side: the tree is v1.4.0's, and after_total carries v1.5.0's time for each frame.
    const wrapper = mount(FlameGraphView, {
      props: {
        root: {
          name: "total",
          total: 100,
          before_total: 100,
          after_total: 200,
          children: [
            { name: "json", total: 20, before_total: 20, after_total: 120 },
            { name: "http", total: 80, before_total: 80, after_total: 80 },
          ],
        },
        unitLabel: "ns",
        summaryLabel: "v1.4.0",
        summaryValue: "100",
        diffBaselineTotal: 100,
        diffComparisonTotal: 200,
        diffLabels: { baseline: "v1.4.0", comparison: "v1.5.0" },
      },
      global: {
        plugins: [i18n],
        stubs: { ChartRenderer: ChartRendererStub, OSwitch: true, OTooltip: true },
      },
    });
    await flushPromises();
    await nextTick();

    const blocks = blocksOf(wrapper);
    const json = blocks.find((block) => block.name === "json")!;
    // Width is v1.4.0's own time; the shares match the diff graph's: json 20% to 60%.
    expect(json).toMatchObject({ total: 20, beforeShare: 0.2, afterShare: 0.6 });
    expect(blocks.find((block) => block.name === "http")).toMatchObject({
      beforeShare: 0.8,
      afterShare: 0.4,
    });
    const options = (
      wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: { tooltip: { formatter: (params: unknown) => string } };
      }
    ).options;
    const tip = options.tooltip.formatter({ data: { block: json } });
    expect(tip).toMatch(/v1\.5\.0<\/span>\s*<span[^>]*>120<\/span>\s*<span[^>]*>60\.00%/);
    expect(tip).toContain("+40.00 pt");
  });

  it("opens the tooltip above the pointer when the window has no room below it", async () => {
    const dom = document.createElement("div");
    dom.getBoundingClientRect = () => ({ left: 0, top: 500 }) as DOMRect;
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "root", total: 10, children: [{ name: "a", total: 10 }] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "10",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: {
            ...ChartRendererStub,
            setup: () => ({
              chart: { getDom: () => dom, dispatchAction: () => {}, setOption: () => {} },
            }),
          },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();

    const { position } = (
      wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: { tooltip: { position: (...args: unknown[]) => number[] } };
      }
    ).options.tooltip;
    const size = { contentSize: [200, 100] };
    // jsdom's window is 768 high: 40 from its bottom edge there is no room, so the tooltip goes above.
    expect(position([10, 228], null, null, null, size)).toEqual([22, 116]);
    expect(position([10, 10], null, null, null, size)).toEqual([22, 22]);
  });

  describe("zoom", () => {
    const tree = {
      name: "total",
      total: 100,
      children: [
        { name: "a", total: 60, children: [{ name: "a1", total: 60, children: [] }] },
        { name: "b", total: 40, children: [] },
      ],
    };
    const click = async (wrapper: ReturnType<typeof mountGraph>, id: string) => {
      wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
        data: { block: blocksOf(wrapper).find((block) => block.id === id) },
      });
      await nextTick();
    };

    it("zooms into a clicked frame and keeps its callers above it, dimmed", async () => {
      const wrapper = mountGraph(tree);
      await flushPromises();
      await nextTick();

      await click(wrapper, "root/0/0");

      expect(blocksOf(wrapper)).toMatchObject([
        { id: "root", name: "total", depth: 0, width: 100, ancestor: true },
        { id: "root/0", name: "a", depth: 1, width: 100, ancestor: true },
        { id: "root/0/0", name: "a1", depth: 2, width: 100 },
      ]);
      expect(blocksOf(wrapper)[2].ancestor).toBeUndefined();
      expect(wrapper.find('[data-test="flame-graph-frame-menu"]').exists()).toBe(false);
    });

    it("zooms out to a clicked caller, and all the way out from the root bar", async () => {
      const wrapper = mountGraph(tree);
      await flushPromises();
      await nextTick();
      await click(wrapper, "root/0/0");
      expect(blocksOf(wrapper)[0].label).toBe("total: 1 (ns) · Click to zoom out");

      await click(wrapper, "root/0");
      expect(blocksOf(wrapper)[1]).toMatchObject({ id: "root/0", name: "a" });

      await click(wrapper, "root");
      expect(blocksOf(wrapper)[0]).toMatchObject({ id: "root", depth: 0, label: "total: 1 (ns)" });
      expect(blocksOf(wrapper).some((block) => block.ancestor)).toBe(false);
    });

    const mountWithChart = () => {
      const dispatchAction = vi.fn();
      const wrapper = mount(FlameGraphView, {
        props: { root: tree, unitLabel: "ns", summaryLabel: "total", summaryValue: "1" },
        global: {
          plugins: [i18n],
          stubs: {
            ChartRenderer: {
              ...ChartRendererStub,
              setup: () => ({ chart: { dispatchAction, setOption: () => {} } }),
            },
            OButton: { template: "<button><slot /></button>" },
            OSwitch: true,
            OTooltip: true,
          },
        },
      });
      const lastZoom = () =>
        dispatchAction.mock.calls.filter(([action]) => action.type === "dataZoom").at(-1)?.[0];
      const wheel = (init: WheelEventInit) => {
        const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
        wrapper.get('[data-test="flame-graph-plot"]').element.dispatchEvent(event);
        return event;
      };
      return { wrapper, lastZoom, wheel };
    };

    it("keeps a plain scroll for the page and zooms on Cmd or Ctrl + scroll at the pointer", async () => {
      const { lastZoom, wheel } = mountWithChart();
      await flushPromises();
      await nextTick();

      expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
      expect(lastZoom()).toBeUndefined();

      // jsdom gives the plot no size, so the pointer sits at the left edge and the zoom keeps it there.
      expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
      expect(lastZoom().start).toBe(0);
      expect(lastZoom().end).toBeCloseTo(100 * Math.exp(-0.3), 5);
      wheel({ deltaY: -100, metaKey: true });
      expect(lastZoom().end).toBeCloseTo(100 * Math.exp(-0.6), 5);
    });

    it("pans on Shift + scroll and on a drag, and a drag release is not a click", async () => {
      const { wrapper, lastZoom, wheel } = mountWithChart();
      await flushPromises();
      await nextTick();
      // Far enough in that a ten-pixel drag stays inside the graph.
      wheel({ deltaY: -2000, ctrlKey: true });
      const span = lastZoom().end - lastZoom().start;

      wheel({ deltaY: 1, shiftKey: true });
      expect(lastZoom().start).toBeCloseTo(span, 5);

      const plot = wrapper.get('[data-test="flame-graph-plot"]').element;
      plot.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 50, button: 0, bubbles: true }),
      );
      plot.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, bubbles: true }));
      plot.dispatchEvent(new PointerEvent("pointerup", { clientX: 40, bubbles: true }));
      expect(lastZoom().start).toBeCloseTo(span + 10 * span, 5);

      wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
        data: { block: { id: "root/0", name: "a", grouped: false } },
      });
      await nextTick();
      expect(wrapper.find('[data-test="flame-graph-focus-bar"]').exists()).toBe(false);
    });

    it("opens a frame's actions from its ⋮ button, with the function name and copy at the top", async () => {
      const wrapper = mountGraph(tree);
      await flushPromises();
      await nextTick();
      const plot = wrapper.get('[data-test="flame-graph-plot"]').element as HTMLElement;
      Object.defineProperty(plot, "clientWidth", { value: 1020 });
      plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1020, height: 200 }) as DOMRect;

      // Row 1, a tenth of the way across: the frame "a".
      plot.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 110, clientY: 40, bubbles: true }),
      );
      await nextTick();
      await wrapper.get('[data-test="flame-graph-frame-more"]').trigger("click");
      await nextTick();

      const menu = wrapper.get('[data-test="flame-graph-frame-menu"]');
      expect(menu.text()).toContain("Function");
      expect(menu.find('[data-test="flame-graph-copy-name"]').exists()).toBe(true);
      await menu.get('[data-test="flame-graph-zoom-in"]').trigger("click");
      await nextTick();
      expect(blocksOf(wrapper).find((block) => !block.ancestor)).toMatchObject({ id: "root/0" });
    });

    it("offers Zoom out on the zoomed frame, Zoom out to here on a caller, and Reset zoom while zoomed", async () => {
      const wrapper = mountGraph(tree);
      await flushPromises();
      await nextTick();
      const menuTests = () =>
        wrapper
          .get('[data-test="flame-graph-frame-menu"]')
          .findAll('[data-test^="flame-graph-zoom"]')
          .map((item) => item.attributes("data-test"));

      // Not zoomed: the root offers no zoom, a frame offers Zoom in.
      await rightClick(wrapper, 10, 10);
      expect(menuTests()).toEqual([]);
      await rightClick(wrapper, 10, 1 + 26 * 2 + 5);
      expect(menuTests()).toEqual(["flame-graph-zoom-in"]);

      await click(wrapper, "root/0/0");
      await rightClick(wrapper, 10, 1 + 26 * 2 + 5);
      expect(menuTests()).toEqual(["flame-graph-zoom-out", "flame-graph-zoom-reset"]);
      await wrapper.get('[data-test="flame-graph-zoom-out"]').trigger("click");
      await nextTick();
      expect(blocksOf(wrapper).find((block) => !block.ancestor)).toMatchObject({ id: "root/0" });

      await click(wrapper, "root/0/0");
      await rightClick(wrapper, 10, 1 + 26 * 1 + 5);
      expect(menuTests()).toEqual(["flame-graph-zoom-out-here", "flame-graph-zoom-reset"]);
      await wrapper.get('[data-test="flame-graph-zoom-reset"]').trigger("click");
      await nextTick();
      expect(blocksOf(wrapper).some((block) => block.ancestor)).toBe(false);
    });

    it("shows the Cmd + scroll hint until it is closed, and Don't show again keeps it closed", async () => {
      localStorage.removeItem("o2_flame_zoom_hint_hidden");
      const first = mountGraph(tree);
      await flushPromises();
      await nextTick();
      expect(first.get('[data-test="flame-graph-zoom-hint"]').text()).toContain("+ scroll to zoom");

      await first.get('[data-test="flame-graph-zoom-hint-never"]').trigger("click");
      await nextTick();
      expect(first.find('[data-test="flame-graph-zoom-hint"]').exists()).toBe(false);

      const second = mountGraph(tree);
      await flushPromises();
      await nextTick();
      expect(second.find('[data-test="flame-graph-zoom-hint"]').exists()).toBe(false);
      localStorage.removeItem("o2_flame_zoom_hint_hidden");
    });

    it("starts a zoomed frame at full width", async () => {
      const { wrapper, lastZoom, wheel } = mountWithChart();
      await flushPromises();
      await nextTick();
      wheel({ deltaY: -400, ctrlKey: true });
      expect(lastZoom().end).toBeLessThan(100);

      wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
        data: { block: blocksOf(wrapper).find((block) => block.id === "root/0") },
      });
      await nextTick();
      const options = wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: { dataZoom: { start: number; end: number }[] };
      };
      expect(options.options.dataZoom[0]).toMatchObject({ start: 0, end: 100 });
    });
  });
});

describe("FlameGraphView tooltip", () => {
  it("escapes formatted values and frame names in the hover card", async () => {
    const payload = "<img src=x onerror=alert(1)>";
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "total", total: 10, children: [{ name: payload, total: 10, children: [] }] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "10",
        valueFormatter: (value: number) => `${value} ${payload}`,
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
    await flushPromises();
    await nextTick();
    const options = (
      wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: {
          series: { data: { block: { label: string } }[] }[];
          tooltip: { formatter: (params: unknown) => string };
        };
      }
    ).options;
    const frame = options.series[0].data.find((datum) => datum.block.label === payload);
    expect(frame).toBeDefined();
    const html = options.tooltip.formatter({ data: { block: frame!.block } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("FlameGraphView theme and size", () => {
  const SERIES_STEPS = [1, 5, 7, 9];
  const CHILD = "main.handleCheckout";
  const themeTokens = [
    "--color-flame-grouped-fill",
    "--color-border-default",
    ...SERIES_STEPS.map((step) => `--color-chart-series-${step}`),
  ];
  const setThemeTokens = (base: number) => {
    const html = document.documentElement;
    html.style.setProperty("--color-flame-grouped-fill", `rgb(${base}, 2, 3)`);
    html.style.setProperty("--color-border-default", `rgb(${base}, 5, 6)`);
    SERIES_STEPS.forEach((step, index) =>
      html.style.setProperty(`--color-chart-series-${step}`, `rgb(${base}, ${index}, ${step})`),
    );
  };
  const childColor = (base: number) => {
    const index = paletteIndexFor(CHILD, SERIES_STEPS.length);
    return `rgb(${base}, ${index}, ${SERIES_STEPS[index]})`;
  };
  afterEach(() => {
    themeTokens.forEach((token) => document.documentElement.style.removeProperty(token));
  });
  const mountWithStore = (store = createStore({ state: { theme: "light" } })) =>
    mount(FlameGraphView, {
      props: {
        root: {
          name: "main",
          self: 1,
          total: 4,
          children: [{ name: CHILD, self: 3, total: 3, children: [] }],
        },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
          OTooltip: true,
        },
      },
    });
  const optionsOf = (wrapper: ReturnType<typeof mountWithStore>) =>
    (
      wrapper.findComponent({ name: "ChartRenderer" }).props("data") as {
        options: {
          backgroundColor?: string;
          series: {
            data: { block: { name: string }; itemStyle: { color: string; borderColor: string } }[];
          }[];
        };
      }
    ).options;
  const styleOf = (wrapper: ReturnType<typeof mountWithStore>, name: string) =>
    optionsOf(wrapper).series[0].data.find((item) => item.block.name === name)?.itemStyle;

  it("re-reads the theme colours and rebuilds the chart when the theme switches", async () => {
    setThemeTokens(1);
    const store = createStore({ state: { theme: "light" } });
    const wrapper = mountWithStore(store);
    await flushPromises();
    expect(styleOf(wrapper, "main")).toMatchObject({
      color: "rgb(1, 2, 3)",
      borderColor: "rgb(1, 5, 6)",
    });
    expect(styleOf(wrapper, CHILD)?.color).toBe(childColor(1));

    setThemeTokens(7);
    store.state.theme = "dark";
    await nextTick();
    expect(styleOf(wrapper, "main")).toMatchObject({
      color: "rgb(7, 2, 3)",
      borderColor: "rgb(7, 5, 6)",
    });
    expect(styleOf(wrapper, CHILD)?.color).toBe(childColor(7));
  });

  it("re-reads the theme colours when a theme colour preset is applied", async () => {
    setThemeTokens(1);
    const wrapper = mountWithStore();
    await flushPromises();
    expect(styleOf(wrapper, "main")).toMatchObject({
      color: "rgb(1, 2, 3)",
      borderColor: "rgb(1, 5, 6)",
    });
    expect(styleOf(wrapper, CHILD)?.color).toBe(childColor(1));

    setThemeTokens(7);
    window.dispatchEvent(new CustomEvent("themeColorChanged"));
    await nextTick();
    expect(styleOf(wrapper, "main")).toMatchObject({
      color: "rgb(7, 2, 3)",
      borderColor: "rgb(7, 5, 6)",
    });
    expect(styleOf(wrapper, CHILD)?.color).toBe(childColor(7));
  });

  it("draws on a transparent background, so the dark chart theme does not box it in", async () => {
    const wrapper = mountWithStore();
    await flushPromises();
    expect(optionsOf(wrapper).backgroundColor).toBe("transparent");
  });

  it("leaves resizes to ChartRenderer below lg, resizes at lg+ only when the container size differs from the drawn size, and stops watching on unmount", async () => {
    const observers: {
      callback: () => void;
      disconnect: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
    }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: () => void;
        disconnect = vi.fn();
        observe = vi.fn();
        constructor(callback: () => void) {
          this.callback = callback;
          observers.push(this);
        }
      },
    );
    const frames: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    const notify = () => {
      observers[0].callback();
      frames.splice(0).forEach((frame) => frame());
    };
    const dom = document.createElement("div");
    const box = { width: 600, height: 300 };
    Object.defineProperty(dom, "clientWidth", { get: () => box.width });
    Object.defineProperty(dom, "clientHeight", { get: () => box.height });
    const drawn = { width: 600, height: 300 };
    const chartInstance = {
      setOption: vi.fn(),
      dispatchAction: vi.fn(),
      getDom: () => dom,
      getWidth: () => drawn.width,
      getHeight: () => drawn.height,
      resize: vi.fn(),
    };
    try {
      const wrapper = mount(FlameGraphView, {
        props: {
          root: { name: "main", self: 1, total: 4, children: [] },
          unitLabel: "ns",
          summaryLabel: "total",
          summaryValue: "4",
        },
        global: {
          plugins: [i18n],
          stubs: {
            ChartRenderer: { ...ChartRendererStub, setup: () => ({ chart: chartInstance }) },
            OButton: { template: "<button><slot /></button>" },
            OSwitch: true,
            OTooltip: true,
          },
        },
      });
      await flushPromises();
      expect(observers).toHaveLength(1);
      expect(observers[0].observe).toHaveBeenCalledTimes(1);
      expect(observers[0].observe).toHaveBeenCalledWith(wrapper.element);

      breakpoint.lgUp = false;
      box.width = 400;
      notify();
      expect(chartInstance.resize).not.toHaveBeenCalled();

      breakpoint.lgUp = true;
      box.width = 600;
      // ChartRenderer already resized for this change, so the chart matches its box.
      notify();
      expect(chartInstance.resize).not.toHaveBeenCalled();

      box.width = 400;
      notify();
      expect(chartInstance.resize).toHaveBeenCalledTimes(1);

      box.height = 0;
      notify();
      expect(chartInstance.resize).toHaveBeenCalledTimes(1);

      wrapper.unmount();
      expect(observers[0].disconnect).toHaveBeenCalled();
    } finally {
      breakpoint.lgUp = true;
      vi.unstubAllGlobals();
    }
  });
});

function viGetBoundingClientRect(element: HTMLElement, box: { left: number; top: number }) {
  element.getBoundingClientRect = () =>
    ({
      left: box.left,
      top: box.top,
      right: box.left,
      bottom: box.top,
      width: 0,
      height: 0,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;
}
