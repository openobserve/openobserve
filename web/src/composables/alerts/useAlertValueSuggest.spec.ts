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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { getFieldValuesForSuggestion, requestFieldValues } from "@/composables/fieldValueStore";
import { VALUE_SUGGEST_DEBOUNCE_MS, useAlertValueSuggest } from "./useAlertValueSuggest";

vi.mock("@/composables/fieldValueStore", () => ({
  FIELD_VALUES_LOOKBACK_MINUTES: 15,
  getFieldValuesForSuggestion: vi.fn(),
  requestFieldValues: vi.fn(),
}));

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, VALUE_SUGGEST_DEBOUNCE_MS + 50));
  await flushPromises();
};

const mountBox = (typed: string, column = "level", stream = "app_logs") => {
  const value = ref(typed);
  const streamName = ref(stream);
  const Box = defineComponent({
    setup() {
      const suggest = useAlertValueSuggest(ref("acme"), ref("logs"), streamName);
      return suggest(
        () => column,
        () => value.value,
        () => [],
      );
    },
    template: "<div />",
  });
  const wrapper = mount(Box, { global: { plugins: [i18n] } });
  return {
    wrapper,
    value,
    vm: wrapper.vm as unknown as { options: any[]; hint?: string },
  };
};

const CTX = { org: "acme", streamType: "logs", streamName: "app_logs" };

describe("useAlertValueSuggest", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(getFieldValuesForSuggestion).mockReset();
    vi.mocked(requestFieldValues).mockReset();
  });

  it("offers the stored values of the chosen field, scoped to the form's stream", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["error", "warn"]);
    const { vm } = mountBox("");
    await settle();

    expect(getFieldValuesForSuggestion).toHaveBeenCalledWith(CTX, "level");
    expect(requestFieldValues).not.toHaveBeenCalled();
    expect(vm.options.map((o) => o.value)).toEqual(["error", "warn"]);
  });

  it("asks the server when nothing is stored for the field yet", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue([]);
    vi.mocked(requestFieldValues).mockResolvedValue(["info"]);
    const { vm } = mountBox("");
    await settle();

    expect(requestFieldValues).toHaveBeenCalledWith(CTX, "level", { keyword: undefined });
    expect(vm.options.map((o) => o.value)).toEqual(["info"]);
  });

  it("asks for the typed text 250 ms after the last keystroke", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["error"]);
    vi.mocked(requestFieldValues).mockResolvedValue(["error"]);
    const { value } = mountBox("");
    await settle();
    value.value = "e";
    await new Promise((resolve) => setTimeout(resolve, 100));
    value.value = "ERR*";
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requestFieldValues).not.toHaveBeenCalled();
    await settle();

    expect(requestFieldValues).toHaveBeenCalledTimes(1);
    expect(requestFieldValues).toHaveBeenCalledWith(CTX, "level", { keyword: "err" });
  });

  it("asks nothing until a field and a stream are chosen", async () => {
    mountBox("", "");
    mountBox("", "level", "");
    await settle();

    expect(getFieldValuesForSuggestion).not.toHaveBeenCalled();
    expect(requestFieldValues).not.toHaveBeenCalled();
  });

  it("says a typed value is not seen only once the answer for it has settled", async () => {
    vi.mocked(requestFieldValues).mockResolvedValue([]);
    const { vm, value } = mountBox("fatal");
    expect(vm.hint).toBeUndefined();
    await settle();
    expect(vm.hint).toBe("Not seen in the last 15 minutes.");

    vi.mocked(requestFieldValues).mockResolvedValue(["error"]);
    value.value = "error";
    await settle();
    expect(vm.hint).toBeUndefined();
  });
});
