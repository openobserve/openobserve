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

const fake = vi.hoisted(() => ({ metrics: [] as string[], ready: false, matchPack: vi.fn() }));

vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: true }));
vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({ loadManifest: vi.fn(), loadAlertFile: vi.fn() }),
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: vi.fn(),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("./packMatchData", () => ({
  readOrgStreams: async () => ({ metrics: new Map(fake.metrics.map((name) => [name, 1])) }),
  readSchemaColumns: async () => [],
  matchPack: (...args: unknown[]) => {
    fake.matchPack(...args);
    return Promise.resolve({ ready: fake.ready });
  },
}));

import { HOSTS_PACK } from "./hostsPack";
import { useStarterPackMatcher } from "./useStarterPackMatcher";

const check = async () => {
  let api!: ReturnType<typeof useStarterPackMatcher>;
  mount(
    defineComponent({
      setup() {
        api = useStarterPackMatcher("org", { pack: HOSTS_PACK });
        return () => null;
      },
    }),
  );
  await api.check();
  return api.state.value;
};

describe("useStarterPackMatcher with the Library on, Hosts pack", () => {
  beforeEach(() => {
    Object.assign(fake, { metrics: [], ready: false });
    fake.matchPack.mockClear();
  });

  it("matches when the Library match is ready", async () => {
    fake.metrics = ["node_cpu_seconds_total"];
    fake.ready = true;
    expect(await check()).toBe("matched");
    expect(fake.matchPack).toHaveBeenCalledWith(
      "org",
      HOSTS_PACK,
      expect.anything(),
      expect.anything(),
    );
  });

  it("waits while a host stream exists but nothing in the pack fits yet", async () => {
    fake.metrics = ["system_cpu_time"];
    expect(await check()).toBe("waiting");
  });

  it("reports none without a host stream and never runs the Library match", async () => {
    fake.metrics = ["kube_pod_status_phase"];
    expect(await check()).toBe("none");
    expect(fake.matchPack).not.toHaveBeenCalled();
  });
});
