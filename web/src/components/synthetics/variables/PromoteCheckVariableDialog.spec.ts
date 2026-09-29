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
import { flushPromises, shallowMount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";

const promoteCheckVariable = vi.fn().mockResolvedValue({});
vi.mock("@/services/synthetics", () => ({
  default: { promoteCheckVariable: (...a: unknown[]) => promoteCheckVariable(...a) },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import PromoteCheckVariableDialog from "./PromoteCheckVariableDialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";

async function mountDialog(secure: boolean) {
  const wrapper = shallowMount(PromoteCheckVariableDialog, {
    props: { open: false, checkId: "c1", name: "BASE_URL", secure, environments: ["prod"] },
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "acme" } } } },
      stubs: { ODialog: { template: "<div><slot /><slot name='footer' /></div>" } },
    },
  }) as VueWrapper;
  await wrapper.setProps({ open: true });
  return wrapper;
}

const confirm = (wrapper: VueWrapper) =>
  wrapper
    .findAllComponents(OButton)
    .find((b) => b.attributes("data-test") === "synthetics-promote-check-variable-confirm")!;

describe("PromoteCheckVariableDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("offers global and the check's environments for a plain variable", async () => {
    wrapper = await mountDialog(false);
    const values = (wrapper.findComponent(OSelect).props("options") as { value: string }[]).map(
      (o) => o.value,
    );
    expect(values).toEqual(["", "prod"]);
  });

  it("never offers global for a secure variable", async () => {
    wrapper = await mountDialog(true);
    const values = (wrapper.findComponent(OSelect).props("options") as { value: string }[]).map(
      (o) => o.value,
    );
    expect(values).toEqual(["prod"]);
  });

  it("promotes into the chosen environment, or global as null", async () => {
    wrapper = await mountDialog(false);
    await confirm(wrapper).trigger("click");
    await flushPromises();
    expect(promoteCheckVariable).toHaveBeenLastCalledWith("acme", "c1", "BASE_URL", null);
    expect(wrapper.emitted("done")?.[0]).toEqual(["BASE_URL"]);

    wrapper.findComponent(OSelect).vm.$emit("update:model-value", "prod");
    await confirm(wrapper).trigger("click");
    await flushPromises();
    expect(promoteCheckVariable).toHaveBeenLastCalledWith("acme", "c1", "BASE_URL", "prod");
  });
});
