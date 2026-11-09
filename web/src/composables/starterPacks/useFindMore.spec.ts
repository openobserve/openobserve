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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";

const fake = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  readFails: false,
  live: [] as Array<Record<string, unknown>>,
  installPack: vi.fn(async (): Promise<Record<string, unknown>> => ({
    installId: "new",
    status: "complete",
  })),
  appendToInstall: vi.fn(async (): Promise<Record<string, unknown>> => ({
    installId: "old",
    status: "complete",
  })),
  undoPack: vi.fn(async () => ({ removed: [], kept: [] })),
  undoItems: vi.fn(async () => ({ removed: [], kept: [] })),
  previewPack: vi.fn(async () => ({
    repairs: [{ from: "a", to: "b" }],
    bindings: [],
    flavours: {},
  })),
}));

vi.mock("@/services/http", () => ({
  default: () => ({
    get: async (url: string) => {
      if (fake.readFails) throw Object.assign(new Error("x"), { response: { status: 500 } });
      const key = decodeURIComponent(url.split("/kv/")[1] ?? "");
      if (!fake.kv.has(key)) throw Object.assign(new Error("x"), { response: { status: 404 } });
      return { data: fake.kv.get(key) };
    },
    post: async (url: string, body: string) => {
      fake.kv.set(decodeURIComponent(url.split("/kv/")[1]), body);
      return { data: "OK" };
    },
    delete: async () => ({ data: "OK" }),
  }),
}));
vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({
    loadManifest: async () => ({
      alerts: [{ id: "nginx/5xx", pack: "nginx", title: "5xx", required_streams: ["edge"] }],
    }),
    loadAlertFile: async () => ({}),
  }),
}));
vi.mock("./kubernetesPack", () => ({
  STARTER_PACKS: [
    {
      id: "kubernetes",
      dashboards: [{ id: "overview" }],
      alerts: ["k8s/one", "k8s/two"],
      savedViews: [{ id: "events" }],
    },
  ],
}));
vi.mock("./useStarterPacks", () => ({
  useStarterPacks: () => ({
    listInstalls: async () => fake.live,
    installPack: fake.installPack,
    appendToInstall: fake.appendToInstall,
    undoPack: fake.undoPack,
    undoItems: fake.undoItems,
    previewPack: fake.previewPack,
  }),
}));

import { DISMISSED_KEY, type FindMoreSource } from "./findMore";
import { useFindMore } from "./useFindMore";

const PACK_SOURCE: FindMoreSource = {
  id: "kubernetes",
  packId: "kubernetes",
  label: "kubernetes",
  streams: [],
  items: [{ kind: "alert", id: "k8s/two", name: "Two", queries: 10 }],
  queriesPerDay: 10,
};
const NGINX: FindMoreSource = {
  id: "library-nginx",
  label: "nginx",
  streams: ["edge"],
  items: [
    { kind: "alert", id: "nginx/5xx", name: "5xx", queries: 10 },
    { kind: "alert", id: "nginx/slow", name: "slow", queries: 5 },
  ],
  queriesPerDay: 15,
};

const finder = () => {
  let api!: ReturnType<typeof useFindMore>;
  mount(
    defineComponent({
      setup() {
        api = useFindMore("org");
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return api;
};

describe("useFindMore", () => {
  beforeEach(() => {
    queryClient.clear();
    fake.kv.clear();
    fake.live = [];
    vi.clearAllMocks();
  });

  it("appends new items of an installed pack to its record", async () => {
    fake.live = [{ installId: "old", status: "complete" }];
    const api = finder();
    expect(await api.add(PACK_SOURCE)).toBe(true);
    expect(fake.appendToInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "kubernetes" }),
      "old",
      ["k8s/two"],
      expect.objectContaining({ repairs: [{ from: "a", to: "b" }] }),
    );
    expect(fake.installPack).not.toHaveBeenCalled();
    expect(api.added.value[0]).toMatchObject({ installId: "old", newRecord: false });
  });

  it("starts a new record with only the source's items for a pack not installed", async () => {
    const api = finder();
    await api.add(PACK_SOURCE);
    const [, options] = fake.installPack.mock.calls[0] as unknown as [
      unknown,
      { exclude: string[] },
    ];
    expect(options.exclude).toEqual(["overview", "k8s/one", "events", "dashboards"]);
    expect(api.added.value[0]).toMatchObject({ installId: "new", newRecord: true });
  });

  it("installs a Library group as its own alerts-only pack", async () => {
    await finder().add(NGINX);
    const [pack, options] = fake.installPack.mock.calls[0] as unknown as [
      { id: string; alerts: string[] },
      { exclude: string[] },
    ];
    expect(pack.id).toBe("library-nginx");
    expect(pack.alerts).toEqual(["nginx/5xx"]);
    expect(options.exclude).toContain("dashboards");
    expect(fake.previewPack).not.toHaveBeenCalled();
  });

  it("keeps the source listed and Undo available when the install ends incomplete", async () => {
    fake.installPack.mockResolvedValueOnce({ installId: "new", status: "incomplete" });
    const api = finder();
    api.result.value = { checkedAt: 1, sources: [PACK_SOURCE], dismissed: 0 };
    expect(await api.add(PACK_SOURCE)).toBe(false);
    expect(api.result.value?.sources).toEqual([PACK_SOURCE]);
    expect(api.added.value).toHaveLength(1);
    await api.undo(api.added.value[0]);
    expect(api.result.value?.sources).toEqual([PACK_SOURCE]);
  });

  it("reports a failed append as not added", async () => {
    fake.live = [{ installId: "old", status: "complete" }];
    fake.appendToInstall.mockResolvedValueOnce({ installId: "old", status: "incomplete" });
    expect(await finder().add(PACK_SOURCE)).toBe(false);
  });

  it("keeps both of two quick dismissals", async () => {
    const api = finder();
    api.result.value = { checkedAt: 1, sources: [NGINX], dismissed: 0 };
    await Promise.all([
      api.dismissItem("library-nginx", "nginx/5xx"),
      api.dismissItem("library-nginx", "nginx/slow"),
      api.dismissItem("library-nginx", "nginx/slow"),
    ]);
    expect(JSON.parse(fake.kv.get(DISMISSED_KEY)!).items).toEqual([
      "library-nginx/nginx/5xx",
      "library-nginx/nginx/slow",
    ]);
  });

  it("does not overwrite the dismissals when they cannot be read", async () => {
    fake.kv.set(DISMISSED_KEY, JSON.stringify({ sources: ["old"], items: [] }));
    fake.readFails = true;
    const api = finder();
    await expect(api.dismissSource("library-nginx")).rejects.toThrow();
    fake.readFails = false;
    expect(JSON.parse(fake.kv.get(DISMISSED_KEY)!).sources).toEqual(["old"]);
  });

  it("undoes only what the Add made", async () => {
    fake.live = [{ installId: "old", status: "complete" }];
    const api = finder();
    await api.add(PACK_SOURCE);
    await api.undo(api.added.value[0]);
    expect(fake.undoItems).toHaveBeenCalledWith(expect.anything(), "old", ["k8s/two"]);
    expect(fake.undoPack).not.toHaveBeenCalled();
    expect(api.added.value).toEqual([]);
  });

  it("keeps a dismissed item out and its cost off the source", async () => {
    const api = finder();
    api.result.value = { checkedAt: 1, sources: [NGINX], dismissed: 0 };
    await api.dismissItem("library-nginx", "nginx/slow");
    await flushPromises();
    expect(JSON.parse(fake.kv.get(DISMISSED_KEY)!).items).toEqual(["library-nginx/nginx/slow"]);
    expect(api.result.value?.sources[0].items.map(({ id }) => id)).toEqual(["nginx/5xx"]);
    expect(api.result.value?.sources[0].queriesPerDay).toBe(10);
    expect(api.result.value?.dismissed).toBe(1);
  });

  it("drops a dismissed source and counts its matches", async () => {
    const api = finder();
    api.result.value = { checkedAt: 1, sources: [NGINX], dismissed: 0 };
    await api.dismissSource("library-nginx");
    expect(JSON.parse(fake.kv.get(DISMISSED_KEY)!).sources).toEqual(["library-nginx"]);
    expect(api.result.value?.sources).toEqual([]);
    expect(api.result.value?.dismissed).toBe(2);
  });
});
