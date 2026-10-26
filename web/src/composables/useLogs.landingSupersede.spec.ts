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

import { describe, it, expect, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import useLogs from "@/composables/useLogs";
import { searchState } from "@/composables/useLogs/searchState";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";

let finishStreams: (value: unknown) => void = () => {};
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: () => new Promise((resolve) => (finishStreams = resolve)),
    getStream: vi.fn().mockResolvedValue({ schema: [] }),
  }),
}));

const Host = defineComponent({
  template: "<div />",
  setup() {
    const { loadLogsData } = useLogs((key: string) => key);
    const { searchObj } = searchState();
    return { loadLogsData, searchObj };
  },
});

describe("loadLogsData — a search the user sent while the stream metadata loaded", () => {
  it("leaves loading on while that search is still in flight", async () => {
    const wrapper: any = mount(Host, { global: { plugins: [store, i18n, router] } });
    const { searchObj } = wrapper.vm;
    searchObj.meta.jobId = "";
    const loaded = wrapper.vm.loadLogsData();
    const autoRun = useLogsAutoRun();
    const run = autoRun.engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "full",
      signature: autoRun.readSignature(),
    });
    searchObj.meta.pendingExecution = { generation: run.id };
    searchObj.loading = true;
    finishStreams({ list: [] });
    await loaded;
    expect(searchObj.meta.pendingExecution?.generation).toBe(run.id);
    expect(searchObj.loading).toBe(true);
    wrapper.unmount();
  });
});
