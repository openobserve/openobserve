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
import { nextTick, ref, watch } from "vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

import ImportFunction from "@/components/functions/ImportFunction.vue";
import config from "@/aws-exports";
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

// Mutable so a test can pick the entitlement before mounting — the JS gate is a
// computed over this plain object, evaluated per component instance.
vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false" },
}));

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
// and one method, so the stub exposes exactly those — and re-emits the way the
// real one does, because the screen reads those events to decide when the
// document on screen has been replaced.
const BaseImportStub = {
  name: "BaseImport",
  props: ["title", "testPrefix", "hideHeader", "isImporting", "containerClass"],
  emits: ["back", "cancel", "import", "update:jsonStr", "update:jsonArray"],
  template: '<div data-test-stub="base-import"><slot name="output-content"></slot></div>',
  setup(_props: any, { expose, emit }: any) {
    const jsonArrayOfObj = ref<any[]>([]);
    const jsonStr = ref("");
    const isImportingLocal = ref(false);

    watch(jsonStr, (newVal) => emit("update:jsonStr", newVal));
    watch(
      jsonArrayOfObj,
      (newVal) => {
        if (newVal && newVal.length > 0) {
          jsonStr.value = JSON.stringify(newVal, null, 2);
          emit("update:jsonStr", jsonStr.value);
          emit("update:jsonArray", newVal);
        }
      },
      { deep: true },
    );

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
    { name: "parse_json", function: ".b = 1", params: "row", transType: 0, numArgs: 1 },
  ];

  const mountScreen = () =>
    mount(ImportFunction, {
      global: {
        plugins: [i18n, store, router],
        stubs: { BaseImport: BaseImportStub, OPageLayout: { template: "<div><slot /></div>" } },
      },
    });

  // Puts a document in the editor, the way choosing a file or typing does. The
  // await matters: BaseImport announces the new content before the user can
  // reach the Import button, and the screen drops its pending choices on it.
  const loadDocument = async (wrapper: any, payload: unknown) => {
    wrapper.vm.baseImportRef.jsonStr = JSON.stringify(payload);
    await nextTick();
    await flushPromises();
  };

  // Presses Import on whatever is in the editor, the way the header button does.
  const pressImport = async (wrapper: any) => {
    await wrapper.vm.importJson({ jsonStr: wrapper.vm.baseImportRef.jsonStr });
    await flushPromises();
    await nextTick();
  };

  const importJson = async (wrapper: any, payload: unknown) => {
    await loadDocument(wrapper, payload);
    await pressImport(wrapper);
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

  // The create form's own rule, which the backend does not enforce: without it
  // an import can write a name the edit form then refuses to save.
  describe("name rules", () => {
    it("refuses a name the Add Function form would reject", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "my-fn with space", function: ".a = 1" });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("is not a valid function name");
    });

    // Padding used to slip past the clash check (which read the raw name) and
    // reach the server, which saw the trimmed one and answered 400.
    it("refuses a padded name rather than letting it hide a clash", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: " parse_nginx ", function: ".a = 1" });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("is not a valid function name");
    });

    // Undetected, the second copy came back as a server clash — and overriding
    // it would have replaced what this same import had just created.
    it("flags a name repeated inside one file", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, [
        { name: "dup", function: ".a = 1" },
        { name: "dup", function: ".b = 2" },
      ]);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("appears more than once in this file");
    });
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
      await pressImport(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("the existing function was kept");
    });

    it("says nothing was imported when every item is skipped", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await pressImport(wrapper);

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "info",
          message: expect.stringContaining("Nothing imported"),
        }),
      );
      expect(mockToastFn).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("overrides through PUT once the user asks to replace the existing one", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await wrapper.vm.onOverrideChoice("parse_nginx", 0, true);
      await flushPromises();
      await pressImport(wrapper);

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
      await wrapper.vm.onOverrideChoice("parse_nginx", 0, true);
      await flushPromises();
      await nextTick();

      expect(mockGetAssociatedPipelines).toHaveBeenCalledWith("test-org", "parse_nginx");
      expect(wrapper.text()).toContain("nginx_ingest");
    });

    // The choice belonged to the file that raised it. Kept across a new file —
    // and keyed by position — it silently overrode whatever sat at that index.
    it("drops the choices made for one file when another is loaded", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await wrapper.vm.onOverrideChoice("parse_nginx", 0, true);
      await flushPromises();

      // A different file, a different existing function, same position.
      await importJson(wrapper, { name: "parse_json", function: ".c = 3" });

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('"parse_json" already exists');
      expect(wrapper.vm.overrideExisting).toEqual({});
    });

    // Skipping and overriding were the only two ways out of a clash, so the
    // obvious third — bring it in under a free name — meant hand-editing the JSON.
    it("imports under a new name when the clash is renamed away", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      expect(wrapper.text()).toContain('"parse_nginx" already exists');

      wrapper.vm.updateFunctionName("parse_nginx_v2", 0);
      await nextTick();
      await pressImport(wrapper);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toMatchObject({
        name: "parse_nginx_v2",
        function: ".b = 2",
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    // The rename box wrote whatever was typed and only complained on the next
    // press, so a name that could never work took a round trip to find out.
    it("judges what is typed into the name box as it is typed", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);

      wrapper.vm.updateFunctionName("not a name", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toContain("letters, numbers and underscores");

      wrapper.vm.updateFunctionName("parse_json", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toContain("already taken");

      wrapper.vm.updateFunctionName("", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toContain("Enter a function name");

      wrapper.vm.updateFunctionName("parse_nginx_v2", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toBeNull();
    });

    // Two items may not both claim one name, and the box has to say so before
    // the press turns it into a server 400 that reads like an unrelated clash.
    it("catches a rename that collides with another item in the same file", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, [
        { name: "fn_a", function: ".a = 1" },
        { name: "fn_b", function: "  " },
      ]);

      wrapper.vm.updateFunctionName("fn_a", 1);
      await nextTick();
      expect(wrapper.vm.nameInputError[1]).toContain("Another function in this file");
    });

    // Replacing the existing one is a decision about that name, so the box has
    // nothing left to object to.
    it("drops the name box's objection once the user chooses to replace", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      wrapper.vm.updateFunctionName("parse_nginx", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toContain("already taken");

      await wrapper.vm.onOverrideChoice("parse_nginx", 0, true);
      await flushPromises();
      expect(wrapper.vm.nameInputError[0]).toBeNull();
    });

    // The clash was reported once per screen, so a name typed into the rename
    // box was skipped with no prompt at all.
    it("prompts for a clash the rename box introduces", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { function: ".a = 1" });
      expect(wrapper.text()).toContain("name is required");

      wrapper.vm.updateFunctionName("parse_nginx", 0);
      await nextTick();
      await flushPromises();
      await pressImport(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('"parse_nginx" already exists');
    });

    // Pressing Import again is the obvious next move on "already exists", and it
    // used to be the press that cleared the name box and the replace checkbox,
    // leaving the raw JSON as the only way to rename.
    it("keeps the clash controls on screen after it skips", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      expect(wrapper.text()).toContain('"parse_nginx" already exists');

      await pressImport(wrapper);

      expect(wrapper.text()).toContain("skipped, the existing function was kept");
      expect(wrapper.text()).toContain('"parse_nginx" already exists');
      expect(wrapper.find('[data-test="function-import-override-checkbox-0"]').exists()).toBe(true);
    });

    // ...and the rename is still one edit away rather than a reload of the file.
    it("still takes a rename after the skip", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await pressImport(wrapper);

      wrapper.vm.updateFunctionName("parse_nginx_v2", 0);
      await nextTick();
      await pressImport(wrapper);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toMatchObject({ name: "parse_nginx_v2" });
    });

    // The picker has to stay reachable while a second item is still being
    // fixed, even though its own clash no longer holds the import back.
    it("keeps the picker on screen while another item is still invalid", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, [conflicting, { name: "fn_b", function: "  " }]);
      expect(wrapper.text()).toContain('"parse_nginx" already exists');

      await pressImport(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("function body is required");
      expect(wrapper.text()).toContain('"parse_nginx" already exists');
    });
  });

  // Every check the import runs has to be answerable from the output pane. A
  // message with no control beside it sends the user back into the raw JSON.
  describe("fixing a rejected item in place", () => {
    it("takes the missing body from the editor it offers", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "fn_a", function: "" });
      expect(wrapper.text()).toContain("function body is required");

      wrapper.vm.updateFunctionBody(".a = 1", 0);
      await nextTick();
      await pressImport(wrapper);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toMatchObject({ name: "fn_a", function: ".a = 1" });
    });

    // A JavaScript function written against VRL tokenizing reads as broken.
    it("opens the body editor in the language the item declares", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "fn_a", function: "", transType: 1 });
      expect(wrapper.vm.bodyLanguage(0)).toBe("javascript");

      await importJson(wrapper, { name: "fn_b", function: "", transType: 0 });
      expect(wrapper.vm.bodyLanguage(0)).toBe("vrl");
    });

    it("takes an unusable type from the language picker", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "fn_a", function: ".a = 1", transType: "vrl" });
      expect(wrapper.text()).toContain("type must be 0 for VRL");

      wrapper.vm.updateTransType("0", 0);
      await nextTick();
      await pressImport(wrapper);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toMatchObject({ transType: 0 });
    });

    // Found by hand: the picker normalised an unusable transType to VRL, so it
    // opened already displaying the answer. Choosing VRL then emitted no change,
    // wrote nothing, and the same error came back on every press — a dead end.
    it("leaves the language unselected when the value is not a language", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "fn_a", function: ".a = 1", transType: "vrl" });

      expect(wrapper.vm.currentTransType(0)).toBe("");
    });

    // Absent is different from unusable: nothing is wrong with it, and VRL is
    // what the payload will send, so the picker may show it.
    it("shows VRL when the item declares no language at all", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "fn_a", function: "" });

      expect(wrapper.vm.currentTransType(0)).toBe("0");
      expect(wrapper.vm.bodyLanguage(0)).toBe("vrl");
    });

    // OSS builds cannot run JavaScript, so offering it would only trade this
    // validation error for a server-side one.
    it("offers VRL only on OSS", async () => {
      (config as any).isEnterprise = "false";
      const wrapper = mountScreen();
      await flushPromises();

      expect(wrapper.vm.transTypeOptions.map((o: any) => o.value)).toEqual(["0"]);
    });

    it("offers JavaScript where the build can run it", async () => {
      (config as any).isEnterprise = "true";
      const wrapper = mountScreen();
      await flushPromises();

      expect(wrapper.vm.transTypeOptions.map((o: any) => o.value)).toEqual(["0", "1"]);
    });

    it("takes unusable params from the params box", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "fn_a", function: ".a = 1", params: ["row"] });
      expect(wrapper.text()).toContain("params must be a string");

      wrapper.vm.updateParams("row", 0);
      await nextTick();
      await pressImport(wrapper);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toMatchObject({ params: "row" });
    });

    // A definition the server refuses used to print its compiler error and stop
    // there. The commonest cause is a JavaScript body with no transType, read by
    // the VRL compiler — the body looks fine and the language is what is wrong.
    it("offers the body and the language after the server refuses an item", async () => {
      mockCreate.mockRejectedValueOnce({
        response: { data: { message: "error[E203]: syntax error" } },
      });
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "testffff", function: "throw new Error('x')" });

      expect(wrapper.text()).toContain("error[E203]");
      expect(wrapper.text()).toContain("was rejected");
      expect(wrapper.text()).toContain("read as VRL");
      // The controls themselves are async components that jsdom never mounts, so
      // what is asserted is the pair of fields the pane renders them from.
      expect(wrapper.vm.functionErrors.at(-1).map((e: any) => e.field)).toEqual([
        "function_body",
        "trans_type",
      ]);
    });

    it("re-sends the item once the language is corrected", async () => {
      mockCreate.mockRejectedValueOnce({
        response: { data: { message: "error[E203]: syntax error" } },
      });
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "testffff", function: "throw new Error('x')" });

      wrapper.vm.updateTransType("1", 0);
      await nextTick();
      await pressImport(wrapper);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate.mock.calls[1][1]).toMatchObject({ name: "testffff", transType: 1 });
    });

    // The control is a correction, so it opens on what is already there. Offering
    // a blank editor over a rejected definition would ask the user to retype it.
    it("opens the body editor on the definition that was refused", async () => {
      mockCreate.mockRejectedValueOnce({
        response: { data: { message: "error[E203]: syntax error" } },
      });
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "testffff", function: "throw new Error('x')" });

      expect(wrapper.vm.currentBody(0)).toBe("throw new Error('x')");
      // No transType in the file, so it reads as VRL — which is what the payload
      // sent, and why the VRL compiler is what rejected it.
      expect(wrapper.vm.currentTransType(0)).toBe("0");
      expect(wrapper.vm.bodyLanguage(0)).toBe("vrl");
    });

    // Whatever is typed on the right has to be what leaves on the next press,
    // and the JSON pane on the left is how the user checks that.
    it("writes every fix-up back into the document", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "", function: "", params: ["row"] });

      wrapper.vm.updateFunctionName("fn_a", 0);
      wrapper.vm.updateFunctionBody(".a = 1", 0);
      wrapper.vm.updateParams("row", 0);
      await nextTick();

      expect(JSON.parse(wrapper.vm.baseImportRef.jsonStr)[0]).toMatchObject({
        name: "fn_a",
        function: ".a = 1",
        params: "row",
      });
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
    await wrapper.vm.onOverrideChoice("hidden_fn", 0, true);
    await flushPromises();
    await pressImport(wrapper);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ name: "hidden_fn" });
  });

  // After a partial run the second press used to report the functions the first
  // press created as "skipped, the existing function was kept".
  it("says what this run already wrote, and does not write it twice", async () => {
    mockCreate
      .mockResolvedValueOnce({ data: { code: 200 } })
      .mockRejectedValueOnce({ response: { data: { message: "Function already exist" } } });
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, [
      { name: "fn_a", function: ".a = 1" },
      { name: "hidden_fn", function: ".b = 2" },
    ]);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    await pressImport(wrapper);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="function-import-result-0"]').text()).toContain(
      "already imported by this run",
    );
  });

  // A run rarely goes in on one press: something fails, the user fixes it in the
  // editor, and presses again. The fix is a different document, so everything
  // keyed to the document is dropped — but what the first press WROTE is not.
  describe("fixing one item and pressing again", () => {
    // A server that remembers, so a second create of the same name is rejected
    // the way the real one rejects it.
    const useRememberingServer = () => {
      const created: any[] = [];
      mockCreate.mockImplementation(async (_org: string, payload: any) => {
        if (payload.function === "nope(") {
          throw { response: { data: { message: "compile error" } } };
        }
        if (created.some((fn) => fn.name === payload.name)) {
          throw { response: { data: { message: "Function already exist" } } };
        }
        created.push({ ...payload });
        return { data: { code: 200 } };
      });
      mockUpdate.mockImplementation(async (_org: string, payload: any) => {
        const at = created.findIndex((fn) => fn.name === payload.name);
        if (at >= 0) created[at] = { ...payload };
        return { data: { code: 200 } };
      });
      mockList.mockImplementation(async () => ({ data: { list: [...existing, ...created] } }));
      return created;
    };

    it("leaves alone the function it created while the other item was failing", async () => {
      useRememberingServer();
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, [
        { name: "a_fn", function: ".a = 1" },
        { name: "b_fn", function: "nope(" },
      ]);
      expect(wrapper.text()).toContain("compile error");

      // The user repairs b_fn in the editor: a different document.
      await importJson(wrapper, [
        { name: "a_fn", function: ".a = 1" },
        { name: "b_fn", function: ".b = 2" },
      ]);

      // a_fn is neither re-sent nor held up for a clash it caused itself.
      expect(wrapper.text()).not.toContain('"a_fn" already exists');
      expect(wrapper.find('[data-test="function-import-result-0"]').text()).toContain(
        "already imported by this run",
      );
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(mockCreate.mock.calls[2][1]).toMatchObject({ name: "b_fn", function: ".b = 2" });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    // The other half of owning what it wrote: an edit to that function is this
    // run's own change, so it goes back as an update with nothing to confirm.
    it("sends its own function again when the user changes it", async () => {
      useRememberingServer();
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "a_fn", function: ".a = 1" });
      expect(mockCreate).toHaveBeenCalledTimes(1);

      await importJson(wrapper, { name: "a_fn", function: ".a = 2" });

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate.mock.calls[0][1]).toMatchObject({ name: "a_fn", function: ".a = 2" });
      expect(wrapper.text()).toContain("re-imported with your change");
      expect(wrapper.text()).not.toContain('"a_fn" already exists');
    });
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

  // The post-import redirect is a timer. Left running, it pulls the user back to
  // the Functions list from wherever they went inside the window.
  it("abandons the redirect when the screen is left before it fires", async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await importJson(wrapper, { name: "new_fn", function: ".a = 1" });
    const push = vi.spyOn(router, "push");

    wrapper.unmount();
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(push).not.toHaveBeenCalled();
  });
});
