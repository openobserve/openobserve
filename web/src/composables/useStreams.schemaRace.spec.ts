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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createStore } from "vuex";
import { flushPromises } from "@vue/test-utils";
import useStreams from "@/composables/useStreams";
import StreamService from "@/services/stream";
import { queryClient } from "@/composables/query/queryClient";
import streamsModule from "@/stores/streams";
import i18nInstance from "@/locales";

const t = (i18nInstance.global as any).t;

vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      nameList: vi.fn(),
      schema: vi.fn(),
    },
  });
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => () => {}),
}));

let realStore: any;

vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => realStore,
}));

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const makeStore = (org: string) =>
  createStore({
    state: () => ({
      selectedOrganization: { identifier: org },
      organizationData: { isDataIngested: true },
    }),
    mutations: {
      setOrg(state: any, identifier: string) {
        state.selectedOrganization = { identifier };
      },
    },
    actions: { setIsDataIngested() {} },
    modules: { streams: streamsModule },
  });

const schemaOf = (org: string, name: string) => ({
  data: {
    name,
    stream_type: "traces",
    schema: [
      { name: "service_name", type: "Utf8" },
      { name: `${org}_only`, type: "Utf8" },
    ],
  },
});

const traceRow = (name: string) => ({ name, stream_type: "traces" });

describe("useStreams schema reads across an org switch or a list refetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    realStore = makeStore("org-a");
  });

  it("a new-org read fetches its own schema when the old org's response lands right after the new list", async () => {
    const service = vi.mocked(StreamService);
    const oldSchema = deferred<any>();
    const newList = deferred<any>();
    service.nameList.mockImplementation(((org: string) =>
      org === "org-a"
        ? Promise.resolve({ data: { list: [traceRow("default")] } })
        : newList.promise) as any);
    service.schema.mockImplementation(((org: string, name: string) =>
      org === "org-a" ? oldSchema.promise : Promise.resolve(schemaOf(org, name))) as any);
    const { getStream } = useStreams(t);

    const oldRead = getStream("default", "traces", true);
    await flushPromises();
    expect(service.schema).toHaveBeenCalledWith("org-a", "default", "traces");

    realStore.commit("setOrg", "org-b");
    const unsubscribe = realStore.subscribe((mutation: any) => {
      if (mutation.type === "streams/updateTraces") oldSchema.resolve(schemaOf("org-a", "default"));
    });
    const newRead = getStream("default", "traces", true);
    await flushPromises();
    newList.resolve({ data: { list: [traceRow("default")] } });
    const [oldStream, newStream] = await Promise.all([oldRead, newRead]);
    unsubscribe();

    expect(service.schema).toHaveBeenCalledWith("org-b", "default", "traces");
    expect(newStream.schema.map((f: any) => f.name)).toEqual(["service_name", "org-b_only"]);
    expect(oldStream.schema.map((f: any) => f.name)).toEqual(["service_name", "org-a_only"]);
    const cached = realStore.state.streams.traces.list[0];
    expect(cached.schema.map((f: any) => f.name)).toEqual(["service_name", "org-b_only"]);
  });

  it("getMultiStreams keeps a superseded org's schema out of the new org's cache", async () => {
    const service = vi.mocked(StreamService);
    const oldSchema = deferred<any>();
    service.nameList.mockResolvedValue({ data: { list: [traceRow("default")] } } as any);
    service.schema.mockImplementation(((org: string, name: string) =>
      org === "org-a" ? oldSchema.promise : Promise.resolve(schemaOf(org, name))) as any);
    const { getStreams, getMultiStreams } = useStreams(t);
    await getStreams("traces", false);

    const oldRead = getMultiStreams([
      { streamName: "default", streamType: "traces", schema: true },
    ]);
    await flushPromises();
    realStore.commit("setOrg", "org-b");
    await getStreams("traces", false);
    oldSchema.resolve(schemaOf("org-a", "default"));
    const [oldStream] = await oldRead;

    expect(oldStream.schema.map((f: any) => f.name)).toEqual(["service_name", "org-a_only"]);
    expect(realStore.state.streams.traces.list[0].schema).toBeUndefined();
  });

  it("stores a schema at the stream's current index when the list is refetched mid-read", async () => {
    const service = vi.mocked(StreamService);
    const schema = deferred<any>();
    service.nameList.mockResolvedValueOnce({ data: { list: [traceRow("default")] } } as any);
    service.nameList.mockResolvedValue({
      data: { list: [traceRow("other"), traceRow("default")] },
    } as any);
    service.schema.mockImplementation((() => schema.promise) as any);
    const { getStream, getStreams } = useStreams(t);

    const read = getStream("default", "traces", true);
    await flushPromises();
    await getStreams("traces", false, false, true);
    schema.resolve(schemaOf("org-a", "default"));
    const stream = await read;

    const list = realStore.state.streams.traces.list;
    expect(list.map((s: any) => s.name)).toEqual(["other", "default"]);
    expect(list[0].schema).toBeUndefined();
    expect(list[1].schema.map((f: any) => f.name)).toEqual(["service_name", "org-a_only"]);
    expect(stream.name).toBe("default");
  });
});
