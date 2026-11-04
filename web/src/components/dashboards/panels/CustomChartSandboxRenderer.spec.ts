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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import CustomChartSandboxRenderer from "./CustomChartSandboxRenderer.vue";
import { __resetSandboxFont } from "@/utils/dashboard/customChartSandbox";
import { FLEET_DRILLDOWN_EVENT } from "@/views/Infrastructure/curated/packs/kubernetes.page";

type PortHandler = ((event: { data: unknown }) => void) | null;

class FakePort {
  other!: FakePort;
  private queue: unknown[] = [];
  private handler: PortHandler = null;
  set onmessage(handler: PortHandler) {
    this.handler = handler;
    this.queue.splice(0).forEach((data) => handler?.({ data }));
  }
  get onmessage() {
    return this.handler;
  }
  postMessage(data: unknown) {
    if (this.other.handler) this.other.handler({ data });
    else this.other.queue.push(data);
  }
  close() {}
}

class FakeMessageChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

const run = (code = "var option = {};") => ({ code, data: [[{ v: 1 }]], panelId: "panel-7" });

describe("CustomChartSandboxRenderer", () => {
  let wrapper: VueWrapper<any>;
  let store: ReturnType<typeof createStore<{ theme: string }>>;
  let hoveredSeriesState: { panelId: string | number | undefined };

  const mountRenderer = (props: Record<string, unknown> = { run: run() }) =>
    mount(CustomChartSandboxRenderer, {
      props: props as any,
      attachTo: document.body,
      global: { plugins: [i18n, store], provide: { hoveredSeriesState } },
    });

  // Plays the frame's ready handshake and collects what the parent sends over the port.
  const connect = async () => {
    const iframe = wrapper.find("iframe").element as HTMLIFrameElement;
    const post = vi.spyOn(iframe.contentWindow!, "postMessage");
    const token = /token: "([0-9a-f]{32})"/.exec(iframe.srcdoc)![1];
    window.dispatchEvent(
      new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ready", token } }),
    );
    await flushPromises();
    const port = post.mock.calls[0][2]![0] as unknown as FakePort;
    const received: any[] = [];
    port.onmessage = (event) => received.push(event.data);
    return { port, received };
  };

  beforeEach(() => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    __resetSandboxFont();
    store = createStore({ state: { theme: "light" } });
    hoveredSeriesState = { panelId: undefined };
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
  });

  it("renders the panel inside a script-only sandboxed frame", async () => {
    wrapper = mountRenderer();
    const iframe = wrapper.find("iframe");

    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes("sandbox")).toBe("allow-scripts");

    const { received } = await connect();
    const runMessage = received.find((message) => message.type === "run");
    expect(JSON.parse(runMessage.data)).toEqual([[{ v: 1 }]]);
    expect(received.find((message) => message.type === "appearance").dark).toBe(false);
  });

  it("emits the frame's error in the shape the panel shows", async () => {
    wrapper = mountRenderer();
    const { port } = await connect();

    port.postMessage({ type: "error", runId: 1, message: "Execution Error: boom" });

    expect(wrapper.emitted("error")).toEqual([[{ message: "Execution Error: boom", code: "" }]]);
  });

  it("turns an allowed drilldown into the event the curated page listens for", async () => {
    const heard: CustomEvent[] = [];
    const listener = (event: Event) => heard.push(event as CustomEvent);
    document.addEventListener(FLEET_DRILLDOWN_EVENT, listener);
    wrapper = mountRenderer();
    const { port } = await connect();

    port.postMessage({ type: "drilldown", name: "cluster", detail: { cluster: "prod-eu" } });
    port.postMessage({ type: "drilldown", name: "other", detail: { cluster: "x" } });
    document.removeEventListener(FLEET_DRILLDOWN_EVENT, listener);

    expect(heard).toHaveLength(1);
    expect(heard[0].detail).toEqual({ cluster: "prod-eu" });
  });

  it("re-runs new data in the same frame", async () => {
    wrapper = mountRenderer();
    const first = wrapper.find("iframe").element;
    const { received } = await connect();

    await wrapper.setProps({ run: { ...run(), data: [[{ v: 2 }]] } });

    expect(wrapper.find("iframe").element).toBe(first);
    const runs = received.filter((message) => message.type === "run");
    expect(runs.map((message) => JSON.parse(message.data))).toEqual([[[{ v: 1 }]], [[{ v: 2 }]]]);
  });

  it("clears the chart when the panel has no run", async () => {
    wrapper = mountRenderer();
    const { received } = await connect();

    await wrapper.setProps({ run: null });

    expect(received.at(-1)).toEqual({ type: "clear" });
  });

  it("sends the dark look when the app theme changes", async () => {
    wrapper = mountRenderer();
    const { received } = await connect();

    store.state.theme = "dark";
    await flushPromises();

    expect(received.at(-1)).toMatchObject({ type: "appearance", dark: true });
  });

  it("marks this panel as hovered when the pointer enters the frame", async () => {
    wrapper = mountRenderer();

    await wrapper.find('[data-test="dashboard-custom-chart-sandbox"]').trigger("mouseover");

    expect(hoveredSeriesState.panelId).toBe("panel-7");
  });

  it("marks the panel on the ref the dashboard actually provides", async () => {
    const provided = ref({ panelId: -1 as string | number | undefined });
    wrapper = mount(CustomChartSandboxRenderer, {
      props: { run: run() },
      attachTo: document.body,
      global: { plugins: [i18n, store], provide: { hoveredSeriesState: provided } },
    });

    await wrapper.find('[data-test="dashboard-custom-chart-sandbox"]').trigger("mouseover");

    expect(provided.value.panelId).toBe("panel-7");
  });

  it("removes the frame on unmount", () => {
    wrapper = mountRenderer();
    const iframe = wrapper.find("iframe").element;

    wrapper.unmount();

    expect(iframe.isConnected).toBe(false);
  });
});
