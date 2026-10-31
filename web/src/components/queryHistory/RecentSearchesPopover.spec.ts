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
  count: vi.fn(),
  record: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: api }));
const clipboard = vi.hoisted(() => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock("@/utils/clipboard", () => clipboard);

import RecentSearchesPopover from "./RecentSearchesPopover.vue";
import RecentSearchesButton from "./RecentSearchesButton.vue";
import RecentSearchesFocusDropdown from "./RecentSearchesFocusDropdown.vue";
import { placeCaret } from "@/test/unit/helpers/monacoCaret";
import {
  routeEditorKeyToRecents,
  type RecentsKeyTarget,
} from "@/utils/queryHistory/recentSearches";

enableAutoUnmount(afterEach);

const NOW_US = Date.now() * 1000;

const setWidths = (el: Element, scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
};
const HOUR_US = 3_600_000_000;

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
};

// The focus dropdown opens at Monaco's caret element, so every editor box here carries one.
const editorBox = () => {
  const box = document.createElement("div");
  const monaco = document.createElement("div");
  monaco.className = "monaco-editor";
  const layer = document.createElement("div");
  layer.className = "cursors-layer";
  const cursor = document.createElement("div");
  cursor.className = "cursor";
  placeCaret(cursor);
  layer.appendChild(cursor);
  monaco.appendChild(layer);
  box.appendChild(monaco);
  document.body.appendChild(box);
  return { box, monaco };
};

const row = (i: number, overrides: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry => ({
  id: `e${i}`,
  source: "logs",
  query: `q${i}`,
  query_key: "k",
  streams: ["k8s"],
  context: {},
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: NOW_US - i * HOUR_US,
  updated_at: NOW_US - i * HOUR_US,
  ...overrides,
});

const mountPopover = (props: Record<string, unknown> = {}) =>
  mount(RecentSearchesPopover, {
    props: { source: "logs", active: true, ...props },
    global: { plugins: [store], stubs: { OTimeCell: true, OTooltip: true } },
  });

const rowIds = (wrapper: ReturnType<typeof mountPopover>) =>
  wrapper
    .findAll('[data-test^="recent-searches-row-"]')
    .map((r) => r.attributes("data-test")?.replace("recent-searches-row-", ""));

describe("RecentSearchesPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.count.mockResolvedValue({ data: { count: 0 } });
    store.state.zoConfig.query_history_enabled = true;
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
  });

  it("asks for this page's recents and shows 8 rows", async () => {
    api.list.mockResolvedValue({ data: Array.from({ length: 12 }, (_, i) => row(i)) });
    const wrapper = mountPopover();
    await flushPromises();
    expect(api.list).toHaveBeenCalledWith("default", { source: "logs", status: "ok", limit: 8 });
    expect(rowIds(wrapper)).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
  });

  it("downloads only the 8 successful rows and the newest run, and counts failures on the server", async () => {
    api.list.mockImplementation((_org: string, params: { status?: string; limit: number }) =>
      Promise.resolve({
        data: params.status
          ? Array.from({ length: params.limit }, (_, i) => row(i + 1))
          : [row(0, { status: "error" })],
      }),
    );
    api.count.mockResolvedValue({ data: { count: 4 } });
    const wrapper = mountPopover();
    await flushPromises();
    expect(api.list.mock.calls.map(([, params]) => params)).toEqual([
      { source: "logs", status: "ok", limit: 8 },
      { source: "logs", limit: 1 },
    ]);
    expect(api.count).toHaveBeenCalledWith("default", { source: "logs", status: "error" });
    expect(wrapper.find('[data-test="recent-searches-pinned-failure"]').text()).toContain("q0");
    expect(rowIds(wrapper)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    expect(wrapper.find('[data-test="recent-searches-view-failed"]').text()).toBe("3 failed");
  });

  it("fetches nothing while inactive", async () => {
    mountPopover({ active: false });
    await flushPromises();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.count).not.toHaveBeenCalled();
  });

  it("pins the latest failure with its error and Load to fix, and counts older failures", async () => {
    api.list.mockResolvedValue({
      data: [
        row(0, { status: "error", context: { error: "syntax error near level" } }),
        row(1),
        row(2, { status: "error" }),
      ],
    });
    api.count.mockResolvedValue({ data: { count: 2 } });
    const wrapper = mountPopover();
    await flushPromises();
    const pinned = wrapper.find('[data-test="recent-searches-pinned-failure"]');
    expect(pinned.text()).toContain("q0");
    expect(pinned.text()).toContain("syntax error near level");
    expect(rowIds(wrapper)).toEqual(["e1"]);

    await wrapper.find('[data-test="recent-searches-load-to-fix"]').trigger("click");
    expect(wrapper.emitted("load")?.[0]?.[0]).toMatchObject({ id: "e0" });

    await wrapper.find('[data-test="recent-searches-view-failed"]').trigger("click");
    expect(wrapper.emitted("view-all")?.[0]).toEqual(["error"]);
  });

  it("keeps the key hint and the privacy/retention note behind the header info icon", async () => {
    api.list.mockResolvedValue({ data: [row(0)] });
    store.state.zoConfig.query_history_retention_days = 14;
    const wrapper = mountPopover();
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-key-hints"]').exists()).toBe(false);
    const about = wrapper.find('[data-test="recent-searches-about"]').attributes("aria-label")!;
    expect(about).toContain("Shift+Enter load only");
    expect(about).toContain("Enter run");
    expect(about).not.toMatch(/[⇧⇥]|Tab/);
    expect(about).toContain("Only your searches in default, visible only to you");
    expect(about).toContain("Kept 14 days");
    expect(wrapper.text()).not.toContain("visible only to you");
    expect(wrapper.find('[data-test="recent-searches-view-all"]').exists()).toBe(true);
    delete store.state.zoConfig.query_history_retention_days;
  });

  it.each([
    [1, "Kept 1 day;"],
    [7, "Kept 7 days;"],
    [0, "Kept until deleted."],
    [-1, "Kept until deleted."],
  ])("states a retention of %s as %s", async (days, text) => {
    api.list.mockResolvedValue({ data: [row(0)] });
    store.state.zoConfig.query_history_retention_days = days;
    const wrapper = mountPopover();
    await flushPromises();
    const about = wrapper.find('[data-test="recent-searches-about"]').attributes("aria-label")!;
    expect(about).toContain(text);
    expect(about).not.toMatch(/\b1 days\b|\b0 days\b/);
    delete store.state.zoConfig.query_history_retention_days;
  });

  it("shows the hint and the note in the tooltip on hover", async () => {
    api.list.mockResolvedValue({ data: [row(0)] });
    const wrapper = mount(RecentSearchesPopover, {
      props: { source: "logs", active: true },
      global: { plugins: [store], stubs: { OTimeCell: true } },
      attachTo: document.body,
    });
    await flushPromises();
    vi.useFakeTimers();
    const info = wrapper.find('[data-test="recent-searches-about"]').element;
    [info, ...info.querySelectorAll("*")].forEach((el) =>
      el.dispatchEvent(new MouseEvent("mouseenter")),
    );
    vi.advanceTimersByTime(700);
    await nextTick();
    await nextTick();
    const bubble = document.body.querySelector('[data-test="o-tooltip-content"]');
    expect(bubble?.textContent).toContain("Esc close");
    expect(bubble?.textContent).toContain("visible only to you");
    vi.useRealTimers();
    wrapper.unmount();
  });

  describe("the pinned failure's error line", () => {
    const message = `Search field not found: Valid fields are ${"f, ".repeat(80)}`;
    const mountWithRealTooltip = async () => {
      api.list.mockResolvedValue({
        data: [row(0, { status: "error", context: { error: message } })],
      });
      const wrapper = mount(RecentSearchesPopover, {
        props: { source: "logs", active: true },
        global: { plugins: [store], stubs: { OTimeCell: true } },
        attachTo: document.body,
      });
      await flushPromises();
      return wrapper.find('[data-test="recent-searches-pinned-error"]').element as HTMLElement;
    };
    const hover = async (el: HTMLElement) => {
      el.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(700);
      await nextTick();
      await nextTick();
    };
    const bubble = () => document.body.querySelector('[data-test="o-tooltip-content"]');

    afterEach(() => vi.useRealTimers());

    it("shows the whole message on hover when the line is cut", async () => {
      const line = await mountWithRealTooltip();
      vi.useFakeTimers();
      setWidths(line, 900, 300);
      await hover(line);
      expect(bubble()?.textContent).toContain(message.trim());
    });

    it("shows no tooltip when the message fits", async () => {
      const line = await mountWithRealTooltip();
      vi.useFakeTimers();
      setWidths(line, 300, 300);
      await hover(line);
      expect(bubble()).toBeNull();
    });
  });

  it("runs on click and only loads on shift-click", async () => {
    api.list.mockResolvedValue({ data: [row(0)] });
    const wrapper = mountPopover();
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-row-e0"]').trigger("click");
    expect(wrapper.emitted("run")?.[0]).toEqual([expect.objectContaining({ id: "e0" }), "now"]);
    await wrapper.find('[data-test="recent-searches-row-e0"]').trigger("click", { shiftKey: true });
    expect(wrapper.emitted("load")?.[0]?.[0]).toMatchObject({ id: "e0" });
  });

  it("runs on Enter, loads on Shift+Enter, and leaves Ctrl/Cmd+Enter to the page's run shortcut", async () => {
    api.list.mockResolvedValue({ data: [row(0)] });
    const wrapper = mountPopover();
    await flushPromises();
    const rowBtn = wrapper.find('[data-test="recent-searches-row-e0"]');
    await rowBtn.trigger("keydown", { key: "Enter", ctrlKey: true });
    await rowBtn.trigger("keydown", { key: "Enter", metaKey: true });
    expect(wrapper.emitted("run")).toBeUndefined();
    expect(wrapper.emitted("load")).toBeUndefined();
    await rowBtn.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("run")).toHaveLength(1);
    await rowBtn.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(wrapper.emitted("load")).toHaveLength(1);
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it("re-runs a row from an earlier day at its original time", async () => {
    api.list.mockResolvedValue({ data: [row(0, { updated_at: NOW_US - 72 * HOUR_US })] });
    const wrapper = mountPopover();
    await flushPromises();
    await wrapper.find('[data-test="recent-searches-row-e0"]').trigger("click");
    expect(wrapper.emitted("run")?.[0]?.[1]).toBe("original");
  });

  it("shows the first-time empty state with examples", async () => {
    api.list.mockResolvedValue({ data: [] });
    const wrapper = mountPopover({ examples: ["match_all('error')", "match_all('timeout')"] });
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-empty"]').exists()).toBe(true);
    await wrapper.find('[data-test="recent-searches-example-1"]').trigger("click");
    expect(wrapper.emitted("example")?.[0]).toEqual(["match_all('timeout')"]);
  });

  it("offers a retry when the list fails to load", async () => {
    api.list.mockRejectedValueOnce(new Error("down")).mockResolvedValue({ data: [row(0)] });
    const wrapper = mountPopover();
    await flushPromises();
    expect(wrapper.find('[data-test="recent-searches-error"]').exists()).toBe(true);
  });
});

describe("the editor's suggest widget look", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.query_history_enabled = true;
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
  });

  it("renders rows at the suggest widget's height with an icon, a monospace one-line query and the time at the end", async () => {
    api.list.mockResolvedValue({
      data: [row(0, { query: "SELECT *\n  FROM k8s" }), row(1, { starred: true })],
    });
    const wrapper = mountPopover();
    await flushPromises();
    const first = wrapper.find('[data-test="recent-searches-row-e0"]');
    expect(first.classes()).toEqual(expect.arrayContaining(["h-6", "flex", "items-center"]));
    const parts = first.element.children;
    expect(parts[0].className).toContain("size-4");
    expect(parts[0].children).toHaveLength(1);
    expect(parts[1].className).toContain("font-mono");
    expect(parts[1].textContent?.trim()).toBe("SELECT * FROM k8s");
    expect(parts[parts.length - 1].tagName.toLowerCase()).toBe("o-time-cell-stub");
    expect(parts[parts.length - 1].getAttribute("mode")).toBe("relative");
    expect(wrapper.find('[data-test="recent-searches-list"]').classes()).toEqual(
      expect.arrayContaining(["max-h-72", "overflow-auto"]),
    );
  });
});

describe("the details pane for the active row", () => {
  const QUERY = [
    "SELECT kubernetes_namespace_name,",
    "       count(*) AS hits",
    '  FROM "k8s_logs"',
    "  -- only errors",
    " WHERE level = 'error'",
    " GROUP BY 1",
  ].join("\n");
  const details = () =>
    document.querySelector<HTMLElement>('[data-test="recent-searches-details"]');
  const detailsQuery = () =>
    document.querySelector<HTMLElement>('[data-test="recent-searches-details-query"]');
  const rowEl = (id: string) =>
    document.querySelector<HTMLElement>(`[data-test="recent-searches-row-${id}"]`)!;
  const hover = async (id: string) => {
    rowEl(id).dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
  };
  const press = (target: Element, key: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.query_history_enabled = true;
    setViewport(1440, 900);
    api.list.mockResolvedValue({
      data: [
        row(0, {
          query: QUERY,
          streams: ["k8s_logs"],
          run_count: 3,
          context: { time: { type: "relative", period: "1h", start_time: 0, end_time: 0 } },
        }),
        row(1, { query: "level = 'warn'\n  AND code = 500" }),
      ],
    });
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
    setViewport(1024, 768);
    document.body.innerHTML = "";
  });

  const mountAttached = async () => {
    const wrapper = mount(RecentSearchesPopover, {
      props: { source: "logs", active: true },
      global: { plugins: [store], stubs: { OTimeCell: true, OTooltip: true } },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  it("renders nothing until a row is hovered or focused", async () => {
    await mountAttached();
    expect(details()).toBeNull();
  });

  it("shows the hovered row's full query exactly as stored, with its line breaks and comments", async () => {
    await mountAttached();
    await hover("e0");
    expect(detailsQuery()!.tagName.toLowerCase()).toBe("pre");
    expect(detailsQuery()!.textContent).toBe(QUERY);
    expect(detailsQuery()!.className).toEqual(expect.stringContaining("whitespace-pre"));
    expect(detailsQuery()!.className).toEqual(expect.stringContaining("font-mono"));
    expect(detailsQuery()!.className).toEqual(expect.stringContaining("overflow-auto"));
    const meta = document.querySelector('[data-test="recent-searches-details-meta"]')!.textContent;
    expect(meta).toContain("k8s_logs");
    expect(meta).toContain("Last 1h");
    expect(meta).toContain("ran 3x");
    expect(document.querySelectorAll('[data-test="recent-searches-details"]')).toHaveLength(1);
  });

  it("wraps long lines inside the query's own scroll, with the meta and error in an opaque footer outside it", async () => {
    const longLine = `GROUP BY ${"k8s_namespace_name, k8s_pod_name, level, status, ".repeat(4)}`;
    api.list.mockResolvedValue({
      data: [
        row(0, {
          status: "error",
          query: `SELECT *\n  FROM k8s_logs\n${longLine}\nORDER BY 1`,
          context: { error: "Search field not found" },
        }),
      ],
    });
    await mountAttached();
    document
      .querySelector('[data-test="recent-searches-pinned-failure"]')!
      .dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
    const pane = details()!;
    const query = detailsQuery()!;
    const footer = document.querySelector<HTMLElement>(
      '[data-test="recent-searches-details-footer"]',
    )!;
    expect(query.className.split(" ")).toEqual(
      expect.arrayContaining([
        "whitespace-pre-wrap",
        "wrap-anywhere",
        "overflow-auto",
        "min-h-0",
        "flex-1",
      ]),
    );
    expect(query.className.split(" ")).not.toContain("whitespace-pre");
    expect(query.textContent).toBe(`SELECT *\n  FROM k8s_logs\n${longLine}\nORDER BY 1`);
    expect(pane.className.split(" ")).toEqual(
      expect.arrayContaining(["flex-col", "overflow-hidden"]),
    );
    expect(pane.children).toHaveLength(2);
    expect(pane.children[0].contains(query)).toBe(true);
    expect(pane.children[1]).toBe(footer);
    expect(query.contains(footer)).toBe(false);
    expect(footer.className.split(" ")).toEqual(
      expect.arrayContaining(["shrink-0", "bg-select-content-bg", "border-t"]),
    );
    expect(footer.querySelector('[data-test="recent-searches-details-meta"]')).not.toBeNull();
    expect(footer.querySelector('[data-test="recent-searches-details-error"]')).not.toBeNull();
  });

  it("shows a failed row's status and error message", async () => {
    api.list.mockResolvedValue({
      data: [row(0, { status: "error", query: "level =\n", context: { error: "syntax error" } })],
    });
    await mountAttached();
    document
      .querySelector('[data-test="recent-searches-pinned-failure"]')!
      .dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
    expect(detailsQuery()!.textContent).toBe("level =\n");
    expect(
      document.querySelector('[data-test="recent-searches-details-meta"]')!.textContent,
    ).toContain("Failed");
    expect(
      document.querySelector('[data-test="recent-searches-details-error"]')!.textContent?.trim(),
    ).toBe("syntax error");
  });

  it("follows the keyboard-active row on ArrowDown and ArrowUp", async () => {
    const wrapper = await mountAttached();
    (wrapper.vm as unknown as { focusFirst: () => boolean }).focusFirst();
    await flushPromises();
    expect(detailsQuery()!.textContent).toBe(QUERY);

    press(document.activeElement!, "ArrowDown");
    await flushPromises();
    expect(document.activeElement).toBe(rowEl("e1"));
    expect(detailsQuery()!.textContent).toBe("level = 'warn'\n  AND code = 500");

    press(document.activeElement!, "ArrowUp");
    await flushPromises();
    expect(detailsQuery()!.textContent).toBe(QUERY);
  });

  describe("hover across the gap to the pane", () => {
    afterEach(() => vi.useRealTimers());
    const list = () => document.querySelector('[data-test="recent-searches-list"]')!;
    const leave = (from: Element, to: Element | null) =>
      from.dispatchEvent(new PointerEvent("pointerleave", { relatedTarget: to }));

    it("keeps the pane while the pointer crosses the gap and enters it", async () => {
      await mountAttached();
      await hover("e0");
      vi.useFakeTimers();
      leave(list(), document.body);
      vi.advanceTimersByTime(80);
      details()!.dispatchEvent(new PointerEvent("pointerenter"));
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(detailsQuery()!.textContent).toBe(QUERY);
    });

    it("keeps the pane when the pointer goes straight from the list into it", async () => {
      await mountAttached();
      await hover("e0");
      vi.useFakeTimers();
      leave(list(), details());
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(details()).not.toBeNull();
    });

    it("drops the pane shortly after the pointer leaves both for elsewhere", async () => {
      await mountAttached();
      await hover("e0");
      vi.useFakeTimers();
      leave(list(), document.body);
      vi.advanceTimersByTime(80);
      await nextTick();
      expect(details()).not.toBeNull();
      vi.advanceTimersByTime(200);
      await nextTick();
      expect(details()).toBeNull();
    });

    it("drops the pane after the pointer leaves it for elsewhere", async () => {
      await mountAttached();
      await hover("e0");
      vi.useFakeTimers();
      details()!.dispatchEvent(new PointerEvent("pointerenter"));
      leave(details()!, document.body);
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(details()).toBeNull();
    });
  });

  describe("placement beside the list", () => {
    const placeRoot = async (box: { left: number; top: number; right: number; bottom: number }) => {
      await mountAttached();
      const root = document.querySelector<HTMLElement>('[data-test="recent-searches-popover"]')!;
      root.getBoundingClientRect = () =>
        ({
          ...box,
          x: box.left,
          y: box.top,
          width: box.right - box.left,
          height: box.bottom - box.top,
        }) as DOMRect;
      await hover("e0");
      const style = details()!.style;
      return {
        left: parseFloat(style.left),
        top: parseFloat(style.top),
        width: parseFloat(style.width),
        maxHeight: parseFloat(style.maxHeight),
      };
    };

    it("docks to the right of the list, top-aligned, with its own capped height", async () => {
      const at = await placeRoot({ left: 113, top: 110, right: 543, bottom: 400 });
      expect(at).toEqual({ left: 547, top: 110, width: 400, maxHeight: 320 });
    });

    it("flips to the left when there is no room on the right", async () => {
      const at = await placeRoot({ left: 900, top: 110, right: 1330, bottom: 400 });
      expect(at.left).toBe(900 - 4 - 400);
      expect(at.top).toBe(110);
    });

    it.each([
      ["a tall pane rises just enough to stay on-screen", 320, 900 - 8 - 320],
      ["a short pane that fits stays level with the list", 73, 668],
    ])("beside a list low on the screen, %s", async (_case, height, top) => {
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
      try {
        const at = await placeRoot({ left: 461, top: 668, right: 891, bottom: 794 });
        expect(at.left).toBe(895);
        expect(at.top).toBe(top);
        expect(at.maxHeight).toBe(320);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("drops below the list when neither side has room, and caps its height to the viewport", async () => {
      setViewport(800, 700);
      const at = await placeRoot({ left: 200, top: 110, right: 630, bottom: 400 });
      expect(at.left).toBe(200);
      expect(at.top).toBe(404);
      expect(at.maxHeight).toBe(700 - 404 - 8);
    });
  });
});

describe("long queries in the details pane", () => {
  const LONG = Array.from({ length: 40 }, (_, i) =>
    i === 0 ? "SELECT" : i === 39 ? "LIMIT 100" : `  col_${i},`,
  ).join("\n");
  const details = () =>
    document.querySelector<HTMLElement>('[data-test="recent-searches-details"]');
  const query = () =>
    document.querySelector<HTMLElement>('[data-test="recent-searches-details-query"]')!;
  const rowEl = (id: string) =>
    document.querySelector<HTMLElement>(`[data-test="recent-searches-row-${id}"]`)!;
  const hover = async (id: string) => {
    rowEl(id).dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
  };
  const key = (target: Element, name: string) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const setScroll = (el: HTMLElement, clientHeight: number, scrollHeight: number) => {
    Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  };
  const placeRoot = (box: { left: number; top: number; right: number; bottom: number }) => {
    const root = document.querySelector<HTMLElement>('[data-test="recent-searches-popover"]')!;
    root.getBoundingClientRect = () =>
      ({
        ...box,
        x: box.left,
        y: box.top,
        width: box.right - box.left,
        height: box.bottom - box.top,
      }) as DOMRect;
  };
  const mountAttached = async () => {
    const wrapper = mount(RecentSearchesPopover, {
      props: { source: "logs", active: true },
      global: { plugins: [store], stubs: { OTimeCell: true, OTooltip: true } },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.query_history_enabled = true;
    setViewport(1440, 900);
    api.list.mockResolvedValue({
      data: [row(0, { query: LONG }), row(1, { query: "level='error'" })],
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete store.state.zoConfig.query_history_enabled;
    setViewport(1024, 768);
    document.body.innerHTML = "";
  });

  it("shows the query's line count in the footer, singular for one line", async () => {
    await mountAttached();
    await hover("e0");
    const lines = () =>
      document.querySelector('[data-test="recent-searches-details-lines"]')!.textContent?.trim();
    expect(lines()).toBe("40 lines");
    await hover("e1");
    expect(lines()).toBe("1 line");
  });

  it("fades the query's bottom edge only while more of it is below", async () => {
    await mountAttached();
    await hover("e0");
    const fade = () => document.querySelector('[data-test="recent-searches-details-fade"]');
    setScroll(query(), 280, 640);
    query().dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(fade()).not.toBeNull();
    query().scrollTop = 360;
    query().dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(fade()).toBeNull();
  });

  it("copies the full query with the drawer's copy and toast", async () => {
    await mountAttached();
    await hover("e0");
    const copy = document.querySelector<HTMLElement>('[data-test="recent-searches-details-copy"]')!;
    expect(copy.getAttribute("aria-label")).toBe("Copy query");
    copy.click();
    expect(clipboard.copyToClipboard).toHaveBeenCalledWith(LONG, expect.any(Function), {
      successMessage: "Query copied",
    });
  });

  it("pages the query with PageDown and PageUp on the active row, while the arrows keep moving rows", async () => {
    const wrapper = await mountAttached();
    (wrapper.vm as unknown as { focusFirst: () => boolean }).focusFirst();
    await flushPromises();
    setScroll(query(), 280, 640);
    const down = key(document.activeElement!, "PageDown");
    expect(down.defaultPrevented).toBe(true);
    expect(query().scrollTop).toBe(264);
    key(document.activeElement!, "PageUp");
    expect(query().scrollTop).toBe(0);
    expect(document.activeElement).toBe(rowEl("e0"));
    key(document.activeElement!, "ArrowDown");
    await flushPromises();
    expect(document.activeElement).toBe(rowEl("e1"));
    expect(query().textContent).toBe("level='error'");
  });

  describe("a keyboard-selected row's pane, reached without hovering the row", () => {
    const copyButton = () =>
      document.querySelector<HTMLElement>('[data-test="recent-searches-details-copy"]')!;
    const focusFirstRow = async (wrapper: Awaited<ReturnType<typeof mountAttached>>) => {
      (wrapper.vm as unknown as { focusFirst: () => boolean }).focusFirst();
      await flushPromises();
      expect(document.activeElement).toBe(rowEl("e0"));
    };

    it("stays while Tab moves focus to Copy, and Copy then works from the keyboard", async () => {
      const wrapper = await mountAttached();
      await focusFirstRow(wrapper);
      const tab = key(rowEl("e0"), "Tab");
      await flushPromises();
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(copyButton());
      expect(query().textContent).toBe(LONG);
      copyButton().click();
      expect(clipboard.copyToClipboard).toHaveBeenCalledWith(LONG, expect.any(Function), {
        successMessage: "Query copied",
      });
      expect(details()).not.toBeNull();
    });

    it("stays when focus moves straight to Copy, as a click on it does", async () => {
      const wrapper = await mountAttached();
      await focusFirstRow(wrapper);
      copyButton().focus();
      await flushPromises();
      expect(document.activeElement).toBe(copyButton());
      expect(query().textContent).toBe(LONG);
    });

    it("stays when the pointer enters the pane and the click takes focus nowhere", async () => {
      const wrapper = await mountAttached();
      await focusFirstRow(wrapper);
      details()!.dispatchEvent(new PointerEvent("pointerenter"));
      rowEl("e0").blur();
      await flushPromises();
      expect(query().textContent).toBe(LONG);
      copyButton().click();
      expect(clipboard.copyToClipboard).toHaveBeenCalledWith(LONG, expect.any(Function), {
        successMessage: "Query copied",
      });
    });

    it("goes back to the row on Shift+Tab from Copy, and closes the list on Escape", async () => {
      const wrapper = await mountAttached();
      await focusFirstRow(wrapper);
      key(rowEl("e0"), "Tab");
      await flushPromises();
      const back = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      copyButton().dispatchEvent(back);
      await flushPromises();
      expect(back.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(rowEl("e0"));
      key(rowEl("e0"), "Tab");
      await flushPromises();
      key(copyButton(), "Escape");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("goes away once focus leaves the pane for elsewhere with the pointer outside it", async () => {
      const wrapper = await mountAttached();
      await focusFirstRow(wrapper);
      key(rowEl("e0"), "Tab");
      await flushPromises();
      const elsewhere = document.createElement("button");
      document.body.appendChild(elsewhere);
      elsewhere.focus();
      await flushPromises();
      expect(details()).toBeNull();
    });

    it("leaves Tab alone when focus is not on a row", async () => {
      await mountAttached();
      const viewAll = document.querySelector<HTMLElement>(
        '[data-test="recent-searches-view-all"]',
      )!;
      const tab = key(viewAll, "Tab");
      expect(tab.defaultPrevented).toBe(false);
    });
  });

  it("shows a row's VRL function in its own block under the query, with its own copy", async () => {
    const vrl = '.severity = if .status >= 500 {\n  "critical"\n} else {\n  "info"\n}';
    api.list.mockResolvedValue({
      data: [
        row(0, {
          query: "SELECT 1",
          context: { page: { stream: "k8s", functionContent: b64EncodeUnicode(vrl) ?? "" } },
        }),
        row(1),
      ],
    });
    await mountAttached();
    await hover("e0");
    const block = document.querySelector('[data-test="recent-searches-details-function"]')!;
    expect(query().contains(block)).toBe(false);
    const text = block.querySelector('[data-test="recent-searches-details-function-text"]')!;
    expect(text.textContent).toBe(vrl);
    expect(text.className.split(" ")).toEqual(
      expect.arrayContaining([
        "whitespace-pre-wrap",
        "wrap-anywhere",
        "font-mono",
        "overflow-auto",
      ]),
    );
    block
      .querySelector<HTMLElement>('[data-test="recent-searches-details-copy-function"]')!
      .click();
    expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(vrl, expect.any(Function), {
      successMessage: "Function copied",
    });
    document.querySelector<HTMLElement>('[data-test="recent-searches-details-copy"]')!.click();
    expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith("SELECT 1", expect.any(Function), {
      successMessage: "Query copied",
    });

    await hover("e1");
    expect(document.querySelector('[data-test="recent-searches-details-function"]')).toBeNull();
  });

  it("leaves PageDown to its owner when no row is active", async () => {
    const wrapper = await mountAttached();
    const vm = wrapper.vm as unknown as {
      handleOutsideKey: (event: KeyboardEvent) => boolean;
      scrollDetails: (step: 1 | -1) => boolean;
    };
    const event = new KeyboardEvent("keydown", { key: "PageDown", cancelable: true });
    expect(vm.handleOutsideKey(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(vm.scrollDetails(1)).toBe(false);
  });

  it("widens to 560px for a query over 18 lines when the viewport has room, and stays 400px for short ones", async () => {
    await mountAttached();
    placeRoot({ left: 113, top: 110, right: 543, bottom: 400 });
    await hover("e0");
    expect(details()!.style.width).toBe("560px");
    expect(details()!.style.maxHeight).toBe("320px");
    await hover("e1");
    expect(details()!.style.width).toBe("400px");
  });

  it("widens only into the room the viewport has, keeping the pane on-screen", async () => {
    setViewport(1100, 900);
    await mountAttached();
    placeRoot({ left: 113, top: 110, right: 543, bottom: 400 });
    await hover("e0");
    expect(details()!.style.left).toBe("547px");
    expect(details()!.style.width).toBe(`${1100 - 8 - 547}px`);
  });

  it("follows the list when it moves while the same row stays active", async () => {
    const holder = document.createElement("div");
    document.body.appendChild(holder);
    const wrapper = mount(RecentSearchesPopover, {
      props: { source: "logs", active: true },
      global: { plugins: [store], stubs: { OTimeCell: true, OTooltip: true } },
      attachTo: holder,
    });
    await flushPromises();
    placeRoot({ left: 113, top: 110, right: 543, bottom: 400 });
    (wrapper.vm as unknown as { focusFirst: () => boolean }).focusFirst();
    await flushPromises();
    expect(details()!.style.top).toBe("110px");
    placeRoot({ left: 420, top: 146, right: 850, bottom: 436 });
    holder.style.top = "36px";
    await flushPromises();
    expect(details()!.style.left).toBe("854px");
    expect(details()!.style.top).toBe("146px");
    expect(query().textContent).toBe(LONG);
  });
});

describe("when history is disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.query_history_enabled = false;
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
  });

  it("hides the clock button", () => {
    const wrapper = mount(RecentSearchesButton, {
      props: { source: "logs" },
      global: { plugins: [store] },
    });
    expect(wrapper.find('[data-test="recent-searches-btn"]').exists()).toBe(false);
  });

  it("never opens the focus dropdown and never fetches", async () => {
    const wrapper = mount(RecentSearchesFocusDropdown, {
      props: { source: "logs", anchor: null, open: true },
      global: { plugins: [store] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(document.querySelector('[data-test="recent-searches-focus-dropdown"]')).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("keyboard: arrows then Enter or Shift+Enter", () => {
  const press = (target: Element, key: string, shiftKey = false) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  const activeTest = () => document.activeElement?.getAttribute("data-test");

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.query_history_enabled = true;
    api.list.mockResolvedValue({ data: [row(0), row(1)] });
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
  });

  const openFromButton = async () => {
    const wrapper = mount(RecentSearchesButton, {
      props: { source: "logs" },
      global: { plugins: [store], stubs: { OTimeCell: true } },
      attachTo: document.body,
    });
    const trigger = wrapper.find('[data-test="recent-searches-btn"]');
    await trigger.trigger("click");
    await flushPromises();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="recent-searches-row-e1"]')).not.toBeNull(),
    );
    return { wrapper, trigger: trigger.element as HTMLElement };
  };

  it("loads the row Shift+Enter is pressed on, even when focus was left on the clock button", async () => {
    const { wrapper, trigger } = await openFromButton();
    trigger.focus();
    press(trigger, "ArrowDown");
    press(document.activeElement!, "ArrowDown");
    expect(activeTest()).toBe("recent-searches-row-e1");

    press(document.activeElement!, "Enter", true);
    await flushPromises();
    expect(wrapper.emitted("load")?.[0]?.[0]).toMatchObject({ id: "e1" });
    expect(wrapper.emitted("run")).toBeUndefined();
  });

  it("gives the keyboard-focused row, or the hovered one, the menu's active state", async () => {
    const { trigger } = await openFromButton();
    trigger.focus();
    press(trigger, "ArrowDown");
    press(document.activeElement!, "ArrowDown");
    await nextTick();
    const row = (id: string) =>
      document.querySelector<HTMLElement>(`[data-test="recent-searches-row-${id}"]`)!;
    expect(row("e1").getAttribute("aria-selected")).toBe("true");
    expect(row("e1").hasAttribute("data-highlighted")).toBe(true);
    expect(row("e0").getAttribute("aria-selected")).toBe("false");
    expect(row("e0").hasAttribute("data-highlighted")).toBe(false);
    expect(row("e1").className).toContain("data-[highlighted]:bg-select-item-selected-bg");
    expect(row("e1").className).toContain("data-[highlighted]:border-accent");

    row("e0").dispatchEvent(new PointerEvent("pointerenter"));
    await nextTick();
    expect(row("e0").hasAttribute("data-highlighted")).toBe(true);
    expect(row("e1").hasAttribute("data-highlighted")).toBe(false);
    vi.useFakeTimers();
    try {
      document
        .querySelector('[data-test="recent-searches-list"]')!
        .dispatchEvent(new PointerEvent("pointerleave", { relatedTarget: document.body }));
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(row("e1").hasAttribute("data-highlighted")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("Enter on a hovered row after opening from the clock button", () => {
    const hoverRow = async (id: string) => {
      document
        .querySelector(`[data-test="recent-searches-row-${id}"]`)!
        .dispatchEvent(new PointerEvent("pointerenter"));
      await flushPromises();
    };
    const enter = (target: Element, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };

    it("focuses the list itself, so Enter runs the hovered row and never reaches the page", async () => {
      const pageSaw = vi.fn();
      document.addEventListener("keydown", pageSaw);
      try {
        const { wrapper } = await openFromButton();
        const list = document.querySelector('[data-test="recent-searches-popover"]')!;
        expect(document.activeElement).toBe(list);
        await hoverRow("e1");
        const event = enter(list);
        await flushPromises();
        expect(event.defaultPrevented).toBe(true);
        expect(pageSaw).not.toHaveBeenCalled();
        expect(wrapper.emitted("run")?.[0]?.[0]).toMatchObject({ id: "e1" });
      } finally {
        document.removeEventListener("keydown", pageSaw);
      }
    });

    it("loads the hovered row on Shift+Enter", async () => {
      const { wrapper } = await openFromButton();
      await hoverRow("e1");
      enter(document.querySelector('[data-test="recent-searches-popover"]')!, true);
      await flushPromises();
      expect(wrapper.emitted("load")?.[0]?.[0]).toMatchObject({ id: "e1" });
      expect(wrapper.emitted("run")).toBeUndefined();
    });

    it("does nothing on Enter when no row is hovered", async () => {
      const { wrapper } = await openFromButton();
      const event = enter(document.querySelector('[data-test="recent-searches-popover"]')!);
      await flushPromises();
      expect(event.defaultPrevented).toBe(false);
      expect(wrapper.emitted("run")).toBeUndefined();
    });

    it("runs the hovered row on Enter even with focus left on the clock button", async () => {
      const { wrapper, trigger } = await openFromButton();
      trigger.focus();
      await hoverRow("e1");
      const event = enter(trigger);
      await flushPromises();
      expect(event.defaultPrevented).toBe(true);
      expect(wrapper.emitted("run")?.[0]?.[0]).toMatchObject({ id: "e1" });
    });
  });

  it("runs the row plain Enter is pressed on", async () => {
    const { wrapper, trigger } = await openFromButton();
    trigger.focus();
    press(trigger, "ArrowDown");
    press(document.activeElement!, "Enter");
    await flushPromises();
    expect(wrapper.emitted("run")?.[0]?.[0]).toMatchObject({ id: "e0" });
    expect(wrapper.emitted("load")).toBeUndefined();
  });

  it("loads from the editor's focus dropdown after its ArrowDown handoff", async () => {
    const wrapper = mount(RecentSearchesFocusDropdown, {
      props: { source: "logs", anchor: editorBox().box, open: true },
      global: { plugins: [store], stubs: { OTimeCell: true } },
      attachTo: document.body,
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="recent-searches-row-e0"]')).not.toBeNull(),
    );
    expect((wrapper.vm as unknown as { focusFirst: () => boolean }).focusFirst()).toBe(true);
    press(document.activeElement!, "Enter", true);
    await flushPromises();
    expect(wrapper.emitted("load")?.[0]?.[0]).toMatchObject({ id: "e0" });
  });

  const mountWithEditor = async () => {
    const { box, monaco } = editorBox();
    const editor = document.createElement("textarea");
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") editor.value += "\n";
    });
    monaco.appendChild(editor);
    const wrapper = mount(RecentSearchesFocusDropdown, {
      props: { source: "logs", anchor: box, open: true },
      global: { plugins: [store], stubs: { OTimeCell: true } },
      attachTo: document.body,
    });
    const handle = wrapper.vm as unknown as RecentsKeyTarget;
    box.addEventListener(
      "keydown",
      (e) => routeEditorKeyToRecents(e, handle, () => wrapper.setProps({ open: false })),
      true,
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="recent-searches-row-e0"]')).not.toBeNull(),
    );
    editor.focus();
    return { wrapper, editor };
  };

  const hoverRow = async (id: string) => {
    document
      .querySelector(`[data-test="recent-searches-row-${id}"]`)!
      .dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
  };

  it("leaves Enter and Shift+Enter to the editor when no row is highlighted", async () => {
    const { wrapper, editor } = await mountWithEditor();
    press(editor, "Enter", true);
    press(editor, "Enter");
    await flushPromises();
    expect(wrapper.emitted("load")).toBeUndefined();
    expect(wrapper.emitted("run")).toBeUndefined();
    expect(editor.value).toBe("\n\n");
  });

  it("loads the hovered row on Shift+Enter from the editor", async () => {
    const { wrapper, editor } = await mountWithEditor();
    await hoverRow("e1");
    press(editor, "Enter", true);
    await flushPromises();
    expect(wrapper.emitted("load")?.[0]?.[0]).toMatchObject({ id: "e1" });
    expect(wrapper.emitted("run")).toBeUndefined();
    expect(editor.value).toBe("");
  });

  it("runs the hovered row on Enter from the editor", async () => {
    const { wrapper, editor } = await mountWithEditor();
    await hoverRow("e1");
    press(editor, "Enter");
    await flushPromises();
    expect(wrapper.emitted("run")?.[0]?.[0]).toMatchObject({ id: "e1" });
    expect(editor.value).toBe("");
  });

  it("pages the hovered row's details on PageDown from the editor, and leaves PageDown to the editor with no row active", async () => {
    const { wrapper, editor } = await mountWithEditor();
    const pageDown = () => {
      const event = new KeyboardEvent("keydown", {
        key: "PageDown",
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(event);
      return event;
    };
    expect(pageDown().defaultPrevented).toBe(false);

    document
      .querySelector('[data-test="recent-searches-row-e0"]')!
      .dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
    const query = document.querySelector<HTMLElement>(
      '[data-test="recent-searches-details-query"]',
    )!;
    Object.defineProperty(query, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(query, "scrollHeight", { configurable: true, value: 900 });
    expect(pageDown().defaultPrevented).toBe(true);
    expect(query.scrollTop).toBe(184);
    expect(document.activeElement).toBe(editor);
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("keeps the clock popover open for a click in the details pane, and closes it for a click elsewhere", async () => {
    const { wrapper } = await openFromButton();
    document
      .querySelector('[data-test="recent-searches-row-e0"]')!
      .dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
    const copy = document.querySelector<HTMLElement>('[data-test="recent-searches-details-copy"]')!;
    copy.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    copy.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector('[data-test="recent-searches-popover"]')).not.toBeNull();

    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector('[data-test="recent-searches-popover"]')).toBeNull();
    wrapper.unmount();
  });

  it("keeps the clock popover open while Tab takes a keyboard-selected row to its details' Copy", async () => {
    const { wrapper, trigger } = await openFromButton();
    trigger.focus();
    press(trigger, "ArrowDown");
    await flushPromises();
    expect(activeTest()).toBe("recent-searches-row-e0");
    press(document.activeElement!, "Tab");
    await flushPromises();
    expect(activeTest()).toBe("recent-searches-details-copy");
    expect(document.querySelector('[data-test="recent-searches-popover"]')).not.toBeNull();
    expect(document.querySelector('[data-test="recent-searches-details-query"]')?.textContent).toBe(
      "q0",
    );
    wrapper.unmount();
  });

  it("fits a short dropdown: header and footer keep their rows and the list scrolls the rest", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
    api.list.mockResolvedValue({ data: Array.from({ length: 8 }, (_, i) => row(i)) });
    try {
      const { box } = editorBox();
      const cursor = box.querySelector(".cursor")!;
      placeCaret(cursor, { left: 113, top: 91, right: 115, bottom: 109 });
      mount(RecentSearchesFocusDropdown, {
        props: { source: "logs", anchor: box, open: true },
        global: { plugins: [store], stubs: { OTimeCell: true } },
        attachTo: document.body,
      });
      await vi.waitFor(() =>
        expect(document.querySelector('[data-test="recent-searches-row-e7"]')).not.toBeNull(),
      );
      const panel = document.querySelector<HTMLElement>(
        '[data-test="recent-searches-focus-dropdown"]',
      )!;
      expect(panel.style.maxHeight).toBe(`${300 - 109 - 8}px`);
      expect(panel.className.split(" ")).toEqual(
        expect.arrayContaining(["flex", "flex-col", "overflow-hidden"]),
      );
      const root = panel.querySelector<HTMLElement>('[data-test="recent-searches-popover"]')!;
      expect(root.className.split(" ")).toEqual(
        expect.arrayContaining(["flex", "flex-col", "min-h-0"]),
      );
      const list = root.querySelector<HTMLElement>('[data-test="recent-searches-list"]')!;
      expect(list.className.split(" ")).toEqual(
        expect.arrayContaining(["min-h-0", "overflow-auto"]),
      );
      const [header, , footer] = [...root.children] as HTMLElement[];
      expect(header.className.split(" ")).toContain("shrink-0");
      expect(footer.className.split(" ")).toContain("shrink-0");
      expect(footer.querySelector('[data-test="recent-searches-view-all"]')).not.toBeNull();
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    }
  });

  it("leaves Enter to the editor when the list has no rows", async () => {
    api.list.mockResolvedValue({ data: [] });
    const { box, monaco } = editorBox();
    const editor = document.createElement("textarea");
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") editor.value += "\n";
    });
    monaco.appendChild(editor);
    const wrapper = mount(RecentSearchesFocusDropdown, {
      props: { source: "logs", anchor: box, open: true },
      global: { plugins: [store], stubs: { OTimeCell: true } },
      attachTo: document.body,
    });
    box.addEventListener(
      "keydown",
      (e) => routeEditorKeyToRecents(e, wrapper.vm as unknown as RecentsKeyTarget, () => {}),
      true,
    );
    await flushPromises();
    press(editor, "Enter", true);
    expect(editor.value).toBe("\n");
    expect(wrapper.emitted("load")).toBeUndefined();
  });
});
