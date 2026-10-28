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

const ROTATIONS = [
  { id: "r1", name: "Primary", shift_rules: [] },
  { id: "r2", name: "Secondary", shift_rules: [] },
];
const HOLDERS = [
  { rotation_id: "r1", name: "Carol Nguyen" },
  { rotation_id: "r2", name: "Riya Root" },
];

function render(policy: unknown, rotationId = "r2", holders = HOLDERS) {
  return mount(OnCallRemoveRotationDialog, {
    props: { open: true, rotationId, rotations: ROTATIONS, holders, policy: policy as any },
    global: { plugins: [i18n], stubs },
  });
}

const dialog = (wrapper: ReturnType<typeof render>) => wrapper.findComponent({ name: "ODialog" });

// S11: removing a rotation says what it does to the escalation policy before it happens.
describe("OnCallRemoveRotationDialog", () => {
  // Owner: the title names the rotation; the body says, with names, who holds it and that nobody takes its shifts.
  it("names the rotation in the title and the people in the body", () => {
    const wrapper = render(null);

    expect(dialog(wrapper).props("title")).toBe("Delete the Secondary rotation?");
    expect(dialog(wrapper).props("primaryButtonLabel")).toBe("Delete rotation");
    expect(wrapper.find('[data-test="oncall-remove-rotation-body"]').text()).toBe(
      "Riya Root is on call in Secondary now. Once it's deleted, nobody takes over its shifts; Primary (Carol Nguyen) keeps its own.",
    );
  });

  it("says when nobody holds it now and no other rotation exists", () => {
    const wrapper = mount(OnCallRemoveRotationDialog, {
      props: {
        open: true,
        rotationId: "r2",
        rotations: [ROTATIONS[1]],
        holders: [],
        policy: null,
      },
      global: { plugins: [i18n], stubs },
    });

    expect(wrapper.find('[data-test="oncall-remove-rotation-body"]').text()).toBe(
      "Nobody is on call in Secondary now. Once it's deleted, nobody takes over its shifts.",
    );
  });

  it("lists the generated steps that go with the rotation", async () => {
    const wrapper = render(pagesR2(true));

    expect(wrapper.find('[data-test="oncall-remove-rotation-steps"]').text()).toBe(
      "The escalation step that pages Secondary is removed too: P1 step 2.",
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
      "P1 step 2 of the escalation policy pages Secondary. Edit the policy first.",
    );
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);
    await wrapper.find('[data-test="oncall-remove-rotation-open-policy"]').trigger("click");
    expect(wrapper.emitted("open-policy")).toHaveLength(1);
  });

  // F7: an older server does not say how the ladder was made, so the dialog warns the remove may be refused.
  it("warns, without blocking, when the server did not say how the ladder was made", async () => {
    const wrapper = render(pagesR2(undefined));

    expect(wrapper.find('[data-test="oncall-remove-rotation-may-refuse"]').text()).toBe(
      "P1 step 2 of the escalation policy pages Secondary. If the policy was edited by hand, the delete is refused until it stops paging Secondary.",
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
      expect(wrapper.find('[data-test="oncall-remove-rotation-body"]').exists()).toBe(true);
    }
  });
});
