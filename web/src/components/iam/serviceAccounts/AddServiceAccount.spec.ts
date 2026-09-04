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
//
// AddServiceAccount asks for a service account NAME (a lowercase slug), not an
// email; the identifier is synthesized as `<name>.<org>@sa.internal` (org in
// the LOCAL part so every org-id shape passes the backend EMAIL_REGEX — see
// AddServiceAccount.schema.ts). Access grants (roles/groups) are applied in
// the same flow after creation, with failures reported alongside the `updated`
// event rather than thrown. These tests mount the REAL <OForm> (only ODialog
// is stubbed) so the conditional name schema actually gates the submit.

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/service_accounts", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/services/iam", () => ({
  getRoles: vi.fn().mockResolvedValue({ data: [] }),
  getGroups: vi.fn().mockResolvedValue({ data: [] }),
  updateRole: vi.fn(),
  updateGroup: vi.fn(),
  createRole: vi.fn(),
  getResources: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

import AddServiceAccount from "./AddServiceAccount.vue";
import service_accounts from "@/services/service_accounts";
import { updateRole, updateGroup, getResources } from "@/services/iam";
import {
  buildServiceAccountEmail,
  serviceAccountDisplayName,
  isSyntheticServiceAccountEmail,
  maxServiceAccountNameLength,
} from "./AddServiceAccount.schema";

// ODialog stub: renders the default slot so the REAL OForm mounts, and exposes
// the footer primary/secondary buttons. Save submits via `form-id` in the app;
// tests drive the form's own submit so the schema runs deterministically.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "size", "title", "primaryButtonLabel", "secondaryButtonLabel", "formId"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div data-test-stub="o-dialog" :data-open="String(open)" :data-title="title" :data-form-id="formId">
      <slot />
      <button
        v-if="secondaryButtonLabel"
        data-test="o-dialog-secondary-btn"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
      <button
        v-if="primaryButtonLabel"
        data-test="o-dialog-primary-btn"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>
  `,
  inheritAttrs: false,
};

function mountComp(props: Record<string, unknown> = {}): VueWrapper<any> {
  return mount(AddServiceAccount, {
    props: {
      open: true,
      modelValue: {
        first_name: "",
        email: "",
        organization: "",
      },
      isUpdated: false,
      ...props,
    },
    global: {
      plugins: [store, i18n],
      // AddRole is stubbed: it lives inside the ODialog slot (for depth
      // stacking) and would otherwise render a second stubbed ODialog whose
      // footer buttons collide with the outer dialog's in `find()` queries.
      stubs: { ODialog: ODialogStub, AddRole: true },
    },
  });
}

const getForm = (wrapper: VueWrapper<any>) => wrapper.findComponent({ name: "OForm" });
const getNameInput = (wrapper: VueWrapper<any>) =>
  wrapper.find('[data-test="iam-add-service-account-name-input"] input');
const getDescriptionInput = (wrapper: VueWrapper<any>) =>
  wrapper.find('[data-test="iam-add-service-account-description-input"] input');

const submitForm = async (wrapper: VueWrapper<any>) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

describe("AddServiceAccount", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("email helpers", () => {
    it("synthesizes an org-scoped lowercase identifier", () => {
      expect(buildServiceAccountEmail("Ingest-Bot", "Default")).toBe(
        "ingest-bot.default@sa.internal",
      );
    });

    it("works for org ids with underscores, digits, and ksuids (in the local part)", () => {
      expect(buildServiceAccountEmail("k1", "_meta")).toBe("k1._meta@sa.internal");
      expect(buildServiceAccountEmail("k1", "my_org1")).toBe("k1.my_org1@sa.internal");
      expect(buildServiceAccountEmail("k1", "2sfVQduPNzuGpSeoGSbNCM7oQKp")).toBe(
        "k1.2sfvqdupnzugpseogsbncm7oqkp@sa.internal",
      );
    });

    it("round-trips the friendly name from the identifier", () => {
      const email = buildServiceAccountEmail("ingest-bot", "default");
      expect(isSyntheticServiceAccountEmail(email, "default")).toBe(true);
      expect(serviceAccountDisplayName(email, "default")).toBe("ingest-bot");
    });

    it("leaves legacy real-email accounts unchanged", () => {
      expect(isSyntheticServiceAccountEmail("bot@example.com", "default")).toBe(false);
      // An identifier scoped to ANOTHER org must not match either.
      expect(isSyntheticServiceAccountEmail("bob.other@sa.internal", "default")).toBe(false);
      expect(serviceAccountDisplayName("bot@example.com", "default")).toBe("bot@example.com");
    });

    it("caps the name so the local part stays within 64 chars", () => {
      expect(maxServiceAccountNameLength("default")).toBe(64 - "default".length - 1);
    });
  });

  describe("rendering", () => {
    it("renders the dialog with the add title in create mode", () => {
      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-title")).toBe("New service account");
      expect(dialog.attributes("data-form-id")).toBe("add-service-account-form");
    });

    it("shows both name and description inputs in create mode", () => {
      expect(getNameInput(wrapper).exists()).toBe(true);
      expect(getDescriptionInput(wrapper).exists()).toBe(true);
    });

    it("hides the name input and shows the update title in update mode", async () => {
      const w = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Existing Description",
          organization: "default",
        },
      });
      await nextTick();

      expect(w.find('[data-test="iam-add-service-account-name-input"]').exists()).toBe(false);
      expect(getDescriptionInput(w).exists()).toBe(true);
      expect(w.find('[data-test-stub="o-dialog"]').attributes("data-title")).toBe(
        "Update Service Account",
      );
      w.unmount();
    });

    it("prefills the description from modelValue in update mode", () => {
      const w = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "My Description",
          organization: "default",
        },
      });
      expect(getForm(w).props("defaultValues")).toEqual({
        name: "",
        first_name: "My Description",
        roles: [],
        groups: [],
      });
      w.unmount();
    });
  });

  describe("schema validation (real OForm, create mode)", () => {
    it("blocks submit and does NOT call create when the name is empty", async () => {
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(service_accounts.create).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Use lowercase letters, numbers and hyphens");
    });

    it("blocks submit when the name contains invalid characters", async () => {
      await getNameInput(wrapper).setValue("Not A Slug!");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("blocks submit on a leading/trailing hyphen", async () => {
      await getNameInput(wrapper).setValue("-bot-");
      await submitForm(wrapper);

      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("blocks submit when the name exceeds the org-derived cap", async () => {
      await getNameInput(wrapper).setValue("a".repeat(maxServiceAccountNameLength("default") + 1));
      await submitForm(wrapper);

      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("submits and calls create with the synthesized identifier", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} } as any);
      await getNameInput(wrapper).setValue("ingest-bot");
      await getDescriptionInput(wrapper).setValue("My Service Account");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(service_accounts.create).toHaveBeenCalledTimes(1);
      expect(service_accounts.create).toHaveBeenCalledWith(
        {
          email: "ingest-bot.default@sa.internal",
          first_name: "My Service Account",
        },
        "default",
      );
    });
  });

  describe("creation behavior", () => {
    it("emits updated (with an access promise resolving to empty buckets) + update:open(false) after a successful create", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} } as any);
      await getNameInput(wrapper).setValue("new-bot");
      await submitForm(wrapper);

      const updated = wrapper.emitted("updated");
      expect(updated).toBeTruthy();
      expect(updated![0][1]).toEqual({
        email: "new-bot.default@sa.internal",
        first_name: "",
        organization: "default",
      });
      // The grant fan-out rides along as a promise so the show-once token is
      // never blocked on it.
      await expect(updated![0][3]).resolves.toEqual({
        assigned: { roles: [], groups: [] },
        failed: { roles: [], groups: [] },
      });
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("fans out role/group grants and buckets failures without hiding the created event", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} } as any);
      vi.mocked(updateRole).mockResolvedValue({ data: {} } as any);
      vi.mocked(updateGroup).mockRejectedValue(new Error("boom"));

      await getNameInput(wrapper).setValue("granted-bot");
      const form = getForm(wrapper).vm.form;
      form.setFieldValue("roles", ["editor"]);
      form.setFieldValue("groups", ["pipelines"]);
      await submitForm(wrapper);

      const email = "granted-bot.default@sa.internal";
      expect(updateRole).toHaveBeenCalledWith({
        role_id: "editor",
        org_identifier: "default",
        payload: { add: [], remove: [], add_users: [email], remove_users: [] },
      });
      expect(updateGroup).toHaveBeenCalledWith({
        group_name: "pipelines",
        org_identifier: "default",
        payload: {
          add_roles: [],
          remove_roles: [],
          add_users: [email],
          remove_users: [],
        },
      });

      const updated = wrapper.emitted("updated");
      expect(updated).toBeTruthy();
      await expect(updated![0][3]).resolves.toEqual({
        assigned: { roles: ["editor"], groups: [] },
        failed: { roles: [], groups: ["pipelines"] },
      });
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("keeps the dialog open and shows an error toast on a 500 failure", async () => {
      vi.mocked(service_accounts.create).mockRejectedValue({
        response: { status: 500, data: { message: "Server error" } },
      });
      await getNameInput(wrapper).setValue("fail-bot");
      await submitForm(wrapper);

      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(wrapper.emitted("updated")).toBeFalsy();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("does not throw on a 403 failure during create", async () => {
      vi.mocked(service_accounts.create).mockRejectedValue({
        response: { status: 403 },
      });
      await getNameInput(wrapper).setValue("forbidden-bot");

      await expect(submitForm(wrapper)).resolves.not.toThrow();
      expect(service_accounts.create).toHaveBeenCalled();
    });
  });

  describe("inline role creation", () => {
    it("onRoleAdded appends the role to the options and auto-selects it in the form", async () => {
      await wrapper.vm.onRoleAdded({ role_name: "fresh_role" });
      await nextTick();

      expect(wrapper.vm.roleOptions).toContainEqual({
        label: "fresh_role",
        value: "fresh_role",
      });
      expect(getForm(wrapper).vm.form.state.values.roles).toEqual(["fresh_role"]);
    });

    it("onRoleAdded is idempotent (no duplicate option or selection)", async () => {
      await wrapper.vm.onRoleAdded({ role_name: "fresh_role" });
      await wrapper.vm.onRoleAdded({ role_name: "fresh_role" });
      await nextTick();

      expect(wrapper.vm.roleOptions.filter((o: any) => o.value === "fresh_role")).toHaveLength(1);
      expect(getForm(wrapper).vm.form.state.values.roles).toEqual(["fresh_role"]);
    });

    it("a role selected via onRoleAdded is included in the grant fan-out", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} } as any);
      vi.mocked(updateRole).mockResolvedValue({ data: {} } as any);

      await getNameInput(wrapper).setValue("with-new-role");
      await wrapper.vm.onRoleAdded({ role_name: "fresh_role" });
      await submitForm(wrapper);

      expect(updateRole).toHaveBeenCalledWith(expect.objectContaining({ role_id: "fresh_role" }));
      await expect(wrapper.emitted("updated")![0][3]).resolves.toEqual({
        assigned: { roles: ["fresh_role"], groups: [] },
        failed: { roles: [], groups: [] },
      });
    });

    it("seeds read-only permissions headlessly when the readonly preset was chosen", async () => {
      vi.mocked(getResources).mockResolvedValue({
        data: [
          { key: "stream", visible: true },
          { key: "logs_cache", visible: true },
          { key: "hidden", visible: false },
        ],
      } as any);
      vi.mocked(updateRole).mockResolvedValue({ data: {} } as any);

      await wrapper.vm.onRoleAdded({
        role_name: "viewer_role",
        startFrom: "readonly",
      });

      expect(updateRole).toHaveBeenCalledWith({
        role_id: "viewer_role",
        org_identifier: "default",
        payload: {
          add: [
            { object: "stream:_all_default", permission: "AllowList" },
            { object: "stream:_all_default", permission: "AllowGet" },
          ],
          remove: [],
          add_users: [],
          remove_users: [],
        },
      });
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("warns instead of claiming success when the seeding yields zero grants", async () => {
      vi.mocked(getResources).mockResolvedValue({ data: [] } as any);

      await wrapper.vm.onRoleAdded({
        role_name: "viewer_role",
        startFrom: "readonly",
      });

      expect(updateRole).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("does not seed permissions for the custom (empty) preset", async () => {
      await wrapper.vm.onRoleAdded({
        role_name: "empty_role",
        startFrom: "custom",
      });

      expect(getResources).not.toHaveBeenCalled();
      expect(updateRole).not.toHaveBeenCalled();
    });

    it("downgrades a seeding failure to a warning and keeps the role selected", async () => {
      vi.mocked(getResources).mockRejectedValue(new Error("boom"));

      await wrapper.vm.onRoleAdded({
        role_name: "viewer_role",
        startFrom: "readonly",
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(getForm(wrapper).vm.form.state.values.roles).toEqual(["viewer_role"]);
    });
  });

  describe("update behavior", () => {
    let updateWrapper: VueWrapper<any>;

    beforeEach(async () => {
      updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Original Description",
          organization: "default",
        },
      });
      await nextTick();
    });

    afterEach(() => {
      updateWrapper?.unmount();
    });

    it("submits without a name field and calls update with the payload", async () => {
      vi.mocked(service_accounts.update).mockResolvedValue({ data: {} } as any);
      await getDescriptionInput(updateWrapper).setValue("Updated Description");
      await submitForm(updateWrapper);

      expect(getForm(updateWrapper).vm.form.state.isValid).toBe(true);
      expect(service_accounts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Updated Description",
          organization: "default",
        }),
        "default",
        "existing@example.com",
      );
    });

    it("emits updated + update:open(false) after a successful update", async () => {
      vi.mocked(service_accounts.update).mockResolvedValue({ data: {} } as any);
      await submitForm(updateWrapper);

      expect(updateWrapper.emitted("updated")).toBeTruthy();
      expect(updateWrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });

  describe("dialog interactions", () => {
    it("emits update:open(false) when cancel is clicked", async () => {
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("forwards update:open from the dialog", async () => {
      await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });
});
