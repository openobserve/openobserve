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
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import RcaGuidanceDialog from "./RcaGuidanceDialog.vue";

// ODialog portals its content; the stub keeps the body and the button props in place.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "primaryButtonLabel", "primaryButtonDisabled"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div v-if="open" data-test="dialog-stub"><h2>{{ title }}</h2><slot /></div>`,
};

const mountDialog = (props: Record<string, unknown> = {}) =>
  mount(RcaGuidanceDialog, {
    props: { open: true, canBuildOnPrevious: true, ...props },
    global: { plugins: [i18n], stubs: { ODialog: ODialogStub } },
  });

const dialog = (wrapper: VueWrapper) => wrapper.findComponent(ODialogStub);
const guidanceBox = (wrapper: VueWrapper) => wrapper.find("textarea");

describe("RcaGuidanceDialog (04 §3 frame I, SG33, SG40)", () => {
  it("frame I: title, the two modes, Guidance and the new-version note", () => {
    const wrapper = mountDialog();

    expect(dialog(wrapper).props("title")).toBe("Re-analyze with guidance");
    expect(dialog(wrapper).props("primaryButtonLabel")).toBe("Start re-analysis");
    expect(wrapper.text()).toContain("Fresh analysis");
    expect(wrapper.text()).toContain("Start from scratch, ignoring this report");
    expect(wrapper.text()).toContain("Build on previous");
    expect(wrapper.text()).toContain("Send this report so the agent extends it");
    expect(wrapper.text()).toContain("Guidance");
    expect(wrapper.find('[data-test="rca-guidance-note"]').text()).toBe(
      "Creates a new report version. This one stays as is.",
    );
    expect(guidanceBox(wrapper).attributes("maxlength")).toBe("2000");
  });

  it("SG40: opens with the given text in Guidance", () => {
    const wrapper = mountDialog({ initialGuidance: "PR #812 went out at 14:02" });

    expect((guidanceBox(wrapper).element as HTMLTextAreaElement).value).toBe(
      "PR #812 went out at 14:02",
    );
  });

  it("each opening starts again from the given text", async () => {
    const wrapper = mountDialog({ open: false, initialGuidance: "first" });
    await wrapper.setProps({ open: true });
    await guidanceBox(wrapper).setValue("edited");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true, initialGuidance: "second" });

    expect((guidanceBox(wrapper).element as HTMLTextAreaElement).value).toBe("second");
  });

  it("Start is disabled without guidance", async () => {
    const wrapper = mountDialog();
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);
    await guidanceBox(wrapper).setValue("   ");
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);
    await guidanceBox(wrapper).setValue("Check the pool");
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);
  });

  it("sends {guidance} with Build on previous by default when a report exists, then closes", async () => {
    const wrapper = mountDialog({ initialGuidance: "  Check the pool  " });

    await dialog(wrapper).vm.$emit("click:primary");

    expect(wrapper.emitted("start")).toEqual([
      [{ buildOnPrevious: true, guidance: "Check the pool" }],
    ]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("sends the Fresh mode when picked", async () => {
    const wrapper = mountDialog({ initialGuidance: "Ignore the canary" });

    await wrapper.findComponent(ORadioGroup).vm.$emit("update:modelValue", "fresh");
    await dialog(wrapper).vm.$emit("click:primary");

    expect(wrapper.emitted("start")).toEqual([
      [{ buildOnPrevious: false, guidance: "Ignore the canary" }],
    ]);
  });

  it("without a report: Fresh by default and Build on previous disabled", async () => {
    const wrapper = mountDialog({ canBuildOnPrevious: false, initialGuidance: "x" });

    const build = wrapper
      .findAllComponents(ORadio)
      .find((radio) => radio.props("value") === "build");
    expect(build?.props("disabled")).toBe(true);
    await dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("start")).toEqual([[{ buildOnPrevious: false, guidance: "x" }]]);
  });
});
