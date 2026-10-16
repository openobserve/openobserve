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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { nextTick, type ComponentPublicInstance } from "vue";
import { createI18n } from "vue-i18n";
import type {
  BrowserCheck,
  BrowserStep,
  SyntheticsFolder,
  SyntheticsLocation,
} from "@/types/synthetics";
import { raw } from "@/types/i18n";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import en from "@/locales/languages/en-US.json";
import ExtractSubtestDialog from "./ExtractSubtestDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

// Rendered inline (no teleport); the footer is ODialog's own concern.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "formId",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "secondaryButtonVariant",
    "primaryButtonLoading",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
  ],
  emits: ["update:open", "click:secondary"],
  template: '<div v-if="open" class="dialog-stub"><slot /></div>',
};
// Field wrappers stay real; only leaf controls are stubbed.
const OInputStub = {
  name: "OInput",
  props: ["modelValue", "label", "error", "errorMessage"],
  emits: ["update:modelValue", "blur"],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "label", "multiple", "error", "errorMessage"],
  emits: ["update:modelValue", "blur"],
  template: '<select v-bind="$attrs" />',
};
const OIconStub = { name: "OIcon", template: "<i />" };

const STUBS = { ODialog: ODialogStub, OInput: OInputStub, OSelect: OSelectStub, OIcon: OIconStub };

const range: BrowserStep[] = [
  { id: "s2", action: "navigate", name: "Open login", value: "https://shop.test/login" },
  {
    id: "s3",
    action: "type",
    name: "Email",
    value: "{{USER}}",
    locator: { candidates: [{ kind: "css", value: "#email" }] },
  },
];
const folders: SyntheticsFolder[] = [
  { folderId: "folder-1", name: "Shop" },
  { folderId: "folder-2", name: "Shared" },
];
const locationOptions: SyntheticsLocation[] = [
  { id: "us-east", label: raw("US East"), region: "us-east-1", provider: "aws" },
  { id: "eu-west", label: raw("EU West"), region: "eu-west-1", provider: "aws" },
];
const parentSchedule: BrowserCheck["schedule"] = {
  type: "interval",
  intervalValue: 5,
  intervalUnit: "minutes",
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ExtractSubtestDialog, {
    props: {
      open: true,
      range,
      // Distinct values per prop, so no summary line can be right by coincidence.
      anchor: 3,
      authoredCount: 7,
      executedCount: 11,
      parentName: "Checkout",
      parentStartingUrl: "https://shop.test/home",
      defaultFolder: "folder-2",
      folders,
      needsSchedule: false,
      parentLocations: ["eu-west"],
      parentSchedule,
      locationOptions,
      variables: { copied: ["USER", "BASE_URL"], toDefine: ["PASSWORD"] },
      onSubmit: vi.fn().mockResolvedValue(undefined),
      ...props,
    },
    global: { plugins: [i18n], stubs: STUBS },
  }) as VueWrapper;
}

function formFields(w: VueWrapper): VueWrapper<ComponentPublicInstance>[] {
  return [...w.findAllComponents(OFormInput), ...w.findAllComponents(OFormSelect)];
}

function field(w: VueWrapper, name: string): VueWrapper<ComponentPublicInstance> {
  const wrapper = formFields(w).find((c) => c.props("name") === name);
  expect(wrapper, `field "${name}"`).toBeDefined();
  return wrapper!.findComponent(OInputStub).exists()
    ? wrapper!.findComponent(OInputStub)
    : wrapper!.findComponent(OSelectStub);
}

function optionValues(leaf: VueWrapper<ComponentPublicInstance>): unknown[] {
  return (leaf.props("options") as { value: unknown }[]).map((o) => o.value);
}

function fieldNames(w: VueWrapper): string[] {
  return formFields(w).map((c) => c.props("name") as string);
}

// Validation is async and cold on first run, so wait for the handler rather than a fixed flush count.
async function submit(w: VueWrapper, onSubmit: ReturnType<typeof vi.fn>) {
  await w.find("form").trigger("submit");
  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  await flushPromises();
}

describe("ExtractSubtestDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders the seeded name and the parent's folder", () => {
    wrapper = mountDialog();

    expect(field(wrapper, "name").props("modelValue")).toBe("Checkout — Open login");
    const folder = field(wrapper, "folder");
    expect(folder.props("modelValue")).toBe("folder-2");
    expect(optionValues(folder)).toEqual(["folder-1", "folder-2"]);
    expect(fieldNames(wrapper)).toEqual(["name", "folder"]);
  });

  it("asks for locations and frequency, all locations preselected, when the parent has none", () => {
    wrapper = mountDialog({ needsSchedule: true, parentLocations: [] });

    expect(fieldNames(wrapper)).toEqual(["name", "folder", "locations", "schedule"]);
    const locations = field(wrapper, "locations");
    expect(locations.props("multiple")).toBe(true);
    expect(optionValues(locations)).toEqual(["us-east", "eu-west"]);
    expect(locations.props("modelValue")).toEqual(["us-east", "eu-west"]);
    // OSelect holds primitives only, so the field carries the preset key (R5).
    const schedule = field(wrapper, "schedule");
    expect(optionValues(schedule)).toEqual(["1min", "5min", "15min", "30min", "1hour"]);
    expect(schedule.props("modelValue")).toBe("5min");
  });

  it("summarises the range, this test, the schedule and the paused status, omitting the schedule line while asking for one", () => {
    wrapper = mountDialog();
    const text = wrapper.text();
    expect(text).toContain("Steps 4 – 5 · starts at /login");
    expect(text).toContain("6 steps after extraction · runs the same 11 steps");
    expect(text).toContain("EU West · every 5 minutes (same as this test)");
    expect(text).toContain("Created paused. Runs only as part of this test until you enable it.");
    expect(text).toContain("Step history restarts.");
    wrapper.unmount();

    wrapper = mountDialog({ needsSchedule: true, parentLocations: [] });
    expect(wrapper.text()).not.toContain("(same as this test)");
    expect(wrapper.text()).toContain("Steps 4 – 5 · starts at /login");
    expect(wrapper.text()).toContain("Created paused.");
  });

  it("lists copied and to-define variables, and omits each line when empty", async () => {
    wrapper = mountDialog();
    expect(wrapper.text()).toContain("Copied to the new test: USER, BASE_URL.");
    expect(wrapper.text()).toContain("Define on the new test before running it alone: PASSWORD.");

    await wrapper.setProps({ variables: { copied: [], toDefine: [] } });
    expect(wrapper.text()).not.toContain("Copied to the new test");
    expect(wrapper.text()).not.toContain("Define on the new test");
  });

  it("hands onSubmit the name and folder, plus locations and schedule only when asked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrapper = mountDialog({ onSubmit });
    await submit(wrapper, onSubmit);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Checkout — Open login", folder: "folder-2" });
    expect(onSubmit.mock.calls[0][0].locations).toBeUndefined();
    expect(onSubmit.mock.calls[0][0].schedule).toBeUndefined();
    wrapper.unmount();

    const askSubmit = vi.fn().mockResolvedValue(undefined);
    wrapper = mountDialog({ onSubmit: askSubmit, needsSchedule: true, parentLocations: [] });
    await submit(wrapper, askSubmit);
    expect(askSubmit).toHaveBeenCalledWith({
      name: "Checkout — Open login",
      folder: "folder-2",
      locations: ["us-east", "eu-west"],
      schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
    });
  });

  it("shows the rejection message and keeps the dialog open", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error('You can\'t create tests in "Shared". Choose another folder.'));
    wrapper = mountDialog({ onSubmit });

    await submit(wrapper, onSubmit);

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain(
        'You can\'t create tests in "Shared". Choose another folder.',
      ),
    );
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.find("form").exists()).toBe(true);
  });

  it("ignores a close request while the submit is pending", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    wrapper = mountDialog({ onSubmit });
    const dialog = wrapper.findComponent(ODialogStub);

    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await nextTick();
    expect(dialog.props("persistent")).toBe(true);
    expect(dialog.props("showClose")).toBe(false);
    // ODialog derives the footer state from the form itself; no hand-kept flags.
    expect(dialog.props("primaryButtonLoading")).toBeUndefined();
    expect(dialog.props("primaryButtonDisabled")).toBeUndefined();
    expect(dialog.props("secondaryButtonDisabled")).toBeUndefined();

    dialog.vm.$emit("update:open", false);
    await nextTick();
    expect(wrapper.emitted("update:open")).toBeUndefined();

    finish();
    await flushPromises();
    expect(dialog.props("persistent")).toBeFalsy();
    expect(dialog.props("showClose")).toBe(true);
    // The host closes the dialog on success, so nothing is assumed about emits before this one.
    const settled = wrapper.emitted("update:open")?.length ?? 0;
    dialog.vm.$emit("update:open", false);
    await nextTick();
    expect(wrapper.emitted("update:open")).toHaveLength(settled + 1);
    expect(wrapper.emitted("update:open")![settled]).toEqual([false]);
  });

  it("starts a click-first range at the parent's Starting URL", () => {
    wrapper = mountDialog({ range: [range[1]] });
    expect(wrapper.text()).toContain("Step 4 · starts at /home");
  });

  it("omits the executed half of the this-test line while the count is unknown", () => {
    wrapper = mountDialog({ executedCount: undefined });
    expect(wrapper.text()).toContain("6 steps after extraction");
    expect(wrapper.text()).not.toContain("runs the same");
    expect(wrapper.text()).not.toContain("undefined");
  });

  it("uses the singular title for a one-step range", () => {
    wrapper = mountDialog({ range: [range[0]] });
    expect(wrapper.findComponent(ODialogStub).props("title")).toBe("Extract 1 step to a new test");
    expect(wrapper.text()).toContain("Step 4 · starts at /login");
    expect(wrapper.text()).toContain("7 steps after extraction · runs the same 11 steps");
    wrapper.unmount();

    wrapper = mountDialog();
    expect(wrapper.findComponent(ODialogStub).props("title")).toBe("Extract 2 steps to a new test");
  });
});
