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

import store from "@/test/unit/helpers/store";
import ExtensionSetupDialog from "./ExtensionSetupDialog.vue";

// ODialog teleports its content to document.body, which would put every
// assertion below outside the wrapper's tree. Stubbed to render its
// header-right, default, and footer slots inline — and only while open.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "subTitle", "size"],
  emits: ["update:open"],
  template: `
    <div v-if="open" class="dialog-stub">
      <slot name="header-right" />
      <slot />
      <slot name="footer" />
    </div>`,
};

// Surfaces the connected pass-through and lets tests flip both attestations
// through the checklist's own model contracts.
const ChecklistStub = {
  name: "ExtensionSetupChecklist",
  props: ["connected", "installAck", "incognitoDone"],
  emits: ["update:installAck", "update:incognitoDone"],
  template: '<div class="checklist-stub" :data-connected="String(connected)" />',
};

// Forwards disabled and re-emits click so CTA assertions and handlers work.
const OButtonStub = {
  props: ["disabled"],
  emits: ["click"],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
};

const OBadgeStub = {
  template: '<span v-bind="$attrs"><slot /></span>',
};

const STUBS = {
  ODialog: ODialogStub,
  ExtensionSetupChecklist: ChecklistStub,
  OButton: OButtonStub,
  OBadge: OBadgeStub,
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ExtensionSetupDialog, {
    props: { open: true, action: "record", ...props },
    global: { plugins: [store], stubs: STUBS },
  }) as VueWrapper;
}

// Flips an attestation via the checklist's v-models.
async function setInstallAck(wrapper: VueWrapper, value: boolean) {
  wrapper.findComponent(ChecklistStub).vm.$emit("update:installAck", value);
  await wrapper.vm.$nextTick();
}

async function setIncognito(wrapper: VueWrapper, value: boolean) {
  wrapper.findComponent(ChecklistStub).vm.$emit("update:incognitoDone", value);
  await wrapper.vm.$nextTick();
}

function ctaDisabled(wrapper: VueWrapper): boolean {
  return (
    wrapper.find('[data-test="synthetics-setup-continue-btn"]').attributes("disabled") !==
    undefined
  );
}

describe("ExtensionSetupDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("should render nothing while closed", () => {
    wrapper = mountDialog({ open: false });

    expect(wrapper.find('[data-test="synthetics-setup-continue-btn"]').exists()).toBe(false);
  });

  it("should show the progress badge in the dialog header", () => {
    wrapper = mountDialog();

    expect(wrapper.find('[data-test="synthetics-setup-progress"]').text()).toContain(
      "synthetics.createBrowserTest.setupProgress",
    );
  });

  it("should pass the connected state through to the checklist", () => {
    wrapper = mountDialog({ connected: true });

    expect(wrapper.find(".checklist-stub").attributes("data-connected")).toBe("true");
  });

  describe("primary CTA gating", () => {
    it("should disable the CTA and point at install while nothing is done", () => {
      wrapper = mountDialog({ connected: false });

      expect(ctaDisabled(wrapper)).toBe(true);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupHintInstall");
    });

    it("should point at incognito once installed via attestation alone", async () => {
      wrapper = mountDialog({ connected: false });

      await setInstallAck(wrapper, true);

      expect(ctaDisabled(wrapper)).toBe(true);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupHintIncognito");
    });

    it("should point at incognito once connected", () => {
      wrapper = mountDialog({ connected: true });

      expect(ctaDisabled(wrapper)).toBe(true);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupHintIncognito");
    });

    // The attestations alone must never enable the CTA — only the live probe
    // proves the recorder can actually drive this tab.
    it("should keep the CTA disabled on both acks without a connection", async () => {
      wrapper = mountDialog({ connected: false });

      await setInstallAck(wrapper, true);
      await setIncognito(wrapper, true);

      expect(ctaDisabled(wrapper)).toBe(true);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupHintConnect");
    });

    it("should show the locked label while any task is pending", () => {
      wrapper = mountDialog({ connected: false });

      expect(wrapper.find('[data-test="synthetics-setup-continue-btn"]').text()).toContain(
        "synthetics.createBrowserTest.setupCtaLocked",
      );
    });

    it("should enable the CTA with the action label once connected and acknowledged", async () => {
      wrapper = mountDialog({ connected: true });

      await setIncognito(wrapper, true);

      expect(ctaDisabled(wrapper)).toBe(false);
      expect(wrapper.find('[data-test="synthetics-setup-continue-btn"]').text()).toContain(
        "synthetics.journey.record",
      );
      expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupHintInstall");
      expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupHintIncognito");
      expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupHintConnect");
    });

    it("should emit continue and then close on CTA click", async () => {
      wrapper = mountDialog({ connected: true });
      await setIncognito(wrapper, true);

      await wrapper.find('[data-test="synthetics-setup-continue-btn"]').trigger("click");

      expect(wrapper.emitted("continue")).toHaveLength(1);
      expect(wrapper.emitted("update:open")).toEqual([[false]]);
    });
  });

  describe("skip link", () => {
    it("should close without continuing when skipped from the record flow", async () => {
      wrapper = mountDialog({ action: "record" });

      await wrapper.find('[data-test="synthetics-setup-dialog-skip"]').trigger("click");

      expect(wrapper.emitted("update:open")).toEqual([[false]]);
      expect(wrapper.emitted("continue")).toBeFalsy();
    });

    it("should not offer a skip link for the replay flow", () => {
      wrapper = mountDialog({ action: "replay" });

      expect(wrapper.find('[data-test="synthetics-setup-dialog-skip"]').exists()).toBe(false);
    });
  });

  // The acks live in component-lifetime refs — session-only on purpose, but a
  // dismissed dialog must not ask the author to attest twice.
  it("should keep both attestations across a close and re-open", async () => {
    wrapper = mountDialog({ connected: true });
    await setInstallAck(wrapper, true);
    await setIncognito(wrapper, true);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    expect(ctaDisabled(wrapper)).toBe(false);
    expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupHintIncognito");
  });

  it("should forward the dialog's own update:open", async () => {
    wrapper = mountDialog();

    await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);

    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });
});
