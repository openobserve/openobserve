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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { fillField } from "@/test/unit/helpers/fillField";
import CipherKeysService from "@/services/cipher_keys";
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import {
  editorDraftKey,
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import CipherKeys from "@/components/settings/CipherKeys.vue";
import AddCipherKey from "./AddCipherKey.vue";
import { addCipherKeyDefaults, type AddCipherKeyForm } from "./AddCipherKey.schema";

vi.mock("@/services/cipher_keys", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
      get_by_name: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulkDelete: vi.fn(),
    },
  });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

const service = CipherKeysService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const newScope: EditorDraftScope = {
  kind: "cipher_key",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "payments_key" };

const savedKey = (): AddCipherKeyForm => {
  const record = addCipherKeyDefaults();
  record.name = "payments_key";
  record.key.store.local = "c3VwZXItc2VjcmV0LWtleQ==";
  return record;
};

const draftOf = (patch: (form: AddCipherKeyForm) => void): AddCipherKeyForm => {
  const data = addCipherKeyDefaults();
  patch(data);
  return data;
};

interface CipherForm {
  state: { values: AddCipherKeyForm };
  setFieldValue: (name: string, value: unknown) => void;
}

let router: Router;
let wrapper: VueWrapper | null = null;

const mountPage = async (query: Record<string, string> = {}) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings/cipher_keys", name: "cipherKeys", component: CipherKeys },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push({ name: "cipherKeys", query });
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, store, router] } },
  );
  await flushPromises();
};

const editor = () => wrapper!.findComponent(AddCipherKey);
const form = () => (editor().vm as unknown as { form: CipherForm }).form;
const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const inDialog = (dialog: string, id: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${dialog}"] [data-test="${id}"]`);
const leaveButton = (id: string) => inDialog("editor-draft-leave-dialog", id);

const edit = async (field: string, value: unknown) => {
  window.dispatchEvent(new Event("pointerdown"));
  form().setFieldValue(field, value);
  await nextTick();
};

const clickCancel = async () => {
  byTest("add-cipher-key-cancel-btn")?.click();
  await flushPromises();
};

describe("AddCipherKey drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
    service.list.mockResolvedValue({
      data: { keys: [{ ...savedKey() }, { ...savedKey(), name: "audit_key" }] },
    });
    service.get_by_name.mockResolvedValue({ data: savedKey() });
    service.create.mockResolvedValue({ data: {} });
    service.update.mockResolvedValue({ data: {} });
    service.delete.mockResolvedValue({ data: {} });
    service.bulkDelete.mockResolvedValue({
      data: { successful: ["payments_key"], unsuccessful: [] },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("drafts a filled-in name and never stores the secret", async () => {
    await mountPage({ action: "add" });
    await fillField("add-cipher-key-name-input", "billing_key");
    await fillField("add-cipher-key-openobserve-secret-input", "dG9wLXNlY3JldA==");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<AddCipherKeyForm>(newScope);
    expect(draft?.data.name).toBe("billing_key");
    expect(draft?.data.key.store.local).toBe("");
    expect(draft?.redactedPaths).toContain("/key/store/local");
    expect(localStorage.getItem(editorDraftKey(newScope))).not.toContain("dG9wLXNlY3JldA==");
  });

  it("Continue restores the work, leaves a changed secret blank and blocks Save until it is typed again", async () => {
    writeEditorDraft(newScope, {
      data: draftOf((f) => (f.name = "from_draft")),
      redactedPaths: ["/key/store/local"],
      changedRedactedPaths: ["/key/store/local"],
    });
    await mountPage({ action: "add" });

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("cipher key");
    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("Secret");
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(form().state.values.name).toBe("from_draft");
    expect(form().state.values.key.store.local).toBe("");
    byTest("add-cipher-key-save-btn")?.click();
    await flushPromises();
    expect(service.create).not.toHaveBeenCalled();

    await fillField("add-cipher-key-openobserve-secret-input", "bmV3LXNlY3JldA==");
    byTest("add-cipher-key-save-btn")?.click();
    await vi.waitFor(() => expect(service.create).toHaveBeenCalledTimes(1));
    expect(service.create.mock.calls[0][1].key.store.local).toBe("bmV3LXNlY3JldA==");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("an optional secret the user changed comes back blank and blocks Save until it is typed again", async () => {
    const akeyless = draftOf((f) => {
      f.name = "payments_key";
      f.key.store.type = "akeyless";
      const ak = f.key.store.akeyless;
      ak.base_url = "https://akeyless.example.com";
      ak.access_id = "p-ab12cd";
      ak.auth.access_key = "c2VydmVyLWFjY2Vzcy1rZXk=";
      ak.store.type = "dfc";
      ak.store.dfc = { name: "payments", iv: "aXYtb2xk", encrypted_data: "ZW5jcnlwdGVk" };
    });
    service.get_by_name.mockResolvedValue({ data: akeyless });
    const stored = JSON.parse(JSON.stringify(akeyless)) as AddCipherKeyForm;
    stored.key.store.akeyless.access_id = "";
    stored.key.store.akeyless.auth.access_key = "";
    stored.key.store.akeyless.store.dfc.iv = "";
    stored.key.store.akeyless.store.dfc.encrypted_data = "";
    stored.key.mechanism.type = "tink_keyset";
    const ak = "/key/store/akeyless";
    writeEditorDraft(editScope, {
      data: stored,
      baseHash: hashDraftValue(akeyless),
      redactedPaths: [
        `${ak}/access_id`,
        `${ak}/auth/access_key`,
        `${ak}/store/dfc/iv`,
        `${ak}/store/dfc/encrypted_data`,
      ],
      changedRedactedPaths: [`${ak}/store/dfc/iv`],
    });
    await mountPage({ action: "edit", name: "payments_key" });

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("DFC IV");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    const restored = form().state.values.key.store.akeyless;
    expect(restored.access_id).toBe("p-ab12cd");
    expect(restored.auth.access_key).toBe("c2VydmVyLWFjY2Vzcy1rZXk=");
    expect(restored.store.dfc.encrypted_data).toBe("ZW5jcnlwdGVk");
    expect(restored.store.dfc.iv).toBe("");

    byTest("add-cipher-key-save-btn")?.click();
    await flushPromises();
    expect(service.update).not.toHaveBeenCalled();
    expect(byTest("add-cipher-key-akeyless-dfc-iv-input")?.textContent).toContain("Re-enter");

    await fillField("add-cipher-key-akeyless-dfc-iv-input", "aXYtbmV3");
    byTest("add-cipher-key-save-btn")?.click();
    await vi.waitFor(() => expect(service.update).toHaveBeenCalledTimes(1));
    expect(service.update.mock.calls[0][1].key.store.akeyless.store.dfc.iv).toBe("aXYtbmV3");
  });

  it("names a not-kept Akeyless static secret so it cannot read as the key's own name", async () => {
    const ak = "/key/store/akeyless";
    writeEditorDraft(newScope, {
      data: draftOf((f) => {
        f.name = "static_key";
        f.key.store.type = "akeyless";
      }),
      redactedPaths: [`${ak}/store/static_secret`],
      changedRedactedPaths: [`${ak}/store/static_secret`],
    });
    await mountPage({ action: "add" });
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "Your change to the Akeyless static secret name was not kept.",
    );
  });

  it("Start fresh drops the draft and keeps the empty form", async () => {
    writeEditorDraft(newScope, { data: draftOf((f) => (f.name = "from_draft")) });
    await mountPage({ action: "add" });

    inDialog("editor-draft-restore-dialog", "o-dialog-secondary-btn")?.click();
    await flushPromises();

    expect(form().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Escape on the restore dialog keeps the draft and the empty form", async () => {
    writeEditorDraft(newScope, { data: draftOf((f) => (f.name = "from_draft")) });
    await mountPage({ action: "add" });

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft<AddCipherKeyForm>(newScope)?.data.name).toBe("from_draft");
  });

  it("an edited key's draft is keyed by its name, and an untouched secret is refilled on Continue", async () => {
    await mountPage({ action: "edit", name: "payments_key" });
    await edit("key.mechanism.type", "tink_keyset");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<AddCipherKeyForm>(editScope);
    expect(draft?.data.key.mechanism.type).toBe("tink_keyset");
    expect(draft?.data.key.store.local).toBe("");
    expect(draft?.changedRedactedPaths).toEqual([]);
    // Hashed with the key material blanked, so the stored hash cannot confirm a guessed secret.
    expect(draft?.baseHash).toMatch(/^[0-9a-f]{8}$/);
    expect(draft?.baseHash).not.toBe(hashDraftValue(savedKey()));
    expect(localStorage.getItem(editorDraftKey(newScope))).toBeNull();

    wrapper!.unmount();
    await mountPage({ action: "edit", name: "payments_key" });
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values.key.mechanism.type).toBe("tink_keyset");
    expect(form().state.values.key.store.local).toBe("c3VwZXItc2VjcmV0LWtleQ==");
  });

  it("opening a deleted key drops its draft with a notice", async () => {
    writeEditorDraft(editScope, { data: savedKey() });
    service.get_by_name.mockRejectedValue({ status: 404, response: { status: 404, data: {} } });
    await mountPage({ action: "edit", name: "payments_key" });

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(editScope)).toBeNull();
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "info", message: expect.stringContaining("cipher key") }),
    );
  });

  it("Cancel asks, and Discard closes the editor and drops the draft", async () => {
    await mountPage({ action: "add" });
    await fillField("add-cipher-key-name-input", "not_kept");
    window.dispatchEvent(new Event("pagehide"));

    await clickCancel();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(editor().exists()).toBe(true);

    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(editor().exists()).toBe(false);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Keep draft closes the editor and keeps the work", async () => {
    await mountPage({ action: "add" });
    await fillField("add-cipher-key-name-input", "kept_for_later");

    await clickCancel();
    leaveButton("o-dialog-secondary-btn")?.click();
    await flushPromises();

    expect(editor().exists()).toBe(false);
    expect(readEditorDraft<AddCipherKeyForm>(newScope)?.data.name).toBe("kept_for_later");
  });

  it("closing leaves ?action before the list reloads, so a kept draft is not offered again", async () => {
    await mountPage({ action: "add" });
    await fillField("add-cipher-key-name-input", "kept_for_later");
    service.list.mockReturnValue(new Promise(() => undefined));

    await clickCancel();
    leaveButton("o-dialog-secondary-btn")?.click();
    await flushPromises();

    expect(router.currentRoute.value.query.action).toBeUndefined();
    expect(editor().exists()).toBe(false);
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(newScope)).not.toBeNull();
  });

  it("a clean Cancel after Escape on restore closes without offering the draft again", async () => {
    writeEditorDraft(newScope, { data: draftOf((f) => (f.name = "from_draft")) });
    await mountPage({ action: "add" });
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    service.list.mockReturnValue(new Promise(() => undefined));

    await clickCancel();

    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(editor().exists()).toBe(false);
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(newScope)).not.toBeNull();
  });

  it("Save in the leave dialog saves without closing the editor itself", async () => {
    await mountPage({ action: "add" });
    await fillField("add-cipher-key-name-input", "saved_from_leave");
    await fillField("add-cipher-key-openobserve-secret-input", "c2F2ZWQ=");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("the browser Back that drops ?action asks, and closing the dialog stays", async () => {
    await mountPage({ action: "add" });
    await fillField("add-cipher-key-name-input", "half_done");

    const navigation = router.push({ name: "cipherKeys", query: {} });
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.query.action).toBe("add");
  });

  it("the list marks the Add button and the row that hold drafts", async () => {
    writeEditorDraft(newScope, { data: addCipherKeyDefaults() });
    writeEditorDraft(editScope, { data: savedKey() });
    await mountPage();

    expect(byTest("cipher-keys-add-draft-dot")).not.toBeNull();
    expect(byTest("cipher-keys-add-btn")?.getAttribute("aria-label")).toContain("unsaved draft");
    await vi.waitFor(() => expect(byTest("cipher-keys-draft-dot-payments_key")).not.toBeNull());
    expect(byTest("cipher-keys-draft-dot-audit_key")).toBeNull();
  });

  it("deleting a key drops its drafts, singly and in bulk", async () => {
    writeEditorDraft(editScope, { data: savedKey() });
    writeEditorDraft({ ...editScope, entityId: "audit_key" }, { data: savedKey() });
    await mountPage();
    const list = wrapper!.findComponent(CipherKeys).vm as unknown as {
      confirmDeleteCipherKey: (row: { name: string }) => void;
      deleteCipherKey: () => void;
      handleSelectedIdsUpdate: (ids: string[]) => void;
      bulkDeleteCipherKeys: () => void;
    };

    list.confirmDeleteCipherKey({ name: "audit_key" });
    list.deleteCipherKey();
    await flushPromises();
    expect(readEditorDraft({ ...editScope, entityId: "audit_key" })).toBeNull();
    expect(readEditorDraft(editScope)).not.toBeNull();

    list.handleSelectedIdsUpdate(["payments_key"]);
    list.bulkDeleteCipherKeys();
    await flushPromises();
    expect(readEditorDraft(editScope)).toBeNull();
    expect(byTest("cipher-keys-draft-dot-payments_key")).toBeNull();
  });
});
