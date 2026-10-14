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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, nextTick, watch } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import useStreamFields from "./useStreamFields";
import { searchState } from "./searchState";
import { queryClient } from "@/composables/query/queryClient";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import type { FieldAlias } from "@/services/service_streams";

const loadSemanticGroups = vi.fn<() => Promise<FieldAlias[]>>();

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    loadSemanticGroups,
    loadKeyFields: async () => ({}),
    loadFieldGrouping: async () => ({ prefix_aliases: {}, group_labels: {} }),
  }),
}));

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });

const Consumer = defineComponent({
  setup: () => useStreamFields(),
  template: "<div></div>",
});

const mounted: { unmount: () => void }[] = [];
const mountConsumer = () => {
  const wrapper = mount(Consumer, { global: { plugins: [store, i18n] } });
  mounted.push(wrapper);
  return wrapper;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

const { searchObj } = searchState();
const org = () => store.state.selectedOrganization.identifier;

const seedStream = () => {
  searchObj.data.stream.streamType = "logs";
  searchObj.data.stream.selectedStream = ["app"];
  searchObj.data.stream.selectedStreamFields = [];
  searchObj.data.streamResults.list = [
    {
      name: "app",
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "host", type: "Utf8" },
        { name: "message", type: "Utf8" },
      ],
      settings: {},
      removedSchemaFields: [],
    },
  ] as any;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const countFieldListBuilds = () => {
  const builds = { count: 0 };
  const stop = watch(
    () => searchObj.data.stream.selectedStreamFields,
    () => builds.count++,
    { flush: "sync" },
  );
  return { builds, stop };
};

const groupsKey = () => serviceStreamKeys.semanticGroups(org());

// Like fetchQuery: the cache keeps a structurally shared copy while the caller gets the raw response.
const pendingGroupsLoad = () => {
  const groups = deferred<FieldAlias[]>();
  loadSemanticGroups.mockReturnValue(groups.promise);
  return (data: FieldAlias[], { cache = true } = {}) => {
    if (cache) queryClient.setQueryData(groupsKey(), structuredClone(data));
    groups.resolve(structuredClone(data));
  };
};

const edgeGroup = () => ({ id: "edge", group: "edge", fields: ["host"] }) as FieldAlias;

const infraGroup = () => ({ id: "infra", group: "infra", fields: ["host"] }) as FieldAlias;

const hostGroup = () =>
  searchObj.data.stream.selectedStreamFields.find((f: any) => f.name === "host")?.group;

beforeEach(() => {
  loadSemanticGroups.mockReset();
  queryClient.removeQueries({ queryKey: serviceStreamKeys.semanticGroups(org()) });
  searchObj.data.query = "";
  searchObj.data.errorMsg = "";
});

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useStreamFields correlation query watcher", () => {
  const correlationClears = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([key]) => String(key).startsWith("oo_correlation_filters")).length;

  const editQueryAndSettle = async () => {
    searchObj.data.query = "host = 'a'";
    await nextTick();
    vi.advanceTimersByTime(700);
    searchObj.data.query = "";
    await nextTick();
    vi.advanceTimersByTime(700);
    await Promise.resolve();
  };

  it("syncs one query edit once however many consumers are mounted", async () => {
    vi.useFakeTimers();
    seedStream();
    mountConsumer();
    mountConsumer();
    mountConsumer();
    mountConsumer();
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    await editQueryAndSettle();

    expect(correlationClears(removeItem)).toBe(1);
  });

  it("keeps syncing after the consumer that registered the watcher unmounts", async () => {
    vi.useFakeTimers();
    seedStream();
    const first = mountConsumer();
    mountConsumer();
    first.unmount();
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    await editQueryAndSettle();

    expect(correlationClears(removeItem)).toBe(1);
  });

  it("stops syncing once every consumer unmounts and resumes on the next mount", async () => {
    vi.useFakeTimers();
    seedStream();
    const wrappers = [mountConsumer(), mountConsumer()];
    wrappers.forEach((w) => w.unmount());
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    await editQueryAndSettle();
    expect(correlationClears(removeItem)).toBe(0);

    mountConsumer();
    await editQueryAndSettle();
    expect(correlationClears(removeItem)).toBe(1);
  });
});

describe("extractFields and a slow semantic-groups load", () => {
  it("finishes extracting fields without waiting for the groups request", async () => {
    seedStream();
    const groups = deferred<FieldAlias[]>();
    loadSemanticGroups.mockReturnValue(groups.promise);
    const wrapper = mountConsumer();

    const outcome = await Promise.race([
      wrapper.vm.extractFields({ reuseLoadedSchema: true }).then(() => "extracted"),
      new Promise((r) => setTimeout(() => r("blocked on semantic groups"), 50)),
    ]);

    expect(outcome).toBe("extracted");
    expect(searchObj.data.stream.selectedStreamFields.map((f: any) => f.name)).toContain("host");
    groups.resolve([]);
  });

  it("regroups the fields once the groups arrive, keeping the current error message", async () => {
    seedStream();
    const land = pendingGroupsLoad();
    const wrapper = mountConsumer();
    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    expect(hostGroup()).not.toBe("infra");

    searchObj.data.errorMsg = "search failed";
    searchObj.loadingStream = false;
    land([infraGroup()]);
    await vi.waitFor(() => expect(hostGroup()).toBe("infra"));

    expect(searchObj.data.errorMsg).toBe("search failed");
    expect(searchObj.loadingStream).toBe(false);
  });

  it("uses cached groups straight away and does not regroup a refresh that changed nothing", async () => {
    seedStream();
    queryClient.setQueryData(groupsKey(), [infraGroup()]);
    const land = pendingGroupsLoad();
    const wrapper = mountConsumer();
    const { builds, stop } = countFieldListBuilds();

    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    land([infraGroup()]);
    await flush();
    stop();

    expect(hostGroup()).toBe("infra");
    expect(builds.count).toBe(1);
  });

  it("does not regroup when a cold groups load fails", async () => {
    seedStream();
    loadSemanticGroups.mockResolvedValue([]);
    const wrapper = mountConsumer();
    const { builds, stop } = countFieldListBuilds();

    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    await flush();
    stop();

    expect(builds.count).toBe(1);
  });

  it("keeps the cached groups when their refresh fails", async () => {
    seedStream();
    queryClient.setQueryData(groupsKey(), [edgeGroup()]);
    loadSemanticGroups.mockResolvedValue([]);
    const wrapper = mountConsumer();
    const { builds, stop } = countFieldListBuilds();

    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    await flush();
    stop();

    expect(hostGroup()).toBe("edge");
    expect(builds.count).toBe(1);
  });

  it("shows invalidated groups first and regroups when their refresh changed them", async () => {
    seedStream();
    queryClient.setQueryData(groupsKey(), [edgeGroup()]);
    await queryClient.invalidateQueries({ queryKey: groupsKey(), refetchType: "none" });
    const land = pendingGroupsLoad();
    const wrapper = mountConsumer();

    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    expect(hostGroup()).toBe("edge");

    land([infraGroup()]);
    await vi.waitFor(() => expect(hostGroup()).toBe("infra"));
  });

  it("leaves a stream change in flight to its own extract", async () => {
    seedStream();
    const land = pendingGroupsLoad();
    const wrapper = mountConsumer();
    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    const { builds, stop } = countFieldListBuilds();

    searchObj.loadingStream = true;
    land([infraGroup()]);
    await flush();
    stop();

    expect(builds.count).toBe(0);
    expect(searchObj.loadingStream).toBe(true);
    searchObj.loadingStream = false;
  });

  it("does not regroup while a selected stream's schema is not loaded", async () => {
    seedStream();
    const land = pendingGroupsLoad();
    const wrapper = mountConsumer();
    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    const { builds, stop } = countFieldListBuilds();

    (searchObj.data.streamResults.list[0] as any).schema = undefined;
    land([infraGroup()]);
    await flush();
    stop();

    expect(builds.count).toBe(0);
  });

  it("does not regroup with the previous org's groups after an org switch", async () => {
    seedStream();
    const land = pendingGroupsLoad();
    const wrapper = mountConsumer();
    await wrapper.vm.extractFields({ reuseLoadedSchema: true });
    const { builds, stop } = countFieldListBuilds();
    const previousOrg = store.state.selectedOrganization;
    const key = groupsKey();

    store.state.selectedOrganization = { ...previousOrg, identifier: "other-org" };
    try {
      queryClient.setQueryData(key, [infraGroup()]);
      land([infraGroup()], { cache: false });
      await flush();
    } finally {
      store.state.selectedOrganization = previousOrg;
      stop();
    }

    expect(builds.count).toBe(0);
  });
});
