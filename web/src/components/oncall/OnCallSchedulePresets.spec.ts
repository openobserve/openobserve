// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallSchedulePresets from "@/components/oncall/OnCallSchedulePresets.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { PresetDescriptor, Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { fromZonedInputValue } from "@/utils/oncall";

vi.mock("@/services/oncall", () => ({
  default: { listSchedulePresets: vi.fn(), applySchedulePreset: vi.fn() },
}));
const service = vi.mocked(oncallService);
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
const toasted = vi.mocked(toast);

const at = (local: string) => fromZonedInputValue(local, "UTC") as number;
// Thursday, so the new-rotation anchor default (latest Monday 00:00) is a different day.
const NOW = at("2026-11-05T11:00");
vi.mock("@/composables/useOnCallClock", async () => {
  const { ref } = await import("vue");
  return { useOnCallClock: () => ref(NOW) };
});

const phone = vi.hoisted(() => ({ on: false }));
vi.mock("@/composables/useBreakpoint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useBreakpoint")>();
  const { computed } = await import("vue");
  return {
    default: () => ({ ...actual.default(), isMobile: computed(() => phone.on) }),
  };
});

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
    // An older server still lists a timezone; the drawer must not offer it.
    {
      field: "timezone",
      kind: "timezone",
      label: "Timezone",
      description: "",
      required: false,
      default: "Asia/Tokyo",
    },
    {
      field: "handover_micros",
      kind: "duration_micros",
      label: "Hand over every",
      description: "",
      required: false,
      default: MICROS_PER_WEEK,
    },
    {
      field: "anchor_micros",
      kind: "timestamp_micros",
      label: "First shift begins",
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

// The week cut at one boundary: the only shape with scalars between its rows.
const split: PresetDescriptor = {
  id: "split_shape",
  name: "Split shape",
  description: "Two halves of the week",
  layers: ["first", "second"],
  inputs: [
    {
      field: "first",
      kind: "group",
      label: "Start of the week",
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
    {
      field: "boundary_day",
      kind: "day_of_week",
      label: "Hand over on",
      description: "0 = Monday … 6 = Sunday.",
      required: false,
      default: 3,
    },
    {
      field: "boundary_minute",
      kind: "minute_of_day",
      label: "Hand over at",
      description: "Minutes past midnight.",
      required: false,
      default: 0,
    },
  ],
};

const rule = (members: string[], over: Partial<Rotation["shift_rules"][number]> = {}) => ({
  name: "Base",
  members,
  shift_micros: MICROS_PER_DAY,
  anchor_micros: at("2026-11-03T09:00"),
  ...over,
});
const PRIMARY: Rotation = { id: "r1", name: "Primary", shift_rules: [rule(["a@example.com"])] };
const SECONDARY: Rotation = {
  id: "r2",
  name: "Secondary",
  shift_rules: [rule(["raj@example.com", "tom@example.com"])],
};

const stubs = {
  ODrawer: {
    name: "ODrawer",
    props: ["open", "title"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "title", "message"],
    emits: ["update:ok"],
    template: "<div v-if='modelValue' data-test='confirm-stub'>{{ title }} {{ message }}</div>",
  },
  ODialog: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonLabel"],
    emits: ["click:primary"],
    template:
      "<div v-if='open' data-test='confirm-stub'><h3>{{ title }}</h3><slot /><button data-test='confirm-ok' @click=\"$emit('click:primary')\">{{ primaryButtonLabel }}</button></div>",
  },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OButton: {
    name: "OButton",
    props: ["disabled", "loading"],
    emits: ["click"],
    template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue", "label", "error", "maxlength", "disabled"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></label>`,
  },
  ODate: {
    name: "ODate",
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<input type="date" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></label>`,
  },
  OTime: {
    name: "OTime",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input type="time" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OInlineEdit: {
    name: "OInlineEdit",
    props: ["modelValue", "error", "maxlength"],
    emits: ["update:modelValue"],
    template: `<span>{{ modelValue }}</span>`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label", "clearable"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<select /></label>`,
  },
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: "<button><slot /></button>",
  },
  OnCallMemberPicker: {
    name: "OnCallMemberPicker",
    props: ["modelValue", "error"],
    emits: ["update:modelValue"],
    template: `<div class="member-picker" />`,
  },
};

async function renderOpen(rotations: Rotation[] = [], startOn = "") {
  const wrapper = mount(OnCallSchedulePresets, {
    props: {
      teamId: "team_1",
      members: [],
      timezone: "UTC",
      rotations,
      startOn,
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
    phone.on = false;
    service.listSchedulePresets.mockResolvedValue({ data: [preset, other, split] } as any);
    service.applySchedulePreset.mockResolvedValue({ data: {} } as any);
  });

  it("tells the page when the license refuses the catalogue", async () => {
    queryClient.clear();
    service.listSchedulePresets.mockRejectedValueOnce({
      response: { status: 403, data: { code: 40001, error_detail: "oncall" } },
    });
    const wrapper = await renderOpen();

    expect(wrapper.emitted("licenseDenied")).toEqual([[["oncall"]]]);
  });

  /// The first card is already chosen: an empty body charges a click for a shape nobody had rejected yet.
  it("puts every shape on a radio card with its description and opens on the first one", async () => {
    const wrapper = await renderOpen();

    const group = wrapper.findComponent({ name: "ORadioGroup" });
    expect(group.props("modelValue")).toBe("test_shape");
    const cards = wrapper.findAllComponents({ name: "ORadio" });
    expect(cards.map((card) => card.props("value"))).toEqual([
      "test_shape",
      "other_shape",
      "split_shape",
    ]);
    expect(cards[0].props("variant")).toBe("card");
    expect(cards[0].text()).toContain("Test shape");
    expect(cards[0].text()).toContain("Two layers over a catch-all");
    expect(wrapper.find('[data-test="oncall-preset-test_shape"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test^="oncall-preset-row-"]').length).toBeGreaterThan(0);
  });

  /// The catalogue is the same four shapes for every org, so reopening the
  /// drawer must not re-ask the server for them.
  it("serves the catalogue from the cache when the drawer is reopened", async () => {
    const wrapper = await renderOpen();
    expect(service.listSchedulePresets).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(service.listSchedulePresets).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="oncall-preset-row-groups-0"]').exists()).toBe(true);
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

  /// U9: the regions open named, and a new one re-splits the whole day evenly.
  it("names the regions and re-splits the day across all of them on Add another", async () => {
    const wrapper = await renderOpen();
    const value = (sel: string) =>
      wrapper.findComponent(`[data-test="${sel}"]`).props("modelValue");
    expect(value("oncall-preset-field-groups-0-name")).toBe("Group 1");
    expect(value("oncall-preset-field-groups-1-name")).toBe("Group 2");

    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");
    const at = (key: string, edge: string) => value(`oncall-preset-field-${key}-${edge}`);

    expect(value("oncall-preset-field-groups-2-name")).toBe("Group 3");
    expect([at("groups-0", "from"), at("groups-0", "to")]).toEqual([0, 480]);
    expect([at("groups-1", "from"), at("groups-1", "to")]).toEqual([480, 960]);
    expect([at("groups-2", "from"), at("groups-2", "to")]).toEqual([960, 1440]);
  });

  it("rebuilds the form when a card picks another shape", async () => {
    const wrapper = await renderOpen();
    await wrapper.find('[data-test="oncall-preset-other_shape"]').trigger("click");
    await flushPromises();

    expect(wrapper.findComponent({ name: "ORadioGroup" }).props("modelValue")).toBe("other_shape");
    expect(wrapper.find('[data-test="oncall-preset-row-only"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-preset-row-groups-0"]').exists()).toBe(false);
  });

  it("keeps what has been typed when the open card is picked again", async () => {
    const wrapper = await renderOpen();
    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-preset-row-groups-2"]').exists()).toBe(true);

    await wrapper
      .findComponent({ name: "ORadioGroup" })
      .vm.$emit("update:modelValue", "test_shape");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-preset-row-groups-2"]').exists()).toBe(true);
  });

  /// Comparing shapes must not cost the values typed into the one left behind.
  it("keeps each shape's typed values when switching away and back", async () => {
    const wrapper = await renderOpen();
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-0-name"]')
      .vm.$emit("update:modelValue", "APAC");
    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");

    const group = wrapper.findComponent({ name: "ORadioGroup" });
    await group.vm.$emit("update:modelValue", "other_shape");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-preset-row-only"]').exists()).toBe(true);

    await group.vm.$emit("update:modelValue", "test_shape");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-preset-row-groups-2"]').exists()).toBe(true);
    expect(
      wrapper.findComponent('[data-test="oncall-preset-field-groups-0-name"]').props("modelValue"),
    ).toBe("APAC");
  });

  it("picks the shape from a select on a phone", async () => {
    phone.on = true;
    const wrapper = await renderOpen();
    expect(wrapper.findComponent({ name: "ORadioGroup" }).exists()).toBe(false);
    const picker = wrapper.findComponent('[data-test="oncall-presets-picker"]');
    expect(picker.props("options").map((o: { value: string }) => o.value)).toEqual([
      "test_shape",
      "other_shape",
      "split_shape",
    ]);
    await picker.vm.$emit("update:modelValue", "other_shape");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-preset-row-only"]').exists()).toBe(true);
    phone.on = false;
  });

  /// U9: the limit is stated on the button's line, and at the limit the button stays, disabled.
  it("states the region limit and disables Add another at it", async () => {
    const wrapper = await renderOpen();
    expect(wrapper.find('[data-test="oncall-preset-group-limit"]').text()).toBe("Up to 3 groups");

    await wrapper.find('[data-test="oncall-preset-group-add-groups"]').trigger("click");
    const add = wrapper.find('[data-test="oncall-preset-group-add-groups"]');
    expect(add.attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="oncall-preset-row-groups-3"]').exists()).toBe(false);
  });

  /// The catch-all already has an answer. Offering an empty picker instead read
  /// as a required field nobody knew how to fill.
  it("states the catch-all default, asks only when overridden, and can go back", async () => {
    const wrapper = await renderOpen();
    const row = wrapper.find('[data-test="oncall-preset-row-catch_all"]');
    expect(row.text()).toContain("everyone above");
    const picker = '[data-test="oncall-preset-field-catch_all-members"]';
    expect(wrapper.find(picker).exists()).toBe(false);

    await wrapper.find('[data-test="oncall-preset-override-catch_all"]').trigger("click");
    expect(wrapper.find(picker).exists()).toBe(true);

    await wrapper.findComponent(picker).vm.$emit("update:modelValue", ["z@example.com"]);
    await wrapper.find('[data-test="oncall-preset-revert-catch_all"]').trigger("click");
    expect(wrapper.find(picker).exists()).toBe(false);
    await staff(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();
    expect((service.applySchedulePreset.mock.calls[0]?.[0] as any).data.catch_all).toBeUndefined();
  });

  /// U6: the team's zone is the only zone, whatever an older catalogue still lists.
  it("never offers a timezone and says the times are in the team's zone", async () => {
    const wrapper = await renderOpen();
    expect(wrapper.find('[data-test="oncall-preset-defaults"]').text()).toContain(
      "Times in UTC · hand over weekly",
    );

    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-preset-field-timezone"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-preset-field-handover_micros"]').exists()).toBe(true);

    await staff(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();
    expect((service.applySchedulePreset.mock.calls[0]?.[0] as any).data.timezone).toBeUndefined();
  });

  /// Every row needs people (D1), so the fixture's two groups are staffed before Save is a valid click.
  async function staff(wrapper: Awaited<ReturnType<typeof renderOpen>>) {
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-0-members"]')
      .vm.$emit("update:modelValue", ["a@example.com"]);
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-1-members"]')
      .vm.$emit("update:modelValue", ["raj@example.com"]);
  }

  /// U1: a team with nothing to replace gets today's drawer, and the server names the first rotation.
  it("hides the target toggle and sends no target when the team has no rotation", async () => {
    const wrapper = await renderOpen();
    expect(wrapper.find('[data-test="oncall-presets-target"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-presets-new-name"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-presets-replace-note"]').text()).toBe(
      "Adds a rotation named Primary.",
    );

    await staff(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    const sent = service.applySchedulePreset.mock.calls[0]?.[0] as any;
    expect(sent.data.preset).toBe("test_shape");
    expect(sent.data.catch_all).toBeUndefined();
    expect(sent.data.rotation_id).toBeUndefined();
    expect(sent.data.new_rotation_name).toBeUndefined();
    expect(wrapper.emitted("applied")).toBeTruthy();
  });

  /// U1 + U3: from Add rotation the drawer targets a new rotation, named as the from-scratch editor would.
  it("opens on a new rotation with the editor's next default name", async () => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY]);
    const toggle = wrapper.findComponent('[data-test="oncall-presets-target"]');
    expect(toggle.props("label")).toBe("Use it for");
    expect(toggle.findAllComponents({ name: "OToggleGroupItem" }).map((i) => i.text())).toEqual([
      "New rotation",
      "Primary",
      "Secondary",
    ]);
    const name = wrapper.findComponent('[data-test="oncall-presets-new-name"]');
    expect(name.props("modelValue")).toBe("Rotation 3");
    expect(wrapper.findComponent({ name: "ODrawer" }).props("title")).toBe(
      "Template for a new rotation",
    );
    expect(wrapper.find('[data-test="oncall-presets-replace-note"]').text()).toBe(
      "Adds a rotation named Rotation 3.",
    );
  });

  /// U1 + U3: from a lane's menu the drawer targets that lane, and says what stays.
  it("opens on the lane it was asked from and names it", async () => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY], "r2");
    expect(wrapper.findComponent('[data-test="oncall-presets-target"]').props("modelValue")).toBe(
      "r2",
    );
    // A5: the name field stays put, showing the name a replace keeps.
    const name = wrapper.findComponent('[data-test="oncall-presets-new-name"]');
    expect(name.props("modelValue")).toBe("Secondary");
    expect(name.props("disabled")).toBe(true);
    expect(wrapper.findComponent({ name: "ODrawer" }).props("title")).toBe(
      "Template for Secondary",
    );
    expect(wrapper.find('[data-test="oncall-presets-replace-note"]').text()).toBe(
      "Replaces Secondary's shift rules. Its name stays, so escalation steps that page it still do.",
    );
  });

  /// U4 + U5: a new rotation is added in one click, with no confirm, under the typed name.
  it("adds a new rotation without a confirm and sends its name", async () => {
    const wrapper = await renderOpen([PRIMARY]);
    await wrapper
      .findComponent('[data-test="oncall-presets-new-name"]')
      .vm.$emit("update:modelValue", " Shadow ");
    await staff(wrapper);
    const save = wrapper.find('[data-test="oncall-presets-apply"]');
    expect(save.text()).toBe("Add rotation");
    await save.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="confirm-stub"]').exists()).toBe(false);
    const sent = (service.applySchedulePreset.mock.calls[0]?.[0] as any).data;
    expect(sent.new_rotation_name).toBe("Shadow");
    expect(sent.rotation_id).toBeUndefined();
    expect(toasted).toHaveBeenCalledWith({
      variant: "success",
      message: "Added Shadow from Test shape",
    });
  });

  /// U4 + U5: a replace confirms first, then sends the rotation's id.
  it("confirms a replace, then sends the rotation id and says what it uses now", async () => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY], "r2");
    await staff(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(service.applySchedulePreset).not.toHaveBeenCalled();
    const confirm = wrapper.findComponent({ name: "ODialog" });
    expect(confirm.props("title")).toBe("Replace Secondary's shift rules?");
    expect(confirm.props("primaryButtonLabel")).toBe("Replace");

    await wrapper.find('[data-test="confirm-ok"]').trigger("click");
    await flushPromises();
    const sent = (service.applySchedulePreset.mock.calls[0]?.[0] as any).data;
    expect(sent.rotation_id).toBe("r2");
    expect(sent.new_rotation_name).toBeUndefined();
    // Untouched, the stored handovers are exactly the rotation's own: no snapping to Monday.
    expect(sent.anchor_micros).toBe(SECONDARY.shift_rules[0].anchor_micros);
    expect(sent.handover_micros).toBe(SECONDARY.shift_rules[0].shift_micros);
    expect(toasted).toHaveBeenCalledWith({
      variant: "success",
      message: "Secondary now uses Test shape",
    });
  });

  /// U5: a blank name is caught before Save, in the footer, for a region and for the new rotation alike.
  it.each([
    {
      field: "oncall-preset-field-groups-1-name",
      reason: "Give every group a name to save",
    },
    { field: "oncall-presets-new-name", reason: "Name the new rotation to save" },
  ])("disables Save with a reason when $field is blank", async ({ field, reason }) => {
    const wrapper = await renderOpen([PRIMARY]);
    await staff(wrapper);
    await wrapper.findComponent(`[data-test="${field}"]`).vm.$emit("update:modelValue", " ");

    const save = wrapper.find('[data-test="oncall-presets-apply"]');
    expect(save.attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="oncall-presets-blocked"]').text()).toBe(reason);
    expect(wrapper.findComponent(`[data-test="${field}"]`).props("error")).toBe(true);
  });

  /// U5: what the server would refuse keeps Save disabled with a plain reason, so the confirm never opens.
  it.each([
    {
      name: "overlapping regions",
      shape: "test_shape",
      field: "oncall-preset-field-groups-0-to",
      value: 780,
      reason: "Give each group its own hours to save",
    },
    {
      name: "a split at Monday 00:00",
      shape: "split_shape",
      field: "oncall-preset-field-boundary_day",
      value: 0,
      reason: "Pick a split later than Monday 00:00 to save",
    },
  ])("blocks Save for $name", async ({ shape, field, value, reason }) => {
    const wrapper = await renderOpen([PRIMARY], "r1");
    await wrapper.findComponent({ name: "ORadioGroup" }).vm.$emit("update:modelValue", shape);
    await flushPromises();
    for (const picker of wrapper.findAll('[data-test$="-members"]')) {
      const selector = `[data-test="${picker.attributes("data-test")}"]`;
      await wrapper.findComponent(selector).vm.$emit("update:modelValue", ["a@example.com"]);
    }
    await wrapper.findComponent(`[data-test="${field}"]`).vm.$emit("update:modelValue", value);

    expect(wrapper.find('[data-test="oncall-presets-blocked"]').text()).toBe(reason);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="confirm-stub"]').exists()).toBe(false);
  });

  /// The server refuses a second rotation of the same name (trimmed, any case), so Save waits.
  it("disables Save when the new rotation's name is already taken", async () => {
    const wrapper = await renderOpen([PRIMARY]);
    await staff(wrapper);
    const name = wrapper.findComponent('[data-test="oncall-presets-new-name"]');
    await name.vm.$emit("update:modelValue", "  primary ");

    expect(wrapper.find('[data-test="oncall-presets-apply"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="oncall-presets-blocked"]').text()).toBe(
      "A rotation named primary already exists",
    );
    expect(name.props("error")).toBe(true);
  });

  /// A4: two shift rules of one name are refused, and a name is held to the server's length.
  it("blocks Save when two shift rules share a name, and caps rule names", async () => {
    const wrapper = await renderOpen();
    await staff(wrapper);
    const second = wrapper.findComponent('[data-test="oncall-preset-field-groups-1-name"]');
    expect(second.props("maxlength")).toBe(64);
    await second.vm.$emit("update:modelValue", " group 1");

    expect(wrapper.find('[data-test="oncall-presets-apply"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="oncall-presets-blocked"]').text()).toBe(
      "Two shift rules are named Group 1",
    );
  });

  /// A8: the reason must read as a warning, so it is not an OText whose own colour would win.
  it("styles the blocked reason as a warning, apart from the note", async () => {
    const wrapper = await renderOpen();
    const blocked = wrapper.find('[data-test="oncall-presets-blocked"]');
    expect(blocked.classes()).toContain("text-status-warning-text");
    expect(
      wrapper
        .findAllComponents({ name: "OText" })
        .some((c) => c.attributes("data-test") === "oncall-presets-blocked"),
    ).toBe(false);
  });

  /// A7/F9: a blocked new name has nothing to announce beside its reason.
  it.each(["  ", "Primary"])("drops the add note while the new name is %j", async (name) => {
    const wrapper = await renderOpen([PRIMARY]);
    await wrapper
      .findComponent('[data-test="oncall-presets-new-name"]')
      .vm.$emit("update:modelValue", name);
    expect(wrapper.find('[data-test="oncall-presets-replace-note"]').exists()).toBe(false);
  });

  /// F4: the toggle and the name field start on one label line, and the counter under the field cannot push it up.
  it("aligns the target toggle and the name field from the top", async () => {
    const wrapper = await renderOpen([PRIMARY]);
    const row = wrapper.find('[data-test="oncall-presets-target-row"]');
    expect(row.classes()).toContain("items-start");
    expect(row.classes()).not.toContain("items-end");
  });

  /// People spread over several rotations are not all credited to the first one's.
  it("says other rotations when the shared people sit on more than one", async () => {
    const tertiary: Rotation = {
      id: "r3",
      name: "Tertiary",
      shift_rules: [rule(["lena@example.com"])],
    };
    const wrapper = await renderOpen([PRIMARY, SECONDARY, tertiary], "r1");
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-0-members"]')
      .vm.$emit("update:modelValue", ["raj@example.com"]);
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-1-members"]')
      .vm.$emit("update:modelValue", ["lena@example.com"]);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(wrapper.findAll('[data-test^="oncall-presets-effect-"]').map((l) => l.text())).toEqual([
      "raj@example.com and 1 other are also on other rotations, so they can be on call twice at once.",
    ]);
  });

  /// Esc or a click outside must not cost a filled form: the same target reopens as it was left.
  it("keeps the form when the drawer reopens on the same target", async () => {
    const wrapper = await renderOpen([PRIMARY], "");
    await wrapper
      .findComponent({ name: "ORadioGroup" })
      .vm.$emit("update:modelValue", "other_shape");
    await flushPromises();
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.findComponent({ name: "ORadioGroup" }).props("modelValue")).toBe("other_shape");
  });

  /// After a save the next open is a new form, even for the same target.
  it("starts clean after a successful apply", async () => {
    const wrapper = await renderOpen([PRIMARY], "");
    await staff(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-groups-0-members"]')
        .props("modelValue"),
    ).toEqual([]);
  });

  /// A6: opening for a different target starts clean: first template, empty rows, Defaults closed.
  it("starts from a clean form when opened for another target", async () => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY], "r2");
    await staff(wrapper);
    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    await wrapper
      .findComponent({ name: "ORadioGroup" })
      .vm.$emit("update:modelValue", "other_shape");
    await flushPromises();
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ startOn: "", open: true });
    await flushPromises();

    expect(wrapper.findComponent({ name: "ORadioGroup" }).props("modelValue")).toBe("test_shape");
    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-groups-0-members"]')
        .props("modelValue"),
    ).toEqual([]);
    expect(wrapper.find('[data-test="oncall-preset-field-handover_micros"]').exists()).toBe(false);
  });

  /// A shift rule with nobody in it pages nobody: Save waits, and says why on one line.
  it("disables Save with a reason while a shift rule has nobody assigned", async () => {
    const wrapper = await renderOpen();
    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-0-members"]')
      .vm.$emit("update:modelValue", ["a@example.com"]);

    const save = wrapper.find('[data-test="oncall-presets-apply"]');
    expect(save.attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="oncall-presets-blocked"]').text()).toBe(
      "Add people to every shift rule to save",
    );

    await wrapper
      .findComponent('[data-test="oncall-preset-field-groups-1-members"]')
      .vm.$emit("update:modelValue", ["b@example.com"]);
    expect(wrapper.find('[data-test="oncall-presets-blocked"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="oncall-presets-apply"]').attributes("disabled"),
    ).toBeUndefined();
  });

  /// U7: a replace keeps the rotation's handovers unless somebody changes them.
  it("prefills handover and first shift from the target's first rule", async () => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY], "r2");
    expect(wrapper.find('[data-test="oncall-preset-defaults"]').text()).toContain("(same as now)");

    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-handover_micros"]')
        .props("modelValue"),
    ).toBe(MICROS_PER_DAY);
    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-anchor_micros-date"]')
        .props("modelValue"),
    ).toBe("2026-11-03");
    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-anchor_micros-time"]')
        .props("modelValue"),
    ).toBe("09:00");
  });

  /// Handover length always has a value, so "(same as now)" can never describe a cleared field.
  it("does not let the handover length be cleared", async () => {
    const wrapper = await renderOpen([PRIMARY], "r1");
    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    expect(
      wrapper.findComponent('[data-test="oncall-preset-field-handover_micros"]').props("clearable"),
    ).toBeUndefined();
  });

  /// U7: reopening on a rotation whose rules changed meanwhile prefills from the rules it has now.
  it("reapplies the target's handover every time the drawer opens", async () => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY], "r2");
    await wrapper.setProps({ open: false });
    const changed = {
      ...SECONDARY,
      shift_rules: [rule(["raj@example.com"], { shift_micros: MICROS_PER_WEEK })],
    };
    await wrapper.setProps({ rotations: [PRIMARY, changed], open: true });
    await flushPromises();
    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");

    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-handover_micros"]')
        .props("modelValue"),
    ).toBe(MICROS_PER_WEEK);
  });

  /// U7: a new rotation keeps the server's default, and the pickers show it rather than a blank.
  it("shows the server's default first shift for a new rotation without sending it", async () => {
    const wrapper = await renderOpen([PRIMARY]);
    expect(wrapper.find('[data-test="oncall-preset-defaults"]').text()).not.toContain(
      "same as now",
    );
    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-anchor_micros-date"]')
        .props("modelValue"),
    ).toBe("2026-11-02");
    expect(
      wrapper
        .findComponent('[data-test="oncall-preset-field-anchor_micros-time"]')
        .props("modelValue"),
    ).toBe("00:00");

    await staff(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();
    const sent = (service.applySchedulePreset.mock.calls[0]?.[0] as any).data;
    expect(sent.anchor_micros).toBeUndefined();
    expect(sent.handover_micros).toBe(MICROS_PER_WEEK);
  });

  /// U8: the confirm lists only the side effects that apply, one plain line each.
  it("lists a moved handover and a person shared with another rotation in the confirm", async () => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY], "r1");
    await staff(wrapper);
    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    await wrapper
      .findComponent('[data-test="oncall-preset-field-handover_micros"]')
      .vm.$emit("update:modelValue", MICROS_PER_WEEK);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    const lines = wrapper.findAll('[data-test^="oncall-presets-effect-"]').map((l) => l.text());
    expect(lines).toEqual([
      "Shifts change from daily to weekly.",
      "raj@example.com is also on Secondary, so they can be on call for both at once.",
    ]);
  });

  /// A2: a moved first shift says where the handovers go, in the team's zone.
  it("says where the handovers move when the first shift changes", async () => {
    const wrapper = await renderOpen([PRIMARY], "r1");
    await staff(wrapper);
    await wrapper.find('[data-test="oncall-preset-defaults-toggle"]').trigger("click");
    await wrapper
      .findComponent('[data-test="oncall-preset-field-anchor_micros-time"]')
      .vm.$emit("update:modelValue", "00:00");
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(wrapper.findAll('[data-test^="oncall-presets-effect-"]').map((l) => l.text())).toEqual([
      "Handovers move from Tue 09:00 to Tue 00:00.",
    ]);
  });

  it.each([
    {
      name: "no side effect",
      members: [["a@example.com"], ["a@example.com"]],
      want: [],
    },
    {
      name: "several shared people",
      members: [["raj@example.com"], ["tom@example.com"]],
      want: [
        "raj@example.com and 1 other are also on Secondary, so they can be on call for both at once.",
      ],
    },
  ])("lists $name in the replace confirm", async ({ members, want }) => {
    const wrapper = await renderOpen([PRIMARY, SECONDARY], "r1");
    for (const [index, people] of members.entries()) {
      await wrapper
        .findComponent(`[data-test="oncall-preset-field-groups-${index}-members"]`)
        .vm.$emit("update:modelValue", people);
    }
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(wrapper.findAll('[data-test^="oncall-presets-effect-"]').map((l) => l.text())).toEqual(
      want,
    );
  });

  /// U10: the boundary reads as one sentence, with a plain hint instead of the catalogue's day numbering.
  it("reads the week's boundary as Split on a day at a time", async () => {
    const wrapper = await renderOpen();
    await wrapper
      .findComponent({ name: "ORadioGroup" })
      .vm.$emit("update:modelValue", "split_shape");
    await flushPromises();
    const row = wrapper.find('[data-test="oncall-preset-row-boundary"]').text();

    expect(row).toMatch(/^Split on.*at/);
    expect(row).not.toContain("0 = Monday");
    expect(row).not.toContain("Hand over");
  });

  /// The server refuses 24:00 as a start or a split, so only an end picker offers it.
  it("offers 24:00 on end pickers only", async () => {
    const wrapper = await renderOpen();
    const values = (sel: string) =>
      wrapper
        .findComponent(`[data-test="${sel}"]`)
        .props("options")
        .map((o: { value: number }) => o.value);
    expect(values("oncall-preset-field-groups-0-from")).not.toContain(1440);
    expect(values("oncall-preset-field-groups-0-to")).toContain(1440);

    await wrapper
      .findComponent({ name: "ORadioGroup" })
      .vm.$emit("update:modelValue", "split_shape");
    await flushPromises();
    expect(values("oncall-preset-field-boundary_minute")).not.toContain(1440);
  });

  /// The new rotation's name is held to the length the server stores, as in the editor.
  it("caps the new rotation's name at the server's length", async () => {
    const wrapper = await renderOpen([PRIMARY]);
    expect(wrapper.findComponent('[data-test="oncall-presets-new-name"]').props("maxlength")).toBe(
      64,
    );
  });

  /// U11: two lines of description on a card, and on a phone the chosen one under the select.
  it("clamps card descriptions to two lines and shows the chosen one on a phone", async () => {
    const desktop = await renderOpen();
    const card = desktop.find('[data-test="oncall-preset-test_shape-description"]');
    expect(card.classes()).toContain("line-clamp-2");

    phone.on = true;
    const mobile = await renderOpen();
    expect(mobile.find('[data-test="oncall-presets-picked-description"]').text()).toBe(
      "Two layers over a catch-all",
    );
  });

  /// Sixteen named-field rejections server-side, each written for the person
  /// who typed the value. Verbatim, on the screen, beside the form.
  it("shows the server's rejection sentence verbatim", async () => {
    service.applySchedulePreset.mockRejectedValue({
      response: { data: { message: "regions 2 and 3 overlap at minute 480" } },
    });
    const wrapper = await renderOpen();
    await staff(wrapper);
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
    const wrapper = await renderOpen();
    await staff(wrapper);
    await wrapper.find('[data-test="oncall-presets-apply"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-presets-error"]').text()).toContain(
      "missing field `name`",
    );
  });
});
