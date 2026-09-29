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

describe("ColumnFormatControls – Locale Format in the Unit dropdown", () => {
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
  const unitSelect = () =>
    wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c: any) => c.vm.$attrs["data-test"] === "o2-format-unit-amount");

  it("nests the locales under the expandable Other Locale row", () => {
    mountWith({ unit: null });
    const options = unitSelect().props("options");
    expect(options).toContainEqual(
      expect.objectContaining({ label: "Other Locale", value: "other-locale", expandable: true }),
    );
    expect(options).toContainEqual(
      expect.objectContaining({
        label: "Hindi - IN (hi_IN)",
        value: "locale:hi-IN",
        parentValue: "other-locale",
      }),
    );
  });

  it("saves a picked locale in the column unit and leaves customUnit alone", async () => {
    const col = mountWith({ unit: "locale", customUnit: "req/s" });
    await unitSelect().vm.$emit("update:modelValue", "locale:hi-IN");
    await flushPromises();
    expect(col.unit).toBe("locale:hi-IN");
    expect(col.customUnit).toBe("req/s");
  });

  it("keeps an unlisted pinned locale selectable", () => {
    mountWith({ unit: "locale:sl-SI" });
    expect(unitSelect().props("options")).toContainEqual(
      expect.objectContaining({ value: "locale:sl-SI" }),
    );
  });
});
