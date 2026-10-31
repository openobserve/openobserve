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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import TraceErrorSpansMenu from "./TraceErrorSpansMenu.vue";
import type { ErrorSpanSummary } from "../utils/traceErrorSummary";

const ERRORS: ErrorSpanSummary[] = [
  {
    spanId: "deep",
    serviceName: "postgres",
    operationName: "SELECT products",
    message: "connection reset",
  },
  {
    spanId: "shallow",
    serviceName: "frontend",
    operationName: "POST /api/checkout",
    message: "",
  },
];

const dropdownStubs = {
  ODropdown: {
    name: "ODropdown",
    template: '<div v-bind="$attrs"><slot name="trigger" /><slot /></div>',
    props: ["open", "side", "align", "contentClass"],
  },
  ODropdownItem: {
    name: "ODropdownItem",
    template: '<div v-bind="$attrs" @click="$emit(\'select\')"><slot /></div>',
    emits: ["select"],
  },
};

const mountMenu = (errors: ErrorSpanSummary[]) =>
  mount(TraceErrorSpansMenu, {
    props: { errors },
    global: { plugins: [i18n], stubs: dropdownStubs },
  });

describe("TraceErrorSpansMenu", () => {
  it("renders no chip when there are no errors", () => {
    expect(mountMenu([]).find('[data-test="trace-details-error-spans-count"]').exists()).toBe(
      false,
    );
  });

  it("shows the error count on the chip", () => {
    expect(mountMenu(ERRORS).get('[data-test="trace-details-error-spans-count"]').text()).toContain(
      "2 errors",
    );
  });

  it("lists error spans in the given deepest-first order with their messages", () => {
    const items = mountMenu(ERRORS).findAll('[data-test^="trace-details-error-spans-item-"]');
    expect(items.map((i) => i.attributes("data-test"))).toEqual([
      "trace-details-error-spans-item-deep",
      "trace-details-error-spans-item-shallow",
    ]);
    expect(items[0].text()).toContain("postgres · SELECT products");
    expect(items[0].text()).toContain("connection reset");
  });

  it("emits the span id of the chosen item", async () => {
    const wrapper = mountMenu(ERRORS);
    await wrapper.get('[data-test="trace-details-error-spans-item-shallow"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([["shallow"]]);
  });
});
