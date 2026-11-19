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

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";

const fake = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  readFails: false,
  dismissalsStatus: 0,
}));

vi.mock("@/services/http", () => ({
  default: () => ({
    get: async (url: string) => {
      if (fake.readFails) throw Object.assign(new Error("x"), { response: { status: 500 } });
      if (url.endsWith("/kv")) return { data: [] };
      const key = decodeURIComponent(url.split("/kv/")[1] ?? "");
      if (key === "starter_pack_find.dismissed" && fake.dismissalsStatus) {
        throw Object.assign(new Error("x"), { response: { status: fake.dismissalsStatus } });
      }
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
vi.mock("./usePackCatalog", () => ({
  ensurePackCatalog: async () => {},
  packs: () => [
    {
      id: "kubernetes",
      dashboards: [{ id: "overview" }],
      alerts: ["k8s/one", "k8s/two"],
      savedViews: [{ id: "events" }],
    },
  ],
}));
vi.mock("./packMatchData", () => ({
  readOrgStreams: async () => [],
  matchPack: async () => ({ dashboards: new Map(), alerts: new Map(), views: new Map() }),
  matchAlerts: async () => new Map([["nginx/5xx", true]]),
}));
import { useFindMore } from "./useFindMore";

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
    fake.dismissalsStatus = 0;
    vi.clearAllMocks();
  });

  it("checks with no org dismissals when reading them is refused", async () => {
    fake.dismissalsStatus = 403;
    const api = finder();
    await api.check();
    expect(api.state.value).toBe("ready");
    expect(api.result.value?.sources.map(({ id }) => id)).toEqual(["library-nginx"]);
  });

  it("still fails the check when the dismissals read fails another way", async () => {
    fake.dismissalsStatus = 500;
    const api = finder();
    await api.check();
    expect(api.state.value).toBe("error");
  });
});
