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

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DomainOrgMappings from "./DomainOrgMappings.vue";
import i18n from "@/locales";
import type { DomainOrgMapping } from "./DomainOrgMappings.schema";

const MAPPINGS: DomainOrgMapping[] = [
  { domain: "acme.com", org_id: "acme", base_role: "admin" },
  { domain: "beta.io", org_id: "beta", base_role: "viewer" },
];

const mountList = () =>
  mount(DomainOrgMappings, {
    props: { modelValue: MAPPINGS },
    global: {
      plugins: [i18n],
      stubs: {
        DomainOrgMappingDialog: true,
        ConfirmDialog: {
          name: "ConfirmDialog",
          props: ["modelValue", "messageKeypath", "messageName", "okVariant"],
          template: "<div />",
        },
      },
    },
  });

describe("DomainOrgMappings — remove confirm", () => {
  it("names the mapping's domain behind a destructive button", async () => {
    const wrapper = mountList();
    await wrapper.find('[data-test="settings-domain-org-mappings-delete-1"]').trigger("click");
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });

    expect(dialog.props("modelValue")).toBe(true);
    expect(dialog.props("messageKeypath")).toBe("settings.domainOrgMappings.confirmRemove");
    expect(dialog.props("messageName")).toBe("beta.io");
    expect(dialog.props("okVariant")).toBe("destructive");
  });

  it("keeps the removed domain in the message while the dialog fades out", async () => {
    const wrapper = mountList();
    await wrapper.find('[data-test="settings-domain-org-mappings-delete-0"]').trigger("click");
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    dialog.vm.$emit("update:ok");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([[MAPPINGS[1]]]);
    expect(dialog.props("messageName")).toBe("acme.com");
  });
});
