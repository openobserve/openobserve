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
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";

import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import { packById } from "./usePackCatalog";
import { resetStarterPackPopups, useStarterPackPopup, type PackEntry } from "./useStarterPackPopup";

const made = vi.hoisted(() => ({ flows: 0, matchers: 0, last: null as any }));
vi.mock("./useStarterPackFlow", () => ({
  useStarterPackFlow: (_org: string, pack: { id: string }) => {
    made.flows += 1;
    const flow = { pack, running: ref(false) };
    made.last = flow;
    return flow;
  },
}));
vi.mock("./useStarterPackMatcher", () => ({
  useStarterPackMatcher: () => {
    made.matchers += 1;
    return { clusters: ref([]) };
  },
}));

loadCatalogFixture();

const inSetup = <T>(run: () => T): T => mounted(run).result;

const mounted = <T>(run: () => T) => {
  let result!: T;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = run();
        return () => h("div");
      },
    }),
  );
  return { result, wrapper };
};

const entryWith = (state: string, installed = false) =>
  ({
    pack: packById("kubernetes")!,
    flow: {
      previewState: ref(state),
      installed: ref(installed),
      loadPreview: vi.fn(),
    },
  }) as unknown as PackEntry;

describe("useStarterPackPopup", () => {
  beforeEach(() => {
    resetStarterPackPopups();
    made.flows = 0;
    made.matchers = 0;
  });

  it("gives every surface of one org the same pack state", () => {
    const pack = packById("kubernetes")!;
    const header = inSetup(() => useStarterPackPopup("org").entryOf(pack));
    const home = inSetup(() => useStarterPackPopup("org").entryOf(pack));
    const other = inSetup(() => useStarterPackPopup("other").entryOf(pack));
    expect(home.flow).toBe(header.flow);
    expect(home.matcher).toBe(header.matcher);
    expect(other.flow).not.toBe(header.flow);
    expect([made.flows, made.matchers]).toEqual([2, 2]);
  });

  it("opens on the list, goes to a pack and back, and closes", () => {
    const popup = useStarterPackPopup("org");
    popup.openList("hosts");
    expect([popup.open.value, popup.screen.value, popup.packId.value]).toEqual([
      true,
      "list",
      "hosts",
    ]);
    popup.openPack("kubernetes");
    expect([popup.screen.value, popup.packId.value]).toEqual(["pack", "kubernetes"]);
    popup.back();
    expect([popup.open.value, popup.screen.value, popup.packId.value]).toEqual([
      true,
      "list",
      "kubernetes",
    ]);
    popup.close();
    expect(popup.open.value).toBe(false);
  });

  it("keeps the clusters a surface names for a pack, on top of the pack's own match", () => {
    const popup = useStarterPackPopup("org");
    popup.openPack("kubernetes", ["typed"]);
    expect(popup.clustersOf("kubernetes", ["seen", "typed"])).toEqual(["typed", "seen"]);
    expect(popup.clustersOf("hosts", ["seen"])).toEqual(["seen"]);
  });

  it("keeps the list selection when the chip reopens it without a pack", () => {
    const popup = useStarterPackPopup("org");
    popup.openList("hosts");
    popup.close();
    popup.openList();
    expect(popup.packId.value).toBe("hosts");
  });

  it("remembers each pack's choices while the app is open, starting from the D14 defaults", () => {
    const first = useStarterPackPopup("org").choicesOf("kubernetes");
    expect(first.turnOn).toBe(true);
    expect(first.sendTo).toBe(false);
    expect(first.destination).toBe("");
    expect(first.unticked.size).toBe(0);
    first.unticked = new Set(["k8s/pod_oom_killed"]);
    first.expanded = { savedView: true };
    const again = useStarterPackPopup("org").choicesOf("kubernetes");
    expect([...again.unticked]).toEqual(["k8s/pod_oom_killed"]);
    expect(again.expanded).toEqual({ savedView: true });
    expect(useStarterPackPopup("org").choicesOf("hosts").unticked.size).toBe(0);
  });

  it("drops an org's pack state once no surface of it is mounted and no setup runs", async () => {
    const pack = packById("kubernetes")!;
    const use = () => mounted(() => useStarterPackPopup("org").entryOf(pack));
    const header = use();
    const home = use();
    header.wrapper.unmount();
    expect(made.flows).toBe(1);
    home.result.flow.running.value = true;
    home.wrapper.unmount();
    const during = use();
    expect(during.result.flow).toBe(home.result.flow);
    during.wrapper.unmount();
    expect(made.flows).toBe(1);
    home.result.flow.running.value = false;
    await nextTick();
    use();
    expect(made.flows).toBe(2);
  });
  it("marks a pack opened from the list, and only from the list", () => {
    const popup = useStarterPackPopup("org");
    popup.openPack("kubernetes", [], { fromList: true });
    expect(popup.fromList.value).toBe(true);
    popup.openPack("kubernetes");
    expect(popup.fromList.value).toBe(false);
  });

  it("keeps the list up, with the pack marked opening, until the pack's plan has loaded", async () => {
    const popup = useStarterPackPopup("org");
    popup.openList();
    const entry = entryWith("loading");
    const opened = popup.openWhenReady(entry, { fromList: true });
    await nextTick();
    expect([popup.screen.value, popup.opening.value]).toEqual(["list", "kubernetes"]);
    (entry.flow.previewState as any).value = "ready";
    await opened;
    expect([popup.screen.value, popup.packId.value, popup.fromList.value]).toEqual([
      "pack",
      "kubernetes",
      true,
    ]);
    expect(popup.opening.value).toBeNull();
  });

  it("starts an idle plan load, and opens on a failed one so the review shows Retry", async () => {
    const popup = useStarterPackPopup("org");
    const entry = entryWith("idle");
    const opened = popup.openWhenReady(entry);
    expect(entry.flow.loadPreview).toHaveBeenCalledTimes(1);
    (entry.flow.previewState as any).value = "error";
    await opened;
    expect([popup.open.value, popup.screen.value]).toEqual([true, "pack"]);
  });

  it("opens a ready or set-up pack at once", async () => {
    const popup = useStarterPackPopup("org");
    await popup.openWhenReady(entryWith("ready"));
    expect(popup.screen.value).toBe("pack");
    popup.back();
    await popup.openWhenReady(entryWith("idle", true));
    expect(popup.screen.value).toBe("pack");
  });
  it("drops a pending open when the popup closes first", async () => {
    const popup = useStarterPackPopup("org");
    popup.openList();
    const entry = entryWith("loading");
    const opened = popup.openWhenReady(entry, { fromList: true });
    popup.close();
    (entry.flow.previewState as any).value = "ready";
    await opened;
    expect([popup.open.value, popup.screen.value]).toEqual([false, "list"]);
  });
});
