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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

import ImportFunction from "@/components/functions/ImportFunction.vue";
import i18n from "@/locales";

const { mockList, mockCreate, mockUpdate, mockGetAssociatedPipelines, mockToastFn } = vi.hoisted(
  () => ({
    mockList: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockGetAssociatedPipelines: vi.fn(),
    mockToastFn: vi.fn(),
  }),
);

vi.mock("@/services/jstransform", () => ({
  default: {
    list: mockList,
    create: mockCreate,
    update: mockUpdate,
    getAssociatedPipelines: mockGetAssociatedPipelines,
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToastFn(...args),
}));

// Stands in for BaseImport: the screen drives it through the same three fields
// and one method, so the stub exposes exactly those.
const BaseImportStub = {
  name: "BaseImport",
  props: ["title", "testPrefix", "hideHeader", "isImporting", "containerClass", "containerStyle"],
  emits: ["back", "cancel", "import"],
  template: '<div data-test-stub="base-import"><slot name="output-content"></slot></div>',
  setup(_props: any, { expose, emit }: any) {
    const jsonArrayOfObj = ref<any[]>([]);
    const jsonStr = ref("");
    const isImportingLocal = ref(false);
    const handleImport = () => {
      isImportingLocal.value = true;
      emit("import", { jsonStr: jsonStr.value, jsonArray: jsonArrayOfObj.value });
    };
    expose({ jsonArrayOfObj, jsonStr, isImportingLocal, handleImport });
    return {};
  },
};

describe("ImportFunction", () => {
  let store: any;
  let router: any;

  const existing = [
    { name: "parse_nginx", function: ".a = 1", params: "row", transType: 0, numArgs: 1 },
  ];

  const mountScreen = () =>
    mount(ImportFunction, {
      global: {
        plugins: [i18n, store, router],
        stubs: { BaseImport: BaseImportStub, OPageLayout: { template: "<div><slot /></div>" } },
      },
    });

  // Feeds the editor and presses Import, the way the header button does.
  const importJson = async (wrapper: any, payload: unknown) => {
    wrapper.vm.baseImportRef.jsonStr = JSON.stringify(payload);
    await wrapper.vm.importJson({ jsonStr: wrapper.vm.baseImportRef.jsonStr });
    await flushPromises();
    await nextTick();
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ data: { list: existing } });
    mockCreate.mockResolvedValue({ data: { code: 200 } });
    mockUpdate.mockResolvedValue({ data: { code: 200 } });
    mockGetAssociatedPipelines.mockResolvedValue({ data: { list: [{ name: "nginx_ingest" }] } });

    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        userInfo: { email: "test@example.com" },
        theme: "light",
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/functions",
          name: "functionList",
          component: { template: "<div>FunctionList</div>" },
        },
        {
          path: "/functions/import",
          name: "importFunction",
          component: { template: "<div>ImportFunction</div>" },
        },
      ],
    });
    router.push("/functions/import");
    await router.isReady();
  });

  it("creates a function whose name is free", async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, { name: "new_fn", function: ".a = 1", params: "row", transType: 0 });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1]).toEqual({
      name: "new_fn",
      function: ".a = 1",
      params: "row",
      transType: 0,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("defaults params to row when the file omits it", async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, { name: "new_fn", function: ".a = 1" });

    expect(mockCreate.mock.calls[0][1].params).toBe("row");
    expect(mockCreate.mock.calls[0][1].transType).toBe(0);
  });

  // A file BaseImport could not parse arrives here as an empty array.
  it("refuses an empty item list instead of reporting a successful import of nothing", async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, []);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockToastFn).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: expect.stringContaining("No functions found"),
      }),
    );
    expect(mockToastFn).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("reports a missing name and writes nothing", async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, { function: ".a = 1" });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("name is required");
  });

  it("reports a missing body and writes nothing", async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, { name: "new_fn", function: "   " });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("function body is required");
  });

  describe("name already exists", () => {
    const conflicting = { name: "parse_nginx", function: ".b = 2", params: "row", transType: 0 };

    it("surfaces the conflict on the first press and writes nothing", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('"parse_nginx" already exists');
      expect(wrapper.find('[data-test="function-import-error-0-0"]').exists()).toBe(true);
    });

    it("keeps the existing function when the choice is left at its default", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await importJson(wrapper, conflicting);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("the existing function was kept");
    });

    it("says nothing was imported when every item is skipped", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await importJson(wrapper, conflicting);

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "info",
          message: expect.stringContaining("Nothing imported"),
        }),
      );
      expect(mockToastFn).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("overrides through PUT once the user picks override", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await wrapper.vm.onConflictChoice(0, "override");
      await flushPromises();
      await importJson(wrapper, conflicting);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate.mock.calls[0][1]).toMatchObject({
        name: "parse_nginx",
        function: ".b = 2",
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("names the pipelines an override would change", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await wrapper.vm.onConflictChoice(0, "override");
      await flushPromises();
      await nextTick();

      expect(mockGetAssociatedPipelines).toHaveBeenCalledWith("test-org", "parse_nginx");
      expect(wrapper.text()).toContain("nginx_ingest");
    });
  });

  // Under RBAC the list is filtered, so a name can be taken without the screen
  // ever seeing it; the 400 is the only signal.
  it("turns a server-reported clash into the same conflict prompt", async () => {
    mockCreate.mockRejectedValueOnce({ response: { data: { message: "Function already exist" } } });
    const wrapper = mountScreen();
    await flushPromises();

    const invisible = { name: "hidden_fn", function: ".a = 1", params: "row", transType: 0 };
    await importJson(wrapper, invisible);

    expect(wrapper.text()).toContain('"hidden_fn" already exists');
    expect(wrapper.text()).not.toContain("failed");
    expect(mockToastFn).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));

    // Override then writes through PUT, even though the list never showed it.
    await wrapper.vm.onConflictChoice(0, "override");
    await flushPromises();
    await importJson(wrapper, invisible);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ name: "hidden_fn" });
  });

  it("reports a failed item instead of navigating away", async () => {
    mockCreate.mockRejectedValueOnce({ response: { data: { message: "invalid VRL" } } });
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, { name: "bad_fn", function: "nope(", params: "row", transType: 0 });

    expect(wrapper.text()).toContain("invalid VRL");
    expect(mockToastFn).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("imports every item in a multi-function file", async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, [
      { name: "fn_a", function: ".a = 1", params: "row", transType: 0 },
      { name: "fn_b", function: ".b = 2", params: "row", transType: 1 },
    ]);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][1].transType).toBe(1);
  });
});
