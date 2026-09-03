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

// A synthetic preset, NOT one of the four real ones: the screen's contract is
// that any catalogue entry renders unaided, and a fixture copied from the real
// follow_the_sun would quietly re-test the hardcoding this component forbids.
// It also has an id the shape table has never heard of, so these tests exercise
// the no-coverage-picture fallback rather than the four known shapes.
const preset: PresetDescriptor = {
  id: "test_shape",
  name: "Test shape",
  description: "Two layers over a catch-all",
  layers: ["layer one", "catch-all"],
  inputs: [
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
        {
          field: "start_minute",
          kind: "minute_of_day",
          label: "From",
          description: "",
          required: true,
        },
        {
          field: "end_minute",
          kind: "minute_of_day",
          label: "Until",
          description: "",
          required: true,
        },
      ],
    },
    {
      field: "catch_all",
      kind: "group",
      label: "Everything else",
      description: "Who covers the hours no group claims.",
      required: false,
      fields: [
        {
          field: "members",
          kind: "member_list",
          label: "Members",
          description: "",
          required: true,
        },
      ],
    },
    {
      field: "timezone",
      kind: "timezone",
      label: "Timezone",
      description: "",
      required: false,
    },
  ],
};

// A second entry, so switching tabs is a real change of shape.
const other: PresetDescriptor = {
  id: "other_shape",
  name: "Other shape",
  description: "One layer",
  layers: ["only"],
  inputs: [
    {
      field: "only",
      kind: "group",
      label: "Only",
      description: "",
      required: true,
      fields: [
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
  OTabs: {
    name: "OTabs",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  OTab: {
    name: "OTab",
    props: ["name", "label"],
    emits: ["click"],
    template: `<button @click="$emit('click')">{{ label }}</button>`,
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue"],
    emits: ["update:ok"],
    template: "<div v-if='modelValue' data-test='confirm-stub' />",
  },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<i />" },
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
  OInlineEdit: {
    name: "OInlineEdit",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<span>{{ modelValue }}</span>`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<select /></label>`,
  },
  OToggleGroup: { name: "OToggleGroup", template: "<div><slot /></div>" },
  OToggleGroupItem: { name: "OToggleGroupItem", template: "<button><slot /></button>" },
  OnCallMemberPicker: {
    name: "OnCallMemberPicker",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<div class="member-picker" />`,
  },
};

async function renderOpen(rotationCount = 0) {
  const wrapper = mount(OnCallSchedulePresets, {
    props: {
      teamId: "team_1",
      members: [],
      timezone: "UTC",
      rotationCount,
      open: true,
      "onUpdate:open": () => {},
    },
    global: { plugins: [i18n, store], stubs },
  });
  await flushPromises();
  return wrapper;
}

describe("OnCallSchedulePresets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listSchedulePresets.mockResolvedValue({ data: [preset, other] } as any);
    service.applySchedulePreset.mockResolvedValue({ data: {} } as any);
  });

  /// The shapes are a comparison, so they stay on one strip — and the first is
  /// already chosen, because an empty body charges a click for a shape nobody
  /// had rejected yet.
  it("puts every shape on the tab strip and opens on the first one", async () => {
    const wrapper = await renderOpen();

    expect(wrapper.find('[data-test="oncall-preset-test_shape"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OTabs" }).props("modelValue")).toBe("test_shape");
    // The name is on the tab, so the line under it carries what it builds.
    expect(wrapper.text()).toContain("Two layers over a catch-all");
    expect(wrapper.findAll('[data-test^="oncall-preset-row-"]').length).toBeGreaterThan(0);
  });

  /// The form opens valid-shaped: the catalogue's own `min`, not a hardcoded
  /// count. A fifth preset with min 3 must open with three rows, unaided.
  it("generates a row per layer from the inputs schema, starting at min groups", async () => {
    const wrapper = await renderOpen();

    expect(wrapper.find('[data-test="oncall-preset-row-groups-0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-preset-row-groups-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-preset-row-groups-2"]').exists()).toBe(false);
    // The optional group is a row too, and carries the whole catch-all rule.
    expect(wrapper.find('[data-test="oncall-preset-row-catch_all"]').exists()).toBe(true);
  });

  /// The window fields the catalogue put on the group land on that group's row,
  /// beside its people, rather than in a stack of separate labelled fields.
  it("puts a group's own start/end pair on its row", async () => {
    const wrapper = await renderOpen();

    expect(wrapper.find('[data-test="oncall-preset-field-groups-0-from"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-preset-field-groups-0-to"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-preset-field-groups-0-members"]').exists()).toBe(true);
  });

  /// The catalogue gives a region's window no default, because it has no
  /// opinion about how many regions there are. Opening on blank time pickers
  /// made the first thing the screen said "168 hours nobody covers" — about a
  /// shape whose whole promise is that it covers them.
  it("opens with the regions tiling the day between them", async () => {
    const wrapper = await renderOpen();
    const at = (key: string, edge: string) =>
      wrapper.findComponent(`[data-test="oncall-preset-field-${key}-${edge}"]`).props("modelValue");

    expect([at("groups-0", "from"), at("groups-0", "to")]).toEqual([0, 720]);
    expect([at("groups-1", "from"), at("groups-1", "to")]).toEqual([720, 1440]);
  });

  /// A region with no hours is a row that changes nothing, and the picture
  /// above it would not move — so a new one takes half of the last one.
  it("makes room for a new region by halving the last", async () => {
    const wrapper = await renderOpen();
    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");
    const at = (key: string, edge: string) =>
      wrapper.findComponent(`[data-test="oncall-preset-field-${key}-${edge}"]`).props("modelValue");

    expect([at("groups-1", "from"), at("groups-1", "to")]).toEqual([720, 1080]);
    expect([at("groups-2", "from"), at("groups-2", "to")]).toEqual([1080, 1440]);
  });

  /// Reka activates a tab on mousedown, so the strip drives the body through
  /// its v-model rather than through a click handler of ours.
  it("rebuilds the form when the strip picks another shape", async () => {
    const wrapper = await renderOpen();
    await wrapper.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "other_shape");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-preset-row-only"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-preset-row-groups-0"]').exists()).toBe(false);
  });

  /// Re-picking the tab you are already on is a no-op, not a reset — the strip
  /// re-emits its own value on focus, and that must not empty the form.
  it("keeps what has been typed when the open tab is picked again", async () => {
    const wrapper = await renderOpen();
    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-preset-row-groups-2"]').exists()).toBe(true);

    await wrapper.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "test_shape");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-preset-row-groups-2"]').exists()).toBe(true);
  });

  it("caps add-group at the catalogue's max", async () => {
    const wrapper = await renderOpen();

    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-preset-row-groups-2"]').exists()).toBe(true);
    // At max the add affordance is gone, not disabled-and-mysterious.
    expect(wrapper.find('[data-test="oncall-preset-group-add-groups"]').exists()).toBe(false);
  });

  /// The catch-all already has an answer. Offering an empty picker instead read
  /// as a required field nobody knew how to fill.
  it("states the catch-all default and only asks when overridden", async () => {
    const wrapper = await renderOpen();
    const row = wrapper.find('[data-test="oncall-preset-row-catch_all"]');
    expect(row.text()).toContain("everyone above");
    expect(wrapper.find('[data-test="oncall-preset-field-catch_all-members"]').exists()).toBe(
      false,
    );

    await wrapper.find('[data-test="oncall-preset-override-catch_all"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-preset-field-catch_all-members"]').exists()).toBe(true);
  });

  /// The three "how it ticks" answers are right by default, so they read as a
  /// sentence and open only when somebody disagrees with one.
  it("collapses timezone and cadence into a sentence until Change is pressed", async () => {
    const wrapper = await renderOpen();
    expect(wrapper.find('[data-test="oncall-preset-field-timezone"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-preset-field-timezone"]').exists()).toBe(true);
  });

  /// Every row whose title is a required text field (the fixture's two
  /// groups) needs a name typed in before Apply is a valid click — the same
  /// thing a real operator has to do for follow-the-sun's regions.
  async function nameGroups(wrapper: Awaited<ReturnType<typeof renderOpen>>) {
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-0-name"]')
      .vm.$emit("update:modelValue", "APAC");
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-1-name"]')
      .vm.$emit("update:modelValue", "EMEA");
  }

  /// Absent beats empty: an un-overridden catch-all must not be sent as an
  /// empty group, which the server would read as "nobody covers the rest".
  it("applies without ceremony when the team has no schedule to lose", async () => {
    const wrapper = await renderOpen(0);
    await nameGroups(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    const sent = service.applySchedulePreset.mock.calls[0]?.[0] as any;
    expect(sent.data.preset).toBe("test_shape");
    expect(sent.data.catch_all).toBeUndefined();
    expect(wrapper.emitted("applied")).toBeTruthy();
  });

  /// The bug this guards: a group whose required name was never typed in must
  /// never reach the network — the server refuses it too, but only after a
  /// round trip, and with axum's raw extraction-failure text rather than a
  /// sentence written for the person who left the field blank.
  it("blocks apply and names the field when a required group name is blank", async () => {
    const wrapper = await renderOpen(0);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(service.applySchedulePreset).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="oncall-presets-error"]').text()).toContain("Group");
    expect(wrapper.emitted("applied")).toBeFalsy();
  });

  /// A full replace of a working schedule gets a confirm; replacing nothing
  /// is a click tax.
  it("confirms before replacing an existing schedule, and says how much", async () => {
    const wrapper = await renderOpen(2);
    expect(wrapper.text()).toContain("2 existing rotations");

    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(service.applySchedulePreset).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="confirm-stub"]').exists()).toBe(true);
  });

  /// Sixteen named-field rejections server-side, each written for the person
  /// who typed the value. Verbatim, on the screen, beside the form.
  it("shows the server's rejection sentence verbatim", async () => {
    service.applySchedulePreset.mockRejectedValue({
      response: { data: { message: "regions 2 and 3 overlap at minute 480" } },
    });
    const wrapper = await renderOpen(0);
    await nameGroups(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-presets-error"]').text()).toContain(
      "regions 2 and 3 overlap at minute 480",
    );
    expect(wrapper.emitted("applied")).toBeFalsy();
  });

  /// The other half of the original bug: when the failure never reaches the
  /// app's own error shape — axum's extraction rejection is plain text, not
  /// `{message}` — the caught error's `data` IS that string. The screen must
  /// still show it, not axios's generic "Request failed with status code 422".
  it("shows a plain-text rejection body when the server never wrapped it in JSON", async () => {
    service.applySchedulePreset.mockRejectedValue({
      response: {
        data: "Failed to deserialize the JSON body: missing field `name` at line 1 column 227",
      },
      message: "Request failed with status code 422",
    });
    const wrapper = await renderOpen(0);
    await nameGroups(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-presets-error"]').text()).toContain(
      "missing field `name`",
    );
  });
});
