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
import sloService from "@/services/slos";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import AddSlo from "./AddSlo.vue";

const getStreams = vi.fn((type: string) => Promise.resolve({ list: [{ name: `${type}_stream` }] }));

vi.mock("@/services/slos", () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(() => Promise.resolve({ data: {} })),
    update: vi.fn(() => Promise.resolve({ data: {} })),
    eligibleAlerts: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    alertPreview: vi.fn(() => Promise.resolve({ data: null })),
  },
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: (type: string) => getStreams(type),
    getStream: vi.fn(() => Promise.resolve({ schema: [] })),
  }),
}));

interface SloDraft {
  form: Record<string, unknown> & { config: Record<string, unknown> };
  groupBy: string[];
  metricsLanguage: "sql" | "prom_ql";
}

const ORG = store.state.selectedOrganization.identifier;
const EMAIL = store.state.userInfo.email;
const newScope: EditorDraftScope = { kind: "slo", org: ORG, entityId: null, userEmail: EMAIL };
const editScope: EditorDraftScope = { ...newScope, entityId: "s1" };

const serverSlo = (status = { sli: 99.94, computed_at: 1793108642 }) => ({
  id: "s1",
  org: ORG,
  folder_id: "default",
  name: "api-availability",
  description: "",
  sli_type: "count",
  config: {
    source: {
      mode: "single_query",
      query: { stream: "logs_stream", stream_type: "logs", good_expr: "status < 500" },
    },
  },
  window_secs: 604800,
  slice_interval_secs: 300,
  target: 99,
  tags: [],
  enabled: true,
  definition_generation: 1,
  status,
});

const Stub = { render: () => h("div") };

let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async (path: string, viewAttrs: Record<string, string> = {}) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/slos", name: "sloList", component: Stub },
      { path: "/slos/add", name: "addSlo", component: AddSlo },
      { path: "/slos/edit/:slo_id", name: "editSlo", component: AddSlo },
      { path: "/logs", name: "logs", component: Stub },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView, viewAttrs) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, store, i18n],
        stubs: {
          SloExpressionField: Stub,
          SloPreviewChart: Stub,
          SelectFolderDropDown: Stub,
          SloTimeSlicePreview: Stub,
          SloAlertPreview: Stub,
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
};

const vm = () =>
  wrapper!.findComponent(AddSlo).vm as unknown as {
    form: Record<string, unknown> & { config: Record<string, unknown> };
    metricsLanguage: string;
    sloDraft: { hasUnsavedChanges: () => boolean };
  };

const edit = async (fields: Record<string, unknown>) => {
  window.dispatchEvent(new Event("pointerdown"));
  Object.assign(vm().form, fields);
  await nextTick();
};

describe("AddSlo drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    getStreams.mockClear();
    vi.mocked(sloService.create).mockClear();
    vi.mocked(sloService.update).mockClear();
    vi.mocked(sloService.get).mockResolvedValue({ data: serverSlo() } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("keeps a single root so the layout's class reaches the page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await mountEditor("/slos/add", { class: "slo-root-probe" });

    expect(document.body.querySelector(".slo-root-probe")).not.toBeNull();
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Extraneous non-props attributes/);
    warn.mockRestore();
  });

  it("writes a new SLO's form, grouping and language when the page hides", async () => {
    await mountEditor("/slos/add");
    await edit({ name: "checkout-latency", target: 99.5 });
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<SloDraft>(newScope);
    expect(draft?.data.form).toMatchObject({ name: "checkout-latency", target: 99.5 });
    expect(draft?.data.groupBy).toEqual([]);
    expect(draft?.data.metricsLanguage).toBe("prom_ql");
  });

  it("continues a PromQL count draft without the shape watchers wiping its expressions", async () => {
    writeEditorDraft(newScope, {
      data: {
        form: {
          name: "metrics-slo",
          description: "",
          tags: [],
          sli_type: "count",
          config: {
            stream_type: "metrics",
            good: "sum(rate(ok[5m]))",
            total: "sum(rate(all[5m]))",
          },
          target: 99.9,
          window_secs: 2592000,
          slice_interval_secs: 300,
          group_by: null,
          groups_estimate: null,
          enabled: true,
          folder_id: "default",
        },
        groupBy: [],
        metricsLanguage: "prom_ql",
      },
    });
    await mountEditor("/slos/add");

    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this SLO",
    );
    click("editor-draft-continue");
    await flushPromises();

    expect(vm().form.name).toBe("metrics-slo");
    expect(vm().form.config).toMatchObject({
      stream_type: "metrics",
      good: "sum(rate(ok[5m]))",
      total: "sum(rate(all[5m]))",
    });
    expect(vm().metricsLanguage).toBe("prom_ql");
    expect(getStreams).toHaveBeenLastCalledWith("metrics");
    expect(vm().sloDraft.hasUnsavedChanges()).toBe(true);
  });

  it("keys an edited SLO's draft by its id and ignores live status in the base", async () => {
    await mountEditor("/slos/edit/s1");
    await edit({ description: "Checkout availability" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<SloDraft>(editScope)?.data.form.description).toBe(
      "Checkout availability",
    );
    expect(readEditorDraft(newScope)).toBeNull();
    wrapper?.unmount();

    vi.mocked(sloService.get).mockResolvedValue({
      data: serverSlo({ sli: 98.1, computed_at: 1793109999 }),
    } as never);
    await mountEditor("/slos/edit/s1");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
  });

  it("warns when the SLO definition changed on the server", async () => {
    writeEditorDraft(editScope, {
      data: { form: { name: "api-availability" }, groupBy: [], metricsLanguage: "sql" },
      baseHash: "00000000",
    });
    await mountEditor("/slos/edit/s1");

    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("drops the draft of an SLO that no longer exists", async () => {
    writeEditorDraft(editScope, {
      data: { form: { name: "gone" }, groupBy: [], metricsLanguage: "sql" },
    });
    vi.mocked(sloService.get).mockRejectedValue({ response: { status: 404 } });
    await mountEditor("/slos/edit/s1");

    expect(readEditorDraft(editScope)).toBeNull();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
  });

  it("drafts a name filled with no key or pointer event, and Cancel asks", async () => {
    await mountEditor("/slos/add");
    await fillField("slos-addslo-name", "autofilled-slo");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<SloDraft>(newScope)?.data.form.name).toBe("autofilled-slo");

    click("slos-addslo-cancel");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(router.currentRoute.value.name).toBe("addSlo");
  });

  it("Escape on the restore dialog keeps the draft, Start fresh drops it", async () => {
    await mountEditor("/slos/add");
    await edit({ name: "from-draft" });
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor("/slos/add");
    pressEscape();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(vm().form.name).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();
    wrapper!.unmount();

    await mountEditor("/slos/add");
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(vm().form.name).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Keep draft leaves and offers the work on the next visit", async () => {
    await mountEditor("/slos/add");
    await edit({ name: "kept-slo" });

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("o-dialog-secondary-btn");
    await navigation;
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<SloDraft>(newScope)?.data.form.name).toBe("kept-slo");
    wrapper!.unmount();

    await mountEditor("/slos/add");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
  });

  it("Cancel with unsaved changes asks, and Discard drops the draft and leaves", async () => {
    await mountEditor("/slos/add");
    await edit({ name: "to-discard" });
    window.dispatchEvent(new Event("pagehide"));

    click("slos-addslo-cancel");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();

    clickLeave("o-dialog-neutral-btn");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("sloList");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog saves without going to the list, then continues", async () => {
    await mountEditor("/slos/edit/s1");
    await edit({ description: "Checkout availability" });

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(sloService.update).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("Save in the leave dialog keeps the user in the editor when the form is invalid", async () => {
    await mountEditor("/slos/add");
    await edit({ description: "no name yet" });

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(sloService.create).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("addSlo");
    expect(vm().sloDraft.hasUnsavedChanges()).toBe(true);
  });

  it("a normal save drops the draft and leaves without asking", async () => {
    await mountEditor("/slos/edit/s1");
    await edit({ description: "Checkout availability" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    click("slos-addslo-save");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("sloList"));

    expect(sloService.update).toHaveBeenCalledTimes(1);
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(editScope)).toBeNull();
  });
});
