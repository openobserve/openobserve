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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import searchService from "@/services/search";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import K8sLogsPanel from "./K8sLogsPanel.vue";
import { resolvePodLogs } from "./podLogsLink";

const push = vi.fn();

vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({}) }));
vi.mock("./podLogsLink", () => ({ resolvePodLogs: vi.fn() }));

enableAutoUnmount(afterEach);

const search = vi.mocked(searchService.search);
const resolve = vi.mocked(resolvePodLogs);

const link = {
  route: { path: "/logs", query: { stream: "default", query: btoa("pod='web-1'") } },
  warnNoClusterField: false,
};

const hits = [
  { _timestamp: 3000, body: "third line" },
  { _timestamp: 1000, body: "first line" },
  { _timestamp: 2000, body: "second line" },
];

const dispatch = vi.fn();

const POLL_MS = 5000;
const DAY_US = 24 * 60 * 60 * 1_000_000;

const mountPanel = async (overrides: Record<string, unknown> = {}) => {
  const store = createStore({ state: { timezone: "UTC" } });
  store.dispatch = dispatch;
  const wrapper = mount(K8sLogsPanel, {
    props: {
      target: { kind: "pod", cluster: "prod", namespace: "shop", name: "web-1" },
      orgId: "org1",
      range: { start: 1, end: 2 },
      ...overrides,
    },
    global: { plugins: [store, i18n] },
  });
  await flushPromises();
  return wrapper;
};

describe("K8sLogsPanel", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    resolve.mockResolvedValue(link as any);
    search.mockResolvedValue({ data: { hits } } as any);
  });

  it("explains when no log stream can be resolved", async () => {
    resolve.mockResolvedValue(null);
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-test="k8s2-logs-nostream"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-logs-line"]').exists()).toBe(false);
  });

  it("shows lines oldest first", async () => {
    const wrapper = await mountPanel();
    const lines = wrapper.findAll('[data-test="k8s2-logs-line"]').map((l) => l.text());
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("first line");
    expect(lines[2]).toContain("third line");
  });

  it("narrows the lines with the filter box", async () => {
    const wrapper = await mountPanel();
    await wrapper
      .find('[data-test="k8s2-logs-filter"] input, input[data-test="k8s2-logs-filter"]')
      .setValue("second");
    await flushPromises();
    const lines = wrapper.findAll('[data-test="k8s2-logs-line"]');
    expect(lines).toHaveLength(1);
    expect(lines[0].text()).toContain("second line");
  });

  it("shows the error state when the search fails", async () => {
    search.mockRejectedValue(new Error("down"));
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-test="k8s2-logs-error"]').exists()).toBe(true);
  });

  it("opens the resolved route in Logs after resetting its session", async () => {
    const wrapper = await mountPanel();
    await wrapper.find('[data-test="k8s2-logs-open"]').trigger("click");
    expect(dispatch).toHaveBeenCalledWith("logs/setIsInitialized", false);
    expect(push).toHaveBeenCalledWith(link.route);
  });

  describe("polling", () => {
    const fakeTimers = () => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const advance = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await flushPromises();
    };
    const liveButton = (wrapper: Awaited<ReturnType<typeof mountPanel>>) =>
      wrapper.find('[data-test="k8s2-logs-live"]');

    it("does not re-resolve the stream on polls when none qualifies", async () => {
      fakeTimers();
      resolve.mockResolvedValue(null);
      await mountPanel();
      expect(resolve).toHaveBeenCalledTimes(1);
      await advance(POLL_MS * 3);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(search).not.toHaveBeenCalled();
    });

    it("resolves again when the target changes after a failed resolution", async () => {
      resolve.mockResolvedValue(null);
      const wrapper = await mountPanel();
      await wrapper.setProps({
        target: { kind: "pod", cluster: "prod", namespace: "shop", name: "web-2" },
      });
      await flushPromises();
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it("polls every 5s while Live", async () => {
      fakeTimers();
      await mountPanel();
      expect(search).toHaveBeenCalledTimes(1);
      await advance(POLL_MS);
      expect(search).toHaveBeenCalledTimes(2);
      await advance(POLL_MS);
      expect(search).toHaveBeenCalledTimes(3);
    });

    it("toggles to Paused and stops polling", async () => {
      fakeTimers();
      const wrapper = await mountPanel();
      expect(liveButton(wrapper).text()).toBe("Live");
      await liveButton(wrapper).trigger("click");
      expect(liveButton(wrapper).text()).toBe("Paused");
      await advance(POLL_MS * 3);
      expect(search).toHaveBeenCalledTimes(1);
      await liveButton(wrapper).trigger("click");
      await advance(POLL_MS);
      expect(search).toHaveBeenCalledTimes(2);
    });

    it("clears the interval on unmount", async () => {
      fakeTimers();
      const wrapper = await mountPanel();
      wrapper.unmount();
      await advance(POLL_MS * 3);
      expect(search).toHaveBeenCalledTimes(1);
    });

    it("skips a tick while the previous search is still pending", async () => {
      fakeTimers();
      await mountPanel();
      let finish: (value: unknown) => void = () => {};
      search.mockImplementationOnce(() => new Promise((done) => (finish = done)) as any);
      await advance(POLL_MS);
      await advance(POLL_MS * 2);
      expect(search).toHaveBeenCalledTimes(2);
      finish({ data: { hits } });
      await flushPromises();
      await advance(POLL_MS);
      expect(search).toHaveBeenCalledTimes(3);
    });

    it("keeps the loaded lines and flags a failed poll", async () => {
      fakeTimers();
      const wrapper = await mountPanel();
      search.mockRejectedValueOnce(new Error("down"));
      await advance(POLL_MS);
      expect(wrapper.findAll('[data-test="k8s2-logs-line"]')).toHaveLength(3);
      expect(wrapper.find('[data-test="k8s2-logs-poll-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="k8s2-logs-error"]').exists()).toBe(false);
    });

    it("tails to now for a relative range", async () => {
      fakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await mountPanel();
      expect(search.mock.calls[0][0].query.query.end_time).toBe(Date.now() * 1000);
    });

    it("runs a closed window paused, ending at range.end, with Live disabled", async () => {
      fakeTimers();
      const wrapper = await mountPanel({ range: { start: 1000, end: 5000, relative: false } });
      expect(search.mock.calls[0][0].query.query.end_time).toBe(5000);
      expect(liveButton(wrapper).text()).toBe("Paused");
      expect(liveButton(wrapper).attributes("disabled")).toBeDefined();
      await advance(POLL_MS * 3);
      expect(search).toHaveBeenCalledTimes(1);
    });
  });

  describe("range and target", () => {
    it("reloads when the page range changes", async () => {
      const wrapper = await mountPanel();
      await wrapper.setProps({ range: { start: 10, end: 20 } });
      await flushPromises();
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1][0].query.query.start_time).toBe(10);
    });

    it("reloads when a relative range becomes absolute", async () => {
      const wrapper = await mountPanel();
      await wrapper.setProps({ range: { start: 1, end: 2, relative: false } });
      await flushPromises();
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1][0].query.query.end_time).toBe(2);
    });
  });

  describe("filters", () => {
    const restartHits = [
      {
        _timestamp: 1000,
        body: "old run",
        k8s_container_name: "app",
        k8s_container_restart_count: 0,
      },
      {
        _timestamp: 2000,
        body: "new run",
        k8s_container_name: "app",
        k8s_container_restart_count: 1,
      },
      {
        _timestamp: 3000,
        body: "sidecar line",
        k8s_container_name: "proxy",
        k8s_container_restart_count: 0,
      },
    ];
    const texts = (wrapper: Awaited<ReturnType<typeof mountPanel>>) =>
      wrapper.findAll('[data-test="k8s2-logs-line"]').map((l) => l.text());

    it("switches to the previous container instance with the Previous toggle", async () => {
      search.mockResolvedValue({ data: { hits: restartHits } } as any);
      const wrapper = await mountPanel();
      expect(texts(wrapper).join("|")).toContain("new run");
      expect(texts(wrapper).join("|")).not.toContain("old run");
      await wrapper.find('[data-test="k8s2-logs-previous-btn"]').trigger("click");
      expect(texts(wrapper).join("|")).toContain("old run");
      expect(texts(wrapper).join("|")).not.toContain("new run");
    });

    it("disables Previous when no loaded line comes from a restarted container", async () => {
      const plain = await mountPanel();
      expect(
        plain.find('[data-test="k8s2-logs-previous-btn"]').attributes("disabled"),
      ).toBeDefined();
      search.mockResolvedValue({ data: { hits: restartHits } } as any);
      const restarted = await mountPanel();
      expect(
        restarted.find('[data-test="k8s2-logs-previous-btn"]').attributes("disabled"),
      ).toBeUndefined();
    });

    it("narrows the lines to the chosen container", async () => {
      search.mockResolvedValue({ data: { hits: restartHits } } as any);
      const wrapper = await mountPanel();
      expect(texts(wrapper)).toHaveLength(2);
      wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "proxy");
      await flushPromises();
      expect(texts(wrapper)).toHaveLength(1);
      expect(texts(wrapper)[0]).toContain("sidecar line");
    });

    it("names the container select for assistive tech", async () => {
      const wrapper = await mountPanel();
      expect(wrapper.find('[aria-label="Container"]').exists()).toBe(true);
    });
  });

  describe("line count", () => {
    it("states the plain count under the cap", async () => {
      const wrapper = await mountPanel();
      expect(wrapper.find('[data-test="k8s2-logs-count"]').text()).toBe("3 lines");
    });

    it("says the latest N lines once the cap is reached", async () => {
      const capped = Array.from({ length: 500 }, (_, i) => ({ _timestamp: i + 1, body: `l${i}` }));
      search.mockResolvedValue({ data: { hits: capped } } as any);
      const wrapper = await mountPanel();
      expect(wrapper.find('[data-test="k8s2-logs-count"]').text()).toBe("Latest 500 lines");
    });
  });

  describe("stamps", () => {
    const stamp = (wrapper: Awaited<ReturnType<typeof mountPanel>>) =>
      wrapper.find('[data-test="k8s2-logs-line"] span').text();

    it("shows only the time within a day", async () => {
      expect(stamp(await mountPanel())).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    });

    it("adds the date when the range spans over 24h", async () => {
      const wrapper = await mountPanel({ range: { start: 0, end: 2 * DAY_US } });
      expect(stamp(wrapper)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    });
  });

  describe("pinned to the bottom", () => {
    const geometry = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
      let top = 0;
      Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
      Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      });
    };

    const tailAfterNewLine = async (scrollTop: number) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      const wrapper = await mountPanel();
      const scroller = wrapper.find('[data-test="k8s2-logs-scroller"]');
      const el = scroller.element as HTMLElement;
      geometry(el, 1000, 100);
      el.scrollTop = scrollTop;
      await scroller.trigger("scroll");
      search.mockResolvedValue({
        data: { hits: [...hits, { _timestamp: 4000, body: "fourth" }] },
      } as any);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushPromises();
      expect(wrapper.findAll('[data-test="k8s2-logs-line"]')).toHaveLength(4);
      return el;
    };

    it("follows new lines while the reader is at the bottom", async () => {
      expect((await tailAfterNewLine(900)).scrollTop).toBe(1000);
    });

    it("leaves the position alone once the reader scrolled up", async () => {
      expect((await tailAfterNewLine(200)).scrollTop).toBe(200);
    });
  });
});
