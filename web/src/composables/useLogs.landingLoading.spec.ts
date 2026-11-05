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

import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import useLogs from "@/composables/useLogs";
import { searchState } from "@/composables/useLogs/searchState";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({
      list: [{ name: "app", stream_type: "logs", schema: [], settings: {} }],
    }),
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

const land = async (result: string) => {
  const wrapper: any = mount(Host, { global: { plugins: [store, i18n, router] } });
  const { searchObj } = wrapper.vm;
  searchObj.meta.jobId = "";
  const request = vi.spyOn(useLogsAutoRun(), "request").mockReturnValue(result as any);
  searchObj.data.stream.selectedStream = ["app"];
  searchObj.loading = true;
  await wrapper.vm.loadLogsData();
  return { wrapper, searchObj, request };
};

describe("loadLogsData — loading across the landing auto-run hand-off", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps loading on while the landing run is scheduled, so the histogram never reads as empty", async () => {
    const { wrapper, searchObj, request } = await land("scheduled");
    expect(request).toHaveBeenCalledTimes(1);
    expect(searchObj.loading).toBe(true);
    wrapper.unmount();
  });

  it("releases loading when the scheduled run never starts", async () => {
    const { wrapper, searchObj, request } = await land("scheduled");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(request).toHaveBeenCalledTimes(1);
    expect(searchObj.loading).toBe(false);
    wrapper.unmount();
  });

  it("clears loading when no landing run is sent", async () => {
    const { wrapper, searchObj } = await land("skipped-ineligible");
    expect(searchObj.loading).toBe(false);
    wrapper.unmount();
  });
});
