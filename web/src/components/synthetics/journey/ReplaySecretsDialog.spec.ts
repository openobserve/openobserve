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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import { raw } from "@/types/i18n";
import en from "@/locales/languages/en-US.json";
import ReplaySecretsDialog from "./ReplaySecretsDialog.vue";

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

const input = (name: string, part = "") =>
  `[data-test="synthetics-journey-replay-secrets-input-${name}${part}"]`;

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ReplaySecretsDialog, {
    props: {
      open: true,
      mode: "ask",
      environmentName: raw("QA"),
      secrets: [{ name: "PASSWORD", steps: [2, 3] }],
      onSubmit: vi.fn().mockResolvedValue(undefined),
      ...props,
    },
    global: { plugins: [i18n], stubs: { ODialog: ODialogStub, OIcon: OIconStub } },
  }) as VueWrapper;
}

function field(w: VueWrapper, name: string): HTMLInputElement {
  return w.get(input(name, "-field")).element as HTMLInputElement;
}

async function pressPrimary(w: VueWrapper) {
  await w.get('[data-test="dialog-stub-primary"]').trigger("click");
  await flushPromises();
}

describe("ReplaySecretsDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("names each secret, its environment and the steps that use it", () => {
    wrapper = mountDialog({
      secrets: [
        { name: "PASSWORD", steps: [2, 3] },
        { name: "TOKEN", steps: [5] },
      ],
    });

    expect(wrapper.get('[data-test="dialog-stub-title"]').text()).toBe(
      "Secrets for this replay in QA",
    );
    expect(wrapper.get(input("PASSWORD")).text()).toContain(
      "PASSWORD · secret in QA · used by steps 2, 3",
    );
    expect(wrapper.get(input("TOKEN")).text()).toContain("TOKEN · secret in QA · used by step 5");
  });

  it("masks the typed value and reveals it with the built-in toggle", async () => {
    wrapper = mountDialog();
    expect(field(wrapper, "PASSWORD").type).toBe("password");

    await wrapper.get(input("PASSWORD", "-reveal")).trigger("click");
    expect(field(wrapper, "PASSWORD").type).toBe("text");

    await wrapper.get(input("PASSWORD", "-reveal")).trigger("click");
    expect(field(wrapper, "PASSWORD").type).toBe("password");
  });

  it("keeps the browser from autofilling a saved password into a secret", () => {
    wrapper = mountDialog();
    expect(field(wrapper, "PASSWORD").getAttribute("autocomplete")).toBe("new-password");
  });

  it("says the value stays in memory and is never saved", () => {
    wrapper = mountDialog();
    expect(wrapper.text()).toContain(
      "Scheduled runs use the stored secret. Replay runs in your browser, which can't read it.",
    );
    expect(wrapper.text()).toContain("Kept in memory until you close this tab. Never saved.");
  });

  it("ask mode: shows a required error when Replay in {environment} is pressed with an empty field; submits every value", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrapper = mountDialog({
      onSubmit,
      secrets: [
        { name: "PASSWORD", steps: [2] },
        { name: "TOKEN", steps: [5] },
      ],
    });
    const primary = wrapper.get('[data-test="dialog-stub-primary"]');
    expect(primary.text()).toBe("Replay in QA");
    expect(primary.attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-test="dialog-stub-neutral"]').exists()).toBe(false);

    await wrapper.get(input("PASSWORD", "-field")).setValue("p");
    await pressPrimary(wrapper);

    await vi.waitFor(() => expect(wrapper.find(input("TOKEN", "-error")).exists()).toBe(true));
    expect(wrapper.find(input("PASSWORD", "-error")).exists()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    await wrapper.get(input("TOKEN", "-field")).setValue("t");
    await pressPrimary(wrapper);

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({ PASSWORD: "p", TOKEN: "t" });
  });

  it("change mode: prefills the value masked, shows the failed step, offers Forget value and Save & re-run", async () => {
    wrapper = mountDialog({
      mode: "change",
      failedAtStep: 3,
      secrets: [{ name: "PASSWORD", steps: [2, 3], value: "hunter2" }],
    });

    expect(field(wrapper, "PASSWORD").value).toBe("hunter2");
    expect(field(wrapper, "PASSWORD").type).toBe("password");
    expect(wrapper.text()).toContain("The last replay failed at step 3 with this value.");
    expect(wrapper.get('[data-test="dialog-stub-primary"]').text()).toBe("Save & re-run");

    const forget = wrapper.get('[data-test="dialog-stub-neutral"]');
    expect(forget.text()).toBe("Forget value");
    await forget.trigger("click");

    expect(wrapper.emitted("forget")).toEqual([[["PASSWORD"]]]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });
});
