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
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import sloService from "@/services/slos";
import { getFoldersListByType } from "@/utils/commons";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import { writeEditorDraft } from "@/utils/drafts/editorDraftStore";
import { click } from "@/test/unit/helpers/draftDom";
import AddSlo from "./AddSlo.vue";

vi.mock("@/services/slos", () => ({
  default: {
    get: vi.fn(),
    update: vi.fn(() => Promise.resolve({ data: {} })),
    eligibleAlerts: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    alertPreview: vi.fn(() => Promise.resolve({ data: null })),
  },
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: () => Promise.resolve({ list: [] }),
    getStream: vi.fn(() => Promise.resolve({ schema: [] })),
  }),
}));
vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFoldersListByType: vi.fn(),
}));

const FOLDERS = [
  { folderId: "default", name: "default" },
  { folderId: "payments", name: "Payments" },
  { folderId: "ops", name: "Ops" },
];

const slo = {
  id: "s1",
  org: store.state.selectedOrganization.identifier,
  folder_id: "payments",
  name: "checkout-availability",
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
};

const Stub = { render: () => h("div") };
let wrapper: VueWrapper | null = null;

async function openEdit() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/slos", name: "sloList", component: Stub },
      { path: "/slos/edit/:slo_id", name: "editSlo", component: AddSlo },
    ],
  });
  await router.push("/slos/edit/s1");
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, store, i18n],
        stubs: {
          SloExpressionField: Stub,
          SloPreviewChart: Stub,
          SloTimeSlicePreview: Stub,
          SloAlertPreview: Stub,
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
}

const pickerFolder = () => (wrapper!.findComponent(SelectFolderDropDown).vm as any).selectedFolder;
const formFolder = () => (wrapper!.findComponent(AddSlo).vm as any).form.folder_id;

describe("AddSlo folder on a direct load of the edit page", () => {
  beforeEach(() => {
    localStorage.clear();
    store.state.organizationData.foldersByType = {};
    vi.mocked(sloService.get).mockResolvedValue({ data: slo } as never);
    vi.mocked(getFoldersListByType)
      .mockReset()
      .mockImplementation(async (s: any, type: string) => {
        s.dispatch("setFoldersByType", { [type]: FOLDERS });
        return FOLDERS;
      });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    store.state.organizationData.foldersByType = [];
  });

  it("loads the alert folders and shows the SLO's own folder, without a ?folder query", async () => {
    await openEdit();

    expect(getFoldersListByType).toHaveBeenCalledWith(store, "alerts");
    expect(pickerFolder()).toBe("payments");
    expect(formFolder()).toBe("payments");
  });

  it("shows the SLO's own folder when the folders were already loaded", async () => {
    store.state.organizationData.foldersByType = { alerts: FOLDERS };

    await openEdit();

    expect(getFoldersListByType).not.toHaveBeenCalled();
    expect(pickerFolder()).toBe("payments");
    expect(formFolder()).toBe("payments");
  });

  it("shows the SLO's own folder when the folders arrive only after the SLO loaded", async () => {
    let fillFolders = () => {};
    vi.mocked(getFoldersListByType).mockImplementation(
      (s: any, type: string) =>
        new Promise((resolve) => {
          fillFolders = () => {
            s.dispatch("setFoldersByType", { [type]: FOLDERS });
            resolve(FOLDERS);
          };
        }),
    );

    await openEdit();
    expect(formFolder()).toBe("payments");
    fillFolders();
    await flushPromises();

    expect(pickerFolder()).toBe("payments");
    expect(formFolder()).toBe("payments");
  });

  it("shows the folder of a restored draft", async () => {
    store.state.organizationData.foldersByType = { alerts: FOLDERS };
    writeEditorDraft(
      {
        kind: "slo",
        org: store.state.selectedOrganization.identifier,
        entityId: "s1",
        userEmail: store.state.userInfo.email,
      },
      {
        data: {
          form: {
            name: slo.name,
            description: "",
            tags: [],
            folder_id: "ops",
            sli_type: "count",
            config: { stream_type: "logs", stream: "logs_stream", good_expr: "status < 500" },
            target: 99,
            window_secs: 604800,
            slice_interval_secs: 300,
            groups_estimate: null,
            enabled: true,
          },
          groupBy: [],
          metricsLanguage: "sql",
        },
      },
    );

    await openEdit();
    click("editor-draft-continue");
    await flushPromises();

    expect(formFolder()).toBe("ops");
    expect(pickerFolder()).toBe("ops");
  });
});
