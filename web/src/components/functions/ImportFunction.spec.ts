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
import { queryClient } from "@/composables/query/queryClient";
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
    // The screen reads existing names through the shared query cache, which outlives
    // a test and would serve the previous one's fixture.
    queryClient.clear();
    // clearAllMocks drops call history but keeps queued `...Once` outcomes, and a
    // rejection queued for a write this screen no longer makes would be served to
    // whichever test writes next.
    mockCreate.mockReset();
    mockUpdate.mockReset();
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

  // Nothing is held back by this screen. It validates the shape of the document
  // and sends every item, the way the pipeline and template import screens do; a
  // name the org already holds is the server's answer, not a local guess. The
  // old pre-check needed a prompt raised on one press and acted on by the next,
  // and that second press silently kept the existing function.
  describe("name already exists", () => {
    const conflicting = { name: "parse_nginx", function: ".b = 2", params: "row", transType: 0 };
    const serverRejectsClash = () =>
      mockCreate.mockRejectedValueOnce({
        response: { data: { message: "Function already exist" } },
      });

    it("asks the server nothing while a name is taken, and everything once it is freed", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      expect(mockCreate).not.toHaveBeenCalled();

      // Replacing is a choice about the same name, so the write is intended and
      // goes out -- the clash is no longer an error to answer.
      await wrapper.vm.onOverrideChoice("parse_nginx", 0, true);
      await flushPromises();
      await pressImport(wrapper);

      expect(wrapper.text()).not.toContain("already exists");
    });

    it("raises the clash without sending the item", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);

      // The org already holds the name, so the rename box answers it before a
      // write is attempted rather than after one is refused.
      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("already exists");
      expect(mockToastFn).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("offers the name box and the replace checkbox on the rejection", async () => {
      serverRejectsClash();
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);

      // The controls are async components jsdom never mounts, so what is
      // asserted is the field the pane renders the name box and checkbox from.
      expect(wrapper.vm.functionErrors.at(-1).map((e: any) => e.field)).toEqual(["name_exists"]);
    });

    it("imports under a new name when the clash is renamed away", async () => {
      serverRejectsClash();
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      wrapper.vm.updateFunctionName("parse_nginx_v2", 0);
      await nextTick();
      await pressImport(wrapper);

      // Only the renamed press reaches the server; the clashing one never did.
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][1]).toMatchObject({
        name: "parse_nginx_v2",
        function: ".b = 2",
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("overrides through PUT once the user asks to replace the existing one", async () => {
      serverRejectsClash();
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
    });

    it("names the pipelines an override would change", async () => {
      serverRejectsClash();
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await wrapper.vm.onOverrideChoice("parse_nginx", 0, true);
      await flushPromises();
      await nextTick();

      expect(mockGetAssociatedPipelines).toHaveBeenCalledWith("test-org", "parse_nginx");
      expect(wrapper.text()).toContain("nginx_ingest");
    });

    // The choice belonged to the file that raised it. Kept across a new file it
    // would replace whatever arrived under that name next.
    it("drops the choices made for one file when another is loaded", async () => {
      serverRejectsClash();
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      await wrapper.vm.onOverrideChoice("parse_nginx", 0, true);
      await flushPromises();

      await loadDocument(wrapper, { name: "parse_json", function: ".c = 3" });

      expect(wrapper.vm.overrideExisting).toEqual({});
    });

    // The name box says what it can about what is typed. What the ORG holds is
    // not among it — that answer only exists on the server.
    it("judges what is typed into the name box as it is typed", async () => {
      serverRejectsClash();
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);

      wrapper.vm.updateFunctionName("not a name", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toContain("letters, numbers and underscores");

      wrapper.vm.updateFunctionName("", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toContain("Enter a function name");

      // The same list the press checks, so the box says now what the press
      // would say next.
      wrapper.vm.updateFunctionName("parse_json", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toContain("already taken");

      wrapper.vm.updateFunctionName("parse_nginx_v2", 0);
      await nextTick();
      expect(wrapper.vm.nameInputError[0]).toBeNull();
    });

    // The clash check reads a list of the org's names. Kept across an org switch
    // it would report names that are free here and miss the ones that are not.
    it("forgets the names it read when the org changes", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, conflicting);
      expect(wrapper.text()).toContain("already exists");

      mockList.mockResolvedValue({ data: { list: [] } });
      store.state.selectedOrganization = { identifier: "other-org" };
      await flushPromises();

      await pressImport(wrapper);

      // Free in the new org, so it is written rather than reported as taken.
      expect(wrapper.text()).not.toContain("already exists");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // Re-sending a function THIS run created is an update of our own work. It
    // only avoided being reported as taken because the list was read before the
    // write; that is luck, not a rule.
    it("does not report the function it just wrote as a name that is taken", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, { name: "brand_new", function: ".a = 1" });
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // The list now holds it, the way a re-read would find it.
      (wrapper.vm as any).existingNames = new Set(["brand_new"]);
      await pressImport(wrapper);

      expect(wrapper.text()).not.toContain("already exists");
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

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

    // A document that is not shaped right is not sent at all — that part is the
    // screen's to judge, and it is the only thing that stops a press.
    it("sends nothing while any item is malformed", async () => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, [conflicting, { name: "fn_b", function: "  " }]);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("function body is required");
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
      // Language first: it is the smaller control and it decides how the body
      // below it is read.
      expect(wrapper.vm.functionErrors.at(-1).map((e: any) => e.field)).toEqual([
        "trans_type",
        "function_body",
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

    // An entry that is not an object is rejected like any other and offered the
    // same controls, so those controls have to have somewhere to write. Writing
    // into the entry itself threw on a primitive and did nothing at all on a
    // null, so the typed name never reached the document and the item could not
    // be fixed however long the user tried.
    it.each([
      ["a bare string", "just a string"],
      ["a null", null],
    ])("repairs %s entry rather than refusing to be fixed", async (_label, entry) => {
      const wrapper = mountScreen();
      await flushPromises();

      await importJson(wrapper, [entry]);

      expect(() => wrapper.vm.updateFunctionName("fn_rescued", 0)).not.toThrow();
      wrapper.vm.updateFunctionBody(".a = 1", 0);
      await nextTick();

      expect(JSON.parse(wrapper.vm.baseImportRef.jsonStr)[0]).toMatchObject({
        name: "fn_rescued",
        function: ".a = 1",
      });
    });
  });

  // Under RBAC the list is filtered, so a name can be taken without the screen
  // ever being able to see it. Since nothing is pre-checked, that case is not
  // special: the server answers, and the same controls appear.
  it("turns a server-reported clash into the same conflict prompt", async () => {
    mockCreate.mockRejectedValueOnce({ response: { data: { message: "Function already exist" } } });
    const wrapper = mountScreen();
    await flushPromises();

    const invisible = { name: "hidden_fn", function: ".a = 1", params: "row", transType: 0 };
    await importJson(wrapper, invisible);

    expect(wrapper.text()).toContain("already exist");
    expect(mockToastFn).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));

    // Override then writes through PUT, even though the list never showed it.
    await wrapper.vm.onOverrideChoice("hidden_fn", 0, true);
    await flushPromises();
    await pressImport(wrapper);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ name: "hidden_fn" });
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

      // a_fn goes back as an update of this run's own work, not as a clash it
      // caused itself — and never as something set aside.
      expect(wrapper.text()).not.toContain("already exist");
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate.mock.calls[0][1]).toMatchObject({ name: "a_fn" });
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(mockCreate.mock.calls[2][1]).toMatchObject({ name: "b_fn", function: ".b = 2" });
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
      expect(wrapper.text()).toContain("overridden");
      expect(wrapper.text()).not.toContain("already exist");
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
