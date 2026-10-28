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
import announcements from "@/services/announcements";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import AnnouncementBannerList from "./AnnouncementBannerList.vue";
import AnnouncementBannerEditor from "./AnnouncementBannerEditor.vue";
import AnnouncementBannerEditorForm from "./AnnouncementBannerEditorForm.vue";
import { draftFromAuthored } from "./announcementDrafts";

vi.mock("@/services/announcements", () => ({
  default: { getActive: vi.fn(), getConfig: vi.fn(), setConfig: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

const service = announcements as unknown as Record<string, ReturnType<typeof vi.fn>>;

const maintenance = {
  id: "banner-maint01",
  message: "Scheduled maintenance tonight at 22:00 UTC",
  variant: "warning",
};
const promo = { id: "banner-promo01", message: "Try the new AI assistant", variant: "promo" };

const newScope: EditorDraftScope = {
  kind: "announcement_banner",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: maintenance.id };

const draftData = (message: string, banner: Record<string, unknown> = maintenance) => ({
  values: { ...draftFromAuthored(banner), message },
  resetDismissals: false,
  audience: "all",
  styleChoice: "warning",
  colorChoice: "default",
});

let router: Router;
let wrapper: VueWrapper | null = null;

const mountAt = async (
  name: "announcementBanners" | "announcementBannerEditor",
  query: Record<string, string> = {},
) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/settings/announcements",
        name: "announcementBanners",
        component: AnnouncementBannerList,
      },
      {
        path: "/settings/announcements/edit",
        name: "announcementBannerEditor",
        component: AnnouncementBannerEditor,
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
    wrapper!.findComponent(AnnouncementBannerEditorForm).vm as unknown as {
      form: { state: { values: { message: string } } };
    }
  ).form;
const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const inDialog = (dialog: string, id: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${dialog}"] [data-test="${id}"]`);
const leaveButton = (id: string) => inDialog("editor-draft-leave-dialog", id);
const savedBanners = () =>
  (service.setConfig.mock.calls.at(-1)?.[1] as { banners: Record<string, unknown>[] }).banners;

describe("AnnouncementBannerEditor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
    service.getConfig.mockResolvedValue({
      data: { banners: [maintenance, promo], styles: [], revision: 3 },
    });
    service.setConfig.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("drafts a message typed into a new banner", async () => {
    await mountAt("announcementBannerEditor");
    await fillField("announcement-editor-message", "Ingestion is delayed in us-east-1");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{ values: { message: string } }>(newScope);
    expect(draft?.data.values.message).toBe("Ingestion is delayed in us-east-1");
  });

  it("keys an edited banner's draft by its id and the stored banner", async () => {
    await mountAt("announcementBannerEditor", { index: "0" });
    await fillField("announcement-editor-message", "Maintenance moved to 23:00 UTC");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{ values: { message: string } }>(editScope);
    expect(draft?.data.values.message).toBe("Maintenance moved to 23:00 UTC");
    expect(draft?.baseHash).toBe(hashDraftValue(maintenance));
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Continue restores the draft, and leaving afterwards still asks", async () => {
    writeEditorDraft(editScope, {
      data: draftData("Maintenance moved to 23:00 UTC"),
      baseHash: hashDraftValue(maintenance),
    });
    await mountAt("announcementBannerEditor", { index: "0" });

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("announcement banner");
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values.message).toBe("Maintenance moved to 23:00 UTC");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;
    expect(router.currentRoute.value.name).toBe("logs");
  });

  it("Start fresh drops the draft and Escape keeps it", async () => {
    writeEditorDraft(newScope, { data: draftData("From the draft", {}) });
    await mountAt("announcementBannerEditor");
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(form().state.values.message).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();
    wrapper!.unmount();

    await mountAt("announcementBannerEditor");
    inDialog("editor-draft-restore-dialog", "o-dialog-secondary-btn")?.click();
    await flushPromises();
    expect(form().state.values.message).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Cancel opens the shared leave dialog, and Discard leaves and drops the draft", async () => {
    await mountAt("announcementBannerEditor", { index: "0" });
    await fillField("announcement-editor-message", "Not kept");
    window.dispatchEvent(new Event("pagehide"));

    byTest("announcement-editor-cancel")?.click();
    await flushPromises();
    expect(byTest("announcement-editor-leave-dialog")).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("announcementBanners");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("Save in the leave dialog saves, then the pending navigation goes on", async () => {
    await mountAt("announcementBannerEditor", { index: "0" });
    await fillField("announcement-editor-message", "Saved from leave");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;

    expect(savedBanners()[0]).toMatchObject({ id: maintenance.id, message: "Saved from leave" });
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("a normal save drops the draft and returns to the list without asking", async () => {
    await mountAt("announcementBannerEditor", { index: "0" });
    await fillField("announcement-editor-message", "Saved normally");
    window.dispatchEvent(new Event("pagehide"));

    byTest("announcement-editor-save")?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("announcementBanners"));

    expect(savedBanners()[0]).toMatchObject({ message: "Saved normally" });
    expect(readEditorDraft(editScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("keeps the browser's own prompt for a reload with unsaved changes", async () => {
    await mountAt("announcementBannerEditor");
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await fillField("announcement-editor-message", "Half written");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("a duplicate drafts in its own slot", async () => {
    await mountAt("announcementBannerEditor", { duplicate: "1" });
    await fillField("announcement-editor-message", "Try the AI assistant in dashboards");
    window.dispatchEvent(new Event("pagehide"));

    const scope = { ...newScope, variant: `duplicate:${promo.id}` };
    expect(readEditorDraft<{ values: { message: string } }>(scope)?.data.values.message).toBe(
      "Try the AI assistant in dashboards",
    );
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("the list marks the Add button, the edited row and the duplicated row", async () => {
    writeEditorDraft(newScope, { data: draftData("New", {}) });
    writeEditorDraft(editScope, { data: draftData("Edited") });
    writeEditorDraft(
      { ...newScope, variant: `duplicate:${promo.id}` },
      { data: draftData("Copy", promo) },
    );
    await mountAt("announcementBanners");

    expect(byTest("announcement-list-add-draft-dot")).not.toBeNull();
    await vi.waitFor(() => expect(byTest("announcement-list-draft-dot-0")).not.toBeNull());
    expect(byTest("announcement-list-draft-dot-1")).toBeNull();
    expect(byTest("announcement-list-duplicate-draft-dot-1")).not.toBeNull();
    expect(byTest("announcement-list-duplicate-draft-dot-0")).toBeNull();
  });

  describe("a legacy banner stored without an id", () => {
    const legacy = { message: "Old banner without an id", variant: "info" };
    beforeEach(() => {
      service.getConfig.mockResolvedValue({
        data: { banners: [maintenance, legacy, promo], styles: [], revision: 3 },
      });
    });

    it("keeps no draft of it or of its copy, and the list shows no dot", async () => {
      await mountAt("announcementBannerEditor", { index: "1" });
      await fillField("announcement-editor-message", "Old banner, edited");
      window.dispatchEvent(new Event("pagehide"));
      wrapper!.unmount();
      await mountAt("announcementBannerEditor", { duplicate: "1" });
      await fillField("announcement-editor-message", "Copy of the old banner");
      window.dispatchEvent(new Event("pagehide"));

      expect(localStorage.length).toBe(0);
      wrapper!.unmount();
      await mountAt("announcementBanners");
      await vi.waitFor(() => expect(byTest("announcement-list-status-1")).not.toBeNull());
      expect(byTest("announcement-list-draft-dot-1")).toBeNull();
      expect(byTest("announcement-list-duplicate-draft-dot-1")).toBeNull();
    });

    it("leaving with changes asks Save or Discard, with no Keep draft", async () => {
      await mountAt("announcementBannerEditor", { index: "1" });
      await fillField("announcement-editor-message", "Old banner, edited");

      byTest("announcement-editor-cancel")?.click();
      await flushPromises();
      expect(byTest("editor-draft-leave-message")?.textContent).toContain("discard your changes");
      expect(leaveButton("o-dialog-secondary-btn")).toBeNull();
      leaveButton("o-dialog-close-btn")?.click();
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("announcementBannerEditor");

      byTest("announcement-editor-cancel")?.click();
      await flushPromises();
      leaveButton("o-dialog-neutral-btn")?.click();
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("announcementBanners");
      expect(localStorage.length).toBe(0);
    });

    it("Save in that dialog saves, then the pending navigation goes on", async () => {
      await mountAt("announcementBannerEditor", { index: "1" });
      await fillField("announcement-editor-message", "Old banner, saved");

      const navigation = router.push("/logs");
      await flushPromises();
      leaveButton("editor-draft-leave-save")?.click();
      await navigation;

      expect(savedBanners()[1]).toMatchObject({ message: "Old banner, saved" });
      expect(router.currentRoute.value.name).toBe("logs");
    });
  });

  it("deleting a banner drops its drafts, and its copy's", async () => {
    writeEditorDraft(editScope, { data: draftData("Edited") });
    const copyScope = { ...newScope, variant: `duplicate:${maintenance.id}` };
    writeEditorDraft(copyScope, { data: draftData("Copy") });
    await mountAt("announcementBanners");
    const list = wrapper!.findComponent(AnnouncementBannerList).vm as unknown as {
      confirmDelete: (index: number) => void;
      removeBanner: () => Promise<void>;
    };

    list.confirmDelete(0);
    await list.removeBanner();
    await flushPromises();

    expect(savedBanners()).toEqual([promo]);
    expect(readEditorDraft(editScope)).toBeNull();
    expect(readEditorDraft(copyScope)).toBeNull();
  });
});
