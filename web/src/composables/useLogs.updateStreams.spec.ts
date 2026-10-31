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

import { describe, expect, it, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useLogs from "@/composables/useLogs";
import { searchState } from "@/composables/useLogs/searchState";

const { getStreamsMock } = vi.hoisted(() => ({ getStreamsMock: vi.fn() }));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: (...args: unknown[]) => getStreamsMock(...args),
    getStream: vi.fn(),
    isStreamExists: vi.fn(() => true),
    isStreamFetched: vi.fn(() => true),
    getMultiStreams: vi.fn(async () => []),
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ currentRoute: { value: { name: "logs", query: {} } }, push: vi.fn() }),
}));

const Host = defineComponent({
  template: "<div />",
  setup() {
    const { updateStreams } = useLogs((key: string) => key as any);
    return { updateStreams };
  },
});

describe("updateStreams", () => {
  const { searchObj } = searchState();

  afterEach(() => {
    searchObj.data.streamResults = { list: [] } as any;
    searchObj.data.stream.streamLists = [];
    getStreamsMock.mockReset();
  });

  it("carries the is_internal flag onto each picker option", async () => {
    searchObj.data.streamResults = { list: [{ name: "stale" }] } as any;
    searchObj.data.stream.streamType = "logs";
    getStreamsMock.mockResolvedValueOnce({
      list: [{ name: "app" }, { name: "_rumdata", is_internal: true }],
    });
    const wrapper = mount(Host, { global: { plugins: [store, i18n] } });

    await (wrapper.vm as any).updateStreams();

    expect(getStreamsMock).toHaveBeenCalledWith("logs", false);
    expect(searchObj.data.stream.streamLists).toEqual([
      { label: "app", value: "app", internal: false },
      { label: "_rumdata", value: "_rumdata", internal: true },
    ]);
    wrapper.unmount();
  });
});
