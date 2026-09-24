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
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import { raw } from "@/types/i18n";
import en from "@/locales/languages/en-US.json";
import MissingValueDialog from "./MissingValueDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

// Inline dialog with ODialog's three footer buttons; primary submits the form named by form-id.
const ODialogStub = defineComponent({
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
    "neutralButtonLabel",
    "neutralButtonVariant",
    "primaryButtonLoading",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  methods: {
    primary() {
      const root = this.$el as HTMLElement;
      const form = this.formId ? root.querySelector(`form[id="${this.formId}"]`) : null;
      if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      else this.$emit("click:primary");
    },
  },
  template: `
    <div v-if="open" class="dialog-stub">
      <h2 data-test="dialog-stub-title">{{ title }}</h2>
      <slot />
      <button v-if="neutralButtonLabel" data-test="dialog-stub-neutral" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
      <button v-if="secondaryButtonLabel" data-test="dialog-stub-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button v-if="primaryButtonLabel" data-test="dialog-stub-primary" :disabled="primaryButtonDisabled" @click="primary">{{ primaryButtonLabel }}</button>
    </div>`,
});
const OIconStub = { props: ["name", "size"], template: '<i :data-icon="name" />' };

const INPUT = '[data-test="synthetics-journey-missing-value-input"]';
const INPUT_FIELD = '[data-test="synthetics-journey-missing-value-input-field"]';
const INPUT_ERROR = '[data-test="synthetics-journey-missing-value-input-error"]';
const SECRET = '[data-test="synthetics-journey-missing-value-secret"]';

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(MissingValueDialog, {
    props: {
      open: true,
      name: "API_KEY",
      environmentName: raw("QA"),
      isGlobal: false,
      steps: [3],
      sharedByChecks: 12,
      canReplayAnyway: true,
      existingKind: null,
      onSubmit: vi.fn().mockResolvedValue(undefined),
      ...props,
    },
    global: { plugins: [i18n], stubs: { ODialog: ODialogStub, OIcon: OIconStub } },
  }) as VueWrapper;
}

function secretBox(w: VueWrapper): DOMWrapper<Element> {
  const host = w.get(SECRET);
  return host.attributes("role") === "checkbox" ? host : host.get('[role="checkbox"]');
}

async function pressSaveAndReplay(w: VueWrapper) {
  await w.get('[data-test="dialog-stub-primary"]').trigger("click");
  await flushPromises();
}

describe("MissingValueDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("names the variable, the environment and the steps that use it", async () => {
    wrapper = mountDialog();
    expect(wrapper.get('[data-test="dialog-stub-title"]').text()).toBe(
      "API_KEY isn't defined in QA",
    );
    expect(wrapper.text()).toContain("Step 3 uses {{API_KEY}}.");
    expect(wrapper.find(INPUT).text()).toContain("Value for API_KEY in QA");

    await wrapper.setProps({ steps: [3, 4] });
    expect(wrapper.text()).toContain("Steps 3, 4 use {{API_KEY}}.");
    expect(wrapper.text()).not.toContain("Step 3 uses");
  });

  it("names the Starting URL when it is the one using the variable", () => {
    wrapper = mountDialog({ steps: [0], canReplayAnyway: false });
    expect(wrapper.text()).toContain("The Starting URL uses {{API_KEY}}.");
    expect(wrapper.text()).not.toContain("Step 0");
  });

  it("says scheduled runs in that environment will fail too", () => {
    wrapper = mountDialog();
    expect(wrapper.text()).toContain(
      "QA, Global and this test have no value for it, so scheduled runs in QA will fail too.",
    );
  });

  it("hides Store as a secret for Global", () => {
    wrapper = mountDialog({ environmentName: raw("Global"), isGlobal: true });
    expect(wrapper.find(SECRET).exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Store as a secret");
    expect(wrapper.text()).toContain("Global values apply to every check");

    wrapper.unmount();
    wrapper = mountDialog();
    expect(wrapper.find(SECRET).exists()).toBe(true);
    expect(wrapper.text()).toContain("Store as a secret");
  });

  it("shows Store as a secret checked and locked when the row already exists as a secret", () => {
    wrapper = mountDialog({ existingKind: "secret" });
    const box = secretBox(wrapper);
    expect(box.attributes("aria-checked")).toBe("true");
    expect(box.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("This variable is already stored as");

    wrapper.unmount();
    wrapper = mountDialog();
    expect(secretBox(wrapper).attributes("aria-checked")).toBe("false");
    expect(secretBox(wrapper).attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).not.toContain("This variable is already stored as");
  });

  it("shows how many checks share the environment", async () => {
    wrapper = mountDialog({ sharedByChecks: 1 });
    expect(wrapper.text()).toContain("QA is shared by 1 check.");

    await wrapper.setProps({ sharedByChecks: 12 });
    expect(wrapper.text()).toContain(
      "QA is shared by 12 checks. The value is saved now and used by all of them; it does not wait for Save & Exit.",
    );
  });

  it("shows a required error when Save & replay is pressed with no value, and does not submit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrapper = mountDialog({ onSubmit });
    const primary = wrapper.get('[data-test="dialog-stub-primary"]');
    expect(primary.text()).toBe("Save & replay");
    expect(primary.attributes("disabled")).toBeUndefined();

    await pressSaveAndReplay(wrapper);

    await vi.waitFor(() => expect(wrapper.find(INPUT_ERROR).exists()).toBe(true));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the value and the secret choice", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrapper = mountDialog({ onSubmit });

    await wrapper.get(INPUT_FIELD).setValue("k");
    await secretBox(wrapper).trigger("click");
    await pressSaveAndReplay(wrapper);

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({ value: "k", secret: true });
  });

  it("emits replay-anyway from the neutral button, and hides it when not allowed", async () => {
    wrapper = mountDialog();
    const neutral = wrapper.get('[data-test="dialog-stub-neutral"]');
    expect(neutral.text()).toBe("Replay anyway");

    await neutral.trigger("click");
    expect(wrapper.emitted("replay-anyway")).toHaveLength(1);

    wrapper.unmount();
    wrapper = mountDialog({ canReplayAnyway: false });
    expect(wrapper.find('[data-test="dialog-stub-neutral"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Replay anyway");
  });
});
