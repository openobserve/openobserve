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
import RcaCancelRunDialog from "./RcaCancelRunDialog.vue";

const ODialog = {
  props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonLoading"],
  emits: ["click:primary", "click:secondary", "update:open"],
  template:
    "<div v-if='open' data-test='rca-cancel-dialog' :data-loading='primaryButtonLoading'><h2>{{ title }}</h2><slot /><button data-test='dialog-secondary' @click=\"$emit('click:secondary')\">{{ secondaryButtonLabel }}</button><button data-test='dialog-primary' @click=\"$emit('click:primary')\">{{ primaryButtonLabel }}</button></div>",
};

const mountDialog = () =>
  mount(RcaCancelRunDialog, {
    props: {
      open: true,
      incidentNumber: "482",
      cancelling: false,
      "onUpdate:open": () => undefined,
    },
    global: { plugins: [i18n], stubs: { ODialog } },
  });

describe("RcaCancelRunDialog", () => {
  it("names the incident and keeps the run on Keep running", async () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain("Cancel the analysis for everyone on incident #482?");
    await wrapper.get('[data-test="dialog-secondary"]').trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  it("W5: stays open with its loading state until the cancel settles", async () => {
    const wrapper = mountDialog();
    await wrapper.setProps({ onConfirm: () => wrapper.setProps({ cancelling: true }) });
    await wrapper.get('[data-test="dialog-primary"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("confirm")).toHaveLength(1);
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.get('[data-test="rca-cancel-dialog"]').attributes("data-loading")).toBe("true");

    await wrapper.setProps({ cancelling: false });
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("closes at once when the page starts no cancel", async () => {
    const wrapper = mountDialog();
    await wrapper.get('[data-test="dialog-primary"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });
});
