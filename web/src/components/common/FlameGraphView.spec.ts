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
import { nextTick } from "vue";
import FlameGraphView from "@/components/common/FlameGraphView.vue";
import i18n from "@/locales";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));

const ChartRendererStub = {
  name: "ChartRenderer",
  props: ["data"],
  emits: ["click"],
  template: '<div class="chart-renderer-stub"></div>',
};

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

    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", value: 4, depth: 0, x: 0, width: 100 } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 140, clientY: 200 } },
    });
    await nextTick();

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
          return rect(parseFloat(this.style.left), parseFloat(this.style.top), 160, 200);
        }
        return rect(0, 0, 300, 300);
      });

    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 250, clientY: 250 } },
    });
    await flushPromises();

    const style = wrapper.get('[data-test="flame-graph-frame-menu"]').attributes("style");
    expect(style).toContain("left: 90px");
    expect(style).toContain("top: 50px");
    spy.mockRestore();
    wrapper.unmount();
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
    const openMenu = async () => {
      chart.vm.$emit("click", {
        data: { block: { id: "root", name: "main", grouped: false } },
        event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
      });
      await nextTick();
    };

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
    chart.vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    expect(chartInstance.dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
    await nextTick();
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
    wrapper.unmount();
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
    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    await nextTick();

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
    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    await nextTick();

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
    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    await nextTick();

    await wrapper.get('[data-test="flame-graph-search-function"]').trigger("click");
    expect(wrapper.emitted("search")).toEqual([["main"]]);

    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    await nextTick();
    await wrapper.get('[data-test="flame-graph-sandwich"]').trigger("click");
    expect(wrapper.emitted("sandwich")).toEqual([["main"]]);

    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", grouped: false } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 10, clientY: 10 } },
    });
    await nextTick();
    await wrapper.get('[data-test="flame-graph-details"]').trigger("click");
    expect(wrapper.emitted("details")).toEqual([["main"]]);
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

  it("labels the flip switch Root at Bottom and draws the root last when it is on", async () => {
    const wrapper = mountGraph({
      name: "total",
      total: 10,
      children: [{ name: "main", total: 10, children: [] }],
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("Root at Bottom");

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
    expect(leaf).toContain("Share of Caller");
    expect(leaf).toContain("25.00%"); // 25 of the caller's 100
    expect(leaf).toContain("12.50%"); // 25 of the view's 200
    expect(tooltipFor("total")).not.toContain("Share of Caller");
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
