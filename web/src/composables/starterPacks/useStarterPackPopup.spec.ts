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
import { resetStarterPackPopups, useStarterPackPopup } from "./useStarterPackPopup";

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
});
