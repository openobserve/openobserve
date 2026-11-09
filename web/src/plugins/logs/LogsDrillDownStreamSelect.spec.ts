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

import { describe, it, expect, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import LogsDrillDownStreamSelect from "./LogsDrillDownStreamSelect.vue";

const streams = [
  { name: "app_logs", is_internal: false },
  { name: "audit_logs", is_internal: false },
];

let wrapper: VueWrapper<any> | null = null;

const mountSelect = (modelValue: string | null = "app_logs") => {
  wrapper = mount(LogsDrillDownStreamSelect, {
    attachTo: document.body,
    props: { streams, modelValue },
    global: { plugins: [i18n, store] },
  });
  return wrapper;
};

const trigger = () => wrapper!.find('[data-test="logs-drilldown-stream-select-trigger"]');

describe("LogsDrillDownStreamSelect", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("shows the selected stream on the trigger", () => {
    mountSelect();

    expect(trigger().attributes("data-test-selected-value")).toBe("app_logs");
  });

  it("offers every stream as an option", () => {
    mountSelect();

    const values = (wrapper!.findComponent(OSelect).props("options") as { value?: string }[]).map(
      (option) => option.value,
    );
    expect(values).toEqual(["app_logs", "audit_logs"]);
  });

  it("emits the newly picked stream and ignores re-picking the current one", () => {
    mountSelect();
    const select = wrapper!.findComponent(OSelect);

    select.vm.$emit("update:modelValue", "app_logs");
    select.vm.$emit("update:modelValue", "audit_logs");

    expect(wrapper!.emitted("update:modelValue")).toEqual([["audit_logs"]]);
  });

  it("opens the picker through the exposed open()", async () => {
    mountSelect(null);

    wrapper!.vm.open();
    await flushPromises();

    expect(trigger().attributes("aria-expanded")).toBe("true");
  });
});
