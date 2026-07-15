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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { nextTick } from "vue";
import AddCipherKey from "@/components/cipherkeys/AddCipherKey.vue";
import CipherKeysService from "@/services/cipher_keys";
import i18n from "@/locales";

// The cipherkeys family is migrated to a SINGLE parent OForm + Zod
// (AddCipherKey.schema.ts): the children render OForm* controls connected to
// this form by name. These tests mount the REAL OForm (never stub it) so they
// exercise the actual schema wiring — an empty required field must block submit
// and NOT call the service (the gap that let the AddToDashboard bug ship).

vi.mock("@/services/cipher_keys", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
    get_by_name: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

// toast returns a dismiss() fn — keep it a no-op so the loading toast teardown
// in the save handlers doesn't blow up.
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

const flush = () => flushPromises();

const setField = (wrapper: any, name: string, value: unknown) =>
  wrapper.vm.form.setFieldValue(name, value);

// Drive a real submit (runs the schema + awaits the @submit handler).
const submit = async (wrapper: any) => {
  await wrapper.vm.form.handleSubmit();
  await flush();
};

const fillValidLocal = (wrapper: any) => {
  setField(wrapper, "name", "my-cipher-key");
  setField(wrapper, "key.store.type", "local");
  setField(wrapper, "key.store.local", "super-secret");
};

describe("AddCipherKey.vue", () => {
  let wrapper: any;
  let store: any;
  let router: any;

  const createWrapper = async (routeQuery: Record<string, any> = {}) => {
    store = createStore({
      state: { selectedOrganization: { identifier: "test-org" } },
    });
    router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    router.push({ query: routeQuery });
    await router.isReady();

    const w = mount(AddCipherKey, {
      global: { plugins: [store, router, i18n] },
    });
    await flush();
    return w;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (CipherKeysService.create as any).mockResolvedValue({ data: {} });
    (CipherKeysService.update as any).mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe("rendering", () => {
    it("mounts with the real OForm", async () => {
      wrapper = await createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
    });

    it("shows the create (not update) title in create mode", async () => {
      wrapper = await createWrapper();
      expect(
        wrapper.find('[data-test="add-template-title"]').text(),
      ).not.toContain("Update");
    });

    it("renders the name input, type select, and action buttons", async () => {
      wrapper = await createWrapper();
      expect(
        wrapper.find('[data-test="add-cipher-key-name-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-cipher-key-type-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-cipher-key-cancel-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-cipher-key-save-btn"]').exists(),
      ).toBe(true);
    });

    it("starts at step 1", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.step).toBe(1);
    });

    // Pre-migration this button was step-gated (`step === 1 && !isUpdating`), so
    // create-mode Save was dead on step 1. R3 drops that: Save always submits and
    // the schema decides. The two assertions below are the whole contract — it is
    // only safe to leave Save enabled BECAUSE an invalid submit reports why.
    it("keeps the Save button enabled and submitting (R3 — never disabled)", async () => {
      wrapper = await createWrapper();
      const saveBtn = wrapper.find('[data-test="add-cipher-key-save-btn"]');
      expect(saveBtn.attributes("disabled")).toBeUndefined();
      expect(saveBtn.attributes("type")).toBe("submit");
    });

    it("surfaces the name error when Save submits an empty form on step 1", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.step).toBe(1);

      await wrapper.find("form").trigger("submit");
      await flush();

      expect(CipherKeysService.create).not.toHaveBeenCalled();
      expect(
        wrapper.find('[data-test="add-cipher-key-name-input-error"]').text(),
      ).toBe("Name is required");
    });
  });

  describe("validation gates the submit (real OForm)", () => {
    it("blocks submit and does NOT create when required fields are empty", async () => {
      wrapper = await createWrapper();
      await submit(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(CipherKeysService.create).not.toHaveBeenCalled();
    });

    it("creates a local key when the form is valid", async () => {
      wrapper = await createWrapper();
      fillValidLocal(wrapper);
      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(CipherKeysService.create).toHaveBeenCalledTimes(1);
      const [org, payload] = (CipherKeysService.create as any).mock.calls[0];
      expect(org).toBe("test-org");
      expect(payload.name).toBe("my-cipher-key");
      expect(payload.key.store.local).toBe("super-secret");
      // Payload parity with the pre-migration code: the `isUpdate` UI flag is
      // merged into the body (false on create). Backend ignores it.
      expect(payload.isUpdate).toBe(false);
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("does NOT create when the local secret is missing", async () => {
      wrapper = await createWrapper();
      setField(wrapper, "name", "my-cipher-key");
      setField(wrapper, "key.store.type", "local");
      setField(wrapper, "key.store.local", "");
      await submit(wrapper);
      expect(CipherKeysService.create).not.toHaveBeenCalled();
    });

    it("creates an akeyless key when all conditional fields are valid", async () => {
      wrapper = await createWrapper();
      setField(wrapper, "name", "my-akeyless");
      setField(wrapper, "key.store.type", "akeyless");
      setField(wrapper, "key.store.akeyless.base_url", "https://api.akeyless.io");
      setField(wrapper, "key.store.akeyless.access_id", "p-abc123");
      setField(wrapper, "key.store.akeyless.auth.type", "access_key");
      setField(wrapper, "key.store.akeyless.auth.access_key", "the-key");
      setField(wrapper, "key.store.akeyless.store.type", "static_secret");
      setField(wrapper, "key.store.akeyless.store.static_secret", "secret-name");
      await submit(wrapper);

      expect(CipherKeysService.create).toHaveBeenCalledTimes(1);
      const [, payload] = (CipherKeysService.create as any).mock.calls[0];
      expect(payload.key.store.type).toBe("akeyless");
      expect(payload.key.store.akeyless.base_url).toBe(
        "https://api.akeyless.io",
      );
    });

    it("does NOT create an akeyless key with an invalid base URL", async () => {
      wrapper = await createWrapper();
      setField(wrapper, "name", "my-akeyless");
      setField(wrapper, "key.store.type", "akeyless");
      setField(wrapper, "key.store.akeyless.base_url", "not-a-url");
      setField(wrapper, "key.store.akeyless.access_id", "p-abc123");
      setField(wrapper, "key.store.akeyless.auth.type", "access_key");
      setField(wrapper, "key.store.akeyless.auth.access_key", "the-key");
      setField(wrapper, "key.store.akeyless.store.type", "static_secret");
      setField(wrapper, "key.store.akeyless.store.static_secret", "secret-name");
      await submit(wrapper);
      expect(CipherKeysService.create).not.toHaveBeenCalled();
    });
  });

  describe("stepper", () => {
    it("Continue advances to step 2 only when the form is valid", async () => {
      wrapper = await createWrapper();
      fillValidLocal(wrapper);
      await wrapper.vm.continueToStep2();
      await nextTick();
      expect(wrapper.vm.step).toBe(2);
      // Advancing must not save.
      expect(CipherKeysService.create).not.toHaveBeenCalled();
    });

    it("Continue stays on step 1 when the form is invalid", async () => {
      wrapper = await createWrapper();
      await wrapper.vm.continueToStep2();
      await nextTick();
      expect(wrapper.vm.step).toBe(1);
    });

    it("Back returns to step 1", async () => {
      wrapper = await createWrapper();
      fillValidLocal(wrapper);
      await wrapper.vm.continueToStep2();
      await nextTick();
      expect(wrapper.vm.step).toBe(2);

      await wrapper
        .find('[data-test="add-cipher-key-step2-back-btn"]')
        .trigger("click");
      expect(wrapper.vm.step).toBe(1);
    });

    it("renders the akeyless child when store.type is akeyless", async () => {
      wrapper = await createWrapper();
      setField(wrapper, "key.store.type", "akeyless");
      await nextTick();
      expect(
        wrapper.find('[data-test="add-cipher-key-akeyless-baseurl-input"]')
          .exists(),
      ).toBe(true);
    });

    it("renders the openobserve secret child when store.type is local", async () => {
      wrapper = await createWrapper();
      expect(
        wrapper.find('[data-test="add-cipher-key-openobserve-secret-input"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("edit mode", () => {
    const record = {
      name: "existing-key",
      key: {
        store: { type: "local", local: "loaded-secret" },
        mechanism: { type: "simple", simple_algorithm: "aes-256-siv" },
      },
    };

    beforeEach(() => {
      (CipherKeysService.get_by_name as any).mockResolvedValue({ data: record });
    });

    it("loads the record, flips to update mode, and prefills the form", async () => {
      wrapper = await createWrapper({ action: "edit", name: "existing-key" });
      await flush();
      expect(wrapper.vm.isUpdatingCipherKey).toBe(true);
      expect(wrapper.find('[data-test="add-template-title"]').text()).toContain(
        "Update",
      );
      expect(wrapper.vm.form.state.values.name).toBe("existing-key");
      expect(wrapper.vm.form.state.values.key.store.local).toBe(
        "loaded-secret",
      );
    });

    it("makes the name input readonly AND disabled in update mode", async () => {
      wrapper = await createWrapper({ action: "edit", name: "existing-key" });
      await flush();
      const nameInput = wrapper.find(
        '[data-test="add-cipher-key-name-input"] input',
      );
      // Pre-migration the name field carried BOTH readonly + disable in edit
      // mode: readonly blocks typing, disabled gives the greyed "locked" look.
      expect(nameInput.attributes("readonly")).toBeDefined();
      expect(nameInput.attributes("disabled")).toBeDefined();
    });

    it("short-circuits with no update call when nothing changed", async () => {
      wrapper = await createWrapper({ action: "edit", name: "existing-key" });
      await flush();
      await submit(wrapper);
      expect(CipherKeysService.update).not.toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("calls update when a field changed", async () => {
      wrapper = await createWrapper({ action: "edit", name: "existing-key" });
      await flush();
      setField(wrapper, "key.store.local", "changed-secret");
      await submit(wrapper);
      expect(CipherKeysService.update).toHaveBeenCalledTimes(1);
      const [org, payload, name] = (CipherKeysService.update as any).mock
        .calls[0];
      expect(org).toBe("test-org");
      expect(payload.key.store.local).toBe("changed-secret");
      // Payload parity: `isUpdate` flag merged into the body (true on update).
      expect(payload.isUpdate).toBe(true);
      expect(name).toBe("existing-key");
    });
  });

  describe("cancel", () => {
    it("emits cancel:hideform directly when there are no changes", async () => {
      wrapper = await createWrapper();
      await wrapper
        .find('[data-test="add-cipher-key-cancel-btn"]')
        .trigger("click");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
      expect(wrapper.vm.dialog.show).toBe(false);
    });

    it("opens the discard-changes dialog when there are unsaved changes", async () => {
      wrapper = await createWrapper();
      setField(wrapper, "name", "dirty-name");
      await nextTick();
      await wrapper
        .find('[data-test="add-cipher-key-cancel-btn"]')
        .trigger("click");
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });
  });
});
