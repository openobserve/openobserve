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
import { defineComponent, h, inject } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import {
  RECENT_SEARCHES_EDITOR_HOST,
  useRecentSearchesEditorHost,
  type RecentSearchesEditorHost,
} from "./useRecentSearchesEditorHost";

const api = vi.hoisted(() => ({ list: vi.fn(), record: vi.fn(), star: vi.fn(), remove: vi.fn() }));
vi.mock("@/services/query_history", () => ({ default: api }));

enableAutoUnmount(afterEach);

const NOW_US = Date.now() * 1000;
const row = (id: string, query: string) => ({
  id,
  source: "metrics",
  query,
  query_key: "k",
  streams: [],
  context: {},
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: NOW_US,
  updated_at: NOW_US,
});

const mountHost = (empty: { value: boolean }) => {
  const seen: { host: RecentSearchesEditorHost | null } = { host: null };
  const Editor = defineComponent({
    setup() {
      seen.host = inject(RECENT_SEARCHES_EDITOR_HOST, null);
      return () => h("div");
    },
  });
  const Page = defineComponent({
    setup() {
      const recent = useRecentSearchesEditorHost("metrics", {
        opensOnFocus: () => empty.value,
        acceptsQuery: (query) => !query.includes("\n"),
      });
      return { recent };
    },
    render: () => h(Editor),
  });
  const wrapper = mount(Page, { global: { plugins: [store] } });
  const recent = () =>
    (wrapper.vm as unknown as { recent: ReturnType<typeof useRecentSearchesEditorHost> }).recent;
  return { wrapper, seen, recent };
};

describe("recent searches for a nested editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.query_history_enabled = true;
    api.list.mockResolvedValue({
      data: [row("a", "rate(x[5m])"), row("b", "up\nsum(up)"), row("c", "sum(up)")],
    });
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
  });

  it("opens the dropdown when an empty editor gets focus and closes it on the first character", async () => {
    const { seen, recent } = mountHost({ value: true });
    const box = document.createElement("div");
    seen.host!.onFocus(box);
    await flushPromises();
    expect(recent().open.value).toBe(true);
    expect(recent().anchor.value).toBe(box);
    expect(api.list).toHaveBeenCalledWith("default", { source: "metrics", status: "ok", limit: 8 });
    seen.host!.onEdit(false, true);
    expect(recent().open.value).toBe(false);
  });

  it("closes the dropdown on Escape and leaves the event to the editor's own Escape binding", async () => {
    const { seen, recent } = mountHost({ value: true });
    seen.host!.onFocus(document.createElement("div"));
    await flushPromises();
    const monaco = document.createElement("div");
    monaco.className = "monaco-editor";
    monaco.addEventListener("keydown", (e) => seen.host!.onKeydown(e));
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    const stop = vi.spyOn(escape, "stopPropagation");
    monaco.dispatchEvent(escape);
    expect(recent().open.value).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
  });

  it("opens when an edit empties the editor, closes on the next character, and respects a dismissal", async () => {
    const { seen, recent } = mountHost({ value: false });
    seen.host!.onFocus(document.createElement("div"));
    await flushPromises();
    expect(recent().open.value).toBe(false);

    seen.host!.onEdit(true, false);
    expect(recent().open.value).toBe(true);
    seen.host!.onEdit(false, true);
    expect(recent().open.value).toBe(false);
    seen.host!.onEdit(true, false);
    expect(recent().open.value).toBe(true);

    recent().open.value = false;
    seen.host!.onEdit(true, true);
    expect(recent().open.value).toBe(false);
    seen.host!.onEdit(false, true);
    seen.host!.onEdit(true, false);
    expect(recent().open.value).toBe(true);
  });

  it("reopens on a single clear after a restore wrote the editor without an edit event", async () => {
    const { seen, recent } = mountHost({ value: true });
    seen.host!.onFocus(document.createElement("div"));
    await flushPromises();
    expect(recent().open.value).toBe(true);
    recent().open.value = false;

    seen.host!.onEdit(true, false);
    expect(recent().open.value).toBe(true);
  });

  it("keeps the dropdown closed when a query has text, but still loads clock rows", async () => {
    const { seen, recent } = mountHost({ value: false });
    seen.host!.onFocus(null);
    await flushPromises();
    expect(recent().open.value).toBe(false);
    expect(seen.host!.queries.value).toEqual(["rate(x[5m])", "sum(up)"]);
  });

  it("offers nothing and opens nothing when history is disabled", async () => {
    store.state.zoConfig.query_history_enabled = false;
    const { seen, recent } = mountHost({ value: true });
    seen.host!.onFocus(null);
    await flushPromises();
    expect(recent().open.value).toBe(false);
    expect(seen.host!.queries.value).toEqual([]);
    expect(api.list).not.toHaveBeenCalled();
  });
});
