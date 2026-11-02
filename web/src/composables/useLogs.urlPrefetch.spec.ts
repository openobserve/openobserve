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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createMemoryHistory } from "vue-router";
import useLogs from "@/composables/useLogs";
import { searchState } from "@/composables/useLogs/searchState";

const calls: string[] = [];
let finishStreams: (value: unknown) => void = () => {};
const prefetchStreamSchema = vi.fn((name: string, type: string) =>
  calls.push(`schema:${type}/${name}`),
);

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: () => {
      calls.push("streams");
      return new Promise((resolve) => (finishStreams = resolve));
    },
    getStream: vi.fn().mockResolvedValue({ schema: [] }),
    prefetchStreamSchema,
  }),
}));

vi.mock("@/composables/useFunctions", () => ({
  default: () => ({
    getAllFunctions: vi.fn(async () => {
      calls.push("functions");
    }),
  }),
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "home", component: { template: "<div />" } },
    { path: "/logs", name: "logs", component: { template: "<div />" } },
  ],
});

const Host = defineComponent({
  template: "<div />",
  setup() {
    const { loadLogsData } = useLogs((key: string) => key);
    const { searchObj } = searchState();
    return { loadLogsData, searchObj };
  },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("loadLogsData — requests the URL search waits on", () => {
  let wrapper: any;

  beforeEach(() => {
    calls.length = 0;
    prefetchStreamSchema.mockClear();
    wrapper = mount(Host, { global: { plugins: [store, i18n, router] } });
    wrapper.vm.searchObj.meta.jobId = "";
  });

  afterEach(async () => {
    finishStreams({ list: [] });
    await flush();
    wrapper.unmount();
    await router.replace({ name: "logs", query: {} });
  });

  it("asks for the functions without waiting for the stream list", async () => {
    await router.replace({ name: "logs", query: {} });
    const loaded = wrapper.vm.loadLogsData();
    await flush();
    expect(calls).toContain("streams");
    expect(calls).toContain("functions");
    finishStreams({ list: [] });
    await loaded;
  });

  it("starts the schema of every stream the URL names before the stream list arrives", async () => {
    await router.replace({ name: "logs", query: { stream: "app,web", stream_type: "logs" } });
    wrapper.vm.searchObj.data.stream.streamType = "logs";
    wrapper.vm.searchObj.data.stream.selectedStream = ["app", "web"];
    const loaded = wrapper.vm.loadLogsData("url");
    await flush();
    expect(prefetchStreamSchema).toHaveBeenCalledWith("app", "logs");
    expect(prefetchStreamSchema).toHaveBeenCalledWith("web", "logs");
    expect(calls.indexOf("schema:logs/app")).toBeLessThan(calls.indexOf("streams"));
    finishStreams({ list: [] });
    await loaded;
  });

  it("prefetches no schema when the URL names no stream", async () => {
    await router.replace({ name: "logs", query: {} });
    wrapper.vm.searchObj.data.stream.selectedStream = ["persisted"];
    const loaded = wrapper.vm.loadLogsData();
    await flush();
    expect(prefetchStreamSchema).not.toHaveBeenCalled();
    finishStreams({ list: [] });
    await loaded;
  });
});
