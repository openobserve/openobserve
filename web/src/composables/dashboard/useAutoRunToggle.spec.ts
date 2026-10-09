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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { AUTO_RUN_STORAGE_KEY, useAutoRunToggle } from "./useAutoRunToggle";

const mockState = reactive({ zoConfig: { auto_query_enabled: true } as any });

vi.mock("vuex", () => ({
  useStore: () => ({ state: mockState }),
}));

const mountWithToggle = () => {
  let api: ReturnType<typeof useAutoRunToggle> | null = null;
  const Probe = defineComponent({
    setup() {
      api = useAutoRunToggle();
      return () => h("div");
    },
  });
  const wrapper = mount(Probe);
  return { wrapper, api: api! };
};

describe("useAutoRunToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    mockState.zoConfig = { auto_query_enabled: true };
    useAutoRunToggle().syncAutoRun();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("is on when nothing is stored and the server flag is on", () => {
    const { api } = mountWithToggle();
    expect(api.isAutoRunAvailable.value).toBe(true);
    expect(api.isAutoRunOn.value).toBe(true);
  });

  it("is off and unavailable when the server flag is off, whatever is stored", () => {
    localStorage.setItem(AUTO_RUN_STORAGE_KEY, "true");
    mockState.zoConfig = { auto_query_enabled: false };
    const { api } = mountWithToggle();
    expect(api.isAutoRunAvailable.value).toBe(false);
    expect(api.isAutoRunOn.value).toBe(false);
  });

  it("reads the value logs and traces stored", () => {
    localStorage.setItem(AUTO_RUN_STORAGE_KEY, "false");
    const { api } = mountWithToggle();
    expect(api.isAutoRunOn.value).toBe(false);
  });

  it("writes the shared key as true/false when toggled", () => {
    const { api } = mountWithToggle();
    api.toggleAutoRun();
    expect(localStorage.getItem(AUTO_RUN_STORAGE_KEY)).toBe("false");
    expect(api.isAutoRunOn.value).toBe(false);
    api.toggleAutoRun();
    expect(localStorage.getItem(AUTO_RUN_STORAGE_KEY)).toBe("true");
    expect(api.isAutoRunOn.value).toBe(true);
  });

  it("follows a change made in another tab", () => {
    const { api, wrapper } = mountWithToggle();
    localStorage.setItem(AUTO_RUN_STORAGE_KEY, "false");
    window.dispatchEvent(new StorageEvent("storage", { key: AUTO_RUN_STORAGE_KEY }));
    expect(api.isAutoRunOn.value).toBe(false);
    wrapper.unmount();
  });

  it("updates every surface in the same tab at once", () => {
    const first = mountWithToggle().api;
    const second = mountWithToggle().api;
    expect(first.isAutoRunOn.value).toBe(true);

    second.toggleAutoRun();

    expect(first.isAutoRunOn.value).toBe(false);
    expect(localStorage.getItem(AUTO_RUN_STORAGE_KEY)).toBe("false");
  });

  it("ignores storage events for other keys", () => {
    const { api } = mountWithToggle();
    localStorage.setItem(AUTO_RUN_STORAGE_KEY, "false");
    window.dispatchEvent(new StorageEvent("storage", { key: "something_else" }));
    expect(api.isAutoRunOn.value).toBe(true);
  });

  it("re-reads the stored value when a kept-alive view is activated again", async () => {
    let api: ReturnType<typeof useAutoRunToggle> | null = null;
    const Probe = defineComponent({
      name: "Probe",
      setup() {
        api = useAutoRunToggle();
        return () => h("div");
      },
    });
    const Other = defineComponent({ name: "Other", render: () => h("span") });
    const showProbe = ref(true);
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, [showProbe.value ? h(Probe) : h(Other)]),
    });
    mount(Host);
    expect(api!.isAutoRunOn.value).toBe(true);

    showProbe.value = false;
    await nextTick();
    localStorage.setItem(AUTO_RUN_STORAGE_KEY, "false");
    showProbe.value = true;
    await nextTick();

    expect(api!.isAutoRunOn.value).toBe(false);
  });
});
