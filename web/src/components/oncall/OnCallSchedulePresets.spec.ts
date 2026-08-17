// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallSchedulePresets from "@/components/oncall/OnCallSchedulePresets.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { PresetDescriptor } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: { listSchedulePresets: vi.fn(), applySchedulePreset: vi.fn() },
}));
const service = vi.mocked(oncallService);

// A synthetic preset, NOT one of the four real ones: the drawer's contract is
// that any catalogue entry renders unaided, and a fixture copied from the real
// follow_the_sun would quietly re-test the hardcoding this component forbids.
const preset: PresetDescriptor = {
  id: "test_shape",
  name: "Test shape",
  description: "Two layers over a catch-all",
  layers: ["layer one", "catch-all"],
  inputs: [
    { field: "label", kind: "text", label: "Name", description: "", required: true },
    {
      field: "groups",
      kind: "group_list",
      label: "Groups",
      description: "",
      required: true,
      min: 2,
      max: 3,
      fields: [
        { field: "name", kind: "text", label: "Group", description: "", required: true },
        {
          field: "members",
          kind: "member_list",
          label: "Members",
          description: "",
          required: true,
        },
      ],
    },
  ],
};

const stubs = {
  ODrawer: {
    name: "ODrawer",
    props: ["open"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue"],
    emits: ["update:ok"],
    template: "<div v-if='modelValue' data-test='confirm-stub' />",
  },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="$emit('click')"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></label>`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<select /></label>`,
  },
};

async function renderOpen(hasSchedule = false) {
  const wrapper = mount(OnCallSchedulePresets, {
    props: { teamId: "team_1", members: [], hasSchedule, open: true, "onUpdate:open": () => {} },
    global: { plugins: [i18n, store], stubs },
  });
  await flushPromises();
  return wrapper;
}

describe("OnCallSchedulePresets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listSchedulePresets.mockResolvedValue({ data: [preset] } as any);
    service.applySchedulePreset.mockResolvedValue({ data: {} } as any);
  });

  it("offers each catalogue entry as a card with its layers", async () => {
    const wrapper = await renderOpen();
    const card = wrapper.find('[data-test="oncall-preset-test_shape"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("catch-all");
  });

  /// The form opens valid-shaped: the catalogue's own `min`, not a hardcoded
  /// count. A fifth preset with min 3 must open with three groups, unaided.
  it("generates the form from the inputs schema, starting at min groups", async () => {
    const wrapper = await renderOpen();
    await wrapper.find('[data-test="oncall-preset-test_shape"]').trigger("click");

    expect(wrapper.find('[data-test="oncall-preset-field-label"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test^="oncall-preset-group-groups-"]')).toHaveLength(2);
  });

  it("caps add-group at the catalogue's max", async () => {
    const wrapper = await renderOpen();
    await wrapper.find('[data-test="oncall-preset-test_shape"]').trigger("click");

    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");
    expect(wrapper.findAll('[data-test^="oncall-preset-group-groups-"]')).toHaveLength(3);
    // At max the add affordance is gone, not disabled-and-mysterious.
    expect(wrapper.find('[data-test="oncall-preset-group-add-groups"]').exists()).toBe(false);
  });

  it("applies without ceremony when the team has no schedule to lose", async () => {
    const wrapper = await renderOpen(false);
    await wrapper.find('[data-test="oncall-preset-test_shape"]').trigger("click");
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(service.applySchedulePreset).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ preset: "test_shape" }) }),
    );
    expect(wrapper.emitted("applied")).toBeTruthy();
  });

  /// A full replace of a working schedule gets a confirm; replacing nothing
  /// is a click tax.
  it("confirms before replacing an existing schedule", async () => {
    const wrapper = await renderOpen(true);
    await wrapper.find('[data-test="oncall-preset-test_shape"]').trigger("click");
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(service.applySchedulePreset).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="confirm-stub"]').exists()).toBe(true);
  });

  /// Sixteen named-field rejections server-side, each written for the person
  /// who typed the value. Verbatim, in the drawer, beside the form.
  it("shows the server's rejection sentence verbatim", async () => {
    service.applySchedulePreset.mockRejectedValue({
      response: { data: { message: "regions 2 and 3 overlap at minute 480" } },
    });
    const wrapper = await renderOpen(false);
    await wrapper.find('[data-test="oncall-preset-test_shape"]').trigger("click");
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-presets-error"]').text()).toContain(
      "regions 2 and 3 overlap at minute 480",
    );
    expect(wrapper.emitted("applied")).toBeFalsy();
  });
});
