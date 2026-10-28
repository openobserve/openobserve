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
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { fillField } from "@/test/unit/helpers/fillField";
import { queryClient } from "@/composables/query/queryClient";
import modelPricingService from "@/services/model_pricing";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import ModelPricingList from "./ModelPricingList.vue";
import ModelPricingEditor from "./ModelPricingEditor.vue";

vi.mock("@/services/model_pricing", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      test: vi.fn(),
    },
  });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

const service = modelPricingService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const modelId = "3Dw5lhNTd4Y929mIlgEMrKyI4mM";
const newScope: EditorDraftScope = {
  kind: "model_pricing",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: modelId };
const duplicateScope: EditorDraftScope = { ...newScope, variant: `duplicate:${modelId}` };

const gpt4o = () => ({
  id: modelId,
  org_id: "default",
  name: "GPT-4o",
  match_pattern: "(?i)^gpt-4o$",
  enabled: true,
  tiers: [{ name: "Default", prices: { input: 2.5e-6, output: 1e-5 } }],
  sort_order: 0,
  source: "org",
  created_at: 1779180443802830,
  updated_at: 1779180443802830,
});
const claude = {
  ...gpt4o(),
  id: "3HrQlsvQqqX1j0dc1n8DGK4ZpPg",
  name: "Claude Sonnet 4.6",
  match_pattern: "claude-sonnet-4-6",
};

const formDraft = (name: string) => ({
  name,
  match_pattern: "(?i)^gpt-4o$",
  tiers: [
    {
      name: "Default",
      condition: null,
      utc_windows: [],
      rules: [],
      priority: 0,
      prices: [
        { key: "input", value: 2.5 },
        { key: "output", value: 10 },
      ],
      draftKey: "",
      draftValue: 0,
    },
  ],
});

const comparable = (m: ReturnType<typeof gpt4o>) => ({
  name: m.name,
  match_pattern: m.match_pattern,
  tiers: m.tiers,
  sort_order: m.sort_order,
  valid_from: null,
});

let router: Router;
let wrapper: VueWrapper | null = null;

const mountAt = async (name: "modelPricing" | "modelPricingEditor", query = {}) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings/model_pricing", name: "modelPricing", component: ModelPricingList },
      {
        path: "/settings/model_pricing/edit",
        name: "modelPricingEditor",
        component: ModelPricingEditor,
      },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push({ name, query });
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, store, router] } },
  );
  await flushPromises();
};

const form = () =>
  (
    wrapper!.findComponent(ModelPricingEditor).vm as unknown as {
      form: { state: { values: { name: string } } };
    }
  ).form;
const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const inDialog = (dialog: string, id: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${dialog}"] [data-test="${id}"]`);
const leaveButton = (id: string) => inDialog("editor-draft-leave-dialog", id);

describe("ModelPricingEditor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
    service.list.mockResolvedValue({ data: [gpt4o(), claude] });
    service.get.mockResolvedValue({ data: gpt4o() });
    service.create.mockResolvedValue({ data: {} });
    service.update.mockResolvedValue({ data: {} });
    service.delete.mockResolvedValue({ data: {} });
    service.test.mockResolvedValue({ data: { captured_models: [] } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("drafts a filled-in new model", async () => {
    await mountAt("modelPricingEditor");
    await fillField("model-pricing-name-input", "Gemini 2.5 Pro");
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft<{ name: string }>(newScope)?.data.name).toBe("Gemini 2.5 Pro");
  });

  it("Continue restores the draft, Start fresh drops it, Escape keeps it", async () => {
    writeEditorDraft(newScope, { data: formDraft("From draft") });
    await mountAt("modelPricingEditor");
    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("model pricing");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values.name).toBe("From draft");
    wrapper!.unmount();

    await mountAt("modelPricingEditor");
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();
    wrapper!.unmount();

    await mountAt("modelPricingEditor");
    inDialog("editor-draft-restore-dialog", "o-dialog-secondary-btn")?.click();
    await flushPromises();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("keys an edited model's draft by its id and the fields this editor writes", async () => {
    await mountAt("modelPricingEditor", { id: modelId });
    await fillField("model-pricing-name-input", "GPT-4o (EU)");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{ name: string }>(editScope);
    expect(draft?.data.name).toBe("GPT-4o (EU)");
    expect(draft?.baseHash).toBe(hashDraftValue(comparable(gpt4o())));
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("a toggle on the list does not count as a server change", async () => {
    writeEditorDraft(editScope, {
      data: formDraft("GPT-4o (EU)"),
      baseHash: hashDraftValue(comparable(gpt4o())),
    });
    service.get.mockResolvedValue({ data: { ...gpt4o(), enabled: false, updated_at: 1 } });
    await mountAt("modelPricingEditor", { id: modelId });

    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
  });

  it("a duplicate drafts in its own slot, apart from a new model", async () => {
    writeEditorDraft(newScope, { data: formDraft("Unrelated new") });
    await mountAt("modelPricingEditor", { id: modelId, duplicate: "true" });

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    await fillField("model-pricing-name-input", "GPT-4o copy for EU");
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft<{ name: string }>(duplicateScope)?.data.name).toBe("GPT-4o copy for EU");
    expect(readEditorDraft<{ name: string }>(newScope)?.data.name).toBe("Unrelated new");
  });

  it("opening a deleted model drops its draft with a notice", async () => {
    writeEditorDraft(editScope, { data: formDraft("GPT-4o (EU)") });
    service.get.mockRejectedValue({ response: { status: 404, data: {} } });
    await mountAt("modelPricingEditor", { id: modelId });

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(editScope)).toBeNull();
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "info",
        message: expect.stringContaining("model pricing"),
      }),
    );
  });

  it("Cancel asks, and Discard leaves and drops the draft", async () => {
    await mountAt("modelPricingEditor", { id: modelId });
    await fillField("model-pricing-name-input", "Not kept");
    window.dispatchEvent(new Event("pagehide"));

    byTest("model-pricing-editor-cancel-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("modelPricingEditor");
    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("modelPricing");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("Keep draft leaves and keeps the work", async () => {
    await mountAt("modelPricingEditor", { id: modelId });
    await fillField("model-pricing-name-input", "Kept for later");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<{ name: string }>(editScope)?.data.name).toBe("Kept for later");
  });

  it("Save in the leave dialog saves, then the pending navigation goes on", async () => {
    await mountAt("modelPricingEditor", { id: modelId });
    await fillField("model-pricing-name-input", "Saved from leave");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;

    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.update.mock.calls[0][2].name).toBe("Saved from leave");
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("a normal save drops the draft and returns to the list without asking", async () => {
    await mountAt("modelPricingEditor", { id: modelId });
    await fillField("model-pricing-name-input", "Saved normally");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    byTest("model-pricing-editor-save-btn")?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("modelPricing"));

    expect(service.update).toHaveBeenCalledTimes(1);
    expect(readEditorDraft(editScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("the list marks New model, the edited row and the row whose duplicate holds a draft", async () => {
    writeEditorDraft(newScope, { data: formDraft("New") });
    writeEditorDraft(editScope, { data: formDraft("Edited") });
    writeEditorDraft(
      { ...duplicateScope, variant: `duplicate:${claude.id}` },
      {
        data: formDraft("Copy"),
      },
    );
    await mountAt("modelPricing");

    expect(byTest("model-pricing-add-draft-dot")).not.toBeNull();
    await vi.waitFor(() => expect(byTest(`model-pricing-draft-dot-${modelId}`)).not.toBeNull());
    expect(byTest(`model-pricing-draft-dot-${claude.id}`)).toBeNull();
    expect(byTest(`model-pricing-${claude.id}-more-actions-draft-dot`)).not.toBeNull();
    expect(byTest(`model-pricing-${modelId}-more-actions-draft-dot`)).toBeNull();
  });

  it("deleting a model drops its drafts, singly and in bulk", async () => {
    const claudeScope = { ...editScope, entityId: claude.id };
    writeEditorDraft(editScope, { data: formDraft("Edited") });
    writeEditorDraft(claudeScope, { data: formDraft("Edited") });
    await mountAt("modelPricing");
    const list = wrapper!.findComponent(ModelPricingList).vm as unknown as {
      confirmDelete: (row: unknown) => void;
      confirmDeleteSelected: () => void;
      confirmDialogMeta: { onConfirm: () => Promise<void> };
      selectedIds: string[];
    };

    const claudeCopy = { ...duplicateScope, variant: `duplicate:${claude.id}` };
    writeEditorDraft(claudeCopy, { data: formDraft("Copy") });
    writeEditorDraft(duplicateScope, { data: formDraft("Copy") });

    list.confirmDelete(claude);
    await list.confirmDialogMeta.onConfirm();
    expect(readEditorDraft(claudeScope)).toBeNull();
    expect(readEditorDraft(claudeCopy)).toBeNull();
    expect(readEditorDraft(duplicateScope)).not.toBeNull();
    expect(readEditorDraft(editScope)).not.toBeNull();

    list.selectedIds = [modelId];
    list.confirmDeleteSelected();
    await list.confirmDialogMeta.onConfirm();
    expect(readEditorDraft(editScope)).toBeNull();
    expect(readEditorDraft(duplicateScope)).toBeNull();
  });
});
