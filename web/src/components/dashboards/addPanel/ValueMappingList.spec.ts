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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";

vi.mock("@tanstack/vue-virtual", async () => {
  const { computed: vueComputed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      vueComputed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});

import ValueMappingList from "./ValueMappingList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { buildValueMappingCache, lookupValueMappingFull } from "@/utils/dashboard/tableConfigUtils";

const PREFIX = "dashboard-addpanel-config-value-mapping";

let wrapper: VueWrapper<any> | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const mountBound = (initial: any[]) => {
  const model = ref<any[]>(initial);
  const Parent = defineComponent({
    setup: () => () =>
      h(ValueMappingList, {
        modelValue: model.value,
        "onUpdate:modelValue": (value: any[]) => {
          model.value = value;
        },
      }),
  });
  wrapper = mount(Parent, { attachTo: document.body, global: { plugins: [i18n, store] } });
  return model;
};

const pick = async (select: string, value: string) => {
  await wrapper!.find(`[data-test="${select}-trigger"]`).trigger("click");
  await flushPromises();
  document.body
    .querySelector<HTMLElement>(`[data-test="${select}-option"][data-test-value="${value}"]`)!
    .click();
  await flushPromises();
};

const options = async (select: string) => {
  await wrapper!.find(`[data-test="${select}-trigger"]`).trigger("click");
  await flushPromises();
  return [...document.body.querySelectorAll<HTMLElement>(`[data-test="${select}-option"]`)].map(
    (el) => el.dataset.testValue,
  );
};

describe("ValueMappingList special values", () => {
  it("offers Special value as a mapping type", async () => {
    mountBound([{ type: "value", value: "", text: "", color: null }]);
    expect(await options(`${PREFIX}-type-select-0`)).toContain("special");
  });

  it("starts a special mapping on Null and shows the match picker instead of a value", async () => {
    const model = mountBound([{ type: "value", value: "", text: "Down", color: null }]);
    await pick(`${PREFIX}-type-select-0`, "special");
    expect(model.value[0]).toMatchObject({ type: "special", match: "null", text: "Down" });
    expect(wrapper!.find(`[data-test="${PREFIX}-match-select-0"]`).exists()).toBe(true);
    expect(wrapper!.find(`[data-test="${PREFIX}-value-input-0"]`).exists()).toBe(false);
    expect(await options(`${PREFIX}-match-select-0`)).toEqual([
      "null",
      "nan",
      "empty",
      "true",
      "false",
    ]);
  });

  it("writes the picked match, which the renderers then apply", async () => {
    const model = mountBound([{ type: "special", match: "null", text: "Off", color: "#ff0000" }]);
    await pick(`${PREFIX}-match-select-0`, "false");
    expect(model.value[0].match).toBe("false");
    const mapping = lookupValueMappingFull(false, buildValueMappingCache(model.value));
    expect(mapping).toMatchObject({ text: "Off", color: "#ff0000" });
  });

  it("drops the match when the row goes back to another type", async () => {
    const model = mountBound([{ type: "special", match: "nan", text: "x", color: null }]);
    await pick(`${PREFIX}-type-select-0`, "value");
    expect(model.value[0].type).toBe("value");
    expect(model.value[0]).not.toHaveProperty("match");
    expect(wrapper!.find(`[data-test="${PREFIX}-value-input-0"]`).exists()).toBe(true);
  });
});
