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
import { mount, VueWrapper } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import ExtensionSetupDialog from "./ExtensionSetupDialog.vue";

// ODialog teleports its content to document.body, which would put every
// assertion below outside the wrapper's tree. Stubbed to render inline and
// surface the primary button contract (label, disabled) in the DOM.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "title",
    "size",
    "primaryButtonLabel",
    "primaryButtonDisabled",
    "secondaryButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div v-if="open" class="dialog-stub" :data-primary-label="primaryButtonLabel">
      <slot />
      <button data-test="stub-primary" :disabled="primaryButtonDisabled" @click="$emit('click:primary')" />
      <button data-test="stub-secondary" @click="$emit('click:secondary')" />
    </div>`,
};

// Surfaces the connected pass-through and lets tests flip the incognito model
// through the checklist's own event contract.
const ChecklistStub = {
  name: "ExtensionSetupChecklist",
  props: ["connected", "incognitoDone"],
  emits: ["update:incognitoDone"],
  template: '<div class="checklist-stub" :data-connected="String(connected)" />',
};

const STUBS = {
  ODialog: ODialogStub,
  ExtensionSetupChecklist: ChecklistStub,
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ExtensionSetupDialog, {
    props: { open: true, action: "record", ...props },
    global: { stubs: STUBS },
  }) as VueWrapper;
}

async function confirmIncognito(wrapper: VueWrapper) {
  await wrapper.findComponent(ChecklistStub).vm.$emit("update:incognitoDone", true);
}

function primaryDisabled(wrapper: VueWrapper): boolean {
  return wrapper.find('[data-test="stub-primary"]').attributes("disabled") !== undefined;
}

describe("ExtensionSetupDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("should label the primary button Record for the record action", () => {
    wrapper = mountDialog({ action: "record" });

    expect(wrapper.find(".dialog-stub").attributes("data-primary-label")).toBe(
      "synthetics.journey.record",
    );
  });

  it("should label the primary button Replay for the replay action", () => {
    wrapper = mountDialog({ action: "replay" });

    expect(wrapper.find(".dialog-stub").attributes("data-primary-label")).toBe(
      "synthetics.journey.replay",
    );
  });

  it("should disable the primary button when neither step is done", () => {
    wrapper = mountDialog({ connected: false });

    expect(primaryDisabled(wrapper)).toBe(true);
  });

  it("should keep the primary button disabled when connected but incognito is unconfirmed", () => {
    wrapper = mountDialog({ connected: true });

    expect(primaryDisabled(wrapper)).toBe(true);
  });

  it("should keep the primary button disabled when incognito is confirmed but not connected", async () => {
    wrapper = mountDialog({ connected: false });

    await confirmIncognito(wrapper);

    expect(primaryDisabled(wrapper)).toBe(true);
  });

  it("should enable the primary button once connected and incognito is confirmed", async () => {
    wrapper = mountDialog({ connected: true });

    await confirmIncognito(wrapper);

    expect(primaryDisabled(wrapper)).toBe(false);
  });

  it("should emit continue and close on primary click", async () => {
    wrapper = mountDialog({ connected: true });
    await confirmIncognito(wrapper);

    await wrapper.find('[data-test="stub-primary"]').trigger("click");

    expect(wrapper.emitted("continue")).toHaveLength(1);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("should close without continuing on secondary click", async () => {
    wrapper = mountDialog({ connected: true });

    await wrapper.find('[data-test="stub-secondary"]').trigger("click");

    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(wrapper.emitted("continue")).toBeFalsy();
  });

  it("should forward the dialog's own update:open", async () => {
    wrapper = mountDialog();

    await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);

    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("should pass the connected state through to the checklist", () => {
    wrapper = mountDialog({ connected: true });

    expect(wrapper.find(".checklist-stub").attributes("data-connected")).toBe("true");
  });

  // The incognito confirmation is the one step that cannot be probed, so a
  // dismissed dialog must not ask the author to confirm it twice.
  it("should keep the incognito confirmation across a close and re-open", async () => {
    wrapper = mountDialog({ connected: true });
    await confirmIncognito(wrapper);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    expect(primaryDisabled(wrapper)).toBe(false);
  });
});
