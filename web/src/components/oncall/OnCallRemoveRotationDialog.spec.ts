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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallRemoveRotationDialog from "@/components/oncall/OnCallRemoveRotationDialog.vue";
import i18n from "@/locales";

const stubs = {
  ODialog: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonLabel", "primaryButtonDisabled", "primaryButtonVariant"],
    emits: ["click:primary", "click:secondary", "update:open"],
    template: "<div v-if='open'>{{ title }} <slot /></div>",
  },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
};

const pagesR2 = (generated: boolean | undefined) => ({
  ladder_is_generated: generated,
  rungs: [
    {
      priority: 1 as const,
      channels: [],
      steps: [
        { after_micros: 0, targets: [{ kind: "rotation" as const, rotation_id: "r1" }] },
        { after_micros: 1, targets: [{ kind: "rotation" as const, rotation_id: "r2" }] },
      ],
    },
  ],
});

function render(policy: unknown, rotationId = "r2") {
  return mount(OnCallRemoveRotationDialog, {
    props: {
      open: true,
      title: "Remove Secondary?",
      messageKeypath: "oncall.removeRotationMessage",
      messageName: "Secondary",
      okLabel: "Remove rotation",
      rotationId,
      policy: policy as any,
    },
    global: { plugins: [i18n], stubs },
  });
}

const dialog = (wrapper: ReturnType<typeof render>) => wrapper.findComponent({ name: "ODialog" });

// S11: removing a rotation says what it does to the escalation policy before it happens.
describe("OnCallRemoveRotationDialog", () => {
  it("lists the generated steps that go with the rotation", async () => {
    const wrapper = render(pagesR2(true));

    expect(wrapper.find('[data-test="oncall-remove-rotation-steps"]').text()).toBe(
      "P1 step 2 is removed from the escalation policy too.",
    );
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);
    // Removing a rotation is destructive, so its button is red like every other delete.
    expect(dialog(wrapper).props("primaryButtonVariant")).toBe("destructive");
    dialog(wrapper).vm.$emit("click:primary");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("refuses while a hand-edited policy pages the rotation, and links to it", async () => {
    const wrapper = render(pagesR2(false));

    expect(wrapper.find('[data-test="oncall-remove-rotation-blocked"]').text()).toBe(
      "P1 step 2 of the escalation policy pages this rotation. Edit the policy first.",
    );
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);
    await wrapper.find('[data-test="oncall-remove-rotation-open-policy"]').trigger("click");
    expect(wrapper.emitted("open-policy")).toHaveLength(1);
  });

  // F7: an older server does not say how the ladder was made, so the dialog warns the remove may be refused.
  it("warns, without blocking, when the server did not say how the ladder was made", async () => {
    const wrapper = render(pagesR2(undefined));

    expect(wrapper.find('[data-test="oncall-remove-rotation-may-refuse"]').text()).toBe(
      "P1 step 2 of the escalation policy pages this rotation. If the policy was edited by hand, the remove is refused until the policy stops paging it.",
    );
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);
    await wrapper.find('[data-test="oncall-remove-rotation-open-policy"]').trigger("click");
    expect(wrapper.emitted("open-policy")).toHaveLength(1);
  });

  it("adds nothing when no step pages it, or when the policy is not loaded", () => {
    for (const wrapper of [
      render(pagesR2(false), "r9"),
      render(pagesR2(undefined), "r9"),
      render(null),
    ]) {
      expect(wrapper.find('[data-test="oncall-remove-rotation-steps"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-remove-rotation-blocked"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-remove-rotation-may-refuse"]').exists()).toBe(false);
      expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);
      expect(wrapper.text()).toContain("It is deleted now, for everyone on this team.");
      // Named in bold, the way every delete confirm names its item.
      expect(wrapper.find('[data-test="oncall-remove-rotation-name"]').text()).toBe("Secondary");
    }
  });
});
