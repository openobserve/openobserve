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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";
import helperStore from "@/test/unit/helpers/store";

vi.mock("@/services/slos", () => ({ default: { create: vi.fn() } }));
vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFoldersListByType: vi.fn(() => Promise.resolve([])),
}));

const push = vi.fn();
const routeQuery: Record<string, string> = {};
vi.mock("vue-router", () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useRoute: () => ({ params: {}, query: routeQuery }),
}));

const toastSpy = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

import ImportSlo from "@/views/slos/ImportSlo.vue";
import sloService from "@/services/slos";
import { getFoldersListByType } from "@/utils/commons";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";

const store = createStore({ state: { selectedOrganization: { identifier: "acme" } } });

const BaseImportStub = {
  props: ["title", "testPrefix", "isImporting"],
  emits: ["back", "cancel", "import"],
  template:
    '<div><slot name="file-input-section" :json-files="null" :update-files="() => {}" /><slot name="output-content" /></div>',
  setup(_props: unknown, { expose }: any) {
    const isImportingLocal = ref(true);
    expose({ isImportingLocal });
    return { isImportingLocal };
  },
};

// What `GET /slos/{id}` returns for a single-query count SLO (see `Slo` in config/src/meta/slo).
const exported = {
  id: "slo-1",
  org: "other-org",
  folder_id: "payments",
  name: "checkout-availability",
  description: "Successful checkout requests",
  sli_type: "count",
  config: {
    source: {
      mode: "single_query",
      query: {
        stream: "app_logs",
        stream_type: "logs",
        scope: "service = 'checkout'",
        good_expr: "status < 500",
      },
    },
  },
  target: 99.9,
  window_secs: 2592000,
  slice_interval_secs: 300,
  enabled: true,
  tags: ["team:pay"],
  owner: "someone@example.com",
  status: { sli: 99.95, error_budget_remaining: 0.6, burn_rate: 0.4, coverage: 1, no_data: false },
  definition_generation: 3,
  groups_estimate: 1,
  groups_reserved: 2,
};

function mountImport() {
  return mount(ImportSlo, {
    global: {
      plugins: [store],
      stubs: { BaseImport: BaseImportStub, SelectFolderDropDown: true, OInput: true, OFile: true },
    },
  });
}

async function runImport(wrapper: any, value: unknown) {
  const jsonStr = typeof value === "string" ? value : JSON.stringify(value);
  wrapper.findComponent(BaseImportStub).vm.$emit("import", { jsonStr });
  await flushPromises();
}

const sentPayloads = () => vi.mocked(sloService.create).mock.calls.map(([, body]) => body as any);

describe("ImportSlo", () => {
  beforeEach(() => {
    vi.mocked(sloService.create)
      .mockReset()
      .mockResolvedValue({ data: { code: 200 } } as any);
    push.mockReset();
    toastSpy.mockReset();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  });

  it("creates a single object in the folder from the query, without server-assigned fields", async () => {
    routeQuery.folder = "team-a";
    const wrapper = mountImport();

    await runImport(wrapper, exported);

    expect(sloService.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sloService.create).mock.calls[0][0]).toBe("acme");
    const [body] = sentPayloads();
    for (const key of [
      "id",
      "org",
      "owner",
      "status",
      "definition_generation",
      "groups_reserved",
    ]) {
      expect(body, `${key} was sent`).not.toHaveProperty(key);
    }
    expect(body.groups_estimate).toBe(exported.groups_estimate);
    expect(body.folder_id).toBe("team-a");
    expect(body.name).toBe("checkout-availability");
    expect(body.tags).toEqual(["team:pay"]);
    expect(body.config).toEqual(exported.config);
  });

  it("creates every item of an array in order, into the selected folder", async () => {
    const wrapper = mountImport();
    wrapper
      .findComponent(SelectFolderDropDown)
      .vm.$emit("folder-selected", { label: "Ops", value: "ops" });

    await runImport(wrapper, [exported, { ...exported, name: "latency" }]);

    expect(sentPayloads().map((b) => [b.name, b.folder_id])).toEqual([
      ["checkout-availability", "ops"],
      ["latency", "ops"],
    ]);
  });

  it("defaults to the default folder without a folder query", async () => {
    const wrapper = mountImport();
    await runImport(wrapper, exported);
    expect(sentPayloads()[0].folder_id).toBe("default");
  });

  it("writes a null or missing tags as [] and drops a null group_by", async () => {
    const wrapper = mountImport();
    const { tags: _tags, ...untagged } = exported;

    await runImport(wrapper, [
      { ...exported, tags: null, group_by: null },
      { ...untagged, name: "no-tags", group_by: ["region"] },
    ]);

    const [nulls, missing] = sentPayloads();
    expect(nulls.tags).toEqual([]);
    expect(nulls).not.toHaveProperty("group_by");
    expect(missing.tags).toEqual([]);
    expect(missing.group_by).toEqual(["region"]);
  });

  it("sends a non-array tags unchanged so the server rejects it visibly", async () => {
    const wrapper = mountImport();

    await runImport(wrapper, { ...exported, tags: "prod" });

    expect(sentPayloads()[0].tags).toBe("prod");
  });

  it("skips an item without a name or that is not an object, and creates the rest", async () => {
    const wrapper = mountImport();

    await runImport(wrapper, [{ ...exported, name: "  " }, "not-an-slo", exported]);

    expect(sloService.create).toHaveBeenCalledTimes(1);
    const results = (wrapper.vm as any).results;
    expect(results.map((r: any) => r.success)).toEqual([false, false, true]);
    expect(results[0].message).toContain("no name");
    expect(results[1].message).toContain("not a JSON object");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the server's message per item and stays on the page on a partial failure", async () => {
    vi.mocked(sloService.create)
      .mockRejectedValueOnce({
        response: { status: 409, data: { message: "SLO name already exists in folder" } },
      })
      .mockResolvedValueOnce({ data: { code: 200 } } as any);
    const wrapper = mountImport();

    await runImport(wrapper, [exported, { ...exported, name: "latency" }]);

    expect(sloService.create).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="slo-import-result-0"]').text()).toContain(
      "SLO name already exists in folder",
    );
    expect(wrapper.find('[data-test="slo-import-result-1"]').text()).toContain("imported");
    expect(push).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect((wrapper.vm as any).baseImportRef.isImportingLocal).toBe(false);
  });

  it("reads a plain-text rejection body as the reason", async () => {
    vi.mocked(sloService.create).mockRejectedValueOnce({
      response: { status: 400, data: "Json deserialize error: missing field `target`" },
    });
    const wrapper = mountImport();

    await runImport(wrapper, exported);

    expect(wrapper.find('[data-test="slo-import-result-0"]').text()).toContain(
      "missing field `target`",
    );
  });

  it("toasts and returns to the list in the import folder when every item succeeds", async () => {
    routeQuery.folder = "team-a";
    const wrapper = mountImport();

    await runImport(wrapper, [exported, { ...exported, name: "latency" }]);

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Imported 2 SLOs" }),
    );
    expect(push).toHaveBeenCalledWith({
      name: "sloList",
      query: { folder: "team-a", org_identifier: "acme" },
    });
  });

  it("rejects text that is not JSON, or empty, without a create call", async () => {
    const wrapper = mountImport();

    await runImport(wrapper, "{not json");
    await runImport(wrapper, "   ");
    await runImport(wrapper, []);

    expect(sloService.create).not.toHaveBeenCalled();
    expect(toastSpy.mock.calls.map(([arg]: any) => arg.variant)).toEqual([
      "error",
      "error",
      "error",
    ]);
    expect(push).not.toHaveBeenCalled();
  });

  it("loads the alert folders for the picker only when the store has none", async () => {
    vi.mocked(getFoldersListByType).mockClear();
    mountImport();
    expect(getFoldersListByType).toHaveBeenCalledWith(store, "alerts");

    vi.mocked(getFoldersListByType).mockClear();
    const loaded = createStore({
      state: {
        selectedOrganization: { identifier: "acme" },
        organizationData: { foldersByType: { alerts: [{ folderId: "default", name: "default" }] } },
      },
    });
    mount(ImportSlo, {
      global: {
        plugins: [loaded],
        stubs: { BaseImport: BaseImportStub, SelectFolderDropDown: true },
      },
    });
    expect(getFoldersListByType).not.toHaveBeenCalled();
  });

  it("imports into default when the folder in the URL is not among the loaded folders", async () => {
    routeQuery.folder = "gone";
    const withFolders = createStore({
      state: {
        selectedOrganization: { identifier: "acme" },
        organizationData: { foldersByType: {} },
      },
    });
    const wrapper = mount(ImportSlo, {
      global: {
        plugins: [withFolders],
        stubs: { BaseImport: BaseImportStub, SelectFolderDropDown: true },
      },
    });
    withFolders.state.organizationData.foldersByType = {
      alerts: [
        { folderId: "default", name: "default" },
        { folderId: "ops", name: "Ops" },
      ],
    };
    await flushPromises();

    await runImport(wrapper, exported);

    expect(sentPayloads()[0].folder_id).toBe("default");
  });

  it("returns to the folder it was opened from on back and cancel", async () => {
    routeQuery.folder = "team-a";
    const wrapper = mountImport();
    wrapper.findComponent(SelectFolderDropDown).vm.$emit("folder-selected", { value: "ops" });

    wrapper.findComponent(BaseImportStub).vm.$emit("back");
    wrapper.findComponent(BaseImportStub).vm.$emit("cancel");

    expect(push.mock.calls.map(([target]) => target.query.folder)).toEqual(["team-a", "team-a"]);
    expect(push.mock.calls[0][0].name).toBe("sloList");
  });
});

describe("ImportSlo with the real BaseImport", () => {
  beforeEach(() => {
    vi.mocked(sloService.create)
      .mockReset()
      .mockResolvedValue({ data: { code: 200 } } as any);
    push.mockReset();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  });

  it("creates what was pasted into the editor when Import is clicked", async () => {
    routeQuery.folder = "team-a";
    // Monaco cannot run in jsdom; the stub forwards pasted text the way the editor's v-model does.
    const QueryEditorStub = {
      props: ["query"],
      emits: ["update:query"],
      template: '<textarea :value="query" @input="$emit(\'update:query\', $event.target.value)" />',
    };
    const wrapper = mount(ImportSlo, {
      global: {
        plugins: [store],
        stubs: { QueryEditor: QueryEditorStub, SelectFolderDropDown: true },
      },
    });
    await flushPromises();

    await wrapper.get('[data-test="slo-import-sql-editor"]').setValue(JSON.stringify([exported]));
    await wrapper.get('[data-test="slo-import-json-btn"]').trigger("click");
    await flushPromises();

    expect(sloService.create).toHaveBeenCalledTimes(1);
    const [org, body] = vi.mocked(sloService.create).mock.calls[0] as [string, any];
    expect(org).toBe("acme");
    expect(body.folder_id).toBe("team-a");
    expect(body.config).toEqual(exported.config);
    for (const key of ["id", "org", "owner", "status", "definition_generation"]) {
      expect(body, `${key} was sent`).not.toHaveProperty(key);
    }
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "sloList" }));
  });

  it("keeps Import disabled until the alert folders have loaded", async () => {
    let finishFetch = () => {};
    vi.mocked(getFoldersListByType).mockImplementationOnce(
      () => new Promise((resolve) => (finishFetch = () => resolve([]))),
    );
    const wrapper = mount(ImportSlo, {
      global: {
        plugins: [store],
        stubs: { QueryEditor: true, SelectFolderDropDown: true },
      },
    });
    await flushPromises();
    const importButton = () => wrapper.get('[data-test="slo-import-json-btn"]');

    expect(importButton().attributes("disabled")).toBeDefined();
    finishFetch();
    await flushPromises();
    expect(importButton().attributes("disabled")).toBeUndefined();
  });

  it("imports into default when the folder fetch fails, which is what the picker shows", async () => {
    routeQuery.folder = "team-a";
    vi.mocked(getFoldersListByType).mockRejectedValueOnce(new Error("network"));
    const QueryEditorStub = {
      props: ["query"],
      emits: ["update:query"],
      template: '<textarea :value="query" @input="$emit(\'update:query\', $event.target.value)" />',
    };
    const wrapper = mount(ImportSlo, {
      global: {
        plugins: [store],
        stubs: { QueryEditor: QueryEditorStub, SelectFolderDropDown: true },
      },
    });
    await flushPromises();

    await wrapper.get('[data-test="slo-import-sql-editor"]').setValue(JSON.stringify(exported));
    await wrapper.get('[data-test="slo-import-json-btn"]').trigger("click");
    await flushPromises();

    expect(sentPayloads()[0].folder_id).toBe("default");
  });

  it("offers the fetched folders in the real picker and imports into the URL's folder", async () => {
    routeQuery.folder = "ops";
    const folders = [
      { folderId: "default", name: "default" },
      { folderId: "ops", name: "Ops" },
    ];
    let finishFetch = () => {};
    vi.mocked(getFoldersListByType).mockImplementationOnce(
      (s: any, type: string) =>
        new Promise((resolve) => {
          finishFetch = () => {
            s.dispatch("setFoldersByType", { [type]: folders });
            resolve(folders);
          };
        }),
    );
    helperStore.state.organizationData.foldersByType = {};
    const QueryEditorStub = {
      props: ["query"],
      emits: ["update:query"],
      template: '<textarea :value="query" @input="$emit(\'update:query\', $event.target.value)" />',
    };
    const wrapper = mount(ImportSlo, {
      global: { plugins: [helperStore], stubs: { QueryEditor: QueryEditorStub } },
    });
    await flushPromises();
    const importButton = () => wrapper.get('[data-test="slo-import-json-btn"]');
    const picker = () => wrapper.findComponent(SelectFolderDropDown).vm as any;

    expect(importButton().attributes("disabled")).toBeDefined();
    finishFetch();
    await flushPromises();

    expect(importButton().attributes("disabled")).toBeUndefined();
    expect(picker().folderOptions.map((o: any) => o.value)).toEqual(["default", "ops"]);
    expect(picker().selectedFolder).toBe("ops");

    await wrapper.get('[data-test="slo-import-sql-editor"]').setValue(JSON.stringify(exported));
    await importButton().trigger("click");
    await flushPromises();

    expect(sentPayloads()[0].folder_id).toBe("ops");
    helperStore.state.organizationData.foldersByType = [];
  });
});
