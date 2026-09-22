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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount as mountComponent } from "@vue/test-utils";
import { defineComponent, h, nextTick, onBeforeUnmount, ref, type Ref } from "vue";
import {
  SELECTION_MAX_IDS,
  SELECTION_STORAGE_KEY,
  SELECTION_TTL_MS,
  clearPersistedSelections,
  usePersistedSelection,
} from "./usePersistedSelection";

interface Stream {
  key: string;
  name: string;
  stream_type: string;
  size: number;
}

type Snapshot = { name: string; stream_type: string };

const stream = (name: string): Stream => ({
  key: `${name}-logs`,
  name,
  stream_type: "logs",
  size: 1,
});

function mount(
  rows: Ref<Stream[]> = ref([]),
  org = ref("org1"),
  mode: "client" | "server" = "server",
) {
  const api = usePersistedSelection<Stream, Snapshot>({
    tableId: "streams",
    scope: () => org.value,
    rows,
    getRowId: (row) => row.key,
    mode,
    snapshot: (row) => ({ name: row.name, stream_type: row.stream_type }),
  });
  return { ...api, rows, org };
}

async function select(s: ReturnType<typeof mount>, ids: string[]) {
  s.selectedIds.value = ids;
  await nextTick();
  await nextTick();
}

describe("usePersistedSelection", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it("restores ids and row snapshots once rows load after re-entering the page", async () => {
    await select(mount(ref([stream("a"), stream("b")])), ["a-logs"]);

    const second = mount(ref([]));
    expect(second.selectedIds.value).toEqual([]);

    second.rows.value = [stream("a"), stream("b")];
    await nextTick();
    expect(second.selectedIds.value).toEqual(["a-logs"]);
    expect(second.selectedRows.value).toEqual([{ name: "a", stream_type: "logs" }]);
  });

  it("ignores a page that resets its selection before its rows have loaded", async () => {
    await select(mount(ref([stream("a")])), ["a-logs"]);

    const second = mount(ref([]));
    second.selectedIds.value = [];
    await nextTick();
    second.rows.value = [stream("a")];
    await nextTick();

    expect(second.selectedIds.value).toEqual(["a-logs"]);
  });

  it("keeps the stored selection when the page clears it while unmounting", async () => {
    const rows = ref([stream("a")]);
    const Page = defineComponent({
      setup() {
        const api = mount(rows);
        onBeforeUnmount(() => (api.selectedIds.value = []));
        return { api };
      },
      render: () => h("div"),
    });
    const wrapper = mountComponent(Page);
    await select(wrapper.vm.api as ReturnType<typeof mount>, ["a-logs"]);
    wrapper.unmount();
    await nextTick();

    expect(mount(ref([stream("a")])).selectedIds.value).toEqual(["a-logs"]);
  });

  it("keeps rows selected on another server page actionable", async () => {
    const s = mount(ref([stream("a")]));
    await select(s, ["a-logs"]);

    s.rows.value = [stream("z")];
    await nextTick();
    await select(s, ["a-logs", "z-logs"]);

    expect(s.offPageCount.value).toBe(1);
    expect(s.selectedRows.value.map((r) => r.name)).toEqual(["a", "z"]);
  });

  it("restores off-page ids in server mode but drops missing ids in client mode", async () => {
    await select(mount(ref([stream("a"), stream("b")])), ["a-logs", "b-logs"]);

    expect(mount(ref([stream("b")]), ref("org1"), "server").selectedIds.value).toEqual([
      "a-logs",
      "b-logs",
    ]);
    expect(mount(ref([stream("b")]), ref("org1"), "client").selectedIds.value).toEqual(["b-logs"]);
  });

  it("resolves a row selected in the same tick, before the watcher has run", () => {
    const s = mount(ref([stream("a")]));
    s.selectedIds.value = ["a-logs"];

    expect(s.selectedRows.value).toEqual([{ name: "a", stream_type: "logs" }]);
  });

  it("stores only the snapshot fields, not the whole row", async () => {
    await select(mount(ref([stream("a")])), ["a-logs"]);

    const stored = JSON.parse(sessionStorage.getItem(SELECTION_STORAGE_KEY)!);
    expect(stored["org1:streams"].rows["a-logs"]).toEqual({ name: "a", stream_type: "logs" });
  });

  it("isolates selection per scope and waits for the new scope's rows", async () => {
    const s = mount(ref([stream("a")]));
    await select(s, ["a-logs"]);

    s.org.value = "org2";
    await nextTick();
    await nextTick();
    expect(s.selectedIds.value).toEqual([]);
    expect(JSON.parse(sessionStorage.getItem(SELECTION_STORAGE_KEY)!)["org1:streams"]).toBeTruthy();

    s.org.value = "org1";
    await nextTick();
    expect(s.selectedIds.value).toEqual([]);
    s.rows.value = [stream("a")];
    await nextTick();
    expect(s.selectedIds.value).toEqual(["a-logs"]);
  });

  it("drops an id that has neither a row on screen nor a snapshot", async () => {
    const s = mount(ref([stream("a")]));
    await select(s, ["a-logs", "ghost-logs"]);

    expect(s.selectedIds.value).toEqual(["a-logs"]);
  });

  it("keeps ids the page sets in client mode even when no loaded row matches", async () => {
    const s = mount(ref([stream("a")]), ref("org1"), "client");
    await select(s, ["a-logs", "elsewhere-logs"]);

    expect(s.selectedIds.value).toEqual(["a-logs", "elsewhere-logs"]);
  });

  it("hands restored ids to pages that keep selected row objects", async () => {
    await select(mount(ref([stream("a")])), ["a-logs"]);

    const onRestore = vi.fn();
    usePersistedSelection<Stream>({
      tableId: "streams",
      scope: () => "org1",
      rows: ref([stream("a")]),
      getRowId: (row) => row.key,
      onRestore,
    });

    expect(onRestore).toHaveBeenCalledWith(["a-logs"]);
  });

  it("removes only the given ids and deletes the entry once empty", async () => {
    const s = mount(ref([stream("a"), stream("b")]));
    await select(s, ["a-logs", "b-logs"]);

    s.remove(["a-logs"]);
    await nextTick();
    expect(mount(ref([stream("b")])).selectedIds.value).toEqual(["b-logs"]);

    s.clear();
    await nextTick();
    expect(sessionStorage.getItem(SELECTION_STORAGE_KEY)).toBeNull();
  });

  it("ignores a stored selection older than the TTL", async () => {
    vi.useFakeTimers();
    await select(mount(ref([stream("a")])), ["a-logs"]);

    vi.advanceTimersByTime(SELECTION_TTL_MS + 1);
    expect(mount(ref([stream("a")])).selectedIds.value).toEqual([]);
  });

  it("caps the number of persisted ids", async () => {
    const rows = Array.from({ length: SELECTION_MAX_IDS + 5 }, (_, i) => stream(`s${i}`));
    const s = mount(ref(rows));
    await select(
      s,
      rows.map((r) => r.key),
    );

    expect(s.selectedIds.value).toHaveLength(SELECTION_MAX_IDS);
  });

  it("survives corrupt storage and clears everything on logout", async () => {
    sessionStorage.setItem(SELECTION_STORAGE_KEY, "{not json");
    const s = mount(ref([stream("a")]));
    expect(s.selectedIds.value).toEqual([]);

    await select(s, ["a-logs"]);
    clearPersistedSelections();
    expect(mount(ref([stream("a")])).selectedIds.value).toEqual([]);
  });
});
