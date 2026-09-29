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

import { describe, expect, it, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import ColumnFormatControls from "@/components/dashboards/ColumnFormatControls.vue";
import {
  emptyColumnOverride,
  type ColumnOverrideUI,
} from "@/composables/dashboard/useColumnFormatting";
import i18n from "@/locales";

describe("ColumnFormatControls – Locale Format locale", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
  });

  const mountWith = (overrides: Partial<ColumnOverrideUI>) => {
    const col = reactive({ ...emptyColumnOverride("amount"), ...overrides });
    wrapper = mount(ColumnFormatControls, {
      props: { col, isNumeric: true },
      global: { plugins: [i18n] },
    });
    return col;
  };
  const findSelect = (dataTest: string) =>
    wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c: any) => c.vm.$attrs["data-test"] === dataTest);
  const trigger = () => wrapper.find('[data-test="o2-format-unit-locale-amount-trigger"]');

  it("shows the locale selector only for the Locale Format unit", () => {
    mountWith({ unit: "bytes" });
    expect(trigger().exists()).toBe(false);
    wrapper.unmount();

    mountWith({ unit: "locale" });
    expect(trigger().exists()).toBe(true);
    expect(trigger().attributes("data-test-selected-label")).toBe("Auto (viewer's language)");
  });

  it("writes the chosen locale to unitLocale and leaves customUnit alone", async () => {
    const col = mountWith({ unit: "locale", customUnit: "req/s" });
    await findSelect("o2-format-unit-locale-amount").vm.$emit("update:modelValue", "hi-IN");
    await flushPromises();
    expect(col.unitLocale).toBe("hi-IN");
    expect(col.customUnit).toBe("req/s");
  });

  it("does not read the locale from customUnit", () => {
    mountWith({ unit: "locale", customUnit: "cs-CZ" });
    expect(trigger().attributes("data-test-selected-label")).toBe("Auto (viewer's language)");
  });
});
