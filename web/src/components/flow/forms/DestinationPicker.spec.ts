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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import DestinationPicker from "./DestinationPicker.vue";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => mockToast(...a) }));

const mockList = vi.fn();
vi.mock("@/services/alert_destination", () => ({
  default: { list: (...args: any[]) => mockList(...args) },
}));

const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "label", "loading"],
  emits: ["update:modelValue"],
  template: '<div class="o-select" :data-count="(options || []).length" />',
};
const OSwitchStub = {
  name: "OSwitch",
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template: '<button class="o-switch" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(DestinationPicker, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OSelect: OSelectStub,
        OSwitch: OSwitchStub,
        CreateDestinationForm: { template: '<div class="create-destination-stub" />' },
      },
    },
    props,
  });
}

const listResponse = {
  data: [
    { name: "sink-a", url: "http://a.example.com" },
    {
      name: "sink-b",
      url: "http://this-is-a-very-long-destination-url-that-should-be-truncated-because-it-exceeds-seventy-chars.example.com/webhook",
    },
  ],
};

describe("DestinationPicker", () => {
  beforeEach(() => {
    mockList.mockResolvedValue(listResponse);
  });
  afterEach(() => vi.clearAllMocks());

  it("fetches pipeline-module destinations on mount", async () => {
    createWrapper();
    await flushPromises();
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ module: "pipeline" }),
    );
  });

  it("exposes the fetched destinations as options", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find(".o-select").attributes("data-count")).toBe("2");
  });

  it("truncates long destination URLs in the sub-label", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const opts = (wrapper.vm as any).destinationOptions;
    const long = opts.find((o: any) => o.value === "sink-b");
    expect(long.subLabel.endsWith("...")).toBe(true);
    expect(long.subLabel.length).toBe(73); // 70 + "..."
  });

  it("preselects initialName", async () => {
    const wrapper = createWrapper({ initialName: "sink-a" });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toMatchObject({
      destination_name: "sink-a",
    });
  });

  // The zod schema now gates the save: an empty selection fails validation, so
  // submit() resolves null and OForm renders the error inline on the field
  // (the old imperative "please select" toast is gone).
  it("submit resolves null when nothing is selected", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "warning" }),
    );
  });

  it("submit resolves { org_id, destination_name } when selected", async () => {
    const wrapper = createWrapper({ initialName: "sink-a" });
    await flushPromises();
    const payload = await (wrapper.vm as any).submit();
    expect(payload.destination_name).toBe("sink-a");
    expect(payload.org_id).toBeDefined();
  });

  it("emits expand when toggling create mode", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    await wrapper.find(".o-switch").trigger("click");
    expect(wrapper.emitted("expand")?.[0]).toEqual([true]);
  });
});
