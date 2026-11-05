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
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import type { QueryHistoryEntry } from "@/services/query_history";
import { b64EncodeUnicode } from "@/utils/formatters";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  record: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: api }));

const clipboard = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock("@/utils/clipboard", () => clipboard);

const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push,
    resolve: (to: { path: string; query: Record<string, string> }) => ({
      href: `/web${to.path}?${new URLSearchParams(to.query).toString()}`,
    }),
  }),
}));

import i18n from "@/locales";
import RecentSearchesDrawer from "./RecentSearchesDrawer.vue";
import { dismissAll, pauseTimer, toastRecords } from "@/lib/feedback/Toast/useToast";

enableAutoUnmount(afterEach);

const NOW_US = Date.now() * 1000;
const DAY_US = 86_400_000_000;

const row = (id: string, overrides: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry => ({
  id,
  source: "logs",
  query: `query ${id}`,
  query_key: "k",
  streams: ["k8s"],
  context: { time: { type: "relative", period: "15m", start_time: 1, end_time: 2 } },
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: NOW_US,
  updated_at: NOW_US,
  ...overrides,
});

const input = (name: string) => ({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: `<input data-stub="${name}" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
});

const mountDrawer = (open = true) =>
  mount(RecentSearchesDrawer, {
    props: { source: "logs", open },
    global: {
      plugins: [store],
      stubs: {
        ODrawer: {
          props: ["open"],
          template: `<div v-if="open"><slot name="header-left" /><slot name="header-right" /><slot /><slot name="footer" /></div>`,
        },
        ODialog: {
          props: ["open"],
          emits: ["click:primary", "click:secondary"],
          template: `<div v-if="open" data-test="dialog"><slot />
            <button data-test="dialog-confirm" @click="$emit('click:primary')" /></div>`,
        },
        // The real menu is portalled, so its clicks never reach the row.
        ODropdown: { template: `<div @click.stop><slot name="trigger" /><slot /></div>` },
        ODropdownItem: {
          emits: ["select"],
          template: `<button v-bind="$attrs" @click="$emit('select')"><slot /></button>`,
        },
        OSearchInput: input("search"),
        OSwitch: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `<input type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)" />`,
        },
        OCheckbox: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `<input type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)" />`,
        },
        OTimeCell: true,
        OTooltip: true,
      },
    },
  });

const lastParams = () => api.list.mock.calls.at(-1)?.[1];

describe("RecentSearchesDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      data: [row("today"), row("old", { updated_at: NOW_US - 3 * DAY_US, run_count: 4 })],
    });
    api.star.mockResolvedValue({ data: {} });
    api.remove.mockResolvedValue({ data: {} });
    api.clear.mockResolvedValue({ data: { deleted: 2 } });
  });
  afterEach(() => {
    store.state.zoConfig.query_history_retention_days = undefined;
  });

  it("lists this page's rows grouped by day", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    expect(lastParams()).toEqual({ source: "logs", limit: 50, offset: 0 });
    const days = wrapper.findAll('[data-test="recent-searches-day"]');
    expect(days).toHaveLength(2);
    expect(days[0].text()).toContain("Today");
    expect(days[0].find("h3").text()).toBe("Today · 1");
    expect(days[1].text()).toContain("Ran 4x · last at");
  });

  it("sends the search text, scope and status chip to the server", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-stub="search"]').setValue("checkout");
    await wrapper.find('[data-test="recent-searches-status-error"]').trigger("click");
    await flushPromises();
    expect(lastParams()).toEqual({
      source: "logs",
      q: "checkout",
      status: "error",
      limit: 50,
      offset: 0,
    });

    await wrapper.find('[data-test="recent-searches-status-starred"]').trigger("click");
    await flushPromises();
    expect(lastParams()).toEqual({
      source: "logs",
      q: "checkout",
      status: "error",
      starred: true,
      limit: 50,
      offset: 0,
    });

    await wrapper.find('[data-test="recent-searches-scope-all"]').trigger("click");
    await flushPromises();
    expect(lastParams().source).toBe("logs,traces,metrics");
  });

  describe("No results", () => {
    const ROWS = [
      row("hit"),
      row("empty", { context: { no_results: true } }),
      row("bad", { status: "error", context: { error: "boom" } }),
    ];
    const ids = (wrapper: ReturnType<typeof mountDrawer>) =>
      wrapper
        .findAll('[data-test^="recent-searches-drawer-row-"]')
        .map((r) => r.attributes("data-test")?.replace("recent-searches-drawer-row-", ""));

    it("tells a zero-hit ok run from a success by its context, in the dot and the label", async () => {
      api.list.mockResolvedValue({ data: ROWS });
      const wrapper = mountDrawer();
      await flushPromises();
      const label = (id: string) =>
        wrapper.find(`[data-test="recent-searches-status-label-${id}"]`).text();
      expect(label("hit")).toBe("Success");
      expect(label("empty")).toBe("No results");
      expect(label("bad")).toBe("Error");
      expect(wrapper.findAll('[data-test="recent-searches-status-dot-no_results"]')).toHaveLength(
        1,
      );
    });

    it("filters the loaded rows client-side, asking the server only for ok runs", async () => {
      api.list.mockResolvedValue({ data: ROWS.filter((r) => r.status === "ok") });
      const wrapper = mountDrawer();
      await flushPromises();
      await wrapper.find('[data-test="recent-searches-status-no_results"]').trigger("click");
      await flushPromises();
      expect(lastParams()).toMatchObject({ status: "ok" });
      expect(ids(wrapper)).toEqual(["empty"]);
      await wrapper.find('[data-test="recent-searches-status-ok"]').trigger("click");
      await flushPromises();
      expect(ids(wrapper)).toEqual(["hit"]);
    });
  });

  it("shows the total in the header badge and Showing N of M in the footer", async () => {
    api.count.mockImplementation((_org: string, params: { starred: boolean }) =>
      Promise.resolve({ data: { count: params.starred ? 1 : 5 } }),
    );
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-count"]').text()).toBe("6");
    expect(wrapper.find('[data-test="recent-searches-showing"]').text()).toBe("Showing 2 of 6");
  });

  describe("Reset filters", () => {
    // Opened already filtered, so the unfiltered list is never cached and Reset must fetch it.
    const mountFiltered = async () => {
      const wrapper = mountDrawer(false);
      wrapper.vm.show("error");
      await wrapper.setProps({ open: true });
      await flushPromises();
      await wrapper.find('[data-stub="search"]').setValue("checkout");
      await flushPromises();
      expect(api.list.mock.calls.every(([, params]) => params.status === "error")).toBe(true);
      return wrapper;
    };
    const expectCleared = (wrapper: ReturnType<typeof mountDrawer>) => {
      expect((wrapper.find('[data-stub="search"]').element as HTMLInputElement).value).toBe("");
      expect(lastParams()).toEqual({ source: "logs", limit: 50, offset: 0 });
    };

    it("clears the search and status chip from the filtered empty state", async () => {
      api.list.mockResolvedValue({ data: [] });
      const wrapper = await mountFiltered();
      const empty = wrapper.find('[data-test="recent-searches-drawer-empty"]');
      expect(empty.text()).toContain("No searches match these filters");
      const button = empty.findAll("button").filter((b) => b.text().includes("Reset filters"));
      expect(button).toHaveLength(1);
      await button[0].trigger("click");
      await flushPromises();
      expectCleared(wrapper);
    });
  });

  it("re-runs now on a row click from today, and at original time on demand", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-drawer-row-today"]').trigger("click");
    expect(wrapper.emitted("restore")?.[0]).toEqual([
      expect.objectContaining({ id: "today" }),
      "now",
      true,
    ]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await wrapper.find('[data-test="recent-searches-rerun-original-old"]').trigger("click");
    expect(wrapper.emitted("restore")?.[1]?.slice(1)).toEqual(["original", true]);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await wrapper.find('[data-test="recent-searches-load-old"]').trigger("click");
    expect(wrapper.emitted("restore")?.[2]?.slice(1)).toEqual(["original", false]);
  });

  it("stars, deletes and copies without restoring", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-star-today"]').trigger("click");
    await flushPromises();
    expect(api.star).toHaveBeenCalledWith("default", "today", true);
    await wrapper.find('[data-test="recent-searches-copy-query-old"]').trigger("click");
    expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(
      "query old",
      expect.any(Function),
      expect.any(Object),
    );
    await wrapper.find('[data-test="recent-searches-copy-link-today"]').trigger("click");
    const link = clipboard.copyToClipboard.mock.calls.at(-1)?.[0] as string;
    expect(link).toContain("/web/logs?");
    expect(link).toContain("from=1");
    expect(link).toContain("to=2");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await wrapper.find('[data-test="recent-searches-delete-old"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="recent-searches-drawer-row-old"]').exists()).toBe(false);
      expect(api.remove).not.toHaveBeenCalled();
      vi.advanceTimersByTime(6000);
      await flushPromises();
      expect(api.remove).toHaveBeenCalledWith("default", "old");
    } finally {
      vi.useRealTimers();
    }
    expect(wrapper.emitted("restore")).toBeUndefined();
  });

  it("keeps a row's VRL function: its own copy, a line under the query, and in the cut query's tooltip", async () => {
    const vrl = '.severity = if .status >= 500 {\n  "critical"\n} else { "info" }';
    api.list.mockResolvedValue({
      data: [
        row("fn", {
          query: "SELECT 1",
          context: { page: { stream: "k8s", functionContent: b64EncodeUnicode(vrl) ?? "" } },
        }),
        row("plain"),
      ],
    });
    const wrapper = mount(RecentSearchesDrawer, {
      props: { source: "logs", open: true },
      global: {
        plugins: [store],
        stubs: {
          ODrawer: { props: ["open"], template: `<div v-if="open"><slot /></div>` },
          ODialog: true,
          OTimeCell: true,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-copy-function-plain"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="recent-searches-drawer-function"]').text()).toContain(
      "Function (VRL): .severity",
    );

    const cell = wrapper.find('[data-test="recent-searches-drawer-query"]').element;
    Object.defineProperty(cell, "scrollWidth", { configurable: true, value: 1200 });
    Object.defineProperty(cell, "clientWidth", { configurable: true, value: 300 });
    vi.useFakeTimers();
    try {
      cell.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(700);
      await nextTick();
      await nextTick();
      const bubble = document.body.querySelector('[data-test="o-tooltip-content"]');
      expect(bubble?.textContent).toContain("SELECT 1");
      expect(bubble?.textContent).toContain(vrl);
    } finally {
      vi.useRealTimers();
      wrapper.unmount();
    }
  });

  it("copies the function from its own menu item and the query alone from Copy query", async () => {
    const vrl = ".a = 1\n.b = 2";
    api.list.mockResolvedValue({
      data: [
        row("fn", {
          query: "SELECT 1",
          context: { page: { stream: "k8s", functionContent: b64EncodeUnicode(vrl) ?? "" } },
        }),
      ],
    });
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-copy-function-fn"]').trigger("click");
    expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(vrl, expect.any(Function), {
      successMessage: "Function copied",
    });
    await wrapper.find('[data-test="recent-searches-copy-query-fn"]').trigger("click");
    expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith("SELECT 1", expect.any(Function), {
      successMessage: "Query copied",
    });
  });

  describe("delete with Undo", () => {
    const deleteToast = () => toastRecords.find((r) => r.message.startsWith("Deleted"));
    const rowShown = (wrapper: ReturnType<typeof mountDrawer>) =>
      wrapper.find('[data-test="recent-searches-drawer-row-old"]').exists();
    const deleteOld = async (wrapper: ReturnType<typeof mountDrawer>) => {
      await wrapper.find('[data-test="recent-searches-delete-old"]').trigger("click");
      await flushPromises();
    };

    beforeEach(() => {
      dismissAll();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
      dismissAll();
    });

    it("shows the row again when the server refuses the delete", async () => {
      api.remove.mockRejectedValueOnce(new Error("500"));
      const wrapper = mountDrawer();
      await flushPromises();
      await deleteOld(wrapper);
      expect(rowShown(wrapper)).toBe(false);
      vi.advanceTimersByTime(20000);
      await flushPromises();
      expect(api.remove).toHaveBeenCalledWith("default", "old");
      expect(rowShown(wrapper)).toBe(true);
    });

    it("brings the row back on Undo and never deletes it", async () => {
      const wrapper = mountDrawer();
      await flushPromises();
      await deleteOld(wrapper);
      expect(rowShown(wrapper)).toBe(false);
      expect(deleteToast()?.message).toBe("Deleted query old");

      deleteToast()?.action?.handler();
      await flushPromises();
      expect(rowShown(wrapper)).toBe(true);
      expect(deleteToast()?.open ?? false).toBe(false);
      vi.advanceTimersByTime(20000);
      await flushPromises();
      expect(api.remove).not.toHaveBeenCalled();
    });

    it("deletes only when the toast closes, so a paused toast keeps Undo working", async () => {
      const wrapper = mountDrawer();
      await flushPromises();
      await deleteOld(wrapper);
      const record = deleteToast();
      pauseTimer(record!.id);
      vi.advanceTimersByTime(20000);
      await flushPromises();
      expect(api.remove).not.toHaveBeenCalled();

      record?.action?.handler();
      await flushPromises();
      expect(rowShown(wrapper)).toBe(true);
      expect(api.remove).not.toHaveBeenCalled();
    });

    it("deletes once the toast times out, and Undo then does nothing", async () => {
      const wrapper = mountDrawer();
      await flushPromises();
      await deleteOld(wrapper);
      const action = deleteToast()?.action;
      vi.advanceTimersByTime(6000);
      await flushPromises();
      expect(api.remove).toHaveBeenCalledWith("default", "old");

      action?.handler();
      await flushPromises();
      expect(rowShown(wrapper)).toBe(false);
      expect(api.remove).toHaveBeenCalledTimes(1);
    });

    it("deletes in the org the delete started in, after a switch to another org", async () => {
      const org = store.state.selectedOrganization;
      const wrapper = mountDrawer();
      await flushPromises();
      await deleteOld(wrapper);
      store.state.selectedOrganization = { ...org, identifier: "other" };
      try {
        vi.advanceTimersByTime(6000);
        await flushPromises();
        expect(api.remove).toHaveBeenCalledWith("default", "old");
        expect(api.remove).not.toHaveBeenCalledWith("other", "old");
      } finally {
        store.state.selectedOrganization = org;
      }
    });

    it("keeps Undo working when the message starts with the lowercase query", async () => {
      const setMessage = (deletedQuery: string) =>
        i18n.global.mergeLocaleMessage("en-us", { recentSearches: { deletedQuery } });
      setMessage("{query} deleted");
      try {
        const wrapper = mountDrawer();
        await flushPromises();
        await deleteOld(wrapper);
        const record = toastRecords.find((r) => r.open);
        expect(record?.message).toBe("Query old deleted");
        record?.action?.handler();
        await flushPromises();
        expect(rowShown(wrapper)).toBe(true);
        vi.advanceTimersByTime(20000);
        await flushPromises();
        expect(api.remove).not.toHaveBeenCalled();
      } finally {
        setMessage("Deleted {query}");
      }
    });

    it("closes the toast before committing when the drawer goes away", async () => {
      const wrapper = mountDrawer();
      await flushPromises();
      await deleteOld(wrapper);
      const record = deleteToast();
      wrapper.unmount();
      await flushPromises();
      expect(api.remove).toHaveBeenCalledWith("default", "old");
      expect(record?.open).toBe(false);
    });
  });

  it("stars or unstars only the row clicked, by its own flag", async () => {
    api.list.mockResolvedValue({
      data: [
        row("today", { query: "same", streams: ["k8s"] }),
        row("other", { query: "same", streams: ["other"], starred: true }),
      ],
    });
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-star-today"]').attributes("aria-label")).toBe(
      "Star",
    );
    await wrapper.find('[data-test="recent-searches-star-today"]').trigger("click");
    await wrapper.find('[data-test="recent-searches-star-other"]').trigger("click");
    await flushPromises();
    expect(api.star.mock.calls).toEqual([
      ["default", "today", true],
      ["default", "other", false],
    ]);
  });

  it("says search or searches to match each count in the clear dialog", async () => {
    api.count.mockImplementation((_org: string, params: { starred: boolean }) =>
      Promise.resolve({ data: { count: params.starred ? 1 : 1 } }),
    );
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-clear-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-clear-body"]').text()).toContain(
      "your 1 recent Logs search in",
    );
    expect(
      wrapper.find('[data-test="recent-searches-clear-include-starred"]').attributes("label"),
    ).toBe("Also remove my 1 starred search");
  });

  it("clears this page and keeps starred by default, all pages and starred on request", async () => {
    api.count.mockImplementation((_org: string, params: { starred: boolean }) =>
      Promise.resolve({ data: { count: params.starred ? 3 : 1234 } }),
    );
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-clear-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-clear-body"]').text()).toContain(
      "your 1234 recent Logs searches",
    );
    expect(api.count).toHaveBeenCalledWith("default", { source: "logs", starred: false });
    expect(api.count).toHaveBeenCalledWith("default", { source: "logs", starred: true });
    expect(api.list).not.toHaveBeenCalledWith("default", expect.objectContaining({ limit: 200 }));
    await wrapper.find('[data-test="dialog-confirm"]').trigger("click");
    await flushPromises();
    expect(api.clear).toHaveBeenLastCalledWith("default", {
      source: "logs",
      include_starred: false,
    });

    await wrapper.find('[data-test="recent-searches-scope-all"]').trigger("click");
    await wrapper.find('[data-test="recent-searches-clear-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-clear-body"]').text()).toContain(
      "across Logs, Traces and Metrics",
    );
    await wrapper.find('[data-test="recent-searches-clear-include-starred"]').setValue(true);
    await wrapper.find('[data-test="dialog-confirm"]').trigger("click");
    await flushPromises();
    expect(api.clear).toHaveBeenLastCalledWith("default", {
      source: "logs,traces,metrics",
      include_starred: true,
    });
    expect(api.count).toHaveBeenCalledWith("default", {
      source: "logs,traces,metrics",
      starred: false,
    });
  });

  it("puts scope and retention in the info tooltip, from /config or kept until deleted", async () => {
    store.state.zoConfig.query_history_retention_days = 30;
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.text()).not.toContain("visible only to you");
    expect(wrapper.find('[data-test="recent-searches-retention"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="recent-searches-about"]').attributes("aria-label")).toContain(
      "Kept 30 days",
    );
    store.state.zoConfig.query_history_retention_days = 0;
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-about"]').attributes("aria-label")).toContain(
      "Kept until deleted",
    );
  });
});

describe("Starred chip", () => {
  const ROWS = [row("today"), row("starred", { starred: true }), row("other")];

  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockImplementation((_org: string, params: { starred?: boolean }) =>
      Promise.resolve({ data: params.starred ? ROWS.filter((r) => r.starred) : ROWS }),
    );
  });

  const mountWithRealChips = (source = "logs") =>
    mount(RecentSearchesDrawer, {
      props: { source, open: true },
      global: {
        plugins: [store],
        stubs: {
          ODrawer: {
            props: ["open"],
            template: `<div v-if="open"><slot /><slot name="footer" /></div>`,
          },
          ODialog: true,
          OTimeCell: true,
          OTooltip: true,
        },
      },
    });
  const shownRows = (wrapper: ReturnType<typeof mountWithRealChips>) =>
    wrapper.findAll('[data-test^="recent-searches-drawer-row-"]').length;
  const chip = (wrapper: ReturnType<typeof mountWithRealChips>, key: string) =>
    wrapper.find(`[data-test="recent-searches-status-${key}"]`);

  it("hides the No results chip for metrics but keeps it for logs and the all-pages scope", async () => {
    const metrics = mountWithRealChips("metrics");
    await flushPromises();
    expect(chip(metrics, "no_results").exists()).toBe(false);
    await metrics.find('[data-test="recent-searches-scope-all"]').trigger("click");
    expect(chip(metrics, "no_results").exists()).toBe(true);
    expect(
      mountWithRealChips("logs").find('[data-test="recent-searches-status-no_results"]').exists(),
    ).toBe(true);
  });

  it("treats a chosen No results as any once the scope narrows to metrics", async () => {
    const wrapper = mountWithRealChips("metrics");
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-scope-all"]').trigger("click");
    await chip(wrapper, "no_results").trigger("click");
    await wrapper.find('[data-test="recent-searches-scope-page"]').trigger("click");
    await flushPromises();
    expect(chip(wrapper, "any").attributes("aria-checked")).toBe("true");
    const metricsCalls = api.list.mock.calls.filter(([, p]) => p.source === "metrics");
    expect(metricsCalls.every(([, p]) => p.status === undefined)).toBe(true);
  });

  it("shows no total in the footer until the count query resolves", async () => {
    api.count.mockImplementation(() => new Promise(() => {}));
    const wrapper = mountWithRealChips();
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-showing"]').text()).toBe("Showing 3");
  });

  it("renders no footer text for the empty state or an error", async () => {
    api.list.mockResolvedValue({ data: [] });
    const empty = mountWithRealChips();
    await flushPromises();
    expect(empty.find('[data-test="recent-searches-showing"]').exists()).toBe(false);
    api.list.mockRejectedValue(new Error("boom"));
    const failed = mountWithRealChips();
    await flushPromises();
    expect(failed.find('[data-test="recent-searches-showing"]').exists()).toBe(false);
  });

  it("selects Starred, shows only starred rows, also after the drawer is closed and reopened", async () => {
    const wrapper = mountWithRealChips();
    await flushPromises();
    expect(shownRows(wrapper)).toBe(3);
    expect(chip(wrapper, "any").text()).toBe("Any status");
    expect(chip(wrapper, "starred").text()).toBe("Starred");
    expect(wrapper.find('[data-test="recent-searches-scope-page"]').text()).toBe("Logs");
    expect(chip(wrapper, "any").attributes("aria-checked")).toBe("true");
    expect(chip(wrapper, "starred").attributes("aria-pressed")).toBe("false");

    await chip(wrapper, "starred").trigger("click");
    await flushPromises();
    expect(chip(wrapper, "starred").attributes("aria-pressed")).toBe("true");
    expect(chip(wrapper, "any").attributes("aria-checked")).toBe("true");
    expect(api.list).toHaveBeenLastCalledWith(
      "default",
      expect.objectContaining({ starred: true }),
    );
    expect(shownRows(wrapper)).toBe(1);

    await wrapper.setProps({ open: false });
    (wrapper.vm as unknown as { show: () => void }).show();
    await flushPromises();
    expect(chip(wrapper, "starred").attributes("aria-pressed")).toBe("true");
    expect(shownRows(wrapper)).toBe(1);

    await chip(wrapper, "starred").trigger("click");
    await flushPromises();
    expect(chip(wrapper, "starred").attributes("aria-pressed")).toBe("false");
    expect(shownRows(wrapper)).toBe(3);
  });

  it("hides Reset all with no filter and clears search, scope, status and Starred when clicked", async () => {
    const wrapper = mountWithRealChips();
    await flushPromises();
    const reset = () => wrapper.find('[data-test="recent-searches-reset-filters"]');
    expect(reset().exists()).toBe(false);
    await chip(wrapper, "error").trigger("click");
    await chip(wrapper, "starred").trigger("click");
    await wrapper.find('[data-test="recent-searches-scope-all"]').trigger("click");
    await flushPromises();
    expect(reset().exists()).toBe(true);
    await reset().trigger("click");
    await flushPromises();
    expect(reset().exists()).toBe(false);
    expect(chip(wrapper, "any").attributes("aria-checked")).toBe("true");
    expect(chip(wrapper, "starred").attributes("aria-pressed")).toBe("false");
    expect(
      wrapper.find('[data-test="recent-searches-scope-page"]').attributes("aria-checked"),
    ).toBe("true");
    expect(shownRows(wrapper)).toBe(3);
  });

  it("combines Starred with a status chip and labels both groups", async () => {
    const wrapper = mountWithRealChips();
    await flushPromises();
    await chip(wrapper, "error").trigger("click");
    await chip(wrapper, "starred").trigger("click");
    await flushPromises();
    expect(api.list).toHaveBeenLastCalledWith(
      "default",
      expect.objectContaining({ status: "error", starred: true }),
    );
    expect(chip(wrapper, "error").attributes("aria-checked")).toBe("true");
    expect(chip(wrapper, "starred").attributes("aria-pressed")).toBe("true");
    const group = wrapper.find('[data-test="recent-searches-status"]');
    expect(group.attributes("role")).toBe("radiogroup");
    expect(group.attributes("aria-label")).toBe("Run status");
    expect(wrapper.find('[data-test="recent-searches-scope"]').attributes("aria-label")).toBe(
      "Search scope",
    );
  });

  describe("client-side status chips", () => {
    const PAGE = 50;
    const page = (prefix: string, noResults: boolean) =>
      Array.from({ length: PAGE }, (_, i) =>
        row(`${prefix}${i}`, noResults ? { context: { no_results: true } } : {}),
      );
    const footer = (wrapper: ReturnType<typeof mountWithRealChips>) =>
      wrapper.find('[data-test="recent-searches-showing"]').text();

    it("keeps fetching pages while the chip hides every loaded row", async () => {
      api.list.mockImplementation((_o: string, p: { offset: number }) =>
        Promise.resolve({ data: p.offset === 0 ? page("e", true) : page("s", false).slice(0, 3) }),
      );
      const wrapper = mountWithRealChips();
      await flushPromises();
      await chip(wrapper, "ok").trigger("click");
      await flushPromises();
      expect(api.list).toHaveBeenCalledTimes(3);
      expect(shownRows(wrapper)).toBe(3);
      expect(wrapper.find('[data-test="recent-searches-drawer-empty"]').exists()).toBe(false);
      expect(footer(wrapper)).toBe("Showing 3");
    });

    it("stops scanning at the page cap", async () => {
      api.list.mockImplementation(() => Promise.resolve({ data: page("e", true) }));
      const wrapper = mountWithRealChips();
      await flushPromises();
      await chip(wrapper, "ok").trigger("click");
      await flushPromises();
      expect(api.list).toHaveBeenCalledTimes(11);
      expect(wrapper.find('[data-test="recent-searches-drawer-empty"]').exists()).toBe(true);
    });

    it("counts a server-side filter with the same filters", async () => {
      api.count.mockImplementation((_o: string, p: { status?: string }) =>
        Promise.resolve({ data: { count: p.status === "error" ? 7 : 40 } }),
      );
      const wrapper = mountWithRealChips();
      await flushPromises();
      await chip(wrapper, "error").trigger("click");
      await flushPromises();
      expect(api.count).toHaveBeenCalledWith("default", { source: "logs", status: "error" });
      expect(footer(wrapper)).toBe("Showing 3 of 7");
    });
  });

  it("shows a cut query's full multi-line text on hover, line breaks and indentation kept", async () => {
    const query =
      "SELECT level,\n       count(*)\n  FROM k8s_logs\n  -- errors only\n WHERE level = 'error'";
    api.list.mockResolvedValue({ data: [row("long", { query })] });
    const wrapper = mount(RecentSearchesDrawer, {
      props: { source: "logs", open: true },
      global: {
        plugins: [store],
        stubs: {
          ODrawer: { props: ["open"], template: `<div v-if="open"><slot /></div>` },
          ODialog: true,
          OTimeCell: true,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    const cell = wrapper.find('[data-test="recent-searches-drawer-query"]').element;
    Object.defineProperty(cell, "scrollWidth", { configurable: true, value: 1200 });
    Object.defineProperty(cell, "clientWidth", { configurable: true, value: 300 });
    vi.useFakeTimers();
    try {
      cell.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(700);
      await nextTick();
      await nextTick();
      const bubble = document.body.querySelector('[data-test="o-tooltip-content"]');
      expect(bubble?.textContent).toContain(query);
      expect(bubble?.className).toContain("whitespace-pre-wrap");
      expect(bubble?.className).toContain("font-mono");
    } finally {
      vi.useRealTimers();
      wrapper.unmount();
    }
  });

  it("shows a failed row's whole error on hover only when the line is cut", async () => {
    const message = `Search field not found: ${"x".repeat(300)}`;
    api.list.mockResolvedValue({
      data: [row("bad", { status: "error", context: { error: message } })],
    });
    const wrapper = mount(RecentSearchesDrawer, {
      props: { source: "logs", open: true },
      global: {
        plugins: [store],
        stubs: {
          ODrawer: { props: ["open"], template: `<div v-if="open"><slot /></div>` },
          ODialog: true,
          OTimeCell: true,
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    const line = wrapper.find('[data-test="recent-searches-drawer-error"]').element;
    const hover = async () => {
      line.dispatchEvent(new MouseEvent("mouseleave"));
      await nextTick();
      line.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(700);
      await nextTick();
      await nextTick();
    };
    const bubble = () => document.body.querySelector('[data-test="o-tooltip-content"]');
    const setWidths = (scrollWidth: number, clientWidth: number) => {
      Object.defineProperty(line, "scrollWidth", { configurable: true, value: scrollWidth });
      Object.defineProperty(line, "clientWidth", { configurable: true, value: clientWidth });
    };
    vi.useFakeTimers();
    try {
      setWidths(300, 300);
      await hover();
      expect(bubble()).toBeNull();
      setWidths(1200, 300);
      await hover();
      expect(bubble()?.textContent).toContain(message);
    } finally {
      vi.useRealTimers();
      wrapper.unmount();
    }
  });
});
