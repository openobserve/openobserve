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
import i18n from "@/locales";
import SaveFunnelDialog from "./SaveFunnelDialog.vue";

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "formId"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div v-if="open" data-test-stub="o-dialog" :data-title="title" :data-form-id="formId">
    <slot />
    <button data-test="o-dialog-secondary-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
    <button data-test="o-dialog-primary-btn" type="submit" :form="formId">{{ primaryButtonLabel }}</button>
  </div>`,
};

describe("SaveFunnelDialog (AC-67)", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const mountDialog = (props: Record<string, unknown> = {}) => {
    const submit = vi.fn(async () => "saved" as const);
    wrapper = mount(SaveFunnelDialog, {
      props: {
        open: true,
        mode: "save",
        initialName: "",
        takenName: (n: string) => n.trim().toLowerCase() === "signup",
        submit,
        ...props,
      },
      global: { plugins: [i18n], stubs: { ODialog: ODialogStub } },
      attachTo: document.body,
    });
    return submit;
  };
  const setInput = async (dt: string, value: string) => {
    const el = wrapper!.find<HTMLInputElement>(
      `[data-test="${dt}"] input, [data-test="${dt}"] textarea, input[data-test="${dt}-field"], textarea[data-test="${dt}-field"]`,
    );
    await el.setValue(value);
  };
  const submitForm = async () => {
    await wrapper!.find("form").trigger("submit");
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
    }
  };

  it("titles each mode, pre-fills the name and states that the SQL is a snapshot", () => {
    mountDialog({ mode: "rename", initialName: "Old name" });
    expect(wrapper!.find('[data-test-stub="o-dialog"]').attributes("data-title")).toBe(
      "Rename saved funnel",
    );
    expect(
      wrapper!.find<HTMLInputElement>('[data-test="rum-analytics-save-funnel-name"] input').element
        .value,
    ).toBe("Old name");
    wrapper!.unmount();
    mountDialog({ mode: "save-as" });
    expect(wrapper!.find('[data-test-stub="o-dialog"]').attributes("data-title")).toBe(
      "Save funnel as",
    );
    expect(wrapper!.text()).toContain("as a snapshot");
    wrapper!.unmount();
    mountDialog({ mode: "duplicate", initialName: "Copy of Signup" });
    expect(wrapper!.find('[data-test-stub="o-dialog"]').attributes("data-title")).toBe(
      "Duplicate funnel",
    );
    expect(
      wrapper!.find<HTMLInputElement>('[data-test="rum-analytics-save-funnel-name"] input').element
        .value,
    ).toBe("Copy of Signup");
    expect(wrapper!.find('[data-test="rum-analytics-save-funnel-description"]').exists()).toBe(
      true,
    );
  });

  it.each([
    ["an empty name", "", "", "Name is required"],
    ["a taken name, ignoring case", " SIGNUP ", "", "A saved funnel with this name already exists"],
    ["an 81-character name", "x".repeat(81), "", "Use at most 80 characters"],
    [
      "65 dotted I, over the server's 128-character name key once lowercased (F52)",
      "\u0130".repeat(65),
      "",
      "This name is too long once lowercased (at most 128 characters)",
    ],
    ["a 501-character description", "Ok", "d".repeat(501), "Use at most 500 characters"],
  ])("refuses %s inline and calls nothing", async (_label, name, description, error) => {
    const submit = mountDialog();
    await setInput("rum-analytics-save-funnel-name", name);
    await setInput("rum-analytics-save-funnel-description", description);
    await submitForm();
    expect(submit).not.toHaveBeenCalled();
    expect(wrapper!.text()).toContain(error);
  });

  it("submits 64 dotted I, whose lowercase form is exactly 128 characters (F52)", async () => {
    const submit = mountDialog();
    await setInput("rum-analytics-save-funnel-name", "\u0130".repeat(64));
    await submitForm();
    expect(submit).toHaveBeenCalledWith({ name: "\u0130".repeat(64), description: "" });
  });

  it("submits the trimmed name and description, and closes once saved", async () => {
    const submit = mountDialog();
    await setInput("rum-analytics-save-funnel-name", "  Checkout  ");
    await setInput("rum-analytics-save-funnel-description", " Cart to paid ");
    await submitForm();
    expect(submit).toHaveBeenCalledWith({ name: "Checkout", description: "Cart to paid" });
    expect(wrapper!.emitted("update:open")).toEqual([[false]]);
  });

  it("a server duplicate lands on the name field and keeps the dialog open; editing the name clears it", async () => {
    const submit = mountDialog();
    submit.mockResolvedValueOnce("duplicate" as never);
    await setInput("rum-analytics-save-funnel-name", "Checkout");
    await submitForm();
    expect(wrapper!.text()).toContain("A saved funnel with this name already exists");
    expect(wrapper!.emitted("update:open")).toBeUndefined();
    await setInput("rum-analytics-save-funnel-name", "Checkout 2");
    await flushPromises();
    expect(wrapper!.text()).not.toContain("A saved funnel with this name already exists");
  });

  it("a failed save keeps the dialog open with the values", async () => {
    const submit = mountDialog();
    submit.mockResolvedValueOnce("failed" as never);
    await setInput("rum-analytics-save-funnel-name", "Checkout");
    await submitForm();
    expect(wrapper!.emitted("update:open")).toBeUndefined();
    expect(
      wrapper!.find<HTMLInputElement>('[data-test="rum-analytics-save-funnel-name"] input').element
        .value,
    ).toBe("Checkout");
  });
});
