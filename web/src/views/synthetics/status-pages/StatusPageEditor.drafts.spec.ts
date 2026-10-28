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
import statusPagesService from "@/services/status_pages";
import OForm from "@/lib/forms/Form/OForm.vue";
import {
  editorDraftKey,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { fillField } from "@/test/unit/helpers/fillField";
import StatusPageEditor from "./StatusPageEditor.vue";

vi.mock("@/services/status_pages", () => ({
  default: {
    get: vi.fn(),
    update: vi.fn(() => Promise.resolve({ data: {} })),
    updateComponents: vi.fn(() => Promise.resolve({ data: {} })),
    rotateSlug: vi.fn(),
  },
}));
vi.mock("@/services/synthetics", () => ({
  default: { listByFolderId: vi.fn(() => Promise.resolve({ data: { checks: [] } })) },
}));
vi.mock("@/utils/commons", () => ({ getFoldersListByType: vi.fn(() => Promise.resolve([])) }));

interface PageForm {
  state: { values: Record<string, unknown> };
  setFieldValue: (k: string, v: unknown) => void;
  getFieldMeta: (k: string) => { errors?: unknown[] } | undefined;
}

const ORG = store.state.selectedOrganization.identifier;
const EMAIL = store.state.userInfo.email;
const scope: EditorDraftScope = {
  kind: "status_page",
  org: ORG,
  entityId: "page-1",
  userEmail: EMAIL,
};

const LOGO = "iVBORw0KGgoAAAANSUhEUgAAAfsAAAHyCAYAAADshGcaAAA9EElEQVR4";

const serverPage = (extra: Record<string, unknown> = {}) => ({
  id: "page-1",
  name: "Acme status",
  slug: "acme",
  description: "",
  brand_name: "Acme",
  accent_color: "",
  logo_img: LOGO,
  favicon_img: "",
  visibility: 1,
  password_set: false,
  noindex: true,
  show_uptime_percent: true,
  show_timeline_bars: true,
  confirm_failures: 2,
  confirm_recovery: 2,
  health: "operational",
  updated_at: 1793108642000000,
  components: [{ id: "c1", name: "API", description: "", check_ids: [] }],
  ...extra,
});

const Stub = { render: () => h("div") };

let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/synthetics", name: "synthetics", component: Stub },
      {
        path: "/synthetics/status-pages/edit/:id",
        name: "synthetics-status-page-edit",
        component: StatusPageEditor,
      },
      { path: "/logs", name: "logs", component: Stub },
    ],
  });
  await router.push("/synthetics/status-pages/edit/page-1");
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: { plugins: [router, store, i18n], stubs: { StatusPagePreview: Stub } },
    },
  );
  await flushPromises();
};

const remount = async () => {
  wrapper?.unmount();
  wrapper = null;
  await mountEditor();
};

const form = () =>
  (
    wrapper!.findComponent(StatusPageEditor).findComponent(OForm).vm as unknown as {
      form: PageForm;
    }
  ).form;

const edit = async (values: Record<string, unknown>) => {
  window.dispatchEvent(new Event("pointerdown"));
  Object.entries(values).forEach(([field, value]) => form().setFieldValue(field, value));
  await nextTick();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );
const restoreButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-restore-dialog"] [data-test="${id}"]`,
  );

describe("StatusPageEditor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(statusPagesService.update).mockClear();
    vi.mocked(statusPagesService.updateComponents).mockClear();
    vi.mocked(statusPagesService.get).mockResolvedValue({ data: serverPage() } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes the page's draft under its id, leaving out the unchanged logo and the password", async () => {
    await mountEditor();
    await edit({ name: "Acme cloud", visibility: "password", password: "hunter2" });
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{
      values: Record<string, unknown>;
      components: { name: string }[];
    }>(scope);
    expect(draft?.data.values).toMatchObject({ name: "Acme cloud", logo_img: null, password: "" });
    expect(draft?.data.components.map((c) => c.name)).toEqual(["API"]);
    expect(localStorage.getItem(editorDraftKey(scope))).not.toContain("hunter2");
    expect(localStorage.getItem(editorDraftKey(scope))).not.toContain(LOGO);
  });

  it("counts a component name typed with no key or pointer event", async () => {
    await mountEditor();
    await fillField("status-page-component-name-0", "Public API");
    window.dispatchEvent(new Event("pagehide"));

    expect(
      readEditorDraft<{ components: { name: string }[] }>(scope)?.data.components[0].name,
    ).toBe("Public API");
  });

  it("continues a draft into the form, its components and the loaded logo", async () => {
    await mountEditor();
    await edit({ name: "Acme cloud", brand_name: "Acme Inc" });
    byTest("status-page-add-component")?.click();
    await flushPromises();
    window.dispatchEvent(new Event("pagehide"));

    await remount();
    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this status page",
    );
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(form().state.values).toMatchObject({
      name: "Acme cloud",
      brand_name: "Acme Inc",
      logo_img: LOGO,
    });
    expect(byTest("status-page-component-row-1")).not.toBeNull();
  });

  it("Start fresh drops the draft and Escape keeps it for the next visit", async () => {
    writeEditorDraft(scope, {
      data: { values: { name: "Kept" }, usingOrgLogoDefault: false, components: [] },
    });
    await mountEditor();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    if (byTest("editor-draft-restore-dialog")) restoreButton("o-dialog-close-btn")?.click();
    await flushPromises();
    expect(form().state.values.name).toBe("Acme status");
    expect(readEditorDraft(scope)).not.toBeNull();

    await remount();
    restoreButton("o-dialog-secondary-btn")?.click();
    await flushPromises();
    expect(readEditorDraft(scope)).toBeNull();
    expect(form().state.values.name).toBe("Acme status");
  });

  it("ignores health and timestamps, and warns when the page itself changed", async () => {
    await mountEditor();
    await edit({ description: "Cloud regions" });
    window.dispatchEvent(new Event("pagehide"));

    vi.mocked(statusPagesService.get).mockResolvedValue({
      data: serverPage({ health: "degraded", updated_at: 1793109999000000 }),
    } as never);
    await remount();
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();

    vi.mocked(statusPagesService.get).mockResolvedValue({
      data: serverPage({ name: "Renamed elsewhere" }),
    } as never);
    await remount();
    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("drops the draft of a page that no longer exists", async () => {
    writeEditorDraft(scope, {
      data: { values: { name: "Gone" }, usingOrgLogoDefault: false, components: [] },
    });
    vi.mocked(statusPagesService.get).mockRejectedValue({ response: { status: 404 } });
    await mountEditor();

    expect(readEditorDraft(scope)).toBeNull();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
  });

  it("a changed password comes back blank, is named, and blocks Save until typed again", async () => {
    // With a stored password a blank field is valid, so only the draft's re-entry rule stops the save.
    vi.mocked(statusPagesService.get).mockResolvedValue({
      data: serverPage({ visibility: 2, password_set: true }),
    } as never);
    await mountEditor();
    await edit({ password: "hunter2" });
    window.dispatchEvent(new Event("pagehide"));

    await remount();
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain("Password");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values).toMatchObject({ visibility: "password", password: "" });

    byTest("status-page-editor-save")?.click();
    await flushPromises();
    expect(statusPagesService.update).not.toHaveBeenCalled();
    expect(form().getFieldMeta("password")?.errors?.length).toBeGreaterThan(0);

    await edit({ password: "n3w-pass" });
    byTest("status-page-editor-save")?.click();
    await vi.waitFor(() => expect(statusPagesService.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(statusPagesService.update).mock.calls[0][2]).toMatchObject({
      password: "n3w-pass",
    });
  });

  it("a not-kept password stops blocking Save once the page no longer uses one", async () => {
    await mountEditor();
    await edit({ visibility: "password", password: "hunter2" });
    window.dispatchEvent(new Event("pagehide"));

    await remount();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    await edit({ visibility: "public" });
    byTest("status-page-editor-save")?.click();
    await vi.waitFor(() => expect(statusPagesService.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(statusPagesService.update).mock.calls[0][2]).not.toHaveProperty("password");
  });

  it("leaves a logo too large for storage out of the draft, says so, and keeps the loaded one", async () => {
    const huge = "A".repeat(256 * 1024 + 1);
    await mountEditor();
    await edit({ name: "Big logo", logo_img: huge });
    window.dispatchEvent(new Event("pagehide"));

    const stored = localStorage.getItem(editorDraftKey(scope)) ?? "";
    expect(stored).toContain("Big logo");
    expect(stored.length).toBeLessThan(10_000);

    await remount();
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain("Logo");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values).toMatchObject({ name: "Big logo", logo_img: LOGO });

    byTest("status-page-editor-save")?.click();
    await vi.waitFor(() => expect(statusPagesService.update).toHaveBeenCalledTimes(1));
  });

  it("Cancel asks; Keep draft leaves with the draft, Discard leaves without it", async () => {
    await mountEditor();
    await edit({ name: "Keep me" });
    byTest("status-page-editor-cancel")?.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-secondary-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("synthetics");
    expect(router.currentRoute.value.query.section).toBe("status-pages");
    expect(readEditorDraft<{ values: { name: string } }>(scope)?.data.values.name).toBe("Keep me");

    await remount();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    byTest("status-page-editor-back")?.click();
    await flushPromises();
    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("synthetics");
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("Save in the leave dialog saves and goes where the user was headed", async () => {
    await mountEditor();
    await edit({ description: "Cloud regions" });

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(statusPagesService.update).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("a normal save drops the draft and returns to the list without asking", async () => {
    await mountEditor();
    await edit({ description: "Cloud regions" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(scope)).not.toBeNull();

    byTest("status-page-editor-save")?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("synthetics"));
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(scope)).toBeNull();
  });
});
